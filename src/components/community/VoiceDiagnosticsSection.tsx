import { useCallback, useEffect, useState } from 'react';
import { Activity, Gauge, RefreshCw } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import {
  TARGET_JOIN_TO_FIRST_AUDIO_MS,
  fetchVoiceHealth,
  probeRegions,
  type RegionProbe,
  type VoiceHealthRow,
} from '../../lib/voiceTelemetry';

/**
 * Voice health: measured region latency and how joins have actually performed.
 *
 * The moonshot doc sets a target of warm join-to-first-audio under 500 ms.
 * Nothing was measuring it, so this is where that claim becomes checkable.
 * p95 rather than mean — a mean hides the tail, and the tail is what people
 * notice and complain about.
 */
export function VoiceDiagnosticsSection() {
  const { profile } = useAuth();
  const [probes, setProbes] = useState<RegionProbe[]>([]);
  const [health, setHealth] = useState<VoiceHealthRow[]>([]);
  const [scope, setScope] = useState<'me' | 'all'>('me');
  const [probing, setProbing] = useState(false);
  const [loading, setLoading] = useState(true);

  const isStaff = profile?.platform_role === 'owner' || profile?.platform_role === 'admin';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setHealth(await fetchVoiceHealth(7, scope));
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void probeRegions().then(setProbes);
  }, []);

  async function reprobe() {
    setProbing(true);
    try {
      setProbes(await probeRegions(true));
    } finally {
      setProbing(false);
    }
  }

  return (
    <div className="nyptid-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <Activity size={16} className="text-nyptid-300" />
        <h2 className="text-lg font-bold text-surface-100">Voice Diagnostics</h2>
      </div>

      <div className="mb-5">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs font-semibold tracking-wide text-surface-500 uppercase">
            Region latency
          </div>
          <button
            type="button"
            onClick={() => void reprobe()}
            disabled={probing}
            className="flex items-center gap-1 text-xs text-nyptid-300 transition-colors hover:text-nyptid-200"
          >
            <RefreshCw size={11} className={probing ? 'animate-spin' : ''} />
            {probing ? 'Probing…' : 'Re-probe'}
          </button>
        </div>

        {probes.length === 0 ? (
          <div className="rounded-lg border border-surface-700 bg-surface-900/50 px-3 py-2 text-sm text-surface-500">
            {probing ? 'Measuring…' : 'No voice regions responded.'}
          </div>
        ) : (
          <div className="space-y-1">
            {probes.map((probe, index) => (
              <div
                key={probe.region}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
                  index === 0
                    ? 'border-green-500/30 bg-green-500/5'
                    : 'border-surface-700/70 bg-surface-900/40'
                }`}
              >
                <span className="flex-1 font-mono text-sm text-surface-200">{probe.region}</span>
                {index === 0 && (
                  <span className="rounded bg-green-500/20 px-1.5 py-0.5 text-[10px] font-bold text-green-300">
                    FASTEST
                  </span>
                )}
                <span className="font-mono text-sm text-surface-400">{probe.rttMs} ms</span>
              </div>
            ))}
          </div>
        )}
        <p className="mt-1.5 text-xs text-surface-600">
          Round trip to each regional voice gateway from this device, right now. This measures
          reachability, not call quality.
        </p>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs font-semibold tracking-wide text-surface-500 uppercase">
            Last 7 days
          </div>
          {isStaff && (
            <div className="flex gap-1">
              {(['me', 'all'] as const).map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  onClick={() => setScope(candidate)}
                  className={`rounded px-2 py-0.5 text-xs transition-colors ${
                    scope === candidate
                      ? 'bg-surface-700 text-surface-100'
                      : 'text-surface-500 hover:text-surface-300'
                  }`}
                >
                  {candidate === 'me' ? 'My sessions' : 'Everyone'}
                </button>
              ))}
            </div>
          )}
        </div>

        {loading ? (
          <div className="py-6 text-center text-sm text-surface-500">Loading…</div>
        ) : health.length === 0 ? (
          <div className="rounded-lg border border-surface-700 bg-surface-900/50 px-3 py-4 text-center text-sm text-surface-500">
            No voice sessions recorded yet. Join a voice channel or start a call and the numbers
            will appear here.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-surface-700 text-xs text-surface-500">
                  <th className="py-1.5 pr-3 font-medium">Region</th>
                  <th className="py-1.5 pr-3 font-medium">Sessions</th>
                  <th className="py-1.5 pr-3 font-medium">Join p50</th>
                  <th className="py-1.5 pr-3 font-medium">Join p95</th>
                  <th className="py-1.5 pr-3 font-medium">RTT</th>
                  <th className="py-1.5 font-medium">Loss</th>
                </tr>
              </thead>
              <tbody>
                {health.map((row) => (
                  <tr key={row.region ?? 'unknown'} className="border-b border-surface-800/60">
                    <td className="py-1.5 pr-3 font-mono text-surface-300">
                      {row.region || 'unknown'}
                    </td>
                    <td className="py-1.5 pr-3 text-surface-400">{row.sessions}</td>
                    <td className="py-1.5 pr-3">
                      <JoinTime value={row.medianJoinMs} />
                    </td>
                    <td className="py-1.5 pr-3">
                      <JoinTime value={row.p95JoinMs} />
                    </td>
                    <td className="py-1.5 pr-3 text-surface-400">
                      {row.medianRttMs === null ? '—' : `${row.medianRttMs} ms`}
                    </td>
                    <td className="py-1.5 text-surface-400">
                      {row.avgPacketLossPct === null ? '—' : `${row.avgPacketLossPct}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-2 flex items-start gap-1.5 text-xs text-surface-600">
          <Gauge size={12} className="mt-0.5 flex-shrink-0" />
          <span>
            Join time is the gap between asking to join and first hearing someone — including the
            token round trip, because that is part of what joining feels like. Target is{' '}
            {TARGET_JOIN_TO_FIRST_AUDIO_MS} ms at p95.
          </span>
        </p>
      </div>
    </div>
  );
}

function JoinTime({ value }: { value: number | null }) {
  if (value === null) return <span className="text-surface-600">—</span>;

  const good = value <= TARGET_JOIN_TO_FIRST_AUDIO_MS;
  const bad = value > TARGET_JOIN_TO_FIRST_AUDIO_MS * 3;

  return (
    <span
      className={`font-mono ${good ? 'text-green-300' : bad ? 'text-red-300' : 'text-amber-300'}`}
    >
      {Math.round(value)} ms
    </span>
  );
}
