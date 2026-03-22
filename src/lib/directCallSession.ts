import { useSyncExternalStore } from 'react';
import type {
  IAgoraRTCClient,
  IAgoraRTCRemoteUser,
  IRemoteAudioTrack,
  ILocalAudioTrack,
  ILocalVideoTrack,
  IRemoteVideoTrack,
  ScreenVideoTrackInitConfig,
} from 'agora-rtc-sdk-ng';
import { loadCallSettings, saveCallSettings, type CallSettings } from './callSettings';
import { describeAgoraJoinFailure, resolveAgoraJoinToken } from './agoraAuth';
import { supabase } from './supabase';
import {
  buildLegacyCallStateUpdate,
  isCallsModernSchemaMissingError,
  normalizeCallStateFromRow,
} from './callsCompat';

type Listener = () => void;
export type ScreenShareQuality = '720p30' | '1080p120' | '4k60';
type AgoraRTCModule = typeof import('agora-rtc-sdk-ng')['default'];

export interface DirectCallJoinOptions {
  conversationId: string;
  userId: string;
  appId: string;
  wantsVideo: boolean;
  startedAtMs?: number | null;
  callId?: string | null;
  isCaller?: boolean;
}

export interface DirectCallSessionState {
  phase: 'idle' | 'connecting' | 'active';
  conversationId: string | null;
  callId: string | null;
  isCaller: boolean;
  wantsVideo: boolean;
  isConnecting: boolean;
  isMuted: boolean;
  isVideoOn: boolean;
  isScreenSharing: boolean;
  screenShareQuality: ScreenShareQuality;
  hasRemoteVideo: boolean;
  remoteParticipantUids: string[];
  remoteVideoUids: string[];
  activeSpeakerUids: string[];
  startedAt: number | null;
  mediaError: string;
  mediaErrorDetail: string;
}

interface HangupOptions {
  signalEnded?: boolean;
  clearMeta?: boolean;
}

interface ToggleScreenShareOptions {
  quality: ScreenShareQuality;
  maxQuality: ScreenShareQuality;
}

const initialState: DirectCallSessionState = {
  phase: 'idle',
  conversationId: null,
  callId: null,
  isCaller: false,
  wantsVideo: false,
  isConnecting: false,
  isMuted: false,
  isVideoOn: false,
  isScreenSharing: false,
  screenShareQuality: '720p30',
  hasRemoteVideo: false,
  remoteParticipantUids: [],
  remoteVideoUids: [],
  activeSpeakerUids: [],
  startedAt: null,
  mediaError: '',
  mediaErrorDetail: '',
};

let cachedAgoraModule: Promise<AgoraRTCModule> | null = null;

async function getAgoraModule(): Promise<AgoraRTCModule> {
  if (!cachedAgoraModule) {
    cachedAgoraModule = import('agora-rtc-sdk-ng').then((module) => {
      const sdk = module.default as AgoraRTCModule;
      try {
        // Reduce SDK log overhead in runtime.
        sdk.setLogLevel(2); // WARNING
      } catch {
        // ignore unsupported logger setup environments
      }
      return sdk;
    });
  }
  return cachedAgoraModule;
}

function formatRtcError(error: unknown): string {
  const e = error as any;
  const parts = [
    e?.name || 'UnknownError',
    e?.code ? `code=${e.code}` : '',
    e?.message || '',
  ].filter(Boolean);
  return parts.join(' | ');
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutLabel: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(timeoutLabel));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function screenShareQualityRank(quality: ScreenShareQuality): number {
  if (quality === '4k60') return 3;
  if (quality === '1080p120') return 2;
  return 1;
}

function isQualityAllowed(requested: ScreenShareQuality, maxQuality: ScreenShareQuality): boolean {
  return screenShareQualityRank(requested) <= screenShareQualityRank(maxQuality);
}

function buildScreenConfig(quality: ScreenShareQuality): ScreenVideoTrackInitConfig {
  if (quality === '4k60') {
    return {
      encoderConfig: {
        width: 3840,
        height: 2160,
        frameRate: 60,
      },
      optimizationMode: 'detail',
    };
  }
  if (quality === '1080p120') {
    return {
      encoderConfig: {
        width: 1920,
        height: 1080,
        frameRate: 120,
      },
      optimizationMode: 'detail',
    };
  }
  return {
    encoderConfig: {
      width: 1280,
      height: 720,
      frameRate: 30,
    },
    optimizationMode: 'detail',
  };
}

function buildDisplayMediaVideoConstraints(quality: ScreenShareQuality): MediaTrackConstraints {
  if (quality === '4k60') {
    return {
      width: { ideal: 3840, max: 3840 },
      height: { ideal: 2160, max: 2160 },
      frameRate: { ideal: 60, max: 60 },
    };
  }
  if (quality === '1080p120') {
    return {
      width: { ideal: 1920, max: 1920 },
      height: { ideal: 1080, max: 1080 },
      frameRate: { ideal: 120, max: 120 },
    };
  }
  return {
    width: { ideal: 1280, max: 1280 },
    height: { ideal: 720, max: 720 },
    frameRate: { ideal: 30, max: 30 },
  };
}

class DirectCallSessionStore {
  private listeners = new Set<Listener>();
  private state: DirectCallSessionState = { ...initialState };

  private client: IAgoraRTCClient | null = null;
  private screenClient: IAgoraRTCClient | null = null;
  private localUid: string | null = null;
  private screenUid: string | null = null;
  private appId: string | null = null;
  private audioTrack: ILocalAudioTrack | null = null;
  private videoTrack: ILocalVideoTrack | null = null;
  private screenTrack: ILocalVideoTrack | null = null;
  private screenAudioTrack: ILocalAudioTrack | null = null;

  private remoteVideoTracks = new Map<string, IRemoteVideoTrack>();
  private remoteAudioTracks = new Map<string, IRemoteAudioTrack>();
  private remoteAudioVolumes = new Map<string, number>();
  private remoteParticipantUids = new Set<string>();

  private localVideoContainer: HTMLDivElement | null = null;
  private remoteVideoContainer: HTMLDivElement | null = null;
  private remoteVideoContainers = new Map<string, HTMLDivElement | null>();

  private callStateChannel: any = null;
  private watchedCallId: string | null = null;
  private callControlChannel: any = null;
  private watchedConversationId: string | null = null;
  private hangupInFlight: Promise<void> | null = null;
  private activeSpeakerFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingActiveSpeakerUids: string[] | null = null;
  private remoteOptimizationTimer: ReturnType<typeof setTimeout> | null = null;

  private sameUidArray(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  private bindScreenTrackEnded(track: ILocalVideoTrack | null) {
    const trackAny = track as any;
    if (!trackAny || typeof trackAny.on !== 'function') return;
    trackAny.on('track-ended', () => {
      if (!this.state.isScreenSharing) return;
      void this.stopScreenShare();
    });
  }

  private async createAgoraScreenTracks(
    quality: ScreenShareQuality,
    audioMode: 'enable' | 'disable',
  ): Promise<{ videoTrack: ILocalVideoTrack; audioTrack: ILocalAudioTrack | null }> {
    const AgoraRTC = await getAgoraModule();
    const created = await AgoraRTC.createScreenVideoTrack(buildScreenConfig(quality), audioMode);
    if (Array.isArray(created)) {
      return {
        videoTrack: created[0],
        audioTrack: created[1] || null,
      };
    }
    return {
      videoTrack: created,
      audioTrack: null,
    };
  }

  private async createNativeScreenTracks(
    quality: ScreenShareQuality,
    withAudio: boolean,
  ): Promise<{ videoTrack: ILocalVideoTrack; audioTrack: ILocalAudioTrack | null }> {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('getDisplayMedia is not available in this runtime');
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: buildDisplayMediaVideoConstraints(quality),
        audio: withAudio,
      });
    } catch (primaryError) {
      // Some Electron/Chromium builds reject advanced constraints and only
      // allow plain boolean capture constraints.
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: withAudio,
      }).catch(() => {
        throw primaryError;
      });
    }

    const mediaVideoTrack = stream.getVideoTracks()[0];
    if (!mediaVideoTrack) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error('Display capture returned no video track');
    }

    const AgoraRTC = await getAgoraModule();
    const videoTrack = AgoraRTC.createCustomVideoTrack({ mediaStreamTrack: mediaVideoTrack });
    const mediaAudioTrack = stream.getAudioTracks()[0];
    const audioTrack = mediaAudioTrack ? AgoraRTC.createCustomAudioTrack({ mediaStreamTrack: mediaAudioTrack }) : null;

    return { videoTrack, audioTrack };
  }

  private async applyEnhancedNoiseSuppression(track: MediaStreamTrack, enabled: boolean) {
    if (!enabled || typeof track?.applyConstraints !== 'function') return;
    try {
      await track.applyConstraints({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      } as MediaTrackConstraints);
    } catch {
      // Ignore unsupported constraint errors.
    }

    // Best-effort voice isolation hint for runtimes that support it.
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
      // Ignore unsupported constraint errors.
    }
  }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = () => this.state;

  private setState(patch: Partial<DirectCallSessionState>) {
    let changed = false;
    const nextState: DirectCallSessionState = { ...this.state };
    (Object.keys(patch) as Array<keyof DirectCallSessionState>).forEach((key) => {
      const nextValue = patch[key];
      if (!Object.is(nextState[key], nextValue)) {
        (nextState as any)[key] = nextValue;
        changed = true;
      }
    });
    if (!changed) return;
    this.state = nextState;
    this.listeners.forEach((listener) => listener());
  }

  private flushActiveSpeakerUids() {
    const next = this.pendingActiveSpeakerUids || [];
    this.pendingActiveSpeakerUids = null;
    this.activeSpeakerFlushTimer = null;
    if (this.sameUidArray(next, this.state.activeSpeakerUids)) return;
    this.setState({ activeSpeakerUids: next });
    this.queueRemoteVideoOptimization();
  }

  private queueActiveSpeakerUids(next: string[]) {
    this.pendingActiveSpeakerUids = next;
    if (this.activeSpeakerFlushTimer) return;
    this.activeSpeakerFlushTimer = setTimeout(() => {
      this.flushActiveSpeakerUids();
    }, 160);
  }

  private async configureRtcOptimizations(client: IAgoraRTCClient) {
    const clientAny = client as any;
    try {
      if (typeof clientAny.enableDualStream === 'function') {
        await clientAny.enableDualStream();
      }
    } catch {
      // Optional optimization only.
    }
    try {
      if (typeof clientAny.setStreamFallbackOption === 'function') {
        // 2 => fallback to audio-only when network quality drops.
        clientAny.setStreamFallbackOption(2);
      }
    } catch {
      // Optional optimization only.
    }
  }

  private queueRemoteVideoOptimization() {
    if (this.remoteOptimizationTimer) return;
    this.remoteOptimizationTimer = setTimeout(() => {
      this.remoteOptimizationTimer = null;
      void this.applyRemoteVideoOptimization();
    }, 140);
  }

  private async applyRemoteVideoOptimization() {
    if (!this.client) return;
    const remoteVideoUids = Array.from(this.remoteVideoTracks.keys());
    if (remoteVideoUids.length === 0) return;

    const clientAny = this.client as any;
    if (typeof clientAny.setRemoteVideoStreamType !== 'function') return;

    const isGroupCall = this.state.remoteParticipantUids.length >= 3;
    const activeSpeakers = this.state.activeSpeakerUids
      .filter((uid) => remoteVideoUids.includes(uid))
      .filter((uid) => !uid.includes('::screen'));
    const screenShareUids = remoteVideoUids.filter((uid) => uid.includes('::screen'));
    const primarySpeaker = activeSpeakers[0]
      || remoteVideoUids.find((uid) => !uid.includes('::screen'))
      || remoteVideoUids[0];
    const secondarySpeaker = activeSpeakers.find((uid) => uid !== primarySpeaker);

    const highPriority = new Set<string>(screenShareUids);
    if (primarySpeaker) highPriority.add(primarySpeaker);
    if (secondarySpeaker) highPriority.add(secondarySpeaker);

    await Promise.all(
      remoteVideoUids.map(async (uid) => {
        const streamType = !isGroupCall || highPriority.has(uid) ? 0 : 1;
        try {
          await clientAny.setRemoteVideoStreamType(uid, streamType);
        } catch {
          // Some environments/plans don't expose this API.
        }
      }),
    );
  }

  private bindTokenRenewalHandlers(
    client: IAgoraRTCClient,
    channelName: string,
    uid: string,
    context: 'call' | 'screen',
  ) {
    const renew = async (reason: 'will-expire' | 'did-expire') => {
      try {
        const freshToken = await resolveAgoraJoinToken(channelName, uid);
        if (!freshToken) return;
        await client.renewToken(freshToken);
        if (reason === 'did-expire' && (this.state.mediaError || this.state.mediaErrorDetail)) {
          this.setState({
            mediaError: '',
            mediaErrorDetail: '',
          });
        }
      } catch (error) {
        console.warn(`Agora ${context} token ${reason} renew failed:`, error);
        if (reason === 'did-expire' && context === 'call') {
          this.setState({
            mediaError: 'Call token refresh failed. Rejoin the call to continue.',
            mediaErrorDetail: formatRtcError(error),
          });
        }
      }
    };

    client.on('token-privilege-will-expire' as any, () => {
      void renew('will-expire');
    });
    client.on('token-privilege-did-expire' as any, () => {
      void renew('did-expire');
    });
  }

  private syncRemoteState() {
    const remoteParticipantUids = Array.from(this.remoteParticipantUids).sort();
    const remoteVideoUids = Array.from(this.remoteVideoTracks.keys()).sort();
    const hasRemoteVideo = remoteVideoUids.length > 0;
    const sameParticipants = this.sameUidArray(remoteParticipantUids, this.state.remoteParticipantUids);
    const sameRemoteVideo = this.sameUidArray(remoteVideoUids, this.state.remoteVideoUids);
    const sameHasRemoteVideo = this.state.hasRemoteVideo === hasRemoteVideo;

    if (!sameParticipants || !sameRemoteVideo || !sameHasRemoteVideo) {
      this.setState({
        remoteParticipantUids,
        remoteVideoUids,
        hasRemoteVideo,
      });
    }

    this.queueRemoteVideoOptimization();

    if (this.remoteVideoContainer && remoteVideoUids.length > 0) {
      this.attachRemoteVideoForUid(remoteVideoUids[0], this.remoteVideoContainer);
    }
  }

  private clearRemoteState() {
    if (this.activeSpeakerFlushTimer) {
      clearTimeout(this.activeSpeakerFlushTimer);
      this.activeSpeakerFlushTimer = null;
    }
    if (this.remoteOptimizationTimer) {
      clearTimeout(this.remoteOptimizationTimer);
      this.remoteOptimizationTimer = null;
    }
    this.pendingActiveSpeakerUids = null;
    this.remoteVideoTracks.forEach((track) => {
      try {
        track.stop();
      } catch {
        // noop
      }
    });
    this.remoteVideoTracks.clear();
    this.remoteAudioTracks.clear();
    this.remoteAudioVolumes.clear();
    this.remoteParticipantUids.clear();
    this.remoteVideoContainers.clear();
    this.setState({
      remoteParticipantUids: [],
      remoteVideoUids: [],
      activeSpeakerUids: [],
      hasRemoteVideo: false,
    });
  }

  setCallMeta(meta: {
    conversationId: string;
    callId?: string | null;
    isCaller?: boolean;
    wantsVideo?: boolean;
  }) {
    const nextCallId = meta.callId ?? this.state.callId ?? null;
    this.watchCallState(nextCallId);
    this.watchConversationControl(meta.conversationId);
    this.setState({
      conversationId: meta.conversationId,
      callId: nextCallId,
      isCaller: meta.isCaller ?? this.state.isCaller,
      wantsVideo: meta.wantsVideo ?? this.state.wantsVideo,
      mediaError: '',
      mediaErrorDetail: '',
    });
  }

  attachLocalVideo(container: HTMLDivElement | null) {
    this.localVideoContainer = container;
    const activeTrack = this.screenTrack || this.videoTrack;
    if (!activeTrack) return;

    try {
      activeTrack.stop();
      if (container) {
        activeTrack.play(container);
      }
    } catch (error) {
      console.warn('attachLocalVideo error', error);
    }
  }

  attachRemoteVideo(container: HTMLDivElement | null) {
    this.remoteVideoContainer = container;
    const firstUid = this.state.remoteVideoUids[0];
    if (!firstUid) return;
    this.attachRemoteVideoForUid(firstUid, container);
  }

  attachRemoteVideoForUid(uid: string, container: HTMLDivElement | null) {
    if (!uid) return;
    if (container) {
      this.remoteVideoContainers.set(uid, container);
    } else {
      this.remoteVideoContainers.delete(uid);
    }

    const track = this.remoteVideoTracks.get(uid);
    if (!track) return;
    try {
      track.stop();
      if (container) {
        track.play(container);
      }
    } catch (error) {
      console.warn('attachRemoteVideoForUid error', error);
    }
  }

  setRemoteUserVolume(uid: string, volume: number) {
    const normalizedUid = String(uid || '').trim();
    if (!normalizedUid) return;
    const clamped = Math.max(0, Math.min(100, Math.round(volume)));
    this.remoteAudioVolumes.set(normalizedUid, clamped);
    const remoteAudioTrack = this.remoteAudioTracks.get(normalizedUid);
    if (remoteAudioTrack && typeof remoteAudioTrack.setVolume === 'function') {
      remoteAudioTrack.setVolume(clamped);
    }
  }

  getRemoteUserVolume(uid: string): number {
    const normalizedUid = String(uid || '').trim();
    if (!normalizedUid) return 100;
    const stored = this.remoteAudioVolumes.get(normalizedUid);
    return typeof stored === 'number' ? stored : 100;
  }

  async join(options: DirectCallJoinOptions): Promise<boolean> {
    const {
      conversationId,
      userId,
      appId,
      wantsVideo,
      startedAtMs = null,
      callId = null,
      isCaller = false,
    } = options;
    const settings = loadCallSettings();
    this.appId = appId;
    this.setState({ screenShareQuality: settings.screenShareQuality || '720p30' });

    if (!appId) {
      this.setState({
        conversationId,
        callId,
        isCaller,
        wantsVideo,
        phase: 'idle',
        isConnecting: false,
        activeSpeakerUids: [],
        mediaError: 'Agora is not configured. Set `VITE_AGORA_APP_ID` to enable calling.',
        mediaErrorDetail: '',
      });
      return false;
    }

    const alreadyActiveForConversation =
      this.state.conversationId === conversationId &&
      (this.state.phase === 'active' || this.state.phase === 'connecting');
    if (alreadyActiveForConversation) {
      const effectiveStartedAt =
        Number.isFinite(startedAtMs) && (startedAtMs || 0) > 0
          ? Number(startedAtMs)
          : this.state.startedAt || Date.now();
      this.setState({
        callId,
        isCaller,
        wantsVideo,
        ...(Number.isFinite(startedAtMs) && (startedAtMs || 0) > 0 ? { startedAt: Number(startedAtMs) } : {}),
      });
      void effectiveStartedAt;
      this.attachLocalVideo(this.localVideoContainer);
      this.attachRemoteVideo(this.remoteVideoContainer);
      return true;
    }

    await this.hangup({ signalEnded: false, clearMeta: false });

    this.setState({
      conversationId,
      callId,
      isCaller,
      wantsVideo,
      phase: 'connecting',
      isConnecting: true,
      isMuted: false,
      isVideoOn: false,
      isScreenSharing: false,
      hasRemoteVideo: false,
      remoteParticipantUids: [],
      remoteVideoUids: [],
      activeSpeakerUids: [],
      mediaError: '',
      mediaErrorDetail: '',
    });

    const callSettings = await this.resolveCallAudioSettings();
    this.watchCallState(callId);
    this.watchConversationControl(conversationId);
    try {
      const AgoraRTC = await getAgoraModule();
      this.client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
      this.localUid = userId;
      this.registerClientEvents(this.client);
      await this.configureRtcOptimizations(this.client);

      const channelName = `dm-${conversationId}`;
      const token = await resolveAgoraJoinToken(channelName, userId);
      await this.client.join(appId, channelName, token, userId);
      this.bindTokenRenewalHandlers(this.client, channelName, String(userId), 'call');

      const tracksToPublish: Array<ILocalAudioTrack | ILocalVideoTrack> = [];

      try {
        this.audioTrack = await this.createLocalAudioTrack(callSettings);
        if (typeof this.audioTrack.setVolume === 'function') {
          this.audioTrack.setVolume(callSettings.inputVolume);
        }
        const audioTrackAny = this.audioTrack as any;
        if (callSettings.inputDeviceId && callSettings.inputDeviceId !== 'default' && typeof audioTrackAny.setDevice === 'function') {
          try {
            await audioTrackAny.setDevice(callSettings.inputDeviceId);
          } catch {
            // Ignore unsupported/invalid device errors and continue with current input.
          }
        }
        tracksToPublish.push(this.audioTrack);
      } catch (audioError) {
        this.setState({
          mediaError: 'Microphone unavailable. Joined call in listen-only mode.',
          mediaErrorDetail: formatRtcError(audioError),
        });
      }

      if (wantsVideo) {
        try {
          this.videoTrack = await this.createLocalVideoTrack();
          tracksToPublish.push(this.videoTrack);
          this.setState({ isVideoOn: true });
          if (this.localVideoContainer) {
            this.videoTrack.play(this.localVideoContainer);
          }
        } catch (videoError) {
          this.setState({
            mediaError: tracksToPublish.length
              ? 'Camera access denied/unavailable. Joined call with microphone only.'
              : 'Camera unavailable and microphone unavailable.',
            mediaErrorDetail: formatRtcError(videoError),
          });
        }
      }

      if (tracksToPublish.length > 0) {
        await this.client.publish(tracksToPublish);
      }

      const effectiveStartedAt =
        Number.isFinite(startedAtMs) && (startedAtMs || 0) > 0
          ? Number(startedAtMs)
          : Date.now();

      this.setState({
        phase: 'active',
        isConnecting: false,
        startedAt: effectiveStartedAt,
      });
      return true;
    } catch (error) {
      console.error('Failed to join DM call:', error);
      const joinDetail = describeAgoraJoinFailure(error);
      this.setState({
        phase: 'idle',
        isConnecting: false,
        isVideoOn: false,
        isScreenSharing: false,
        hasRemoteVideo: false,
        activeSpeakerUids: [],
        mediaError: joinDetail.includes('token-based join')
          ? 'Call connection failed (Agora token setup required).'
          : 'Could not access microphone/camera. Check app permissions and selected devices.',
        mediaErrorDetail: joinDetail.includes('token-based join') ? joinDetail : formatRtcError(error),
      });
      await this.teardownMedia();
      return false;
    }
  }

  async toggleMute() {
    if (!this.audioTrack) return;
    const newMuted = !this.state.isMuted;
    await this.audioTrack.setEnabled(!newMuted);
    this.setState({ isMuted: newMuted });
  }

  async setNoiseSuppression(enabled: boolean) {
    const current = loadCallSettings();
    if (current.noiseSuppression === enabled && this.audioTrack) return;

    const nextSettings = {
      ...current,
      inputVolume: this.normalizeInputVolume(current.inputVolume),
      noiseSuppression: enabled,
    };
    // Store user preference immediately, even if we cannot hot-swap the track.
    saveCallSettings(nextSettings);

    if (!this.client || this.state.phase !== 'active') return;
    if (!this.audioTrack) return;

    const wasMuted = this.state.isMuted;
    const previousTrack = this.audioTrack;
    this.audioTrack = null;

    try {
      await this.client.unpublish(previousTrack);
    } catch {
      // noop
    }
    try {
      previousTrack.stop();
      previousTrack.close();
    } catch {
      // noop
    }

    try {
      const rebuiltTrack = await this.createLocalAudioTrack(nextSettings);
      this.audioTrack = rebuiltTrack;
      if (typeof rebuiltTrack.setVolume === 'function') {
        rebuiltTrack.setVolume(nextSettings.inputVolume);
      }
      if (wasMuted) {
        await rebuiltTrack.setEnabled(false);
      }
      await this.client.publish(rebuiltTrack);
      this.setState({
        mediaError: '',
        mediaErrorDetail: '',
      });
    } catch (error) {
      this.setState({
        mediaError: 'Could not reconfigure microphone right now.',
        mediaErrorDetail: formatRtcError(error),
      });
    }
  }

  async applyCallSettings(nextSettingsInput?: CallSettings) {
    const nextSettings = await this.resolveCallAudioSettings(nextSettingsInput || loadCallSettings());
    saveCallSettings(nextSettings);

    const outputVolume = Math.max(0, Math.min(200, Math.round(Number(nextSettings.outputVolume) || 100)));
    for (const [uid, remoteTrack] of this.remoteAudioTracks.entries()) {
      const configuredVolume = this.remoteAudioVolumes.get(uid);
      const nextVolume = typeof configuredVolume === 'number' ? configuredVolume : outputVolume;
      this.remoteAudioVolumes.set(uid, nextVolume);
      if (typeof remoteTrack.setVolume === 'function') {
        remoteTrack.setVolume(nextVolume);
      }
      if (nextSettings.outputDeviceId && nextSettings.outputDeviceId !== 'default' && typeof remoteTrack.setPlaybackDevice === 'function') {
        try {
          await remoteTrack.setPlaybackDevice(nextSettings.outputDeviceId);
        } catch {
          // Some runtimes don't allow output routing changes.
        }
      }
    }

    if (!this.client || this.state.phase !== 'active') {
      this.setState({
        mediaError: '',
        mediaErrorDetail: '',
      });
      return;
    }

    const previousTrack = this.audioTrack;
    const wasMuted = this.state.isMuted;
    let rebuiltTrack: ILocalAudioTrack | null = null;

    try {
      rebuiltTrack = await this.createLocalAudioTrack(nextSettings);
      if (typeof rebuiltTrack.setVolume === 'function') {
        rebuiltTrack.setVolume(nextSettings.inputVolume);
      }
      const rebuiltTrackAny = rebuiltTrack as any;
      if (nextSettings.inputDeviceId && nextSettings.inputDeviceId !== 'default' && typeof rebuiltTrackAny.setDevice === 'function') {
        try {
          await rebuiltTrackAny.setDevice(nextSettings.inputDeviceId);
        } catch {
          // If explicit selection fails, continue on default mic binding.
        }
      }
      if (wasMuted) {
        await rebuiltTrack.setEnabled(false);
      }
    } catch (error) {
      this.setState({
        mediaError: 'Could not apply microphone settings. Check selected device and permissions.',
        mediaErrorDetail: formatRtcError(error),
      });
      return;
    }

    try {
      if (previousTrack) {
        try {
          await this.client.unpublish(previousTrack);
        } catch {
          // noop
        }
      }
      await this.client.publish(rebuiltTrack);
      this.audioTrack = rebuiltTrack;
      if (previousTrack) {
        try {
          previousTrack.stop();
          previousTrack.close();
        } catch {
          // noop
        }
      }
      this.setState({
        mediaError: '',
        mediaErrorDetail: '',
      });
    } catch (error) {
      try {
        rebuiltTrack.stop();
        rebuiltTrack.close();
      } catch {
        // noop
      }
      if (previousTrack) {
        this.audioTrack = previousTrack;
        try {
          await this.client.publish(previousTrack);
        } catch {
          // noop
        }
      } else {
        this.audioTrack = null;
      }
      this.setState({
        mediaError: 'Could not apply microphone settings right now.',
        mediaErrorDetail: formatRtcError(error),
      });
    }
  }

  async toggleVideo() {
    if (!this.client || this.state.phase !== 'active') return;

    if (this.state.isVideoOn && this.videoTrack) {
      await this.client.unpublish(this.videoTrack);
      this.videoTrack.stop();
      this.videoTrack.close();
      this.videoTrack = null;
      this.setState({ isVideoOn: false });
      return;
    }

    const newVideoTrack = await this.createLocalVideoTrack();
    this.videoTrack = newVideoTrack;
    await this.client.publish(newVideoTrack);
    this.setState({ isVideoOn: true, wantsVideo: true });
    if (this.localVideoContainer) {
      newVideoTrack.play(this.localVideoContainer);
    }
  }

  async toggleScreenShare(options: ToggleScreenShareOptions) {
    if (!this.client || this.state.phase !== 'active') return;
    if (!this.appId || !this.state.conversationId || !this.localUid) return;

    const requestedQuality = options.quality;
    if (!isQualityAllowed(requestedQuality, options.maxQuality)) {
      this.setState({
        mediaError: `Selected screen share quality is unavailable on your current plan (max: ${options.maxQuality}).`,
        mediaErrorDetail: '',
      });
      return;
    }

    if (this.state.isScreenSharing) {
      await this.stopScreenShare();
      return;
    }

    const qualityAttemptOrder: ScreenShareQuality[] =
      requestedQuality === '1080p120'
        ? ['1080p120', '720p30']
        : requestedQuality === '4k60'
          ? ['4k60', '1080p120', '720p30']
          : ['720p30'];

    const attemptErrors: string[] = [];
    let activeQuality: ScreenShareQuality | null = null;

    for (const quality of qualityAttemptOrder) {
      if (!isQualityAllowed(quality, options.maxQuality)) continue;
      const attemptFns: Array<{
        label: string;
        run: () => Promise<{ videoTrack: ILocalVideoTrack; audioTrack: ILocalAudioTrack | null }>;
      }> = [
        {
          label: `${quality}:agora:audio-on`,
          run: () => this.createAgoraScreenTracks(quality, 'enable'),
        },
        {
          label: `${quality}:agora:audio-off`,
          run: () => this.createAgoraScreenTracks(quality, 'disable'),
        },
        {
          label: `${quality}:native:audio-on`,
          run: () => this.createNativeScreenTracks(quality, true),
        },
        {
          label: `${quality}:native:audio-off`,
          run: () => this.createNativeScreenTracks(quality, false),
        },
      ];

      for (const attempt of attemptFns) {
        try {
          const created = await attempt.run();
          this.screenTrack = created.videoTrack;
          this.screenAudioTrack = created.audioTrack;
          this.bindScreenTrackEnded(this.screenTrack);
          const AgoraRTC = await getAgoraModule();
          this.screenClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
          this.screenUid = `${this.localUid}::screen`;
          const channelName = `dm-${this.state.conversationId}`;
          const token = await resolveAgoraJoinToken(channelName, this.screenUid);
          await this.screenClient.join(this.appId, channelName, token, this.screenUid);
          this.bindTokenRenewalHandlers(this.screenClient, channelName, this.screenUid, 'screen');

          const publishTracks: Array<ILocalVideoTrack | ILocalAudioTrack> = [];
          if (this.screenTrack) publishTracks.push(this.screenTrack);
          if (this.screenAudioTrack) publishTracks.push(this.screenAudioTrack);
          if (publishTracks.length) {
            await this.screenClient.publish(publishTracks);
          }

          activeQuality = quality;
          break;
        } catch (error) {
          attemptErrors.push(`${attempt.label}: ${formatRtcError(error)}`);
          if (this.screenClient) {
            try {
              await this.screenClient.leave();
            } catch {
              // noop
            }
            this.screenClient = null;
          }
          this.screenUid = null;
          this.disposeScreenTracks();
        }
      }

      if (activeQuality) break;
    }

    if (!activeQuality || !this.screenTrack) {
      this.setState({
        mediaError: 'Could not start screen sharing.',
        mediaErrorDetail: attemptErrors.join(' || ') || 'No supported screen capture method succeeded.',
      });
      return;
    }

    this.setState({
      isScreenSharing: true,
      screenShareQuality: activeQuality,
      mediaError: '',
      mediaErrorDetail: '',
    });
    if (this.localVideoContainer) {
      this.screenTrack.play(this.localVideoContainer);
    }
  }

  private async stopScreenShare() {
    if (!this.state.isScreenSharing) return;

    const activeScreenClient = this.screenClient;
    this.screenClient = null;
    this.screenUid = null;

    const toUnpublish: Array<ILocalVideoTrack | ILocalAudioTrack> = [];
    if (this.screenTrack) toUnpublish.push(this.screenTrack);
    if (this.screenAudioTrack) toUnpublish.push(this.screenAudioTrack);
    if (activeScreenClient && toUnpublish.length) {
      try {
        await activeScreenClient.unpublish(toUnpublish);
      } catch {
        // noop
      }
    }

    if (activeScreenClient) {
      try {
        await withTimeout(
          activeScreenClient.leave(),
          1200,
          'Timed out leaving screen-share RTC client.',
        );
      } catch (error) {
        console.warn('Screen-share RTC leave timed out/failed:', error);
      }
    }

    this.disposeScreenTracks();
    this.setState({ isScreenSharing: false });

    if (this.videoTrack && this.localVideoContainer) {
      try {
        this.videoTrack.stop();
        this.videoTrack.play(this.localVideoContainer);
      } catch {
        // noop
      }
    }
  }

  private disposeScreenTracks() {
    if (this.screenTrack) {
      this.screenTrack.stop();
      this.screenTrack.close();
      this.screenTrack = null;
    }
    if (this.screenAudioTrack) {
      this.screenAudioTrack.stop();
      this.screenAudioTrack.close();
      this.screenAudioTrack = null;
    }
  }

  async hangup(options: HangupOptions = {}) {
    if (this.hangupInFlight) {
      return this.hangupInFlight;
    }

    const operation = this.performHangup(options)
      .catch((error) => {
        console.error('Direct call hangup failed:', error);
      })
      .finally(() => {
        this.hangupInFlight = null;
      });

    this.hangupInFlight = operation;
    return operation;
  }

  private async performHangup(options: HangupOptions = {}) {
    const { signalEnded = true, clearMeta = true } = options;
    const signalCallId = this.state.callId;
    const signalConversationId = this.state.conversationId;

    if (signalEnded && signalCallId) {
      void (async () => {
        try {
          await withTimeout(
            (async () => {
              const modernResponse = await supabase
                .from('calls')
                .update({ state: 'ended' } as any)
                .eq('id', signalCallId)
                .in('state', ['ringing', 'accepted']);
              if (!modernResponse.error) return;
              if (!isCallsModernSchemaMissingError(modernResponse.error)) {
                throw modernResponse.error;
              }
              const legacyResponse = await supabase
                .from('calls')
                .update(buildLegacyCallStateUpdate('ended') as any)
                .eq('id', signalCallId)
                .in('status', ['ringing', 'accepted']);
              if (legacyResponse.error) {
                throw legacyResponse.error;
              }
            })(),
            2000,
            'Timed out signaling ended call state.',
          );
        } catch (error) {
          console.warn('Failed to signal ended call state:', error);
        }
      })();
    }

    if (signalEnded && signalConversationId && this.callControlChannel) {
      void (async () => {
        try {
          await withTimeout(
            this.callControlChannel.send({
              type: 'broadcast',
              event: 'call-ended',
              payload: {
                conversation_id: signalConversationId,
                by_user_id: this.localUid,
                at: new Date().toISOString(),
              },
            }),
            2000,
            'Timed out broadcasting call-ended event.',
          );
        } catch (error) {
          console.warn('Failed to broadcast call-ended event:', error);
        }
      })();
    }

    if (clearMeta) {
      this.watchCallState(null);
      this.watchConversationControl(null);
    }

    // Flip UI state immediately so route transitions are instant even if
    // media teardown/network leave takes a moment.
    this.setState({
      phase: 'idle',
      isConnecting: false,
      isMuted: false,
      isVideoOn: false,
      isScreenSharing: false,
      hasRemoteVideo: false,
      remoteParticipantUids: [],
      remoteVideoUids: [],
      activeSpeakerUids: [],
      mediaError: '',
      mediaErrorDetail: '',
      ...(clearMeta
        ? {
            conversationId: null,
            callId: null,
            isCaller: false,
            wantsVideo: false,
            startedAt: null,
          }
        : {}),
    });

    try {
      await withTimeout(
        this.teardownMedia(),
        2000,
        'Timed out tearing down call media.',
      );
    } catch (error) {
      console.warn('Call teardown timed out; forcing local cleanup.', error);
      this.forceLocalCleanup();
    }
  }

  private watchCallState(callId: string | null) {
    if (this.watchedCallId === callId) return;

    if (this.callStateChannel) {
      supabase.removeChannel(this.callStateChannel);
      this.callStateChannel = null;
    }
    this.watchedCallId = callId;
    if (!callId) return;

    this.callStateChannel = supabase
      .channel(`direct-call-session:${callId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'calls', filter: `id=eq.${callId}` },
        async (payload) => {
          const updated = payload.new as any;
          const nextState = normalizeCallStateFromRow(updated);
          if (!nextState) return;
          if ((nextState === 'ended' || nextState === 'declined') && this.state.phase !== 'idle') {
            void this.hangup({ signalEnded: false });
          }
        },
      )
      .subscribe();
  }

  private watchConversationControl(conversationId: string | null) {
    if (this.watchedConversationId === conversationId) return;

    if (this.callControlChannel) {
      supabase.removeChannel(this.callControlChannel);
      this.callControlChannel = null;
    }
    this.watchedConversationId = conversationId;
    if (!conversationId) return;

    this.callControlChannel = supabase
      .channel(`direct-call-control:${conversationId}`)
      .on('broadcast', { event: 'call-ended' }, async (payload: any) => {
        const data = (payload?.payload || {}) as { by_user_id?: string; conversation_id?: string };
        if (!data.conversation_id || String(data.conversation_id) !== String(conversationId)) return;
        if (data.by_user_id && this.localUid && String(data.by_user_id) === String(this.localUid)) return;
        if (this.state.phase === 'idle') return;
        if (String(this.state.conversationId || '') !== String(conversationId)) return;
        void this.hangup({ signalEnded: false });
      })
      .subscribe();
  }

  private forceLocalCleanup() {
    this.disposeScreenTracks();

    try {
      if (this.videoTrack) {
        this.videoTrack.stop();
        this.videoTrack.close();
      }
    } catch {
      // noop
    }
    this.videoTrack = null;

    try {
      if (this.audioTrack) {
        this.audioTrack.stop();
        this.audioTrack.close();
      }
    } catch {
      // noop
    }
    this.audioTrack = null;

    this.clearRemoteState();
    this.localUid = null;
    this.screenUid = null;
  }

  private async teardownMedia() {
    // Snapshot and clear references up-front so UI can continue immediately
    // even if lower-level media/runtime teardown stalls.
    const activeClient = this.client;
    this.client = null;
    const activeScreenClient = this.screenClient;
    this.screenClient = null;

    this.forceLocalCleanup();

    if (!activeClient) return;

    try {
      activeClient.removeAllListeners();
    } catch {
      // noop
    }

    try {
      await withTimeout(
        activeClient.leave(),
        1200,
        'Timed out leaving RTC client during teardown.',
      );
    } catch (error) {
      console.warn('RTC leave timed out/failed after local cleanup:', error);
    }

    if (activeScreenClient) {
      try {
        activeScreenClient.removeAllListeners();
      } catch {
        // noop
      }
      try {
        await withTimeout(
          activeScreenClient.leave(),
          1200,
          'Timed out leaving screen-share RTC client during teardown.',
        );
      } catch (error) {
        console.warn('Screen-share RTC leave timed out/failed after local cleanup:', error);
      }
    }
  }

  private registerClientEvents(client: IAgoraRTCClient) {
    try {
      client.enableAudioVolumeIndicator();
    } catch {
      // Some environments do not expose volume indicators.
    }

    client.on('volume-indicator', (volumes: Array<{ uid: string | number; level: number }>) => {
      if (!Array.isArray(volumes)) return;
      const speaking = volumes
        .filter((entry) => Number(entry?.level || 0) >= 5)
        .map((entry) => String(entry.uid))
        .filter(Boolean)
        .sort();
      const deduped = Array.from(new Set(speaking));
      if (this.sameUidArray(deduped, this.state.activeSpeakerUids)) return;
      this.queueActiveSpeakerUids(deduped);
    });

    client.on('user-joined', (user: IAgoraRTCRemoteUser) => {
      const uid = String(user.uid);
      this.remoteParticipantUids.add(uid);
      this.syncRemoteState();
    });

    client.on('user-published', async (user: IAgoraRTCRemoteUser, mediaType: 'audio' | 'video') => {
      const uid = String(user.uid);
      this.remoteParticipantUids.add(uid);
      this.syncRemoteState();

      const callSettings = loadCallSettings();
      await client.subscribe(user, mediaType);

      if (mediaType === 'audio' && user.audioTrack) {
        this.remoteAudioTracks.set(uid, user.audioTrack);
        const configuredVolume = this.remoteAudioVolumes.get(uid);
        const nextVolume = typeof configuredVolume === 'number'
          ? configuredVolume
          : callSettings.outputVolume;
        this.remoteAudioVolumes.set(uid, nextVolume);
        if (typeof user.audioTrack.setVolume === 'function') {
          user.audioTrack.setVolume(nextVolume);
        }
        if (callSettings.outputDeviceId && callSettings.outputDeviceId !== 'default' && typeof user.audioTrack.setPlaybackDevice === 'function') {
          try {
            await user.audioTrack.setPlaybackDevice(callSettings.outputDeviceId);
          } catch {
            // Some runtimes don't support changing playback device.
          }
        }
        user.audioTrack.play();
      }

      if (mediaType === 'video' && user.videoTrack) {
        this.remoteVideoTracks.set(uid, user.videoTrack);
        this.syncRemoteState();

        const mappedContainer = this.remoteVideoContainers.get(uid);
        if (mappedContainer) {
          user.videoTrack.play(mappedContainer);
        } else if (this.remoteVideoContainer && this.state.remoteVideoUids[0] === uid) {
          user.videoTrack.play(this.remoteVideoContainer);
        }
      }

      this.queueRemoteVideoOptimization();
    });

    client.on('user-unpublished', (user: IAgoraRTCRemoteUser, mediaType: 'audio' | 'video') => {
      const uid = String(user.uid);
      if (mediaType === 'video') {
        const existingTrack = this.remoteVideoTracks.get(uid);
        if (existingTrack) {
          existingTrack.stop();
        }
        this.remoteVideoTracks.delete(uid);
      }
      if (mediaType === 'audio') {
        this.remoteAudioTracks.delete(uid);
      }
      this.syncRemoteState();
    });

    client.on('user-left', (user: IAgoraRTCRemoteUser) => {
      const uid = String(user.uid);
      const existingTrack = this.remoteVideoTracks.get(uid);
      if (existingTrack) {
        existingTrack.stop();
      }
      this.remoteVideoTracks.delete(uid);
      this.remoteAudioTracks.delete(uid);
      this.remoteAudioVolumes.delete(uid);
      this.remoteParticipantUids.delete(uid);
      this.remoteVideoContainers.delete(uid);
      this.syncRemoteState();
    });
  }

  private normalizeInputVolume(inputVolume: number): number {
    const numeric = Number(inputVolume);
    if (!Number.isFinite(numeric)) return 100;
    if (numeric <= 0) return 100;
    return Math.max(1, Math.min(100, Math.round(numeric)));
  }

  private async resolveCallAudioSettings(base?: CallSettings): Promise<CallSettings> {
    const source = base || loadCallSettings();
    const next: CallSettings = {
      ...source,
      inputVolume: this.normalizeInputVolume(source.inputVolume),
      inputDeviceId: String(source.inputDeviceId || 'default').trim() || 'default',
    };

    let changed = (
      next.inputVolume !== source.inputVolume
      || next.inputDeviceId !== source.inputDeviceId
    );

    if (next.inputDeviceId !== 'default') {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasSavedInput = devices.some((device) => (
          device.kind === 'audioinput' && device.deviceId === next.inputDeviceId
        ));
        if (!hasSavedInput) {
          next.inputDeviceId = 'default';
          changed = true;
        }
      } catch {
        // If device enumeration fails, keep current best-effort settings.
      }
    }

    if (changed) {
      saveCallSettings(next);
    }
    return next;
  }

  private async createLocalAudioTrack(preferredSettings?: CallSettings): Promise<ILocalAudioTrack> {
    const callSettings = await this.resolveCallAudioSettings(preferredSettings);
    const errors: string[] = [];
    const AgoraRTC = await getAgoraModule();

    try {
      const selectedStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: callSettings.inputDeviceId && callSettings.inputDeviceId !== 'default'
            ? { exact: callSettings.inputDeviceId }
            : undefined,
          echoCancellation: callSettings.echoCancellation,
          noiseSuppression: callSettings.noiseSuppression,
          autoGainControl: callSettings.automaticGainControl,
        },
        video: false,
      });
      const selectedTrack = selectedStream.getAudioTracks()[0];
      if (!selectedTrack) {
        throw new Error('No audio track from selected getUserMedia');
      }
      await this.applyEnhancedNoiseSuppression(selectedTrack, callSettings.noiseSuppression);
      return AgoraRTC.createCustomAudioTrack({ mediaStreamTrack: selectedTrack });
    } catch (error) {
      errors.push(`getUserMedia(selected): ${formatRtcError(error)}`);
    }

    try {
      return await AgoraRTC.createMicrophoneAudioTrack({
        microphoneId: callSettings.inputDeviceId && callSettings.inputDeviceId !== 'default'
          ? callSettings.inputDeviceId
          : undefined,
        AEC: callSettings.echoCancellation,
        ANS: callSettings.noiseSuppression,
        AGC: callSettings.automaticGainControl,
      } as any);
    } catch (error) {
      errors.push(`agora(selected): ${formatRtcError(error)}`);
    }

    try {
      const defaultStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: callSettings.echoCancellation,
          noiseSuppression: callSettings.noiseSuppression,
          autoGainControl: callSettings.automaticGainControl,
        },
        video: false,
      });
      const defaultTrack = defaultStream.getAudioTracks()[0];
      if (!defaultTrack) {
        throw new Error('No audio track from default getUserMedia');
      }
      await this.applyEnhancedNoiseSuppression(defaultTrack, callSettings.noiseSuppression);
      return AgoraRTC.createCustomAudioTrack({ mediaStreamTrack: defaultTrack });
    } catch (error) {
      errors.push(`getUserMedia(default): ${formatRtcError(error)}`);
    }

    try {
      return await AgoraRTC.createMicrophoneAudioTrack({
        AEC: callSettings.echoCancellation,
        ANS: callSettings.noiseSuppression,
        AGC: callSettings.automaticGainControl,
      } as any);
    } catch (error) {
      errors.push(`agora(default): ${formatRtcError(error)}`);
      throw new Error(errors.join(' || '));
    }
  }

  private async createLocalVideoTrack(): Promise<ILocalVideoTrack> {
    const AgoraRTC = await getAgoraModule();
    const callSettings = loadCallSettings();
    let stream: MediaStream;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: callSettings.cameraDeviceId && callSettings.cameraDeviceId !== 'default'
            ? { exact: callSettings.cameraDeviceId }
            : undefined,
          width: callSettings.qualityHD ? { ideal: 1280 } : { ideal: 854 },
          height: callSettings.qualityHD ? { ideal: 720 } : { ideal: 480 },
        },
        audio: false,
      });
    } catch {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: callSettings.qualityHD ? { ideal: 1280 } : { ideal: 854 },
          height: callSettings.qualityHD ? { ideal: 720 } : { ideal: 480 },
        },
        audio: false,
      });
    }

    const mediaStreamTrack = stream.getVideoTracks()[0];
    if (!mediaStreamTrack) {
      throw new Error('No camera track returned by browser');
    }
    return AgoraRTC.createCustomVideoTrack({ mediaStreamTrack });
  }
}

export const directCallSession = new DirectCallSessionStore();

export function useDirectCallSession(): DirectCallSessionState {
  return useSyncExternalStore(
    directCallSession.subscribe,
    directCallSession.getState,
    directCallSession.getState,
  );
}
