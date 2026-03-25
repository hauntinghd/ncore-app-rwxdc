import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  PhoneOff,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { AppShell } from '../components/layout/AppShell';
import { Avatar } from '../components/ui/Avatar';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { serverVoiceSession, useServerVoiceSession } from '../lib/serverVoiceSession';
import type { Channel, VoiceSession } from '../lib/types';

function LocalVideoMount() {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    serverVoiceSession.attachLocalVideo(ref.current);
    return () => {
      serverVoiceSession.attachLocalVideo(null);
    };
  }, []);

  return <div ref={ref} className="w-full h-full bg-surface-900" />;
}

function RemoteVideoMount({ uid }: { uid: string }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    serverVoiceSession.attachRemoteVideoForUid(uid, ref.current);
    return () => {
      serverVoiceSession.attachRemoteVideoForUid(uid, null);
    };
  }, [uid]);

  return <div ref={ref} className="w-full h-full bg-surface-900" />;
}

function RemoteParticipantCard({
  uid,
  session,
  hasVideo,
  isSpeaking,
}: {
  uid: string;
  session?: VoiceSession;
  hasVideo: boolean;
  isSpeaking: boolean;
}) {
  const profile = (session as any)?.profile;
  const name = profile?.display_name || profile?.username || `User ${uid.slice(0, 6)}`;

  return (
    <div className={`voice-participant-card ${isSpeaking ? 'speaking' : ''}`}>
      {hasVideo ? (
        <RemoteVideoMount uid={uid} />
      ) : (
        <div className="flex flex-col items-center gap-3">
          <div className={`rounded-full ${isSpeaking ? 'animate-speaking' : ''}`}>
            <Avatar
              src={profile?.avatar_url}
              name={name}
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
        <span className="text-xs text-white font-medium truncate">{name}</span>
        {session?.is_muted && <MicOff size={12} className="text-red-400 flex-shrink-0" />}
      </div>
    </div>
  );
}

export function VoiceChannelPage() {
  const { communityId, channelId } = useParams<{ communityId: string; channelId: string }>();
  const { profile, user } = useAuth();
  const navigate = useNavigate();
  const session = useServerVoiceSession();
  const [channel, setChannel] = useState<Channel | null>(null);

  useEffect(() => {
    if (!channelId) return;
    supabase
      .from('channels')
      .select('*')
      .eq('id', channelId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setChannel(data as Channel);
      });
  }, [channelId]);

  useEffect(() => {
    if (!window.desktopBridge?.listDesktopCaptureSources) return;
    void serverVoiceSession.refreshScreenSources();
  }, []);

  useEffect(() => {
    if (!communityId || !channelId || !profile?.id) return;
    void serverVoiceSession.join({
      communityId,
      channelId,
      channelName: channel?.name || session.channelName || '',
      profileId: profile.id,
      userId: user?.id || profile.id,
    });
  }, [communityId, channelId, channel?.name, profile?.id, session.channelName, user?.id]);

  const dbSessionByUserId = useMemo(() => {
    const map = new Map<string, VoiceSession>();
    for (const entry of session.dbSessions) {
      const userId = String(entry.user_id || '').trim();
      if (userId) map.set(userId, entry);
    }
    return map;
  }, [session.dbSessions]);

  const localSpeakerUid = String(user?.id || profile?.id || '');
  const isLocalSpeaking = localSpeakerUid ? session.activeSpeakerUids.includes(localSpeakerUid) : false;
  const localName = profile?.display_name || profile?.username || 'You';
  const remoteParticipantUids = session.remoteParticipantUids.filter((uid) => uid !== localSpeakerUid);

  async function handleLeave() {
    await serverVoiceSession.leave();
    navigate(`/app/community/${communityId}`);
  }

  return (
    <AppShell
      activeCommunityId={communityId}
      activeChannelId={channelId}
      title={channel?.name || session.channelName || 'Voice Channel'}
      subtitle={channel?.description}
    >
      <div className="flex flex-col h-full bg-surface-950">
        {session.isConnecting ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <div className="w-12 h-12 border-2 border-nyptid-300 border-t-transparent rounded-full animate-spin" />
            <p className="text-surface-400">Connecting to voice channel...</p>
          </div>
        ) : (
          <>
            <div className="flex-1 relative overflow-hidden">
              {session.connectionError && (
                <div className="mx-4 mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                  {session.connectionError}
                </div>
              )}

              {remoteParticipantUids.length === 0 && !session.isCameraOn ? (
                <div className="flex flex-col items-center justify-center h-full gap-4">
                  <div className="w-20 h-20 bg-surface-800 rounded-2xl flex items-center justify-center">
                    <Mic size={32} className="text-surface-400" />
                  </div>
                  <div className="text-center">
                    <h3 className="text-lg font-bold text-surface-200">You're in {channel?.name || session.channelName || 'voice'}</h3>
                    <p className="text-surface-500 text-sm mt-1">Stay connected while you browse the rest of the server.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {session.dbSessions.map((entry) => (
                      <div key={entry.user_id} className="flex flex-col items-center gap-2">
                        <div className={`relative ${!entry.is_muted ? 'animate-speaking' : ''} rounded-full`}>
                          <Avatar
                            src={(entry as any).profile?.avatar_url}
                            name={(entry as any).profile?.display_name || (entry as any).profile?.username || 'User'}
                            size="lg"
                          />
                        </div>
                        <span className="text-xs text-surface-400">
                          {(entry as any).profile?.display_name || (entry as any).profile?.username}
                        </span>
                        {entry.is_muted && <MicOff size={12} className="text-red-400" />}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="p-4 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
                  {session.isCameraOn && profile && (
                    <div className={`voice-participant-card ${isLocalSpeaking ? 'speaking' : ''}`}>
                      <LocalVideoMount />
                      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 bg-black/50 rounded-full px-2 py-1">
                        <span className="text-xs text-white font-medium">{localName} (You)</span>
                        {session.isMuted && <MicOff size={10} className="text-red-400" />}
                      </div>
                    </div>
                  )}

                  {remoteParticipantUids.map((uid) => (
                    <RemoteParticipantCard
                      key={uid}
                      uid={uid}
                      session={dbSessionByUserId.get(uid)}
                      hasVideo={session.remoteVideoUids.includes(uid)}
                      isSpeaking={session.activeSpeakerUids.includes(uid)}
                    />
                  ))}
                </div>
              )}

              {session.isScreenSharing && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
                  <div className="rounded-full bg-black/60 px-3 py-1 text-xs text-surface-200">
                    Screen sharing active
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-center gap-4 py-4 border-t border-surface-800 bg-surface-900 flex-shrink-0">
              <div className="text-xs text-surface-500 absolute left-4">
                {session.isConnected ? (
                  <span className="flex items-center gap-1.5 text-green-400">
                    <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                    Connected
                  </span>
                ) : 'Connecting...'}
              </div>

              <button
                onClick={() => void serverVoiceSession.toggleMute()}
                title={session.isMuted ? 'Unmute' : 'Mute'}
                className={`w-12 h-12 rounded-full flex items-center justify-center text-lg transition-all ${session.isMuted ? 'bg-red-600 text-white hover:bg-red-500' : 'bg-surface-700 text-surface-200 hover:bg-surface-600'}`}
              >
                {session.isMuted ? <MicOff size={20} /> : <Mic size={20} />}
              </button>

              <button
                onClick={() => void serverVoiceSession.toggleCamera()}
                title={session.isCameraOn ? 'Turn off camera' : 'Turn on camera'}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${session.isCameraOn ? 'bg-nyptid-300 text-surface-950 hover:bg-nyptid-200' : 'bg-surface-700 text-surface-200 hover:bg-surface-600'}`}
              >
                {session.isCameraOn ? <Video size={20} /> : <VideoOff size={20} />}
              </button>

              <button
                onClick={() => void serverVoiceSession.toggleScreenShare()}
                title={session.isScreenSharing ? 'Stop sharing' : 'Share screen'}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${session.isScreenSharing ? 'bg-blue-500 text-white hover:bg-blue-400' : 'bg-surface-700 text-surface-200 hover:bg-surface-600'}`}
              >
                {session.isScreenSharing ? <MonitorOff size={20} /> : <Monitor size={20} />}
              </button>

              {session.screenSources.length > 0 && (
                <select
                  value={session.selectedScreenSourceId}
                  onChange={(event) => serverVoiceSession.setSelectedScreenSourceId(event.target.value)}
                  className="nyptid-input w-auto max-w-[220px] text-xs py-2"
                  title="Choose app window or screen for sharing"
                >
                  {session.screenSources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.type === 'window' ? 'App' : 'Screen'}: {source.name}
                    </option>
                  ))}
                </select>
              )}

              {window.desktopBridge?.listDesktopCaptureSources && (
                <button
                  type="button"
                  onClick={() => void serverVoiceSession.refreshScreenSources()}
                  className="h-10 px-3 rounded-full text-xs font-semibold bg-surface-700 text-surface-200 hover:bg-surface-600 transition-colors"
                  title="Refresh share sources"
                >
                  {session.loadingScreenSources ? 'Refreshing...' : 'Refresh Sources'}
                </button>
              )}

              <button
                onClick={() => void serverVoiceSession.toggleDeafen()}
                title={session.isDeafened ? 'Undeafen' : 'Deafen'}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${session.isDeafened ? 'bg-red-600 text-white hover:bg-red-500' : 'bg-surface-700 text-surface-200 hover:bg-surface-600'}`}
              >
                {session.isDeafened ? <VolumeX size={20} /> : <Volume2 size={20} />}
              </button>

              <button
                onClick={() => void serverVoiceSession.toggleNoiseSuppression()}
                title={session.noiseSuppressionEnabled ? 'Noise suppression on' : 'Noise suppression off'}
                className={`h-12 px-3 rounded-full text-xs font-semibold transition-all ${
                  session.noiseSuppressionEnabled
                    ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40'
                    : 'bg-surface-700 text-surface-200 hover:bg-surface-600'
                }`}
              >
                Noise {session.noiseSuppressionEnabled ? 'On' : 'Off'}
              </button>

              <button
                onClick={() => void handleLeave()}
                title="Leave voice channel"
                className="w-12 h-12 rounded-full bg-red-600 flex items-center justify-center text-white hover:bg-red-500 transition-colors"
              >
                <PhoneOff size={20} />
              </button>

              <div className="absolute right-4 flex items-center gap-2">
                <span className="text-xs text-surface-500">
                  {session.dbSessions.length} in channel
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
