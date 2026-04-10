/**
 * RTC Provider Abstraction Layer
 *
 * Provider-agnostic interface for real-time communication.
 * Implementations: AgoraProvider, LiveKitProvider (future).
 */

// ---------------------------------------------------------------------------
// Track abstractions
// ---------------------------------------------------------------------------

export interface IRTCLocalAudioTrack {
  readonly kind: 'audio';
  readonly mediaStreamTrack: MediaStreamTrack | null;
  setEnabled(enabled: boolean): Promise<void>;
  setVolume(volume: number): void;
  setDevice?(deviceId: string): Promise<void>;
  play(): void;
  stop(): void;
  close(): void;
  /** Pipe audio through a processor chain (Agora-style). Returns the track for chaining. */
  pipe?(processor: unknown): IRTCLocalAudioTrack;
  /** Terminal node in the processor chain. */
  processorDestination?: unknown;
  unpipe?(): void;
  /** Access the underlying provider-specific track for advanced operations. */
  readonly _raw: unknown;
}

export interface IRTCLocalVideoTrack {
  readonly kind: 'video';
  play(container: HTMLElement): void;
  stop(): void;
  close(): void;
  setEnabled(enabled: boolean): Promise<void>;
  readonly _raw: unknown;
}

export interface IRTCRemoteAudioTrack {
  readonly kind: 'audio';
  setVolume(volume: number): void;
  setPlaybackDevice?(deviceId: string): Promise<void>;
  play(): void;
  stop(): void;
  readonly _raw: unknown;
}

export interface IRTCRemoteVideoTrack {
  readonly kind: 'video';
  play(container: HTMLElement): void;
  stop(): void;
  readonly _raw: unknown;
}

// ---------------------------------------------------------------------------
// Participant abstraction
// ---------------------------------------------------------------------------

export interface IRTCRemoteParticipant {
  uid: string;
  audioTrack: IRTCRemoteAudioTrack | null;
  videoTrack: IRTCRemoteVideoTrack | null;
}

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type RTCMediaType = 'audio' | 'video';

export interface RTCClientEvents {
  'user-joined': (uid: string) => void;
  'user-left': (uid: string) => void;
  'user-published': (uid: string, mediaType: RTCMediaType, participant: IRTCRemoteParticipant) => void;
  'user-unpublished': (uid: string, mediaType: RTCMediaType) => void;
  'volume-indicator': (volumes: Array<{ uid: string; level: number }>) => void;
  'token-privilege-will-expire': () => void;
  'token-privilege-did-expire': () => void;
  'connection-state-change': (state: RTCConnectionState, prevState: RTCConnectionState, reason?: string) => void;
  'network-quality': (stats: RTCNetworkQuality) => void;
  'exception': (code: number, message: string, uid: string) => void;
}

export type RTCConnectionState = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'DISCONNECTING';

export interface RTCNetworkQuality {
  uplinkNetworkQuality: number; // 0-6 (0=unknown, 1=excellent, 6=disconnected)
  downlinkNetworkQuality: number;
}

// ---------------------------------------------------------------------------
// Stats abstraction
// ---------------------------------------------------------------------------

export interface RTCConnectionStats {
  averagePingMs: number | null;
  lastPingMs: number | null;
  outboundPacketLossPct: number | null;
}

// ---------------------------------------------------------------------------
// Client interface
// ---------------------------------------------------------------------------

export interface RTCJoinOptions {
  channelName: string;
  token: string | null;
  uid: string;
}

export interface RTCScreenShareConfig {
  quality: '720p30' | '1080p120' | '4k60';
}

export interface IRTCClient {
  /** Join a channel/room with the given credentials. */
  join(options: RTCJoinOptions): Promise<void>;

  /** Leave the current channel/room. */
  leave(): Promise<void>;

  /** Publish local tracks to the channel. */
  publish(tracks: Array<IRTCLocalAudioTrack | IRTCLocalVideoTrack>): Promise<void>;

  /** Unpublish local tracks from the channel. */
  unpublish(tracks: Array<IRTCLocalAudioTrack | IRTCLocalVideoTrack>): Promise<void>;

  /** Subscribe to a remote participant's media. */
  subscribe(uid: string, mediaType: RTCMediaType): Promise<IRTCRemoteParticipant>;

  /** Renew the authentication token. */
  renewToken(token: string): Promise<void>;

  /** Enable volume indicator reporting. */
  enableAudioVolumeIndicator(): void;

  /** Get current connection stats. */
  getConnectionStats(): Promise<RTCConnectionStats>;

  /** Get remote network quality for a specific uid. */
  getRemoteNetworkQuality?(uid: string): RTCNetworkQuality | null;

  /** Register event listener. */
  on<K extends keyof RTCClientEvents>(event: K, handler: RTCClientEvents[K]): void;

  /** Remove event listener. */
  off<K extends keyof RTCClientEvents>(event: K, handler: RTCClientEvents[K]): void;

  /** The underlying provider-specific client for escape-hatch access. */
  readonly _raw: unknown;
}

// ---------------------------------------------------------------------------
// Noise suppression abstraction
// ---------------------------------------------------------------------------

export interface NoiseSuppressionBinding {
  engine: 'ai' | 'fallback' | 'off';
  detail: string;
  teardown: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface RTCClientConfig {
  mode: 'rtc' | 'live';
  codec: 'vp8' | 'vp9' | 'h264' | 'av1';
}

export interface RTCAudioTrackConfig {
  deviceId?: string;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
}

export interface IRTCProvider {
  readonly name: 'agora' | 'livekit';

  /** Create a new RTC client instance. */
  createClient(config?: RTCClientConfig): Promise<IRTCClient>;

  /** Create a local audio track from the microphone. */
  createAudioTrack(config?: RTCAudioTrackConfig): Promise<IRTCLocalAudioTrack>;

  /** Create a custom audio track from an existing MediaStreamTrack. */
  createCustomAudioTrack(mediaStreamTrack: MediaStreamTrack): Promise<IRTCLocalAudioTrack>;

  /** Create a custom video track from an existing MediaStreamTrack. */
  createCustomVideoTrack(mediaStreamTrack: MediaStreamTrack): Promise<IRTCLocalVideoTrack>;

  /** Create a local video track from the camera. */
  createVideoTrack(deviceId?: string): Promise<IRTCLocalVideoTrack>;

  /** Create screen share tracks (video + optional audio). */
  createScreenShareTracks(config?: RTCScreenShareConfig): Promise<{
    videoTrack: IRTCLocalVideoTrack;
    audioTrack: IRTCLocalAudioTrack | null;
  }>;

  /** Create a noise suppression binding for the given audio track. */
  createNoiseSuppression(
    track: IRTCLocalAudioTrack,
    enabled: boolean,
  ): Promise<NoiseSuppressionBinding>;

  /** Resolve an auth token for joining a channel/room. */
  resolveToken(channelName: string, uid: string): Promise<string | null>;

  /** Human-readable description of a join failure. */
  describeJoinFailure(error: unknown): string;

  /** Set SDK log level (0=none, 1=error, 2=warn, 3=info, 4=debug). */
  setLogLevel?(level: number): void;
}

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

export type RTCProviderName = 'agora' | 'livekit';

const PROVIDER_ENV_KEY = 'VITE_RTC_PROVIDER';

export function getConfiguredProviderName(): RTCProviderName {
  const envValue = String(
    (import.meta.env as Record<string, string | undefined>)?.[PROVIDER_ENV_KEY] || '',
  ).trim().toLowerCase();
  if (envValue === 'livekit') return 'livekit';
  return 'agora';
}

let activeProvider: IRTCProvider | null = null;

export async function getRTCProvider(name?: RTCProviderName): Promise<IRTCProvider> {
  const providerName = name || getConfiguredProviderName();

  if (activeProvider && activeProvider.name === providerName) {
    return activeProvider;
  }

  if (providerName === 'livekit') {
    const { LiveKitProvider } = await import('./livekitProvider');
    activeProvider = new LiveKitProvider();
  } else {
    const { AgoraProvider } = await import('./agoraProvider');
    activeProvider = new AgoraProvider();
  }

  return activeProvider;
}
