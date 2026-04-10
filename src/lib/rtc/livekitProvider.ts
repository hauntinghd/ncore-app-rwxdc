/**
 * LiveKit RTC Provider
 *
 * Implements IRTCProvider using the livekit-client SDK.
 * Self-hosted LiveKit server (Apache 2.0) replaces Agora.
 */

import {
  Room,
  RoomEvent,
  Track,
  LocalAudioTrack,
  LocalVideoTrack,
  RemoteAudioTrack,
  RemoteVideoTrack,
  RemoteTrackPublication,
  RemoteParticipant,
  createLocalAudioTrack,
  createLocalVideoTrack,
  createLocalScreenTracks,
  ConnectionState,
  type AudioCaptureOptions,
  type VideoCaptureOptions,
  type ScreenShareCaptureOptions,
} from 'livekit-client';

import { supabase } from '../supabase';

import type {
  IRTCProvider,
  IRTCClient,
  IRTCLocalAudioTrack,
  IRTCLocalVideoTrack,
  IRTCRemoteAudioTrack,
  IRTCRemoteVideoTrack,
  IRTCRemoteParticipant,
  RTCClientConfig,
  RTCClientEvents,
  RTCAudioTrackConfig,
  RTCScreenShareConfig,
  RTCJoinOptions,
  RTCConnectionStats,
  RTCConnectionState,
  RTCMediaType,
  NoiseSuppressionBinding,
} from './rtcProvider';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const LIVEKIT_URL = String(import.meta.env.VITE_LIVEKIT_URL || '').trim();
const LIVEKIT_TOKEN_FUNCTION = String(import.meta.env.VITE_LIVEKIT_TOKEN_FUNCTION || 'livekit-token').trim();
const SUPABASE_ANON_KEY = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

// ---------------------------------------------------------------------------
// Track wrappers
// ---------------------------------------------------------------------------

function wrapLocalAudioTrack(track: LocalAudioTrack, mediaStream?: MediaStream): IRTCLocalAudioTrack {
  return {
    kind: 'audio',
    get mediaStreamTrack() {
      return track.mediaStreamTrack ?? null;
    },
    async setEnabled(enabled: boolean) {
      if (enabled) {
        await track.unmute();
      } else {
        await track.mute();
      }
    },
    setVolume(_volume: number) {
      // LiveKit local audio volume is controlled at the capture level.
    },
    async setDevice(deviceId: string) {
      await track.restartTrack({ deviceId });
    },
    play() {
      // Local audio tracks don't need explicit play in LiveKit.
    },
    stop() {
      track.stop();
    },
    close() {
      track.stop();
    },
    get _raw() {
      return track;
    },
  };
}

function wrapLocalVideoTrack(track: LocalVideoTrack): IRTCLocalVideoTrack {
  return {
    kind: 'video',
    play(container: HTMLElement) {
      track.attach(container);
    },
    stop() {
      track.detach();
      track.stop();
    },
    close() {
      track.detach();
      track.stop();
    },
    async setEnabled(enabled: boolean) {
      if (enabled) {
        await track.unmute();
      } else {
        await track.mute();
      }
    },
    get _raw() {
      return track;
    },
  };
}

function wrapRemoteAudioTrack(track: RemoteAudioTrack): IRTCRemoteAudioTrack {
  return {
    kind: 'audio',
    setVolume(volume: number) {
      track.setVolume(volume / 100); // LiveKit uses 0-1, NCore uses 0-100
    },
    async setPlaybackDevice(deviceId: string) {
      await track.setSinkId(deviceId);
    },
    play() {
      const el = track.attach();
      el.style.display = 'none';
      document.body.appendChild(el);
    },
    stop() {
      track.detach().forEach((el) => el.remove());
    },
    get _raw() {
      return track;
    },
  };
}

function wrapRemoteVideoTrack(track: RemoteVideoTrack): IRTCRemoteVideoTrack {
  return {
    kind: 'video',
    play(container: HTMLElement) {
      track.attach(container);
    },
    stop() {
      track.detach().forEach((el) => el.remove());
    },
    get _raw() {
      return track;
    },
  };
}

// ---------------------------------------------------------------------------
// Connection state mapping
// ---------------------------------------------------------------------------

function mapConnectionState(state: ConnectionState): RTCConnectionState {
  switch (state) {
    case ConnectionState.Connected: return 'CONNECTED';
    case ConnectionState.Connecting: return 'CONNECTING';
    case ConnectionState.Reconnecting: return 'RECONNECTING';
    case ConnectionState.Disconnected: return 'DISCONNECTED';
    default: return 'DISCONNECTED';
  }
}

// ---------------------------------------------------------------------------
// Client wrapper
// ---------------------------------------------------------------------------

class LiveKitClient implements IRTCClient {
  private room: Room;
  private participants = new Map<string, IRTCRemoteParticipant>();
  private eventCleanups: Array<() => void> = [];

  constructor(room: Room) {
    this.room = room;
  }

  async join(options: RTCJoinOptions): Promise<void> {
    if (!LIVEKIT_URL) {
      throw new Error('VITE_LIVEKIT_URL is not configured.');
    }
    const token = options.token;
    if (!token) {
      throw new Error('LiveKit requires a valid token to join.');
    }
    await this.room.connect(LIVEKIT_URL, token);
  }

  async leave(): Promise<void> {
    await this.room.disconnect();
    this.participants.clear();
    this.eventCleanups.forEach((cleanup) => cleanup());
    this.eventCleanups = [];
  }

  async publish(tracks: Array<IRTCLocalAudioTrack | IRTCLocalVideoTrack>): Promise<void> {
    for (const track of tracks) {
      const raw = track._raw;
      if (raw instanceof LocalAudioTrack || raw instanceof LocalVideoTrack) {
        await this.room.localParticipant.publishTrack(raw);
      }
    }
  }

  async unpublish(tracks: Array<IRTCLocalAudioTrack | IRTCLocalVideoTrack>): Promise<void> {
    for (const track of tracks) {
      const raw = track._raw;
      if (raw instanceof LocalAudioTrack || raw instanceof LocalVideoTrack) {
        await this.room.localParticipant.unpublishTrack(raw);
      }
    }
  }

  async subscribe(uid: string, mediaType: RTCMediaType): Promise<IRTCRemoteParticipant> {
    const participant = Array.from(this.room.remoteParticipants.values())
      .find((p) => p.identity === uid);
    if (!participant) throw new Error(`Remote participant ${uid} not found`);

    const existing = this.participants.get(uid) || { uid, audioTrack: null, videoTrack: null };

    // LiveKit auto-subscribes by default. Find the relevant track.
    if (mediaType === 'audio') {
      const audioPub = Array.from(participant.audioTrackPublications.values())
        .find((pub) => pub.track instanceof RemoteAudioTrack);
      if (audioPub?.track) {
        existing.audioTrack = wrapRemoteAudioTrack(audioPub.track as RemoteAudioTrack);
      }
    }
    if (mediaType === 'video') {
      const videoPub = Array.from(participant.videoTrackPublications.values())
        .find((pub) => pub.track instanceof RemoteVideoTrack);
      if (videoPub?.track) {
        existing.videoTrack = wrapRemoteVideoTrack(videoPub.track as RemoteVideoTrack);
      }
    }

    this.participants.set(uid, existing);
    return existing;
  }

  async renewToken(token: string): Promise<void> {
    // LiveKit handles token refresh through the Room's token property.
    // The server can also push new tokens via SignalClient.
    // For manual renewal, we update the metadata.
    // In practice, LiveKit Cloud handles this automatically.
  }

  enableAudioVolumeIndicator(): void {
    // LiveKit provides speaking detection via ActiveSpeakerChanged event natively.
    // No explicit enable needed.
  }

  async getConnectionStats(): Promise<RTCConnectionStats> {
    try {
      const localP = this.room.localParticipant;
      // LiveKit provides connection quality per-participant.
      const quality = localP.connectionQuality;
      // Map quality to approximate ping values.
      const qualityToPing: Record<string, number> = {
        excellent: 20,
        good: 60,
        poor: 150,
        lost: 500,
      };
      const ping = qualityToPing[quality] ?? null;
      return {
        averagePingMs: ping,
        lastPingMs: ping,
        outboundPacketLossPct: null,
      };
    } catch {
      return { averagePingMs: null, lastPingMs: null, outboundPacketLossPct: null };
    }
  }

  on<K extends keyof RTCClientEvents>(event: K, handler: RTCClientEvents[K]): void {
    if (event === 'user-joined') {
      const fn = (participant: RemoteParticipant) => {
        (handler as RTCClientEvents['user-joined'])(participant.identity);
      };
      this.room.on(RoomEvent.ParticipantConnected, fn);
      this.eventCleanups.push(() => this.room.off(RoomEvent.ParticipantConnected, fn));
    } else if (event === 'user-left') {
      const fn = (participant: RemoteParticipant) => {
        this.participants.delete(participant.identity);
        (handler as RTCClientEvents['user-left'])(participant.identity);
      };
      this.room.on(RoomEvent.ParticipantDisconnected, fn);
      this.eventCleanups.push(() => this.room.off(RoomEvent.ParticipantDisconnected, fn));
    } else if (event === 'user-published') {
      const fn = (pub: RemoteTrackPublication, participant: RemoteParticipant) => {
        const uid = participant.identity;
        const mediaType: RTCMediaType = pub.kind === Track.Kind.Audio ? 'audio' : 'video';
        const existing = this.participants.get(uid) || { uid, audioTrack: null, videoTrack: null };

        if (mediaType === 'audio' && pub.track instanceof RemoteAudioTrack) {
          existing.audioTrack = wrapRemoteAudioTrack(pub.track);
        }
        if (mediaType === 'video' && pub.track instanceof RemoteVideoTrack) {
          existing.videoTrack = wrapRemoteVideoTrack(pub.track);
        }
        this.participants.set(uid, existing);

        (handler as RTCClientEvents['user-published'])(uid, mediaType, existing);
      };
      this.room.on(RoomEvent.TrackSubscribed, fn);
      this.eventCleanups.push(() => this.room.off(RoomEvent.TrackSubscribed, fn));
    } else if (event === 'user-unpublished') {
      const fn = (pub: RemoteTrackPublication, participant: RemoteParticipant) => {
        const uid = participant.identity;
        const mediaType: RTCMediaType = pub.kind === Track.Kind.Audio ? 'audio' : 'video';
        const existing = this.participants.get(uid);
        if (existing) {
          if (mediaType === 'audio') existing.audioTrack = null;
          if (mediaType === 'video') existing.videoTrack = null;
        }
        (handler as RTCClientEvents['user-unpublished'])(uid, mediaType);
      };
      this.room.on(RoomEvent.TrackUnsubscribed, fn);
      this.eventCleanups.push(() => this.room.off(RoomEvent.TrackUnsubscribed, fn));
    } else if (event === 'volume-indicator') {
      const fn = (speakers: Array<{ identity?: string; audioLevel?: number } & any>) => {
        const volumes = speakers
          .filter((s) => s.identity)
          .map((s) => ({
            uid: String(s.identity || ''),
            level: Math.round((s.audioLevel ?? 0) * 100),
          }));
        (handler as RTCClientEvents['volume-indicator'])(volumes);
      };
      this.room.on(RoomEvent.ActiveSpeakersChanged, fn);
      this.eventCleanups.push(() => this.room.off(RoomEvent.ActiveSpeakersChanged, fn));
    } else if (event === 'connection-state-change') {
      const fn = (state: ConnectionState) => {
        const mapped = mapConnectionState(state);
        (handler as RTCClientEvents['connection-state-change'])(mapped, 'CONNECTED');
      };
      this.room.on(RoomEvent.ConnectionStateChanged, fn);
      this.eventCleanups.push(() => this.room.off(RoomEvent.ConnectionStateChanged, fn));
    } else if (event === 'token-privilege-will-expire') {
      // LiveKit doesn't have a direct equivalent; token refresh is handled server-side.
    } else if (event === 'token-privilege-did-expire') {
      const fn = () => {
        (handler as RTCClientEvents['token-privilege-did-expire'])();
      };
      this.room.on(RoomEvent.Disconnected, fn);
      this.eventCleanups.push(() => this.room.off(RoomEvent.Disconnected, fn));
    }
  }

  off<K extends keyof RTCClientEvents>(_event: K, _handler: RTCClientEvents[K]): void {
    // Cleanup is handled via eventCleanups on leave().
  }

  get _raw() {
    return this.room;
  }
}

// ---------------------------------------------------------------------------
// Token resolution
// ---------------------------------------------------------------------------

async function resolveLiveKitToken(channelName: string, uid: string): Promise<string | null> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token || '';
    const headers: Record<string, string> = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    if (SUPABASE_ANON_KEY) headers.apikey = SUPABASE_ANON_KEY;

    const { data, error } = await supabase.functions.invoke(LIVEKIT_TOKEN_FUNCTION, {
      body: { channelName, uid },
      headers,
    });

    if (error) {
      console.warn('LiveKit token fetch failed:', error);
      return null;
    }

    const token = typeof data === 'string' ? data.trim()
      : typeof data?.token === 'string' ? data.token.trim()
      : '';
    return token || null;
  } catch (error) {
    console.warn('LiveKit token resolution error:', error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

export class LiveKitProvider implements IRTCProvider {
  readonly name = 'livekit' as const;

  async createClient(_config?: RTCClientConfig): Promise<IRTCClient> {
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      // Enable simulcast for bandwidth-adaptive video
      videoCaptureDefaults: {
        resolution: { width: 1280, height: 720, frameRate: 30 },
      },
    });
    return new LiveKitClient(room);
  }

  async createAudioTrack(config?: RTCAudioTrackConfig): Promise<IRTCLocalAudioTrack> {
    const options: AudioCaptureOptions = {
      deviceId: config?.deviceId && config.deviceId !== 'default' ? config.deviceId : undefined,
      echoCancellation: config?.echoCancellation ?? true,
      noiseSuppression: config?.noiseSuppression ?? true,
      autoGainControl: config?.autoGainControl ?? true,
    };
    const track = await createLocalAudioTrack(options);
    return wrapLocalAudioTrack(track);
  }

  async createCustomAudioTrack(mediaStreamTrack: MediaStreamTrack): Promise<IRTCLocalAudioTrack> {
    const track = new LocalAudioTrack(mediaStreamTrack);
    return wrapLocalAudioTrack(track);
  }

  async createCustomVideoTrack(mediaStreamTrack: MediaStreamTrack): Promise<IRTCLocalVideoTrack> {
    const track = new LocalVideoTrack(mediaStreamTrack);
    return wrapLocalVideoTrack(track);
  }

  async createVideoTrack(deviceId?: string): Promise<IRTCLocalVideoTrack> {
    const options: VideoCaptureOptions = {
      deviceId: deviceId && deviceId !== 'default' ? deviceId : undefined,
      resolution: { width: 1280, height: 720, frameRate: 30 },
    };
    const track = await createLocalVideoTrack(options);
    return wrapLocalVideoTrack(track);
  }

  async createScreenShareTracks(config?: RTCScreenShareConfig): Promise<{
    videoTrack: IRTCLocalVideoTrack;
    audioTrack: IRTCLocalAudioTrack | null;
  }> {
    const qualityPresets: Record<string, Partial<ScreenShareCaptureOptions>> = {
      '720p30': { resolution: { width: 1280, height: 720, frameRate: 30 } },
      '1080p120': { resolution: { width: 1920, height: 1080, frameRate: 120 } },
      '4k60': { resolution: { width: 3840, height: 2160, frameRate: 60 } },
    };
    const preset = qualityPresets[config?.quality || '720p30'] || qualityPresets['720p30'];

    const tracks = await createLocalScreenTracks({
      ...preset,
      audio: true,
    });

    let videoTrack: IRTCLocalVideoTrack | null = null;
    let audioTrack: IRTCLocalAudioTrack | null = null;

    for (const track of tracks) {
      if (track instanceof LocalVideoTrack && !videoTrack) {
        videoTrack = wrapLocalVideoTrack(track);
      }
      if (track instanceof LocalAudioTrack && !audioTrack) {
        audioTrack = wrapLocalAudioTrack(track);
      }
    }

    if (!videoTrack) {
      throw new Error('Screen share did not produce a video track');
    }

    return { videoTrack, audioTrack };
  }

  async createNoiseSuppression(
    _track: IRTCLocalAudioTrack,
    enabled: boolean,
  ): Promise<NoiseSuppressionBinding> {
    if (!enabled) {
      return { engine: 'off', detail: 'noise suppression disabled', teardown: async () => {} };
    }
    // LiveKit has built-in noise suppression via Krisp integration on LiveKit Cloud.
    // For self-hosted, we'll use the RNNoise processor (Phase 2).
    // For now, rely on browser-level noise suppression.
    return {
      engine: 'fallback',
      detail: 'Browser-level noise suppression (RNNoise integration pending)',
      teardown: async () => {},
    };
  }

  async resolveToken(channelName: string, uid: string): Promise<string | null> {
    return resolveLiveKitToken(channelName, uid);
  }

  describeJoinFailure(error: unknown): string {
    const e = error as any;
    const message = String(e?.message || '');
    if (message.includes('VITE_LIVEKIT_URL')) {
      return 'LiveKit server URL is not configured. Set VITE_LIVEKIT_URL in your environment.';
    }
    if (message.includes('token')) {
      return 'LiveKit token is required. Configure the livekit-token Supabase function.';
    }
    return message || String(error);
  }

  setLogLevel(level: number): void {
    // LiveKit logging is configured through the Room options.
  }
}
