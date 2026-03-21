import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Mic, MicOff, Video, VideoOff, Monitor, MonitorOff,
  PhoneOff, Volume2, VolumeX, Settings, Users, Maximize2,
  MessageSquare
} from 'lucide-react';
import AgoraRTC, {
  IAgoraRTCClient, ILocalVideoTrack, ILocalAudioTrack,
  IRemoteVideoTrack, IRemoteAudioTrack, UID
} from 'agora-rtc-sdk-ng';
import { AppShell } from '../components/layout/AppShell';
import { Avatar } from '../components/ui/Avatar';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import type { Channel, VoiceSession } from '../lib/types';
import { describeAgoraJoinFailure, resolveAgoraJoinToken } from '../lib/agoraAuth';
import { loadCallSettings, saveCallSettings } from '../lib/callSettings';

const AGORA_APP_ID = import.meta.env.VITE_AGORA_APP_ID || '';

function formatRtcError(error: unknown): string {
  const e = error as any;
  return [e?.name || 'UnknownError', e?.code ? `code=${e.code}` : '', e?.message || String(error || '')]
    .filter(Boolean)
    .join(' | ');
}

interface Participant {
  uid: UID;
  videoTrack?: IRemoteVideoTrack;
  audioTrack?: IRemoteAudioTrack;
  profile?: {
    id: string;
    display_name: string | null;
    username: string;
    avatar_url: string | null;
  };
  isMuted?: boolean;
}

interface ScreenSourceOption {
  id: string;
  name: string;
  type: 'screen' | 'window';
}

export function VoiceChannelPage() {
  const { communityId, channelId } = useParams<{ communityId: string; channelId: string }>();
  const { profile, user } = useAuth();
  const navigate = useNavigate();
  const [channel, setChannel] = useState<Channel | null>(null);
  const [participants, setParticipants] = useState<Map<UID, Participant>>(new Map());
  const [activeSpeakerUids, setActiveSpeakerUids] = useState<string[]>([]);
  const [dbSessions, setDbSessions] = useState<VoiceSession[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);
  const [connectionError, setConnectionError] = useState('');
  const [localVideoTrack, setLocalVideoTrack] = useState<ILocalVideoTrack | null>(null);
  const [localAudioTrack, setLocalAudioTrack] = useState<ILocalAudioTrack | null>(null);
  const [screenTrack, setScreenTrack] = useState<ILocalVideoTrack | null>(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [noiseSuppressionEnabled, setNoiseSuppressionEnabled] = useState(() => loadCallSettings().noiseSuppression);
  const [screenSources, setScreenSources] = useState<ScreenSourceOption[]>([]);
  const [selectedScreenSourceId, setSelectedScreenSourceId] = useState('');
  const [loadingScreenSources, setLoadingScreenSources] = useState(false);
  const clientRef = useRef<IAgoraRTCClient | null>(null);
  const localVideoRef = useRef<HTMLDivElement>(null);
  const speakingKeyRef = useRef('');

  useEffect(() => {
    if (!channelId) return;
    supabase.from('channels').select('*').eq('id', channelId).maybeSingle()
      .then(({ data }) => { if (data) setChannel(data as Channel); });
    loadDbSessions();
  }, [channelId]);

  useEffect(() => {
    if (!window.desktopBridge?.listDesktopCaptureSources) return;
    void refreshScreenSources();
  }, []);

  async function loadDbSessions() {
    if (!channelId) return;
    const { data } = await supabase
      .from('voice_sessions')
      .select('*, profile:profiles(*)')
      .eq('channel_id', channelId);
    if (data) setDbSessions(data as VoiceSession[]);
  }

  useEffect(() => {
    if (!channelId || !profile?.id) return;
    joinChannel();

    return () => {
      void leaveChannel();
    };
  }, [channelId, profile?.id, user?.id]);

  async function joinChannel() {
    if (!channelId || !profile) return;
    setIsConnecting(true);
    setConnectionError('');

    try {
      await supabase.from('voice_sessions').upsert({
        channel_id: channelId,
        user_id: profile.id,
        is_muted: false,
        is_deafened: false,
        is_camera_on: false,
        is_screen_sharing: false,
      });

      if (!AGORA_APP_ID) {
        console.warn('Agora App ID not configured. Voice/video disabled in demo mode.');
        setIsConnected(true);
        setIsConnecting(false);
        return;
      }

      const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
      clientRef.current = client;
      try {
        client.enableAudioVolumeIndicator();
      } catch {
        // ignore unsupported volume indicator environments
      }

      client.on('volume-indicator', (volumes: Array<{ uid: UID; level: number }>) => {
        const active = (volumes || [])
          .filter((entry) => Number(entry?.level || 0) >= 5)
          .map((entry) => String(entry.uid));
        const deduped = Array.from(new Set(active));
        const nextKey = deduped.slice().sort().join(',');
        if (nextKey === speakingKeyRef.current) return;
        speakingKeyRef.current = nextKey;
        setActiveSpeakerUids(deduped);
      });

      client.on('user-published', async (user, mediaType) => {
        await client.subscribe(user, mediaType);
        setParticipants(prev => {
          const updated = new Map(prev);
          const existing = updated.get(user.uid) || { uid: user.uid };
          if (mediaType === 'video') existing.videoTrack = user.videoTrack;
          if (mediaType === 'audio') {
            existing.audioTrack = user.audioTrack;
            user.audioTrack?.play();
          }
          updated.set(user.uid, existing);
          return updated;
        });
      });

      client.on('user-unpublished', (user, mediaType) => {
        setParticipants(prev => {
          const updated = new Map(prev);
          const existing = updated.get(user.uid);
          if (existing) {
            if (mediaType === 'video') existing.videoTrack = undefined;
            if (mediaType === 'audio') existing.audioTrack = undefined;
            updated.set(user.uid, existing);
          }
          return updated;
        });
      });

      client.on('user-left', (user) => {
        setParticipants(prev => {
          const updated = new Map(prev);
          updated.delete(user.uid);
          return updated;
        });
        setActiveSpeakerUids((prev) => prev.filter((uid) => uid !== String(user.uid)));
      });

      const rtcUid = user?.id || profile.id;
      const token = await resolveAgoraJoinToken(channelId, rtcUid);
      await client.join(AGORA_APP_ID, channelId, token, rtcUid);

      const settings = loadCallSettings();
      const audioTrack = await AgoraRTC.createMicrophoneAudioTrack({
        microphoneId: settings.inputDeviceId && settings.inputDeviceId !== 'default' ? settings.inputDeviceId : undefined,
        AEC: settings.echoCancellation,
        ANS: settings.noiseSuppression,
        AGC: settings.automaticGainControl,
      } as any);
      setLocalAudioTrack(audioTrack);
      await client.publish(audioTrack);

      setIsConnected(true);
    } catch (err) {
      console.error('Failed to join voice channel:', err);
      setConnectionError(describeAgoraJoinFailure(err));
      setIsConnected(true);
    } finally {
      setIsConnecting(false);
    }
  }

  async function leaveChannel() {
    if (!channelId || !profile) return;

    localVideoTrack?.stop();
    localVideoTrack?.close();
    localAudioTrack?.stop();
    localAudioTrack?.close();
    screenTrack?.stop();
    screenTrack?.close();

    if (clientRef.current) {
      clientRef.current.removeAllListeners();
      await clientRef.current.leave();
      clientRef.current = null;
    }
    setActiveSpeakerUids([]);
    speakingKeyRef.current = '';

    await supabase.from('voice_sessions').delete()
      .eq('channel_id', channelId)
      .eq('user_id', profile.id);
  }

  async function refreshScreenSources() {
    if (!window.desktopBridge?.listDesktopCaptureSources) return;
    setLoadingScreenSources(true);
    try {
      const result = await window.desktopBridge.listDesktopCaptureSources();
      if (!result.ok) return;
      const sources = (result.sources || []) as ScreenSourceOption[];
      setScreenSources(sources);
      if (!selectedScreenSourceId && sources.length > 0) {
        setSelectedScreenSourceId(sources[0].id);
      } else if (selectedScreenSourceId && !sources.some((source) => source.id === selectedScreenSourceId)) {
        setSelectedScreenSourceId(sources[0]?.id || '');
      }
    } finally {
      setLoadingScreenSources(false);
    }
  }

  async function toggleMute() {
    if (!localAudioTrack || !channelId || !profile) return;
    const newMuted = !isMuted;
    localAudioTrack.setEnabled(!newMuted);
    setIsMuted(newMuted);
    await supabase.from('voice_sessions').update({ is_muted: newMuted })
      .eq('channel_id', channelId).eq('user_id', profile.id);
  }

  async function toggleCamera() {
    if (!clientRef.current || !channelId || !profile) return;
    if (isCameraOn && localVideoTrack) {
      await clientRef.current.unpublish(localVideoTrack);
      localVideoTrack.stop();
      localVideoTrack.close();
      setLocalVideoTrack(null);
      setIsCameraOn(false);
    } else {
      try {
        const videoTrack = await AgoraRTC.createCameraVideoTrack();
        setLocalVideoTrack(videoTrack);
        await clientRef.current.publish(videoTrack);
        setIsCameraOn(true);
        setTimeout(() => {
          if (localVideoRef.current) videoTrack.play(localVideoRef.current);
        }, 100);
      } catch (err) {
        console.error('Camera error:', err);
      }
    }
    await supabase.from('voice_sessions').update({ is_camera_on: !isCameraOn })
      .eq('channel_id', channelId).eq('user_id', profile.id);
  }

  async function toggleScreenShare() {
    if (!clientRef.current || !channelId || !profile) return;
    if (isScreenSharing && screenTrack) {
      await clientRef.current.unpublish(screenTrack);
      screenTrack.stop();
      screenTrack.close();
      setScreenTrack(null);
      setIsScreenSharing(false);
    } else {
      try {
        setConnectionError('');
        if (selectedScreenSourceId && window.desktopBridge?.setPreferredDesktopCaptureSource) {
          await window.desktopBridge.setPreferredDesktopCaptureSource(selectedScreenSourceId);
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
            displayStream = await navigator.mediaDevices.getDisplayMedia({
              video: true,
              audio: false,
            });
          }
          const mediaVideoTrack = displayStream.getVideoTracks()[0];
          if (!mediaVideoTrack) {
            displayStream.getTracks().forEach((t) => t.stop());
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
            setIsScreenSharing(false);
            setScreenTrack((prev) => {
              try {
                prev?.stop();
                prev?.close();
              } catch {
                // noop
              }
              return null;
            });
          });
        }

        setScreenTrack(track);
        await clientRef.current.publish(track);
        setIsScreenSharing(true);
      } catch (err: unknown) {
        console.error('Screen share error:', err);
        setConnectionError(`Could not start screen sharing: ${formatRtcError(err)}`);
      }
    }
  }

  async function toggleNoiseSuppression() {
    const client = clientRef.current;
    if (!client) return;

    const next = !noiseSuppressionEnabled;
    setNoiseSuppressionEnabled(next);
    const nextSettings = {
      ...loadCallSettings(),
      noiseSuppression: next,
    };
    saveCallSettings(nextSettings);

    if (!localAudioTrack) return;

    try {
      await client.unpublish(localAudioTrack);
    } catch {
      // noop
    }
    try {
      localAudioTrack.stop();
      localAudioTrack.close();
    } catch {
      // noop
    }

    try {
      const rebuilt = await AgoraRTC.createMicrophoneAudioTrack({
        microphoneId: nextSettings.inputDeviceId && nextSettings.inputDeviceId !== 'default'
          ? nextSettings.inputDeviceId
          : undefined,
        AEC: nextSettings.echoCancellation,
        ANS: nextSettings.noiseSuppression,
        AGC: nextSettings.automaticGainControl,
      } as any);
      if (isMuted) {
        await rebuilt.setEnabled(false);
      }
      setLocalAudioTrack(rebuilt);
      await client.publish(rebuilt);
      setConnectionError('');
    } catch (error) {
      setConnectionError(`Could not apply noise suppression: ${formatRtcError(error)}`);
    }
  }

  async function handleLeave() {
    await leaveChannel();
    navigate(`/app/community/${communityId}`);
  }

  const allParticipants = Array.from(participants.values());
  const mySession = dbSessions.find(s => s.user_id === profile?.id);
  const localSpeakerUid = String(user?.id || profile?.id || '');
  const isLocalSpeaking = localSpeakerUid ? activeSpeakerUids.includes(localSpeakerUid) : false;

  return (
    <AppShell
      activeCommunityId={communityId}
      activeChannelId={channelId}
      title={channel?.name || 'Voice Channel'}
    >
      <div className="flex flex-col h-full bg-surface-950">
        {isConnecting ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <div className="w-12 h-12 border-2 border-nyptid-300 border-t-transparent rounded-full animate-spin" />
            <p className="text-surface-400">Connecting to voice channel...</p>
          </div>
        ) : (
          <>
            <div className="flex-1 relative overflow-hidden">
              {connectionError && (
                <div className="mx-4 mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                  {connectionError}
                </div>
              )}
              {allParticipants.length === 0 && !isCameraOn ? (
                <div className="flex flex-col items-center justify-center h-full gap-4">
                  <div className="w-20 h-20 bg-surface-800 rounded-2xl flex items-center justify-center">
                    <Mic size={32} className="text-surface-400" />
                  </div>
                  <div className="text-center">
                    <h3 className="text-lg font-bold text-surface-200">You're in {channel?.name}</h3>
                    <p className="text-surface-500 text-sm mt-1">Waiting for others to join...</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {dbSessions.map(session => (
                      <div key={session.user_id} className="flex flex-col items-center gap-2">
                        <div className={`relative ${!session.is_muted ? 'animate-speaking' : ''} rounded-full`}>
                          <Avatar
                            src={(session as any).profile?.avatar_url}
                            name={(session as any).profile?.display_name || (session as any).profile?.username || 'User'}
                            size="lg"
                          />
                        </div>
                        <span className="text-xs text-surface-400">
                          {(session as any).profile?.display_name || (session as any).profile?.username}
                        </span>
                        {session.is_muted && <MicOff size={12} className="text-red-400" />}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="p-4 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
                  {isCameraOn && profile && (
                    <div className={`voice-participant-card ${isLocalSpeaking ? 'speaking' : ''}`}>
                      <div ref={localVideoRef} className="w-full h-full bg-surface-900" />
                      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 bg-black/50 rounded-full px-2 py-1">
                        <span className="text-xs text-white font-medium">{profile.display_name || profile.username} (You)</span>
                        {isMuted && <MicOff size={10} className="text-red-400" />}
                      </div>
                    </div>
                  )}
                  {allParticipants.map(participant => {
                    const session = dbSessions.find(s => s.user_id === String(participant.uid));
                    return (
                      <ParticipantCard
                        key={String(participant.uid)}
                        participant={participant}
                        session={session}
                        isSpeaking={activeSpeakerUids.includes(String(participant.uid))}
                      />
                    );
                  })}
                </div>
              )}

              {isScreenSharing && (
                <div className="absolute inset-0 flex items-center justify-center bg-black">
                  <div className="text-surface-400 text-sm">Screen sharing active</div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-center gap-4 py-4 border-t border-surface-800 bg-surface-900 flex-shrink-0">
              <div className="text-xs text-surface-500 absolute left-4">
                {isConnected ? (
                  <span className="flex items-center gap-1.5 text-green-400">
                    <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                    Connected
                  </span>
                ) : 'Connecting...'}
              </div>

              <button
                onClick={toggleMute}
                title={isMuted ? 'Unmute' : 'Mute'}
                className={`w-12 h-12 rounded-full flex items-center justify-center text-lg transition-all ${isMuted ? 'bg-red-600 text-white hover:bg-red-500' : 'bg-surface-700 text-surface-200 hover:bg-surface-600'}`}
              >
                {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
              </button>

              <button
                onClick={toggleCamera}
                title={isCameraOn ? 'Turn off camera' : 'Turn on camera'}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${isCameraOn ? 'bg-nyptid-300 text-surface-950 hover:bg-nyptid-200' : 'bg-surface-700 text-surface-200 hover:bg-surface-600'}`}
              >
                {isCameraOn ? <Video size={20} /> : <VideoOff size={20} />}
              </button>

              <button
                onClick={toggleScreenShare}
                title={isScreenSharing ? 'Stop sharing' : 'Share screen'}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${isScreenSharing ? 'bg-blue-500 text-white hover:bg-blue-400' : 'bg-surface-700 text-surface-200 hover:bg-surface-600'}`}
              >
                {isScreenSharing ? <MonitorOff size={20} /> : <Monitor size={20} />}
              </button>

              {screenSources.length > 0 && (
                <select
                  value={selectedScreenSourceId}
                  onChange={(event) => setSelectedScreenSourceId(event.target.value)}
                  className="nyptid-input w-auto max-w-[220px] text-xs py-2"
                  title="Choose app window or screen for sharing"
                >
                  {screenSources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.type === 'window' ? 'App' : 'Screen'}: {source.name}
                    </option>
                  ))}
                </select>
              )}

              {window.desktopBridge?.listDesktopCaptureSources && (
                <button
                  type="button"
                  onClick={() => void refreshScreenSources()}
                  className="h-10 px-3 rounded-full text-xs font-semibold bg-surface-700 text-surface-200 hover:bg-surface-600 transition-colors"
                  title="Refresh share sources"
                >
                  {loadingScreenSources ? 'Refreshing...' : 'Refresh Sources'}
                </button>
              )}

              <button
                onClick={() => setIsDeafened(v => !v)}
                title={isDeafened ? 'Undeafen' : 'Deafen'}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${isDeafened ? 'bg-red-600 text-white hover:bg-red-500' : 'bg-surface-700 text-surface-200 hover:bg-surface-600'}`}
              >
                {isDeafened ? <VolumeX size={20} /> : <Volume2 size={20} />}
              </button>

              <button
                onClick={toggleNoiseSuppression}
                title={noiseSuppressionEnabled ? 'Noise suppression on' : 'Noise suppression off'}
                className={`h-12 px-3 rounded-full text-xs font-semibold transition-all ${
                  noiseSuppressionEnabled
                    ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40'
                    : 'bg-surface-700 text-surface-200 hover:bg-surface-600'
                }`}
              >
                Noise {noiseSuppressionEnabled ? 'On' : 'Off'}
              </button>

              <button
                onClick={handleLeave}
                title="Leave voice channel"
                className="w-12 h-12 rounded-full bg-red-600 flex items-center justify-center text-white hover:bg-red-500 transition-colors"
              >
                <PhoneOff size={20} />
              </button>

              <div className="absolute right-4 flex items-center gap-2">
                <span className="text-xs text-surface-500">
                  {dbSessions.length} in channel
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function ParticipantCard({
  participant,
  session,
  isSpeaking,
}: {
  participant: Participant;
  session?: VoiceSession;
  isSpeaking: boolean;
}) {
  const videoRef = useRef<HTMLDivElement>(null);
  const profile = (session as any)?.profile;

  useEffect(() => {
    if (participant.videoTrack && videoRef.current) {
      participant.videoTrack.play(videoRef.current);
    }
    return () => { participant.videoTrack?.stop(); };
  }, [participant.videoTrack]);

  return (
    <div className={`voice-participant-card ${isSpeaking ? 'speaking' : ''}`}>
      {participant.videoTrack ? (
        <div ref={videoRef} className="w-full h-full bg-surface-900" />
      ) : (
        <div className="flex flex-col items-center gap-3">
          <div className={`rounded-full ${isSpeaking ? 'animate-speaking' : ''}`}>
            <Avatar
              src={profile?.avatar_url}
              name={profile?.display_name || profile?.username || 'User'}
              size="xl"
            />
          </div>
          {session?.is_muted && (
            <div className="flex items-center gap-1 text-xs text-red-400">
              <MicOff size={12} /> Muted
            </div>
          )}
        </div>
      )}
      <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between bg-black/60 rounded-full px-3 py-1">
        <span className="text-xs text-white font-medium truncate">
          {profile?.display_name || profile?.username || `User ${String(participant.uid).slice(0, 6)}`}
        </span>
        {session?.is_muted && <MicOff size={12} className="text-red-400 flex-shrink-0" />}
      </div>
    </div>
  );
}
