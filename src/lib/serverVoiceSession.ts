import { useSyncExternalStore } from 'react';
import type {
  IAgoraRTCClient,
  ILocalAudioTrack,
  ILocalVideoTrack,
  IRemoteAudioTrack,
  IRemoteVideoTrack,
  UID,
} from 'agora-rtc-sdk-ng';
import { describeAgoraJoinFailure, resolveAgoraJoinToken } from './agoraAuth';
import { createConfiguredLocalAudioTrack } from './callMedia';
import { loadCallSettings, saveCallSettings } from './callSettings';
import { supabase } from './supabase';
import type { Channel, VoiceSession } from './types';

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
  isMuted: false,
  isDeafened: false,
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
};

function formatRtcError(error: unknown): string {
  const e = error as any;
  return [e?.name || 'UnknownError', e?.code ? `code=${e.code}` : '', e?.message || String(error || '')]
    .filter(Boolean)
    .join(' | ');
}

class ServerVoiceSessionStore {
  private listeners = new Set<Listener>();
  private state: ServerVoiceSessionState = { ...initialState };

  private client: IAgoraRTCClient | null = null;
  private localUid: string | null = null;
  private localProfileId: string | null = null;
  private localVideoTrack: ILocalVideoTrack | null = null;
  private localAudioTrack: ILocalAudioTrack | null = null;
  private screenTrack: ILocalVideoTrack | null = null;
  private remoteVideoTracks = new Map<string, IRemoteVideoTrack>();
  private remoteAudioTracks = new Map<string, IRemoteAudioTrack>();
  private remoteVideoContainers = new Map<string, HTMLDivElement | null>();
  private localVideoContainer: HTMLDivElement | null = null;
  private dbSessionsChannel: any = null;
  private activeSpeakerKey = '';

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = () => this.state;

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
    this.setState({
      dbSessions: (data || []) as VoiceSession[],
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
      isConnected: false,
      isConnecting: true,
      connectionError: '',
      noiseSuppressionEnabled: loadCallSettings().noiseSuppression,
    });

    void this.hydrateChannelName(channelId, channelName);
    await this.loadDbSessions(channelId);
    this.watchDbSessions(channelId);

    let rtcJoined = false;

    try {
      await supabase.from('voice_sessions').upsert({
        channel_id: channelId,
        user_id: profileId,
        is_muted: false,
        is_deafened: false,
        is_camera_on: false,
        is_screen_sharing: false,
      });

      if (!AGORA_APP_ID) {
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
      try {
        client.enableAudioVolumeIndicator();
      } catch {
        // ignore unsupported volume indicator environments
      }

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
      await client.join(AGORA_APP_ID, channelId, token, this.localUid);
      rtcJoined = true;

      const audioTrack = await createConfiguredLocalAudioTrack(loadCallSettings());
      this.localAudioTrack = audioTrack;
      await client.publish(audioTrack);

      this.setState({
        phase: 'active',
        isConnected: true,
        isConnecting: false,
        connectionError: '',
      });
      return true;
    } catch (error) {
      console.error('Failed to join server voice channel:', error);
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
    const currentChannelId = this.state.channelId;
    const currentProfileId = this.localProfileId;

    try {
      this.localVideoTrack?.stop();
      this.localVideoTrack?.close();
    } catch {
      // noop
    }
    this.localVideoTrack = null;

    try {
      this.localAudioTrack?.stop();
      this.localAudioTrack?.close();
    } catch {
      // noop
    }
    this.localAudioTrack = null;

    try {
      this.screenTrack?.stop();
      this.screenTrack?.close();
    } catch {
      // noop
    }
    this.screenTrack = null;

    this.remoteVideoTracks.forEach((track) => {
      try {
        track.stop();
      } catch {
        // noop
      }
    });
    this.remoteVideoTracks.clear();
    this.remoteAudioTracks.clear();
    this.remoteVideoContainers.clear();
    this.activeSpeakerKey = '';

    if (this.client) {
      try {
        this.client.removeAllListeners();
      } catch {
        // noop
      }
      await this.client.leave();
      this.client = null;
    }

    if (currentChannelId && currentProfileId) {
      await supabase
        .from('voice_sessions')
        .delete()
        .eq('channel_id', currentChannelId)
        .eq('user_id', currentProfileId);
    }

    if (this.dbSessionsChannel) {
      supabase.removeChannel(this.dbSessionsChannel);
      this.dbSessionsChannel = null;
    }

    this.localUid = null;
    this.localProfileId = null;
    this.setState({
      ...initialState,
      noiseSuppressionEnabled: loadCallSettings().noiseSuppression,
      screenSources: this.state.screenSources,
      selectedScreenSourceId: this.state.selectedScreenSourceId,
    });
  }

  async toggleMute() {
    if (!this.localAudioTrack || !this.state.channelId || !this.localProfileId) return;
    const nextMuted = !this.state.isMuted;
    await this.localAudioTrack.setEnabled(!nextMuted);
    this.setState({ isMuted: nextMuted });
    await supabase
      .from('voice_sessions')
      .update({ is_muted: nextMuted })
      .eq('channel_id', this.state.channelId)
      .eq('user_id', this.localProfileId);
  }

  async toggleDeafen() {
    const next = !this.state.isDeafened;
    this.setState({ isDeafened: next });
    await this.applyRemoteAudioState();
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
    if (!this.client || !this.state.channelId || !this.localProfileId) return;
    if (this.state.isScreenSharing && this.screenTrack) {
      await this.client.unpublish(this.screenTrack);
      this.screenTrack.stop();
      this.screenTrack.close();
      this.screenTrack = null;
      this.setState({ isScreenSharing: false });
      this.attachActiveLocalVideoTrack();
      await supabase
        .from('voice_sessions')
        .update({ is_screen_sharing: false })
        .eq('channel_id', this.state.channelId)
        .eq('user_id', this.localProfileId);
      return;
    }

    try {
      const AgoraRTC = await getAgoraModule();
      this.setState({ connectionError: '' });
      if (this.state.selectedScreenSourceId && window.desktopBridge?.setPreferredDesktopCaptureSource) {
        await window.desktopBridge.setPreferredDesktopCaptureSource(this.state.selectedScreenSourceId);
      }

      let track: ILocalVideoTrack | null = null;
      try {
        track = await AgoraRTC.createScreenVideoTrack({}, 'disable') as ILocalVideoTrack;
      } catch (agoraError) {
        if (!navigator.mediaDevices?.getDisplayMedia) {
          throw agoraError;
        }
        let displayStream: MediaStream;
        try {
          displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
              width: { ideal: 1920 },
              height: { ideal: 1080 },
              frameRate: { ideal: 60, max: 120 },
            },
            audio: false,
          });
        } catch {
          displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        }
        const mediaVideoTrack = displayStream.getVideoTracks()[0];
        if (!mediaVideoTrack) {
          displayStream.getTracks().forEach((entry) => entry.stop());
          throw agoraError;
        }
        track = AgoraRTC.createCustomVideoTrack({ mediaStreamTrack: mediaVideoTrack });
      }

      if (!track) {
        throw new Error('No screen track available');
      }

      const trackAny = track as any;
      if (typeof trackAny.on === 'function') {
        trackAny.on('track-ended', () => {
          if (!this.state.isScreenSharing) return;
          void this.toggleScreenShare();
        });
      }

      this.screenTrack = track;
      await this.client.publish(track);
      this.setState({ isScreenSharing: true });
      this.attachActiveLocalVideoTrack();
      await supabase
        .from('voice_sessions')
        .update({ is_screen_sharing: true })
        .eq('channel_id', this.state.channelId)
        .eq('user_id', this.localProfileId);
    } catch (error) {
      console.error('Screen share error:', error);
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

    try {
      const rebuilt = await createConfiguredLocalAudioTrack(nextSettings);
      if (this.state.isMuted) {
        await rebuilt.setEnabled(false);
      }
      this.localAudioTrack = rebuilt;
      await this.client.publish(rebuilt);
      this.setState({ connectionError: '' });
    } catch (error) {
      this.setState({ connectionError: `Could not apply noise suppression: ${formatRtcError(error)}` });
    }
  }
}

export const serverVoiceSession = new ServerVoiceSessionStore();

export function useServerVoiceSession(): ServerVoiceSessionState {
  return useSyncExternalStore(
    serverVoiceSession.subscribe,
    serverVoiceSession.getState,
    serverVoiceSession.getState,
  );
}
