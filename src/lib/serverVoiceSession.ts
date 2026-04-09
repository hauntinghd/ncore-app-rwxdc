import { useSyncExternalStore } from 'react';
import type {
  IAgoraRTCClient,
  ILocalAudioTrack,
  ILocalVideoTrack,
  IRemoteAudioTrack,
  IRemoteVideoTrack,
  ScreenVideoTrackInitConfig,
  UID,
} from 'agora-rtc-sdk-ng';
import { describeAgoraJoinFailure, resolveAgoraJoinToken } from './agoraAuth';
import { createAIDenoiserBinding, type AIDenoiserBinding } from './agoraAIDenoiser';
import { createConfiguredLocalAudioTrack } from './callMedia';
import { loadCallSettings, saveCallSettings } from './callSettings';
import { queueRuntimeEvent } from './runtimeTelemetry';
import { publishServerVoiceShellState } from './serverVoiceShell';
import { supabase } from './supabase';
import type { Channel, VoiceSession } from './types';
import { playVoiceToggleSound } from './notificationSound';

type Listener = () => void;

const AGORA_APP_ID = import.meta.env.VITE_AGORA_APP_ID || '';
type AgoraRTCModule = typeof import('agora-rtc-sdk-ng')['default'];

let cachedAgoraModule: Promise<AgoraRTCModule> | null = null;

async function getAgoraModule(): Promise<AgoraRTCModule> {
  if (!cachedAgoraModule) {
    cachedAgoraModule = import('agora-rtc-sdk-ng').then((module) => module.default as AgoraRTCModule);
  }
  return cachedAgoraModule;
}

export interface ScreenSourceOption {
  id: string;
  name: string;
  type: 'screen' | 'window';
}

type ScreenShareQuality = '720p30' | '1080p120' | '4k60';

export interface ServerVoiceSessionState {
  phase: 'idle' | 'connecting' | 'active';
  communityId: string | null;
  channelId: string | null;
  channelName: string;
  isMuted: boolean;
  isDeafened: boolean;
  isCameraOn: boolean;
  isScreenSharing: boolean;
  isConnected: boolean;
  isConnecting: boolean;
  connectionError: string;
  noiseSuppressionEnabled: boolean;
  dbSessions: VoiceSession[];
  remoteParticipantUids: string[];
  remoteVideoUids: string[];
  activeSpeakerUids: string[];
  screenSources: ScreenSourceOption[];
  selectedScreenSourceId: string;
  loadingScreenSources: boolean;
  participantCount: number;
  averagePingMs: number | null;
  lastPingMs: number | null;
  outboundPacketLossPct: number | null;
  privacyCode: string[];
}

export interface ServerVoiceSessionShellState {
  phase: ServerVoiceSessionState['phase'];
  communityId: string | null;
  channelId: string | null;
  channelName: string;
  isMuted: boolean;
  isDeafened: boolean;
  isCameraOn: boolean;
  isScreenSharing: boolean;
  noiseSuppressionEnabled: boolean;
  participantCount: number;
  averagePingMs: number | null;
  lastPingMs: number | null;
  outboundPacketLossPct: number | null;
  privacyCode: string[];
}

interface JoinOptions {
  communityId: string;
  channelId: string;
  channelName?: string | null;
  profileId: string;
  userId?: string | null;
}

const initialState: ServerVoiceSessionState = {
  phase: 'idle',
  communityId: null,
  channelId: null,
  channelName: '',
  isMuted: Boolean(loadCallSettings().startMuted),
  isDeafened: Boolean(loadCallSettings().startDeafened),
  isCameraOn: false,
  isScreenSharing: false,
  isConnected: false,
  isConnecting: false,
  connectionError: '',
  noiseSuppressionEnabled: loadCallSettings().noiseSuppression,
  dbSessions: [],
  remoteParticipantUids: [],
  remoteVideoUids: [],
  activeSpeakerUids: [],
  screenSources: [],
  selectedScreenSourceId: '',
  loadingScreenSources: false,
  participantCount: 0,
  averagePingMs: null,
  lastPingMs: null,
  outboundPacketLossPct: null,
  privacyCode: [],
};

function persistVoiceTogglePreferences(next: { startMuted?: boolean; startDeafened?: boolean }) {
  const current = loadCallSettings();
  saveCallSettings({
    ...current,
    ...next,
  });
}

function formatRtcError(error: unknown): string {
  const e = error as any;
  return [e?.name || 'UnknownError', e?.code ? `code=${e.code}` : '', e?.message || String(error || '')]
    .filter(Boolean)
    .join(' | ');
}

function screenShareQualityRank(quality: ScreenShareQuality): number {
  if (quality === '4k60') return 3;
  if (quality === '1080p120') return 2;
  return 1;
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

class ServerVoiceSessionStore {
  private listeners = new Set<Listener>();
  private state: ServerVoiceSessionState = { ...initialState };
  private shellState: ServerVoiceSessionShellState = {
    phase: initialState.phase,
    communityId: initialState.communityId,
    channelId: initialState.channelId,
    channelName: initialState.channelName,
    isMuted: initialState.isMuted,
    isDeafened: initialState.isDeafened,
    isCameraOn: initialState.isCameraOn,
    isScreenSharing: initialState.isScreenSharing,
    noiseSuppressionEnabled: initialState.noiseSuppressionEnabled,
    participantCount: initialState.participantCount,
    averagePingMs: initialState.averagePingMs,
    lastPingMs: initialState.lastPingMs,
    outboundPacketLossPct: initialState.outboundPacketLossPct,
    privacyCode: initialState.privacyCode,
  };
  private lifecycleToken = 0;

  private client: IAgoraRTCClient | null = null;
  private localUid: string | null = null;
  private localProfileId: string | null = null;
  private localVideoTrack: ILocalVideoTrack | null = null;
  private localAudioTrack: ILocalAudioTrack | null = null;
  private audioDenoiserBinding: AIDenoiserBinding | null = null;
  private screenClient: IAgoraRTCClient | null = null;
  private screenUid: string | null = null;
  private screenTrack: ILocalVideoTrack | null = null;
  private screenAudioTrack: ILocalAudioTrack | null = null;
  private remoteVideoTracks = new Map<string, IRemoteVideoTrack>();
  private remoteAudioTracks = new Map<string, IRemoteAudioTrack>();
  private remoteVideoContainers = new Map<string, HTMLDivElement | null>();
  private localVideoContainer: HTMLDivElement | null = null;
  private dbSessionsChannel: any = null;
  private activeSpeakerKey = '';
  private statsInterval: ReturnType<typeof setInterval> | null = null;
  private latencySamples: number[] = [];
  private screenShareOperation: Promise<void> | null = null;

  private async configureRtcOptimizations(client: IAgoraRTCClient) {
    const clientAny = client as any;
    try {
      await client.enableDualStream();
    } catch {
      // noop
    }
    try {
      if (typeof clientAny.setStreamFallbackOption === 'function') {
        clientAny.setStreamFallbackOption(2);
      }
    } catch {
      // noop
    }
  }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = () => this.state;
  getShellState = () => this.shellState;

  private deriveShellState(state: ServerVoiceSessionState): ServerVoiceSessionShellState {
    return {
      phase: state.phase,
      communityId: state.communityId,
      channelId: state.channelId,
      channelName: state.channelName,
      isMuted: state.isMuted,
      isDeafened: state.isDeafened,
      isCameraOn: state.isCameraOn,
      isScreenSharing: state.isScreenSharing,
      noiseSuppressionEnabled: state.noiseSuppressionEnabled,
      participantCount: state.participantCount,
      averagePingMs: state.averagePingMs,
      lastPingMs: state.lastPingMs,
      outboundPacketLossPct: state.outboundPacketLossPct,
      privacyCode: state.privacyCode,
    };
  }

  private setState(patch: Partial<ServerVoiceSessionState>) {
    let changed = false;
    const nextState: ServerVoiceSessionState = { ...this.state };
    (Object.keys(patch) as Array<keyof ServerVoiceSessionState>).forEach((key) => {
      const nextValue = patch[key];
      if (!Object.is(nextState[key], nextValue)) {
        (nextState as any)[key] = nextValue;
        changed = true;
      }
    });
    if (!changed) return;
    this.state = nextState;
    const nextShellState = this.deriveShellState(nextState);
    const shellChanged = Object.keys(nextShellState).some((key) => (
      !Object.is(
        this.shellState[key as keyof ServerVoiceSessionShellState],
        nextShellState[key as keyof ServerVoiceSessionShellState],
      )
    ));
    if (shellChanged) {
      this.shellState = nextShellState;
      publishServerVoiceShellState(nextShellState);
    }
    this.listeners.forEach((listener) => listener());
  }

  private sameUidArray(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  private syncRemoteState() {
    const remoteParticipantUids = Array.from(new Set([
      ...Array.from(this.remoteAudioTracks.keys()),
      ...Array.from(this.remoteVideoTracks.keys()),
    ])).sort();
    const remoteVideoUids = Array.from(this.remoteVideoTracks.keys()).sort();

    if (
      !this.sameUidArray(remoteParticipantUids, this.state.remoteParticipantUids)
      || !this.sameUidArray(remoteVideoUids, this.state.remoteVideoUids)
    ) {
      this.setState({
        remoteParticipantUids,
        remoteVideoUids,
      });
    }
  }

  private async hydrateChannelName(channelId: string, fallbackName?: string | null) {
    if (fallbackName) {
      this.setState({ channelName: fallbackName });
      return;
    }
    const { data } = await supabase
      .from('channels')
      .select('*')
      .eq('id', channelId)
      .maybeSingle();
    if (data) {
      this.setState({ channelName: String((data as Channel).name || '') });
    }
  }

  private async loadDbSessions(channelId: string) {
    const { data } = await supabase
      .from('voice_sessions')
      .select('*, profile:profiles(*)')
      .eq('channel_id', channelId);
    if (this.state.channelId !== channelId) return;
    const nextSessions = (data || []) as VoiceSession[];
    this.setState({
      dbSessions: nextSessions,
      participantCount: nextSessions.length,
      privacyCode: this.buildPrivacyCode(channelId, nextSessions),
    });
  }

  private watchDbSessions(channelId: string) {
    if (this.dbSessionsChannel) {
      supabase.removeChannel(this.dbSessionsChannel);
      this.dbSessionsChannel = null;
    }

    this.dbSessionsChannel = supabase
      .channel(`server-voice-sessions:${channelId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'voice_sessions', filter: `channel_id=eq.${channelId}` },
        () => {
          void this.loadDbSessions(channelId);
        },
      )
      .subscribe();
  }

  private async applyRemoteAudioState() {
    const outputVolume = this.state.isDeafened ? 0 : Math.max(0, Math.min(100, Number(loadCallSettings().outputVolume || 100)));
    await Promise.all(Array.from(this.remoteAudioTracks.values()).map(async (track) => {
      try {
        if (typeof track.setVolume === 'function') {
          track.setVolume(outputVolume);
        }
      } catch {
        // ignore output volume failures
      }
    }));
  }

  private normalizePacketLoss(value: unknown): number | null {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return null;
    const pct = numeric <= 1 ? numeric * 100 : numeric;
    return Math.round(pct * 10) / 10;
  }

  private buildPrivacyCode(channelId: string, sessions: VoiceSession[]): string[] {
    const seed = [
      String(channelId || '').trim(),
      ...sessions.map((session) => String(session.user_id || '').trim()).filter(Boolean).sort(),
    ].join(':');
    let hash = 0;
    for (let index = 0; index < seed.length; index += 1) {
      hash = ((hash << 5) - hash + seed.charCodeAt(index)) | 0;
    }
    const nextCodes: string[] = [];
    let cursor = Math.abs(hash) + 104729;
    while (nextCodes.length < 6) {
      cursor = (cursor * 1103515245 + 12345) & 0x7fffffff;
      nextCodes.push(String(cursor % 100000).padStart(5, '0'));
    }
    return nextCodes;
  }

  private stopStatsPolling() {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    this.latencySamples = [];
  }

  private updateRtcStats() {
    const rtcStats = (this.client as any)?.getRTCStats?.();
    if (!rtcStats) return;
    const lastPingMs = Number(
      rtcStats.RTT
      ?? rtcStats.rtt
      ?? rtcStats.Rtt
      ?? rtcStats.roundTripTime
      ?? rtcStats.NetworkTransportDelay
      ?? 0,
    );
    if (Number.isFinite(lastPingMs) && lastPingMs > 0) {
      this.latencySamples = [...this.latencySamples, Math.round(lastPingMs)].slice(-12);
    }
    const averagePingMs = this.latencySamples.length > 0
      ? Math.round(this.latencySamples.reduce((sum, sample) => sum + sample, 0) / this.latencySamples.length)
      : null;
    this.setState({
      lastPingMs: Number.isFinite(lastPingMs) && lastPingMs > 0 ? Math.round(lastPingMs) : null,
      averagePingMs,
      outboundPacketLossPct: this.normalizePacketLoss(
        rtcStats.OutgoingPacketLossRate
        ?? rtcStats.outgoingPacketLossRate
        ?? rtcStats.SendPacketLossRate
        ?? rtcStats.sendPacketLossRate
        ?? null,
      ),
    });
  }

  private startStatsPolling() {
    this.stopStatsPolling();
    this.updateRtcStats();
    this.statsInterval = setInterval(() => {
      this.updateRtcStats();
    }, 2500);
  }

  private attachActiveLocalVideoTrack() {
    const activeTrack = this.screenTrack || this.localVideoTrack;
    if (!activeTrack || !this.localVideoContainer) return;
    try {
      activeTrack.stop();
      activeTrack.play(this.localVideoContainer);
    } catch {
      // noop
    }
  }

  private async disposeAudioDenoiser(binding: AIDenoiserBinding | null = this.audioDenoiserBinding) {
    if (!binding) return;
    if (binding === this.audioDenoiserBinding) {
      this.audioDenoiserBinding = null;
    }
    try {
      await binding.teardown();
    } catch {
      // noop
    }
  }

  private bindScreenTrackEnded(track: ILocalVideoTrack | null) {
    const trackAny = track as any;
    if (!trackAny || typeof trackAny.on !== 'function') return;
    trackAny.on('track-ended', () => {
      if (!this.state.isScreenSharing) return;
      void this.stopScreenShare();
    });
  }

  private getPreferredScreenShareQuality(): ScreenShareQuality {
    const quality = loadCallSettings().screenShareQuality;
    if (quality === '4k60' || quality === '1080p120' || quality === '720p30') {
      return quality;
    }
    return '720p30';
  }

  private getScreenShareAttemptOrder(requested: ScreenShareQuality): ScreenShareQuality[] {
    if (requested === '4k60') return ['4k60', '1080p120', '720p30'];
    if (requested === '1080p120') return ['1080p120', '720p30'];
    return ['720p30'];
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
        selfBrowserSurface: 'exclude' as any,
        surfaceSwitching: 'include' as any,
        systemAudio: withAudio ? 'include' as any : 'exclude' as any,
        preferCurrentTab: false as any,
      } as any);
    } catch (primaryError) {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: withAudio,
        selfBrowserSurface: 'exclude' as any,
        surfaceSwitching: 'include' as any,
        systemAudio: withAudio ? 'include' as any : 'exclude' as any,
        preferCurrentTab: false as any,
      } as any).catch(() => {
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

  private disposeScreenTracks() {
    if (this.screenTrack) {
      try {
        this.screenTrack.stop();
        this.screenTrack.close();
      } catch {
        // noop
      }
      this.screenTrack = null;
    }
    if (this.screenAudioTrack) {
      try {
        this.screenAudioTrack.stop();
        this.screenAudioTrack.close();
      } catch {
        // noop
      }
      this.screenAudioTrack = null;
    }
  }

  private async stopScreenShare(syncDb = true) {
    if (!this.state.isScreenSharing && !this.screenClient && !this.screenTrack && !this.screenAudioTrack) {
      return;
    }

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
        activeScreenClient.removeAllListeners();
      } catch {
        // noop
      }
      try {
        await activeScreenClient.leave();
      } catch (error) {
        console.warn('Failed leaving screen-share client:', error);
      }
    }

    this.disposeScreenTracks();
    this.setState({
      isScreenSharing: false,
      connectionError: '',
    });
    this.attachActiveLocalVideoTrack();

    if (syncDb && this.state.channelId && this.localProfileId) {
      await supabase
        .from('voice_sessions')
        .update({ is_screen_sharing: false })
        .eq('channel_id', this.state.channelId)
        .eq('user_id', this.localProfileId);
    }
  }

  attachLocalVideo(container: HTMLDivElement | null) {
    this.localVideoContainer = container;
    this.attachActiveLocalVideoTrack();
  }

  attachRemoteVideoForUid(uid: string, container: HTMLDivElement | null) {
    const normalizedUid = String(uid || '').trim();
    if (!normalizedUid) return;
    if (container) {
      this.remoteVideoContainers.set(normalizedUid, container);
    } else {
      this.remoteVideoContainers.delete(normalizedUid);
    }

    const track = this.remoteVideoTracks.get(normalizedUid);
    if (!track) return;
    try {
      track.stop();
      if (container) {
        track.play(container);
      }
    } catch {
      // noop
    }
  }

  async refreshScreenSources() {
    if (!window.desktopBridge?.listDesktopCaptureSources) return;
    this.setState({ loadingScreenSources: true });
    try {
      const result = await window.desktopBridge.listDesktopCaptureSources();
      if (!result.ok) return;
      const sources = (result.sources || []) as ScreenSourceOption[];
      const nextSelected = this.state.selectedScreenSourceId && sources.some((source) => source.id === this.state.selectedScreenSourceId)
        ? this.state.selectedScreenSourceId
        : (sources[0]?.id || '');
      this.setState({
        screenSources: sources,
        selectedScreenSourceId: nextSelected,
      });
    } finally {
      this.setState({ loadingScreenSources: false });
    }
  }

  setSelectedScreenSourceId(sourceId: string) {
    this.setState({ selectedScreenSourceId: String(sourceId || '').trim() });
  }

  async join(options: JoinOptions) {
    const { communityId, channelId, channelName, profileId, userId } = options;
    if (!channelId || !profileId) return false;
    const joinToken = ++this.lifecycleToken;
    const activeCallSettings = loadCallSettings();
    const preferredMuted = Boolean(activeCallSettings.startMuted);
    const preferredDeafened = Boolean(activeCallSettings.startDeafened);

    if (
      this.state.channelId === channelId
      && (this.state.phase === 'active' || this.state.phase === 'connecting')
    ) {
      this.localProfileId = profileId;
      this.localUid = String(userId || profileId || '').trim() || profileId;
      this.setState({
        communityId,
        channelId,
        channelName: String(channelName || this.state.channelName || ''),
      });
      void this.loadDbSessions(channelId);
      return true;
    }

    if (this.state.channelId && this.state.channelId !== channelId) {
      await this.leave();
    }

    this.localProfileId = profileId;
    this.localUid = String(userId || profileId || '').trim() || profileId;
    this.setState({
      phase: 'connecting',
      communityId,
      channelId,
      channelName: String(channelName || ''),
      isMuted: preferredMuted,
      isDeafened: preferredDeafened,
      isConnected: false,
      isConnecting: true,
      connectionError: '',
      noiseSuppressionEnabled: activeCallSettings.noiseSuppression,
    });

    void this.hydrateChannelName(channelId, channelName);
    await this.loadDbSessions(channelId);
    this.watchDbSessions(channelId);

    let rtcJoined = false;

    try {
      await supabase.from('voice_sessions').upsert({
        channel_id: channelId,
        user_id: profileId,
        is_muted: this.state.isMuted,
        is_deafened: this.state.isDeafened,
        is_camera_on: false,
        is_screen_sharing: false,
      });
      if (joinToken !== this.lifecycleToken) {
        await supabase
          .from('voice_sessions')
          .delete()
          .eq('channel_id', channelId)
          .eq('user_id', profileId);
        return false;
      }

      if (!AGORA_APP_ID) {
        if (joinToken !== this.lifecycleToken) return false;
        this.stopStatsPolling();
        this.setState({
          phase: 'active',
          isConnected: true,
          isConnecting: false,
        });
        return true;
      }

      const AgoraRTC = await getAgoraModule();
      const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
      this.client = client;
      await this.configureRtcOptimizations(client);
      try {
        client.enableAudioVolumeIndicator();
      } catch {
        // ignore unsupported volume indicator environments
      }
      client.on('connection-state-change', (curState, prevState, reason) => {
        queueRuntimeEvent('server_voice_connection_state', {
          channel_id: channelId,
          current_state: String(curState || ''),
          previous_state: String(prevState || ''),
          reason: String(reason || ''),
        }, { userId: profileId, sampleRate: 0.5 });
      });

      client.on('volume-indicator', (volumes: Array<{ uid: UID; level: number }>) => {
        const active = (volumes || [])
          .filter((entry) => Number(entry?.level || 0) >= 5)
          .map((entry) => String(entry.uid))
          .sort();
        const deduped = Array.from(new Set(active));
        const nextKey = deduped.join(',');
        if (nextKey === this.activeSpeakerKey) return;
        this.activeSpeakerKey = nextKey;
        this.setState({ activeSpeakerUids: deduped });
      });

      client.on('user-published', async (user, mediaType) => {
        await client.subscribe(user, mediaType);
        const uid = String(user.uid);
        if (mediaType === 'video' && user.videoTrack) {
          this.remoteVideoTracks.set(uid, user.videoTrack);
          const target = this.remoteVideoContainers.get(uid);
          if (target) {
            try {
              user.videoTrack.play(target);
            } catch {
              // noop
            }
          }
        }
        if (mediaType === 'audio' && user.audioTrack) {
          this.remoteAudioTracks.set(uid, user.audioTrack);
          try {
            user.audioTrack.play();
          } catch {
            // noop
          }
          void this.applyRemoteAudioState();
        }
        this.syncRemoteState();
      });

      client.on('user-unpublished', (user, mediaType) => {
        const uid = String(user.uid);
        if (mediaType === 'video') {
          const existingVideo = this.remoteVideoTracks.get(uid);
          try {
            existingVideo?.stop();
          } catch {
            // noop
          }
          this.remoteVideoTracks.delete(uid);
        }
        if (mediaType === 'audio') {
          this.remoteAudioTracks.delete(uid);
        }
        this.syncRemoteState();
      });

      client.on('user-left', (user) => {
        const uid = String(user.uid);
        const existingVideo = this.remoteVideoTracks.get(uid);
        try {
          existingVideo?.stop();
        } catch {
          // noop
        }
        this.remoteVideoTracks.delete(uid);
        this.remoteAudioTracks.delete(uid);
        this.remoteVideoContainers.delete(uid);
        this.setState({
          activeSpeakerUids: this.state.activeSpeakerUids.filter((entry) => entry !== uid),
        });
        this.syncRemoteState();
      });

      const token = await resolveAgoraJoinToken(channelId, this.localUid);
      if (joinToken !== this.lifecycleToken) {
        try {
          await client.leave();
        } catch {
          // noop
        }
        return false;
      }
      await client.join(AGORA_APP_ID, channelId, token, this.localUid);
      rtcJoined = true;
      queueRuntimeEvent('server_voice_joined', {
        channel_id: channelId,
        has_agora: true,
      }, { userId: profileId, sampleRate: 1 });
      if (joinToken !== this.lifecycleToken) {
        try {
          await client.leave();
        } catch {
          // noop
        }
        await supabase
          .from('voice_sessions')
          .delete()
          .eq('channel_id', channelId)
          .eq('user_id', profileId);
        return false;
      }

      const audioTrack = await createConfiguredLocalAudioTrack(activeCallSettings);
      if (joinToken !== this.lifecycleToken) {
        try {
          audioTrack.stop();
          audioTrack.close();
        } catch {
          // noop
        }
        try {
          await client.leave();
        } catch {
          // noop
        }
        await supabase
          .from('voice_sessions')
          .delete()
          .eq('channel_id', channelId)
          .eq('user_id', profileId);
        return false;
      }
      const audioDenoiserBinding = await createAIDenoiserBinding(audioTrack, activeCallSettings.noiseSuppression);
      this.localAudioTrack = audioTrack;
      this.audioDenoiserBinding = audioDenoiserBinding;
      if (this.state.isMuted) {
        await audioTrack.setEnabled(false);
      }
      await client.publish(audioTrack);
      if (joinToken !== this.lifecycleToken) {
        try {
          await client.unpublish(audioTrack);
        } catch {
          // noop
        }
        await this.disposeAudioDenoiser(audioDenoiserBinding);
        try {
          audioTrack.stop();
          audioTrack.close();
        } catch {
          // noop
        }
        try {
          await client.leave();
        } catch {
          // noop
        }
        await supabase
          .from('voice_sessions')
          .delete()
          .eq('channel_id', channelId)
          .eq('user_id', profileId);
        return false;
      }

      this.setState({
        phase: 'active',
        isConnected: true,
        isConnecting: false,
        connectionError: '',
      });
      this.startStatsPolling();
      return true;
    } catch (error) {
      console.error('Failed to join server voice channel:', error);
      this.stopStatsPolling();
      await this.disposeAudioDenoiser();
      queueRuntimeEvent('server_voice_join_failed', {
        channel_id: channelId,
        error: describeAgoraJoinFailure(error),
      }, { userId: profileId, sampleRate: 1 });
      this.setState({
        phase: 'idle',
        isConnected: false,
        isConnecting: false,
        connectionError: describeAgoraJoinFailure(error),
      });
      if (!rtcJoined) {
        await supabase
          .from('voice_sessions')
          .delete()
          .eq('channel_id', channelId)
          .eq('user_id', profileId);
        await this.loadDbSessions(channelId);
      }
      return false;
    }
  }

  async leave() {
    const leaveToken = ++this.lifecycleToken;
    const currentChannelId = this.state.channelId;
    const currentProfileId = this.localProfileId;
    const preservedScreenSources = this.state.screenSources;
    const preservedSelectedScreenSourceId = this.state.selectedScreenSourceId;
    const activeClient = this.client;
    const activeDbSessionsChannel = this.dbSessionsChannel;
    const activeRemoteVideoTracks = Array.from(this.remoteVideoTracks.values());

    this.stopStatsPolling();
    await this.stopScreenShare(false);

    this.client = null;
    this.dbSessionsChannel = null;
    this.localUid = null;
    this.localProfileId = null;
    this.remoteVideoTracks.clear();
    this.remoteAudioTracks.clear();
    this.remoteVideoContainers.clear();
    this.activeSpeakerKey = '';
    const persistedSettings = loadCallSettings();
    this.setState({
      ...initialState,
      isMuted: Boolean(persistedSettings.startMuted),
      isDeafened: Boolean(persistedSettings.startDeafened),
      noiseSuppressionEnabled: persistedSettings.noiseSuppression,
      screenSources: preservedScreenSources,
      selectedScreenSourceId: preservedSelectedScreenSourceId,
    });

    try {
      this.localVideoTrack?.stop();
      this.localVideoTrack?.close();
    } catch {
      // noop
    }
    this.localVideoTrack = null;

    try {
      await this.disposeAudioDenoiser();
      this.localAudioTrack?.stop();
      this.localAudioTrack?.close();
    } catch {
      // noop
    }
    this.localAudioTrack = null;

    activeRemoteVideoTracks.forEach((track) => {
      try {
        track.stop();
      } catch {
        // noop
      }
    });

    if (activeClient) {
      try {
        activeClient.removeAllListeners();
      } catch {
        // noop
      }
      try {
        await activeClient.leave();
      } catch (error) {
        console.warn('Failed leaving active voice client:', error);
      }
    }

    if (currentChannelId && currentProfileId) {
      const { error } = await supabase
        .from('voice_sessions')
        .delete()
        .eq('channel_id', currentChannelId)
        .eq('user_id', currentProfileId);
      if (error) {
        console.warn('Failed deleting voice session row during leave:', error);
      }
    }

    if (activeDbSessionsChannel) {
      supabase.removeChannel(activeDbSessionsChannel);
    }

    if (leaveToken !== this.lifecycleToken) return;
    queueRuntimeEvent('server_voice_left', {
      channel_id: currentChannelId,
    }, { userId: currentProfileId, sampleRate: 1 });
  }

  async toggleMute() {
    const nextMuted = !this.state.isMuted;
    if (this.localAudioTrack && this.state.channelId && this.localProfileId) {
      await this.localAudioTrack.setEnabled(!nextMuted);
    }
    persistVoiceTogglePreferences({ startMuted: nextMuted });
    this.setState({ isMuted: nextMuted });
    playVoiceToggleSound('mute', nextMuted);
    if (!this.state.channelId || !this.localProfileId) return;
    await supabase
      .from('voice_sessions')
      .update({ is_muted: nextMuted })
      .eq('channel_id', this.state.channelId)
      .eq('user_id', this.localProfileId);
  }

  async toggleDeafen() {
    const next = !this.state.isDeafened;
    persistVoiceTogglePreferences({ startDeafened: next });
    this.setState({ isDeafened: next });
    await this.applyRemoteAudioState();
    playVoiceToggleSound('deafen', next);
    if (this.state.channelId && this.localProfileId) {
      await supabase
        .from('voice_sessions')
        .update({ is_deafened: next })
        .eq('channel_id', this.state.channelId)
        .eq('user_id', this.localProfileId);
    }
  }

  async toggleCamera() {
    if (!this.client || !this.state.channelId || !this.localProfileId) return;
    const nextCameraOn = !this.state.isCameraOn;
    if (this.state.isCameraOn && this.localVideoTrack) {
      await this.client.unpublish(this.localVideoTrack);
      this.localVideoTrack.stop();
      this.localVideoTrack.close();
      this.localVideoTrack = null;
      this.setState({ isCameraOn: nextCameraOn });
      this.attachActiveLocalVideoTrack();
    } else {
      const AgoraRTC = await getAgoraModule();
      const videoTrack = await AgoraRTC.createCameraVideoTrack();
      this.localVideoTrack = videoTrack;
      await this.client.publish(videoTrack);
      this.setState({ isCameraOn: nextCameraOn });
      this.attachActiveLocalVideoTrack();
    }

    await supabase
      .from('voice_sessions')
      .update({ is_camera_on: nextCameraOn })
      .eq('channel_id', this.state.channelId)
      .eq('user_id', this.localProfileId);
  }

  async toggleScreenShare() {
    if (this.screenShareOperation) {
      return this.screenShareOperation;
    }
    const operation = this.performToggleScreenShare().finally(() => {
      this.screenShareOperation = null;
    });
    this.screenShareOperation = operation;
    return operation;
  }

  private async performToggleScreenShare() {
    if (!this.client || !this.state.channelId || !this.localProfileId || !this.localUid || !AGORA_APP_ID) return;
    if (this.state.isScreenSharing) {
      await this.stopScreenShare();
      return;
    }

    const requestedQuality = this.getPreferredScreenShareQuality();
    const qualityAttemptOrder = this.getScreenShareAttemptOrder(requestedQuality);
    const preferNativeCapture = typeof window !== 'undefined' && Boolean(window.desktopBridge?.setPreferredDesktopCaptureSource);
    const attemptErrors: string[] = [];

    try {
      this.setState({ connectionError: '' });
      if (this.state.selectedScreenSourceId && window.desktopBridge?.setPreferredDesktopCaptureSource) {
        await window.desktopBridge.setPreferredDesktopCaptureSource(this.state.selectedScreenSourceId);
      }

      let activeQuality: ScreenShareQuality | null = null;
      for (const quality of qualityAttemptOrder) {
        const attemptFns: Array<{
          label: string;
          run: () => Promise<{ videoTrack: ILocalVideoTrack; audioTrack: ILocalAudioTrack | null }>;
        }> = preferNativeCapture
          ? [
            {
              label: `${quality}:native:audio-on`,
              run: () => this.createNativeScreenTracks(quality, true),
            },
            {
              label: `${quality}:native:audio-off`,
              run: () => this.createNativeScreenTracks(quality, false),
            },
            {
              label: `${quality}:agora:audio-on`,
              run: () => this.createAgoraScreenTracks(quality, 'enable'),
            },
            {
              label: `${quality}:agora:audio-off`,
              run: () => this.createAgoraScreenTracks(quality, 'disable'),
            },
          ]
          : [
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
            await this.configureRtcOptimizations(this.screenClient);
            this.screenUid = `${this.localUid}::screen`;
            const token = await resolveAgoraJoinToken(this.state.channelId, this.screenUid);
            await this.screenClient.join(AGORA_APP_ID, this.state.channelId, token, this.screenUid);

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
                this.screenClient.removeAllListeners();
              } catch {
                // noop
              }
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

      if (!activeQuality || !this.screenTrack || !this.screenClient) {
        throw new Error(attemptErrors.join(' || ') || 'No supported screen capture method succeeded.');
      }

      this.setState({
        isScreenSharing: true,
        connectionError: '',
      });
      this.attachActiveLocalVideoTrack();
      await supabase
        .from('voice_sessions')
        .update({ is_screen_sharing: true })
        .eq('channel_id', this.state.channelId)
        .eq('user_id', this.localProfileId);
    } catch (error) {
      console.error('Screen share error:', error);
      queueRuntimeEvent('server_voice_screen_share_failed', {
        channel_id: this.state.channelId,
        error: formatRtcError(error),
      }, { userId: this.localProfileId, sampleRate: 1 });
      await this.stopScreenShare(false);
      this.setState({ connectionError: `Could not start screen sharing: ${formatRtcError(error)}` });
    }
  }

  async toggleNoiseSuppression() {
    if (!this.client) return;
    const next = !this.state.noiseSuppressionEnabled;
    const nextSettings = {
      ...loadCallSettings(),
      noiseSuppression: next,
    };
    saveCallSettings(nextSettings);
    this.setState({ noiseSuppressionEnabled: next });

    if (!this.localAudioTrack) return;
    await this.disposeAudioDenoiser();

    try {
      await this.client.unpublish(this.localAudioTrack);
    } catch {
      // noop
    }
    try {
      this.localAudioTrack.stop();
      this.localAudioTrack.close();
    } catch {
      // noop
    }

    let rebuilt: ILocalAudioTrack | null = null;
    let denoiserBinding: AIDenoiserBinding | null = null;
    try {
      rebuilt = await createConfiguredLocalAudioTrack(nextSettings);
      denoiserBinding = await createAIDenoiserBinding(rebuilt, nextSettings.noiseSuppression);
      if (this.state.isMuted) {
        await rebuilt.setEnabled(false);
      }
      this.localAudioTrack = rebuilt;
      this.audioDenoiserBinding = denoiserBinding;
      await this.client.publish(rebuilt);
      this.setState({ connectionError: '' });
    } catch (error) {
      if (denoiserBinding) {
        await this.disposeAudioDenoiser(denoiserBinding);
      }
      try {
        rebuilt?.stop();
        rebuilt?.close();
      } catch {
        // noop
      }
      this.localAudioTrack = null;
      this.setState({ connectionError: `Could not apply noise suppression: ${formatRtcError(error)}` });
    }
  }
}

export const serverVoiceSession = new ServerVoiceSessionStore();
publishServerVoiceShellState({
  phase: initialState.phase,
  communityId: initialState.communityId,
  channelId: initialState.channelId,
  channelName: initialState.channelName,
  isMuted: initialState.isMuted,
  isDeafened: initialState.isDeafened,
  isCameraOn: initialState.isCameraOn,
  isScreenSharing: initialState.isScreenSharing,
  noiseSuppressionEnabled: initialState.noiseSuppressionEnabled,
  participantCount: initialState.participantCount,
  averagePingMs: initialState.averagePingMs,
  lastPingMs: initialState.lastPingMs,
  outboundPacketLossPct: initialState.outboundPacketLossPct,
  privacyCode: initialState.privacyCode,
});

export function useServerVoiceSession(): ServerVoiceSessionState {
  return useSyncExternalStore(
    serverVoiceSession.subscribe,
    serverVoiceSession.getState,
    serverVoiceSession.getState,
  );
}

export function useServerVoiceSessionShell(): ServerVoiceSessionShellState {
  return useSyncExternalStore(
    serverVoiceSession.subscribe,
    serverVoiceSession.getShellState,
    serverVoiceSession.getShellState,
  );
}
