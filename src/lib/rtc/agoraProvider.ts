/**
 * Agora RTC Provider
 *
 * Wraps the Agora Web SDK behind the IRTCProvider interface.
 */

import type {
  IAgoraRTCClient,
  IAgoraRTCRemoteUser,
  ILocalAudioTrack,
  ILocalVideoTrack,
  IRemoteAudioTrack,
  IRemoteVideoTrack,
  ScreenVideoTrackInitConfig,
} from 'agora-rtc-sdk-ng';

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
  RTCMediaType,
  NoiseSuppressionBinding,
} from './rtcProvider';

import { resolveAgoraJoinToken, describeAgoraJoinFailure } from '../agoraAuth';
import { createAIDenoiserBinding } from '../agoraAIDenoiser';

// ---------------------------------------------------------------------------
// Lazy-loaded Agora SDK
// ---------------------------------------------------------------------------

type AgoraRTCModule = typeof import('agora-rtc-sdk-ng')['default'];

let cachedModule: Promise<AgoraRTCModule> | null = null;

function getAgoraModule(): Promise<AgoraRTCModule> {
  if (!cachedModule) {
    cachedModule = import('agora-rtc-sdk-ng').then((m) => {
      const sdk = m.default as AgoraRTCModule;
      try {
        sdk.setLogLevel(2); // WARNING
      } catch {
        // ignore
      }
      return sdk;
    });
  }
  return cachedModule;
}

const AGORA_APP_ID = String(import.meta.env.VITE_AGORA_APP_ID || '').trim();

// ---------------------------------------------------------------------------
// Track wrappers
// ---------------------------------------------------------------------------

function wrapLocalAudioTrack(track: ILocalAudioTrack): IRTCLocalAudioTrack {
  return {
    kind: 'audio',
    get mediaStreamTrack() {
      try {
        return (track as any).getMediaStreamTrack?.() ?? null;
      } catch {
        return null;
      }
    },
    async setEnabled(enabled: boolean) {
      await track.setEnabled(enabled);
    },
    setVolume(volume: number) {
      if (typeof track.setVolume === 'function') track.setVolume(volume);
    },
    async setDevice(deviceId: string) {
      const t = track as any;
      if (typeof t.setDevice === 'function') await t.setDevice(deviceId);
    },
    play() {
      track.play();
    },
    stop() {
      track.stop();
    },
    close() {
      track.close();
    },
    pipe(processor: unknown) {
      (track as any).pipe(processor);
      return this;
    },
    get processorDestination() {
      return (track as any).processorDestination;
    },
    unpipe() {
      try {
        (track as any).unpipe();
      } catch {
        // noop
      }
    },
    get _raw() {
      return track;
    },
  };
}

function wrapLocalVideoTrack(track: ILocalVideoTrack): IRTCLocalVideoTrack {
  return {
    kind: 'video',
    play(container: HTMLElement) {
      track.play(container);
    },
    stop() {
      track.stop();
    },
    close() {
      track.close();
    },
    async setEnabled(enabled: boolean) {
      await track.setEnabled(enabled);
    },
    get _raw() {
      return track;
    },
  };
}

function wrapRemoteAudioTrack(track: IRemoteAudioTrack): IRTCRemoteAudioTrack {
  return {
    kind: 'audio',
    setVolume(volume: number) {
      if (typeof track.setVolume === 'function') track.setVolume(volume);
    },
    async setPlaybackDevice(deviceId: string) {
      if (typeof (track as any).setPlaybackDevice === 'function') {
        await (track as any).setPlaybackDevice(deviceId);
      }
    },
    play() {
      track.play();
    },
    stop() {
      track.stop();
    },
    get _raw() {
      return track;
    },
  };
}

function wrapRemoteVideoTrack(track: IRemoteVideoTrack): IRTCRemoteVideoTrack {
  return {
    kind: 'video',
    play(container: HTMLElement) {
      track.play(container);
    },
    stop() {
      track.stop();
    },
    get _raw() {
      return track;
    },
  };
}

// ---------------------------------------------------------------------------
// Client wrapper
// ---------------------------------------------------------------------------

class AgoraClient implements IRTCClient {
  private client: IAgoraRTCClient;
  private participants = new Map<string, IRTCRemoteParticipant>();

  constructor(client: IAgoraRTCClient) {
    this.client = client;
  }

  async join(options: RTCJoinOptions): Promise<void> {
    await this.client.join(AGORA_APP_ID, options.channelName, options.token, options.uid);
  }

  async leave(): Promise<void> {
    await this.client.leave();
    this.participants.clear();
  }

  async publish(tracks: Array<IRTCLocalAudioTrack | IRTCLocalVideoTrack>): Promise<void> {
    const rawTracks = tracks.map((t) => t._raw as ILocalAudioTrack | ILocalVideoTrack);
    await this.client.publish(rawTracks);
  }

  async unpublish(tracks: Array<IRTCLocalAudioTrack | IRTCLocalVideoTrack>): Promise<void> {
    const rawTracks = tracks.map((t) => t._raw as ILocalAudioTrack | ILocalVideoTrack);
    await this.client.unpublish(rawTracks);
  }

  async subscribe(uid: string, mediaType: RTCMediaType): Promise<IRTCRemoteParticipant> {
    const remoteUsers = this.client.remoteUsers;
    const user = remoteUsers.find((u) => String(u.uid) === uid);
    if (!user) throw new Error(`Remote user ${uid} not found`);

    await this.client.subscribe(user, mediaType);

    const existing = this.participants.get(uid) || { uid, audioTrack: null, videoTrack: null };

    if (mediaType === 'audio' && user.audioTrack) {
      existing.audioTrack = wrapRemoteAudioTrack(user.audioTrack);
    }
    if (mediaType === 'video' && user.videoTrack) {
      existing.videoTrack = wrapRemoteVideoTrack(user.videoTrack);
    }

    this.participants.set(uid, existing);
    return existing;
  }

  async renewToken(token: string): Promise<void> {
    await this.client.renewToken(token);
  }

  enableAudioVolumeIndicator(): void {
    this.client.enableAudioVolumeIndicator();
  }

  async getConnectionStats(): Promise<RTCConnectionStats> {
    try {
      const stats = this.client.getRTCStats();
      return {
        averagePingMs: typeof stats.RTT === 'number' ? stats.RTT : null,
        lastPingMs: typeof stats.RTT === 'number' ? stats.RTT : null,
        outboundPacketLossPct: null,
      };
    } catch {
      return { averagePingMs: null, lastPingMs: null, outboundPacketLossPct: null };
    }
  }

  on<K extends keyof RTCClientEvents>(event: K, handler: RTCClientEvents[K]): void {
    if (event === 'user-joined') {
      this.client.on('user-joined', (user: IAgoraRTCRemoteUser) => {
        (handler as RTCClientEvents['user-joined'])(String(user.uid));
      });
    } else if (event === 'user-left') {
      this.client.on('user-left', (user: IAgoraRTCRemoteUser) => {
        this.participants.delete(String(user.uid));
        (handler as RTCClientEvents['user-left'])(String(user.uid));
      });
    } else if (event === 'user-published') {
      this.client.on('user-published', (user: IAgoraRTCRemoteUser, mediaType: 'audio' | 'video') => {
        const uid = String(user.uid);
        const participant = this.participants.get(uid) || { uid, audioTrack: null, videoTrack: null };
        this.participants.set(uid, participant);
        (handler as RTCClientEvents['user-published'])(uid, mediaType, participant);
      });
    } else if (event === 'user-unpublished') {
      this.client.on('user-unpublished', (user: IAgoraRTCRemoteUser, mediaType: 'audio' | 'video') => {
        const uid = String(user.uid);
        const participant = this.participants.get(uid);
        if (participant) {
          if (mediaType === 'audio') participant.audioTrack = null;
          if (mediaType === 'video') participant.videoTrack = null;
        }
        (handler as RTCClientEvents['user-unpublished'])(uid, mediaType);
      });
    } else if (event === 'volume-indicator') {
      this.client.on('volume-indicator' as any, (volumes: any[]) => {
        if (!Array.isArray(volumes)) return;
        const mapped = volumes.map((v) => ({ uid: String(v.uid), level: Number(v.level || 0) }));
        (handler as RTCClientEvents['volume-indicator'])(mapped);
      });
    } else if (event === 'token-privilege-will-expire') {
      this.client.on('token-privilege-will-expire', () => {
        (handler as RTCClientEvents['token-privilege-will-expire'])();
      });
    } else if (event === 'token-privilege-did-expire') {
      this.client.on('token-privilege-did-expire', () => {
        (handler as RTCClientEvents['token-privilege-did-expire'])();
      });
    } else if (event === 'connection-state-change') {
      this.client.on('connection-state-change', (state: any, prevState: any, reason?: any) => {
        (handler as RTCClientEvents['connection-state-change'])(state, prevState, reason);
      });
    } else if (event === 'exception') {
      this.client.on('exception', (evt: any) => {
        (handler as RTCClientEvents['exception'])(evt?.code || 0, evt?.msg || '', evt?.uid || '');
      });
    }
  }

  off<K extends keyof RTCClientEvents>(event: K, handler: RTCClientEvents[K]): void {
    // Agora doesn't support targeted removal cleanly; this is best-effort.
    try {
      this.client.removeAllListeners(event as any);
    } catch {
      // noop
    }
  }

  get _raw() {
    return this.client;
  }
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

export class AgoraProvider implements IRTCProvider {
  readonly name = 'agora' as const;

  async createClient(config?: RTCClientConfig): Promise<IRTCClient> {
    const AgoraRTC = await getAgoraModule();
    const client = AgoraRTC.createClient({
      mode: config?.mode || 'rtc',
      codec: config?.codec || 'vp8',
    });
    return new AgoraClient(client);
  }

  async createAudioTrack(config?: RTCAudioTrackConfig): Promise<IRTCLocalAudioTrack> {
    const AgoraRTC = await getAgoraModule();

    // Try getUserMedia first for enhanced noise suppression support.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: config?.deviceId && config.deviceId !== 'default'
            ? { exact: config.deviceId }
            : undefined,
          echoCancellation: config?.echoCancellation ?? true,
          noiseSuppression: config?.noiseSuppression ?? true,
          autoGainControl: config?.autoGainControl ?? true,
        },
        video: false,
      });
      const mediaTrack = stream.getAudioTracks()[0];
      if (mediaTrack) {
        await applyEnhancedConstraints(mediaTrack, config?.noiseSuppression ?? true);
        const agoraTrack = AgoraRTC.createCustomAudioTrack({ mediaStreamTrack: mediaTrack });
        return wrapLocalAudioTrack(agoraTrack);
      }
    } catch {
      // Fall through to Agora SDK track creation.
    }

    // Fallback: Agora native track creation.
    const agoraTrack = await AgoraRTC.createMicrophoneAudioTrack({
      microphoneId: config?.deviceId && config.deviceId !== 'default' ? config.deviceId : undefined,
      AEC: config?.echoCancellation ?? true,
      ANS: config?.noiseSuppression ?? true,
      AGC: config?.autoGainControl ?? true,
    } as any);
    return wrapLocalAudioTrack(agoraTrack);
  }

  async createCustomAudioTrack(mediaStreamTrack: MediaStreamTrack): Promise<IRTCLocalAudioTrack> {
    const AgoraRTC = await getAgoraModule();
    const agoraTrack = AgoraRTC.createCustomAudioTrack({ mediaStreamTrack });
    return wrapLocalAudioTrack(agoraTrack);
  }

  async createCustomVideoTrack(mediaStreamTrack: MediaStreamTrack): Promise<IRTCLocalVideoTrack> {
    const AgoraRTC = await getAgoraModule();
    const agoraTrack = AgoraRTC.createCustomVideoTrack({ mediaStreamTrack });
    return wrapLocalVideoTrack(agoraTrack);
  }

  async createVideoTrack(deviceId?: string): Promise<IRTCLocalVideoTrack> {
    const AgoraRTC = await getAgoraModule();
    const agoraTrack = await AgoraRTC.createCameraVideoTrack({
      cameraId: deviceId && deviceId !== 'default' ? deviceId : undefined,
    });
    return wrapLocalVideoTrack(agoraTrack);
  }

  async createScreenShareTracks(config?: RTCScreenShareConfig): Promise<{
    videoTrack: IRTCLocalVideoTrack;
    audioTrack: IRTCLocalAudioTrack | null;
  }> {
    const AgoraRTC = await getAgoraModule();
    const qualityPresets: Record<string, Partial<ScreenVideoTrackInitConfig>> = {
      '720p30': { encoderConfig: { width: 1280, height: 720, frameRate: 30, bitrateMax: 2500 } },
      '1080p120': { encoderConfig: { width: 1920, height: 1080, frameRate: 120, bitrateMax: 8000 } },
      '4k60': { encoderConfig: { width: 3840, height: 2160, frameRate: 60, bitrateMax: 16000 } },
    };
    const preset = qualityPresets[config?.quality || '720p30'] || qualityPresets['720p30'];
    const result = await AgoraRTC.createScreenVideoTrack(
      { ...preset } as ScreenVideoTrackInitConfig,
      'auto',
    );

    if (Array.isArray(result)) {
      return {
        videoTrack: wrapLocalVideoTrack(result[0]),
        audioTrack: wrapLocalAudioTrack(result[1] as unknown as ILocalAudioTrack),
      };
    }
    return {
      videoTrack: wrapLocalVideoTrack(result),
      audioTrack: null,
    };
  }

  async createNoiseSuppression(
    track: IRTCLocalAudioTrack,
    enabled: boolean,
  ): Promise<NoiseSuppressionBinding> {
    const rawTrack = track._raw as ILocalAudioTrack;
    return createAIDenoiserBinding(rawTrack, enabled);
  }

  async resolveToken(channelName: string, uid: string): Promise<string | null> {
    return resolveAgoraJoinToken(channelName, uid);
  }

  describeJoinFailure(error: unknown): string {
    return describeAgoraJoinFailure(error);
  }

  setLogLevel(level: number): void {
    getAgoraModule().then((sdk) => {
      try {
        sdk.setLogLevel(level);
      } catch {
        // ignore
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function applyEnhancedConstraints(track: MediaStreamTrack, nsEnabled: boolean) {
  if (!nsEnabled || typeof track.applyConstraints !== 'function') return;
  try {
    await track.applyConstraints({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    } as MediaTrackConstraints);
  } catch {
    // ignore
  }
  try {
    await track.applyConstraints({
      advanced: [
        { voiceIsolation: true } as any,
        { googNoiseSuppression: true } as any,
        { googNoiseSuppression2: true } as any,
        { googEchoCancellation: true } as any,
        { googEchoCancellation2: true } as any,
        { googAutoGainControl: true } as any,
        { googAutoGainControl2: true } as any,
        { googHighpassFilter: true } as any,
        { googTypingNoiseDetection: true } as any,
      ],
    } as MediaTrackConstraints);
  } catch {
    // ignore
  }
}
