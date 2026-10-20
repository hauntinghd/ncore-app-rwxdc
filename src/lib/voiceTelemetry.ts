/**
 * Voice telemetry — join timing, region probing, and steady-state quality.
 *
 * `NCORE_ULTRA_LOW_LATENCY_MOONSHOT.md` sets a target of warm join-to-first-audio
 * under 500 ms and lists what has to be measured to chase it. None of it was
 * being recorded, so every claim about voice latency to date has been a guess.
 * This is the measurement layer; schema is `20260730150000_voice_telemetry.sql`.
 *
 * Everything here is best-effort and swallows its own failures. Telemetry that
 * can break a call is worse than no telemetry.
 */
import { supabase } from './supabase';
import type { IRTCClient } from './rtc/rtcProvider';

export type VoiceSessionKind = 'server_voice' | 'direct_call';
export type VoiceOutcome = 'connected' | 'failed' | 'abandoned';

export interface RegionProbe {
  region: string;
  rttMs: number;
}

// ---------------------------------------------------------------------------
// Region probing
// ---------------------------------------------------------------------------

/**
 * Candidate voice regions and a probe endpoint for each.
 *
 * The endpoints are Agora's regional gateways. We measure the time to a
 * response of any kind — including an error response — because reachability and
 * round-trip time are what matter, not what the endpoint says.
 */
const REGION_PROBES: Array<{ region: string; url: string }> = [
  { region: 'us-west', url: 'https://webrtc2-ap-web-3.agora.io/api/v1' },
  { region: 'us-east', url: 'https://webrtc2-ap-web-4.agora.io/api/v1' },
  { region: 'eu-west', url: 'https://webrtc2-ap-web-2.agora.io/api/v1' },
  { region: 'ap-southeast', url: 'https://webrtc2-ap-web-1.agora.io/api/v1' },
];

const PROBE_TIMEOUT_MS = 2500;
const PROBE_CACHE_MS = 5 * 60_000;

let probeCache: { probes: RegionProbe[]; at: number } | null = null;

/**
 * Times a single region endpoint.
 *
 * `mode: 'no-cors'` gives an opaque response we cannot read, which is fine —
 * the timing is the measurement. A network error still yields a useful upper
 * bound only if it was a timeout, so failures return null and are dropped
 * rather than being recorded as a very fast zero.
 */
async function probeRegion(url: string): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const started = performance.now();
  try {
    await fetch(url, {
      method: 'HEAD',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    });
    return Math.round(performance.now() - started);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probes every candidate region in parallel, fastest first.
 *
 * Cached for five minutes: the doc asks for probing "after login and when
 * network changes", and re-probing on every join would add latency to the
 * exact operation it is meant to speed up.
 */
export async function probeRegions(force = false): Promise<RegionProbe[]> {
  if (!force && probeCache && Date.now() - probeCache.at < PROBE_CACHE_MS) {
    return probeCache.probes;
  }

  const results = await Promise.all(
    REGION_PROBES.map(async ({ region, url }) => {
      const rttMs = await probeRegion(url);
      return rttMs === null ? null : { region, rttMs };
    }),
  );

  const probes = results
    .filter((probe): probe is RegionProbe => probe !== null)
    .sort((left, right) => left.rttMs - right.rttMs);

  probeCache = { probes, at: Date.now() };
  return probes;
}

/** The lowest-RTT reachable region, or null if none responded. */
export async function bestRegion(): Promise<string | null> {
  const probes = await probeRegions();
  return probes[0]?.region ?? null;
}

/** Called when the network changes, so the next join re-probes. */
export function invalidateRegionProbes() {
  probeCache = null;
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', invalidateRegionProbes);
  const connection = (navigator as { connection?: EventTarget }).connection;
  connection?.addEventListener('change', invalidateRegionProbes);
}

// ---------------------------------------------------------------------------
// Join tracking
// ---------------------------------------------------------------------------

interface TrackerContext {
  kind: VoiceSessionKind;
  channelId?: string | null;
  conversationId?: string | null;
  communityId?: string | null;
  provider?: string;
  userId: string | null;
}

function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor(fraction * sorted.length));
  return Math.round(sorted[index]);
}

/**
 * Measures one join attempt from intent to teardown.
 *
 * Create it the moment the user asks to join — before token fetch — because
 * the token round trip is part of what they experience as "joining", and
 * excluding it would flatter the numbers.
 */
export class VoiceJoinTracker {
  private readonly startedAt = performance.now();
  private readonly context: TrackerContext;

  private tokenFetchMs: number | null = null;
  private rtcConnectedMs: number | null = null;
  private firstLocalPublishMs: number | null = null;
  private firstRemoteAudioMs: number | null = null;

  private selectedRegion: string | null = null;
  private regionProbes: Record<string, number> = {};

  private rttSamples: number[] = [];
  private packetLossSamples: number[] = [];
  private reconnectCount = 0;
  private failoverCount = 0;

  private statsTimer: number | null = null;
  private finished = false;

  constructor(context: TrackerContext) {
    this.context = context;
  }

  private since(): number {
    return Math.round(performance.now() - this.startedAt);
  }

  markTokenFetched() {
    this.tokenFetchMs ??= this.since();
  }

  markRtcConnected() {
    this.rtcConnectedMs ??= this.since();
  }

  markLocalPublish() {
    this.firstLocalPublishMs ??= this.since();
  }

  /** The number that matters: when the user could first hear someone. */
  markFirstRemoteAudio() {
    this.firstRemoteAudioMs ??= this.since();
  }

  markReconnect() {
    this.reconnectCount += 1;
  }

  markFailover() {
    this.failoverCount += 1;
  }

  setRegion(region: string | null, probes: readonly RegionProbe[] = []) {
    this.selectedRegion = region;
    for (const probe of probes) this.regionProbes[probe.region] = probe.rttMs;
  }

  /**
   * Samples connection stats on an interval until the session ends.
   *
   * 10 seconds, not 1: this data is for comparing regions and providers over
   * many sessions, and a per-second sample would be a hundred times the rows
   * for no more insight.
   */
  startSampling(client: IRTCClient) {
    if (this.statsTimer !== null) return;
    this.statsTimer = window.setInterval(() => {
      void (async () => {
        try {
          const stats = await client.getConnectionStats();
          if (!stats) return;
          if (typeof stats.lastPingMs === 'number' && stats.lastPingMs > 0) {
            this.rttSamples.push(Math.round(stats.lastPingMs));
          }
          if (typeof stats.outboundPacketLossPct === 'number' && stats.outboundPacketLossPct >= 0) {
            this.packetLossSamples.push(stats.outboundPacketLossPct);
          }
        } catch {
          // A provider that cannot report stats is not a reason to stop the call.
        }
      })();
    }, 10_000);
  }

  private stopSampling() {
    if (this.statsTimer !== null) {
      window.clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
  }

  /** Live figures for the diagnostics panel, before the session ends. */
  snapshot() {
    return {
      region: this.selectedRegion,
      regionProbes: { ...this.regionProbes },
      joinToFirstAudioMs: this.firstRemoteAudioMs,
      rtcConnectedMs: this.rtcConnectedMs,
      lastRttMs: this.rttSamples[this.rttSamples.length - 1] ?? null,
      avgRttMs: this.rttSamples.length
        ? Math.round(this.rttSamples.reduce((sum, value) => sum + value, 0) / this.rttSamples.length)
        : null,
      packetLossPct: this.packetLossSamples.length
        ? Number(
            (
              this.packetLossSamples.reduce((sum, value) => sum + value, 0) /
              this.packetLossSamples.length
            ).toFixed(2),
          )
        : null,
      reconnectCount: this.reconnectCount,
    };
  }

  /**
   * Writes the row. Safe to call more than once; only the first wins.
   *
   * A join that never produced audio is recorded too — it is the most
   * interesting row in the table, and only storing successes would hide
   * exactly the cases worth investigating.
   */
  async finish(outcome: VoiceOutcome = 'connected', failureReason?: string): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    this.stopSampling();

    if (!this.context.userId) return;

    const avgRtt = this.rttSamples.length
      ? Math.round(this.rttSamples.reduce((sum, value) => sum + value, 0) / this.rttSamples.length)
      : null;
    const avgLoss = this.packetLossSamples.length
      ? Number(
          (
            this.packetLossSamples.reduce((sum, value) => sum + value, 0) /
            this.packetLossSamples.length
          ).toFixed(2),
        )
      : null;

    // A session that connected but never heard anyone did not really work,
    // whatever the caller believes.
    const resolvedOutcome: VoiceOutcome =
      outcome === 'connected' && this.firstRemoteAudioMs === null ? 'abandoned' : outcome;

    try {
      await supabase.from('voice_session_metrics').insert({
        user_id: this.context.userId,
        session_kind: this.context.kind,
        channel_id: this.context.channelId ?? null,
        conversation_id: this.context.conversationId ?? null,
        community_id: this.context.communityId ?? null,
        provider: this.context.provider ?? 'agora',
        selected_region: this.selectedRegion,
        region_probes: this.regionProbes,
        token_fetch_ms: this.tokenFetchMs,
        rtc_connected_ms: this.rtcConnectedMs,
        first_local_publish_ms: this.firstLocalPublishMs,
        first_remote_audio_ms: this.firstRemoteAudioMs,
        rtt_samples: this.rttSamples.slice(0, 200),
        avg_rtt_ms: avgRtt,
        p95_rtt_ms: percentile(this.rttSamples, 0.95),
        packet_loss_pct: avgLoss,
        reconnect_count: this.reconnectCount,
        failover_count: this.failoverCount,
        outcome: resolvedOutcome,
        failure_reason: failureReason?.slice(0, 300) ?? null,
        session_duration_ms: this.since(),
        client_platform: detectPlatform(),
        network_type: detectNetworkType(),
      } as never);
    } catch {
      // Never surfaced. A failed metrics write is not the user's problem.
    }
  }
}

function detectPlatform(): string {
  if (typeof window === 'undefined') return 'unknown';
  if (window.desktopBridge) return 'desktop';
  if (/Android/i.test(navigator.userAgent)) return 'android';
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) return 'ios';
  return 'web';
}

function detectNetworkType(): string {
  const connection = (navigator as { connection?: { effectiveType?: string } }).connection;
  return String(connection?.effectiveType || 'unknown');
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface VoiceHealthRow {
  region: string | null;
  sessions: number;
  medianJoinMs: number | null;
  p95JoinMs: number | null;
  medianRttMs: number | null;
  avgPacketLossPct: number | null;
  failureRatePct: number | null;
  reconnectRate: number | null;
}

interface HealthRow {
  region: string | null;
  sessions: number | string;
  median_join_ms: number | string | null;
  p95_join_ms: number | string | null;
  median_rtt_ms: number | string | null;
  avg_packet_loss_pct: number | string | null;
  failure_rate_pct: number | string | null;
  reconnect_rate: number | string | null;
}

const toNumber = (value: number | string | null): number | null =>
  value === null ? null : Math.round(Number(value) * 100) / 100;

export async function fetchVoiceHealth(
  days = 7,
  scope: 'me' | 'all' = 'me',
): Promise<VoiceHealthRow[]> {
  const { data, error } = await supabase.rpc('voice_health_summary', {
    p_days: days,
    p_scope: scope,
  });
  if (error) return [];

  return ((data ?? []) as HealthRow[]).map((row) => ({
    region: row.region,
    sessions: Number(row.sessions ?? 0),
    medianJoinMs: toNumber(row.median_join_ms),
    p95JoinMs: toNumber(row.p95_join_ms),
    medianRttMs: toNumber(row.median_rtt_ms),
    avgPacketLossPct: toNumber(row.avg_packet_loss_pct),
    failureRatePct: toNumber(row.failure_rate_pct),
    reconnectRate: toNumber(row.reconnect_rate),
  }));
}

/** The moonshot doc's target, for labelling numbers in the UI. */
export const TARGET_JOIN_TO_FIRST_AUDIO_MS = 500;
