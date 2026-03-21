import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Maximize2, Mic, MicOff, Minimize2, MonitorUp, PhoneOff, Video, VideoOff, Volume2, VolumeX, Waves } from 'lucide-react';
import { AppShell } from '../components/layout/AppShell';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { directCallSession, ScreenShareQuality, useDirectCallSession } from '../lib/directCallSession';
import { loadCallSettings, saveCallSettings } from '../lib/callSettings';
import { clampScreenShareQuality, compareScreenShareQuality, useEntitlements } from '../lib/entitlements';
import type { Profile } from '../lib/types';

const AGORA_APP_ID = import.meta.env.VITE_AGORA_APP_ID || '';
const OUTGOING_RING_TIMEOUT_MS = 3 * 60 * 1000;
const BANDWIDTH_IDLE_DISCONNECT_MS = 2 * 60 * 1000;

interface CallParticipantProfile {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  status: Profile['status'];
}

interface ScreenSourceOption {
  id: string;
  name: string;
  type: 'screen' | 'window';
  thumbnailDataUrl?: string;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): boolean {
  return UUID_REGEX.test(String(value || '').trim());
}

function resolveCallStartedAtMs(callRow: any): number | null {
  if (!callRow || typeof callRow !== 'object') return null;
  const candidates = [
    (callRow as any)?.metadata?.started_at,
    (callRow as any)?.accepted_at,
    (callRow as any)?.created_at,
  ];
  for (const candidate of candidates) {
    const parsed = new Date(String(candidate || '')).getTime();
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function RemoteVideoMount({ uid }: { uid: string }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    directCallSession.attachRemoteVideoForUid(uid, ref.current);
    return () => {
      directCallSession.attachRemoteVideoForUid(uid, null);
    };
  }, [uid]);

  return <div ref={ref} className="w-full h-full" />;
}

export function DirectCallPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const [searchParams] = useSearchParams();
  const { profile, user } = useAuth();
  const navigate = useNavigate();
  const wantsVideo = searchParams.get('video') === '1';
  const allowFallbackJoin = searchParams.get('fallback') === '1';
  const isOutgoingFallback = searchParams.get('outgoing') === '1';
  const session = useDirectCallSession();
  const { entitlements } = useEntitlements();

  const [hasAccess, setHasAccess] = useState<boolean | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [callState, setCallState] = useState<string | null>(null);
  const [isCaller, setIsCaller] = useState(false);
  const [loadingAccess, setLoadingAccess] = useState(true);
  const [screenQuality, setScreenQuality] = useState<ScreenShareQuality>(() => loadCallSettings().screenShareQuality || '720p30');
  const [noiseSuppressionEnabled, setNoiseSuppressionEnabled] = useState<boolean>(() => loadCallSettings().noiseSuppression);
  const [participantProfilesByUid, setParticipantProfilesByUid] = useState<Record<string, CallParticipantProfile>>({});
  const [screenSources, setScreenSources] = useState<ScreenSourceOption[]>([]);
  const [screenSourceId, setScreenSourceId] = useState('');
  const [loadingScreenSources, setLoadingScreenSources] = useState(false);
  const [fullscreenUid, setFullscreenUid] = useState<string | null>(null);
  const [fullscreenFallbackUid, setFullscreenFallbackUid] = useState<string | null>(null);
  const [remoteVolumesByUid, setRemoteVolumesByUid] = useState<Record<string, number>>({});
  const [callStartedAtMs, setCallStartedAtMs] = useState<number | null>(null);
  const remoteTileRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const previousRemoteVolumeRef = useRef<Record<string, number>>({});
  const sessionWasLiveRef = useRef(false);

  const isThisConversationSession = session.conversationId === (conversationId || null);
  const isConnecting = loadingAccess || (isThisConversationSession && session.isConnecting);
  const isMuted = isThisConversationSession ? session.isMuted : false;
  const isVideoOn = isThisConversationSession ? session.isVideoOn : false;
  const isScreenSharing = isThisConversationSession ? session.isScreenSharing : false;
  const remoteParticipantUids = isThisConversationSession ? session.remoteParticipantUids : [];
  const remoteVideoUids = isThisConversationSession ? session.remoteVideoUids : [];
  const activeSpeakerUids = isThisConversationSession ? session.activeSpeakerUids : [];
  const mediaError = isThisConversationSession ? session.mediaError : '';
  const mediaErrorDetail = isThisConversationSession ? session.mediaErrorDetail : '';
  const maxScreenShareQuality = entitlements.maxScreenShareQuality as ScreenShareQuality;
  const canUse1080 = compareScreenShareQuality('1080p120', maxScreenShareQuality) <= 0;
  const canUse4k = compareScreenShareQuality('4k60', maxScreenShareQuality) <= 0;
  const localSpeakerUid = String(user?.id || profile?.id || '');
  const isLocalSpeaking = localSpeakerUid ? activeSpeakerUids.includes(localSpeakerUid) : false;
  const hasValidConversationId = isUuid(conversationId);

  useEffect(() => {
    sessionWasLiveRef.current = false;
    setCallStartedAtMs(null);
    setFullscreenFallbackUid(null);
  }, [conversationId]);

  useEffect(() => {
    if (conversationId && !hasValidConversationId) {
      navigate('/app/dm', { replace: true });
    }
  }, [conversationId, hasValidConversationId, navigate]);

  useEffect(() => {
    const clamped = clampScreenShareQuality(screenQuality, maxScreenShareQuality) as ScreenShareQuality;
    if (clamped !== screenQuality) {
      setScreenQuality(clamped);
      saveCallSettings({ ...loadCallSettings(), screenShareQuality: clamped });
    }
  }, [maxScreenShareQuality, screenQuality]);

  const loadScreenSources = useCallback(async () => {
    if (!window.desktopBridge?.listDesktopCaptureSources) return;
    setLoadingScreenSources(true);
    try {
      const result = await window.desktopBridge.listDesktopCaptureSources();
      if (!result.ok) return;
      const sources = (result.sources || []) as ScreenSourceOption[];
      setScreenSources(sources);
      if (!screenSourceId && sources.length > 0) {
        setScreenSourceId(sources[0].id);
      } else if (screenSourceId && !sources.some((source) => source.id === screenSourceId)) {
        setScreenSourceId(sources[0]?.id || '');
      }
    } finally {
      setLoadingScreenSources(false);
    }
  }, [screenSourceId]);

  useEffect(() => {
    if (!window.desktopBridge?.listDesktopCaptureSources) return;
    void loadScreenSources();
  }, [loadScreenSources]);

  useEffect(() => {
    setRemoteVolumesByUid((prev) => {
      const next: Record<string, number> = {};
      for (const uid of remoteParticipantUids) {
        const previous = prev[uid];
        next[uid] = typeof previous === 'number' ? previous : directCallSession.getRemoteUserVolume(uid);
      }
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (
        prevKeys.length === nextKeys.length
        && nextKeys.every((key) => prev[key] === next[key])
      ) {
        return prev;
      }
      return next;
    });
  }, [remoteParticipantUids]);

  useEffect(() => {
    const onFullscreenChange = () => {
      const fullElement = document.fullscreenElement;
      if (!fullElement) {
        setFullscreenUid(null);
        setFullscreenFallbackUid(null);
        return;
      }
      const matched = Object.entries(remoteTileRefs.current).find(([, node]) => node === fullElement);
      setFullscreenUid(matched ? matched[0] : null);
      setFullscreenFallbackUid(null);
    };

    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange' as any, onFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('webkitfullscreenchange' as any, onFullscreenChange);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setFullscreenFallbackUid(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!conversationId) return;
    if (session.phase === 'connecting' || session.phase === 'active') {
      sessionWasLiveRef.current = true;
      return;
    }
    if (sessionWasLiveRef.current && session.phase === 'idle') {
      navigate(`/app/dm/${conversationId}`);
    }
  }, [conversationId, navigate, session.phase]);

  useEffect(() => {
    if (!conversationId) return;
    if (callState !== 'ringing' || !isCaller) return;
    if (remoteParticipantUids.length > 0) return;

    const timeoutId = window.setTimeout(() => {
      navigate(`/app/dm/${conversationId}`, { replace: true });
      window.setTimeout(() => {
        void directCallSession.hangup({ signalEnded: true });
      }, 0);
    }, OUTGOING_RING_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [callState, conversationId, isCaller, navigate, remoteParticipantUids.length]);

  useEffect(() => {
    if (!conversationId) return;
    if (callState !== 'accepted') return;
    if (session.phase !== 'active') return;
    if (remoteParticipantUids.length > 0) return;

    const timeoutId = window.setTimeout(() => {
      navigate(`/app/dm/${conversationId}`, { replace: true });
      window.setTimeout(() => {
        void directCallSession.hangup({ signalEnded: true });
      }, 0);
    }, BANDWIDTH_IDLE_DISCONNECT_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [callState, conversationId, navigate, remoteParticipantUids.length, session.phase]);

  useEffect(() => {
    if (!conversationId || !hasValidConversationId) {
      setParticipantProfilesByUid({});
      return;
    }

    let cancelled = false;
    (async () => {
      const { data: members, error: membersError } = await supabase
        .from('direct_conversation_members')
        .select('user_id')
        .eq('conversation_id', conversationId);
      if (cancelled || membersError || !members || members.length === 0) return;

      const userIds = Array.from(new Set((members as any[]).map((row: any) => String(row.user_id)).filter(Boolean)));
      if (userIds.length === 0) return;

      const { data: profileRows, error: profilesError } = await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url, status')
        .in('id', userIds);
      if (cancelled || profilesError || !profileRows) return;

      const profileById = new Map<string, CallParticipantProfile>();
      for (const profileRow of profileRows as any[]) {
        profileById.set(String(profileRow.id), profileRow as CallParticipantProfile);
      }

      const next: Record<string, CallParticipantProfile> = {};
      for (const userId of userIds) {
        const profileData = profileById.get(String(userId));
        if (!profileData) continue;
        next[String(userId)] = profileData;
        next[String(profileData.id)] = profileData;
      }
      setParticipantProfilesByUid(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId, hasValidConversationId]);

  useEffect(() => {
    if (!conversationId || !profile || !hasValidConversationId) return;

    let cancelled = false;
    let callChannel: any = null;
    let pollingTimer: number | null = null;

    const initialize = async () => {
      setLoadingAccess(true);

      const { data: member } = await supabase
        .from('direct_conversation_members')
        .select('id')
        .eq('conversation_id', conversationId)
        .eq('user_id', profile.id)
        .maybeSingle();

      if (cancelled) return;
      const canAccess = Boolean(member);
      setHasAccess(canAccess);
      if (!canAccess) {
        setLoadingAccess(false);
        return;
      }

      const rtcUid = user?.id || profile.id;

      const { data: callRow, error: callError } = await supabase
        .from('calls')
        .select('*')
        .eq('conversation_id', conversationId)
        .in('state', ['ringing', 'accepted'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (callError) {
        console.warn('Call row lookup failed; using fallback join path.', callError);
      }
      if (cancelled) return;

      if (callRow && (callRow as any).id) {
        const c = callRow as any;
        const rowCallId = String(c.id);
        const callerFlag = String(c.caller_id) === String(profile.id);
        const rowStartedAtMs = resolveCallStartedAtMs(c);
        setCallStartedAtMs(rowStartedAtMs);

        setCallId(rowCallId);
        setCallState(c.state || null);
        setIsCaller(callerFlag);

        directCallSession.setCallMeta({
          conversationId,
          callId: rowCallId,
          isCaller: callerFlag,
          wantsVideo,
        });

        // Reliable handshake: caller joins immediately so media is ready when recipient accepts.
        if (callerFlag || c.state === 'accepted') {
          await directCallSession.join({
            conversationId,
            callId: rowCallId,
            userId: rtcUid,
            wantsVideo,
            startedAtMs: rowStartedAtMs,
            isCaller: callerFlag,
            appId: AGORA_APP_ID,
          });
        }

        callChannel = supabase
          .channel(`calls:${rowCallId}`)
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'calls', filter: `id=eq.${rowCallId}` },
            async (payload) => {
              if (cancelled) return;
              const updated = payload.new as any;
              const nextStartedAt = resolveCallStartedAtMs(updated);
              if (nextStartedAt) {
                setCallStartedAtMs(nextStartedAt);
              }
              setCallState(updated.state || null);

              if (updated.state === 'accepted') {
                const updatedCallerFlag = String(updated.caller_id) === String(profile.id);
                setIsCaller(updatedCallerFlag);
                await directCallSession.join({
                  conversationId,
                  callId: rowCallId,
                  userId: rtcUid,
                  wantsVideo,
                  startedAtMs: nextStartedAt,
                  isCaller: updatedCallerFlag,
                  appId: AGORA_APP_ID,
                });
              }

              if (updated.state === 'declined' || updated.state === 'ended') {
                void directCallSession.hangup({ signalEnded: false });
                navigate(`/app/dm/${conversationId}`);
              }
            },
          )
          .subscribe();

        // If caller misses realtime for any reason, poll call state briefly as fallback.
        if (callerFlag && c.state === 'ringing') {
          pollingTimer = window.setInterval(async () => {
            const { data } = await supabase
              .from('calls')
              .select('state, created_at, metadata')
              .eq('id', rowCallId)
              .maybeSingle();
            if (!data || cancelled) return;
            const nextState = (data as any).state;
            const nextStartedAt = resolveCallStartedAtMs(data);
            if (nextStartedAt) {
              setCallStartedAtMs(nextStartedAt);
            }
            setCallState(nextState || null);
            if (nextState === 'accepted') {
              window.clearInterval(pollingTimer!);
              pollingTimer = null;
              await directCallSession.join({
                conversationId,
                callId: rowCallId,
                userId: rtcUid,
                wantsVideo,
                startedAtMs: nextStartedAt,
                isCaller: true,
                appId: AGORA_APP_ID,
              });
            }
          }, 1500);
        }
      } else {
        // No active/ringing call row found. Only keep this page if a live
        // in-memory call session for the same conversation already exists.
        // Otherwise, route back to DMs instead of leaving the UI stuck in an
        // idle "waiting" layout that looks frozen.
        const liveState = directCallSession.getState();
        const hasLiveSessionForConversation =
          liveState.conversationId === conversationId &&
          (liveState.phase === 'active' || liveState.phase === 'connecting');

        if (!hasLiveSessionForConversation && !allowFallbackJoin) {
          setCallId(null);
          setCallState(null);
          setIsCaller(false);
          setLoadingAccess(false);
          navigate(`/app/dm/${conversationId}`, { replace: true });
          return;
        }

        if (!hasLiveSessionForConversation && allowFallbackJoin) {
          // Explicit fallback route when calls-row signaling is unavailable.
          setCallId(null);
          setCallState('ringing');
          setIsCaller(isOutgoingFallback);
          setCallStartedAtMs(Date.now());
          if (isOutgoingFallback) {
            await directCallSession.join({
              conversationId,
              callId: null,
              userId: rtcUid,
              wantsVideo,
              startedAtMs: Date.now(),
              isCaller: true,
              appId: AGORA_APP_ID,
            });
          }
        }
      }

      if (!cancelled) {
        setLoadingAccess(false);
      }
    };

    void initialize();

    return () => {
      cancelled = true;
      if (pollingTimer) {
        window.clearInterval(pollingTimer);
      }
      if (callChannel) {
        supabase.removeChannel(callChannel);
      }
      // Keep media session alive across route changes; only detach the visual mount points.
      directCallSession.attachLocalVideo(null);
      directCallSession.attachRemoteVideo(null);
    };
  }, [conversationId, profile?.id, user?.id, wantsVideo, allowFallbackJoin, navigate, hasValidConversationId, isOutgoingFallback]);

  const bindLocalVideo = useCallback((node: HTMLDivElement | null) => {
    directCallSession.attachLocalVideo(node);
  }, []);

  async function toggleMute() {
    await directCallSession.toggleMute();
  }

  async function toggleVideo() {
    await directCallSession.toggleVideo();
  }

  async function toggleScreenShare() {
    if (!isScreenSharing && screenSourceId && window.desktopBridge?.setPreferredDesktopCaptureSource) {
      await window.desktopBridge.setPreferredDesktopCaptureSource(screenSourceId);
    }
    await directCallSession.toggleScreenShare({
      quality: screenQuality,
      maxQuality: maxScreenShareQuality,
    });
  }

  async function toggleParticipantFullscreen(uid: string) {
    const target = remoteTileRefs.current[uid];
    if (!target) return;
    if (fullscreenFallbackUid === uid) {
      setFullscreenFallbackUid(null);
      return;
    }
    const activeFullscreenElement = document.fullscreenElement || (document as any).webkitFullscreenElement;
    if (activeFullscreenElement === target) {
      const exitFullscreen = document.exitFullscreen || ((document as any).webkitExitFullscreen?.bind(document));
      if (exitFullscreen) {
        await exitFullscreen.call(document).catch(() => undefined);
      }
      return;
    }
    const requestFullscreen = target.requestFullscreen || ((target as any).webkitRequestFullscreen?.bind(target));
    if (requestFullscreen) {
      const ok = await requestFullscreen.call(target).then(() => true).catch(() => false);
      if (ok) {
        setFullscreenFallbackUid(null);
        return;
      }
    }
    setFullscreenFallbackUid(uid);
  }

  function setRemoteTileRef(uid: string, node: HTMLDivElement | null) {
    if (!uid) return;
    remoteTileRefs.current[uid] = node;
  }

  function handleRemoteVolumeChange(uid: string, value: number) {
    const next = Math.max(0, Math.min(100, Math.round(value)));
    setRemoteVolumesByUid((prev) => ({ ...prev, [uid]: next }));
    if (next > 0) {
      previousRemoteVolumeRef.current[uid] = next;
    }
    directCallSession.setRemoteUserVolume(uid, next);
  }

  function toggleRemoteMute(uid: string) {
    const currentVolume = remoteVolumesByUid[uid] ?? 100;
    if (currentVolume <= 0) {
      const restored = Math.max(1, Math.min(100, previousRemoteVolumeRef.current[uid] ?? 100));
      handleRemoteVolumeChange(uid, restored);
      return;
    }
    previousRemoteVolumeRef.current[uid] = currentVolume;
    handleRemoteVolumeChange(uid, 0);
  }

  async function toggleNoiseSuppression() {
    const next = !noiseSuppressionEnabled;
    setNoiseSuppressionEnabled(next);
    const nextSettings = {
      ...loadCallSettings(),
      noiseSuppression: next,
    };
    saveCallSettings(nextSettings);
    await directCallSession.setNoiseSuppression(next);
  }

  async function handleHangup() {
    const canEndForEveryone = Boolean(
      profile?.platform_role === 'owner'
      || callState === 'ringing'
      || remoteParticipantUids.length === 0,
    );
    if (conversationId) {
      navigate(`/app/dm/${conversationId}`, { replace: true });
    } else {
      navigate('/app/dm', { replace: true });
    }
    // Route transition first, teardown immediately after so UI never appears frozen.
    window.setTimeout(() => {
      void directCallSession.hangup({ signalEnded: canEndForEveryone });
    }, 0);
  }

  async function acceptCall() {
    if (!conversationId || !profile) return;
    if (callId) {
      try {
        await supabase.from('calls').update({ state: 'accepted' } as any).eq('id', callId);
      } catch (error) {
        console.error('Failed to accept call state', error);
      }
    }
    setCallState('accepted');
    await directCallSession.join({
      conversationId,
      callId,
      userId: user?.id || profile.id,
      wantsVideo,
      startedAtMs: callStartedAtMs || Date.now(),
      isCaller: false,
      appId: AGORA_APP_ID,
    });
  }

  async function declineCall() {
    if (callId) {
      try {
        await supabase.from('calls').update({ state: 'declined' } as any).eq('id', callId);
      } catch (error) {
        console.error('Failed to decline call', error);
      }
    }
    if (conversationId) {
      navigate(`/app/dm/${conversationId}`, { replace: true });
    } else {
      navigate('/app/dm', { replace: true });
    }
    window.setTimeout(() => {
      void directCallSession.hangup({ signalEnded: false });
    }, 0);
  }

  const remoteTiles = useMemo(() => {
    if (remoteParticipantUids.length > 0) return remoteParticipantUids;
    return [];
  }, [remoteParticipantUids]);

  const getParticipantName = useCallback((uid: string) => {
    const normalizedUid = String(uid || '').trim();
    const baseUid = normalizedUid.split('::')[0];
    const p = participantProfilesByUid[normalizedUid] || participantProfilesByUid[baseUid];
    const isScreenStream = normalizedUid.includes('::screen');
    if (p) {
      const label = p.display_name || p.username;
      return isScreenStream ? `${label} (Screen)` : label;
    }
    if (isScreenStream) {
      return `Participant ${baseUid.slice(0, 6)} (Screen)`;
    }
    return `Participant ${normalizedUid.slice(0, 6)}`;
  }, [participantProfilesByUid]);

  if (!profile) return null;

  return (
    <AppShell showChannelSidebar={false} title="Direct Call">
      <div className="h-full flex flex-col bg-surface-950 relative">
        {fullscreenFallbackUid && (
          <div
            className="fixed inset-0 z-[75] bg-black/80"
            onClick={() => setFullscreenFallbackUid(null)}
          />
        )}
        {callState === 'ringing' && (
          <div className="absolute left-1/2 -translate-x-1/2 top-6 z-40">
            {isCaller ? (
              <div className="px-4 py-2 rounded-lg bg-surface-800 text-surface-200">
                Calling - waiting for answer...
              </div>
            ) : (
              <div className="flex items-center gap-3 px-4 py-2 rounded-lg bg-surface-800 text-surface-200">
                <div className="font-medium">Incoming {wantsVideo ? 'video' : 'voice'} call</div>
                <button onClick={acceptCall} className="nyptid-btn-primary">Accept</button>
                <button onClick={declineCall} className="nyptid-btn-secondary">Decline</button>
              </div>
            )}
          </div>
        )}

        <div className="flex-1 flex items-center justify-center p-6">
          {isConnecting ? (
            <div className="text-center">
              <div className="w-12 h-12 border-2 border-nyptid-300 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-surface-400">Connecting to call...</p>
            </div>
          ) : hasAccess === false ? (
            <div className="text-center">
              <p className="text-red-400 font-semibold">You are not part of this conversation.</p>
              <button onClick={() => navigate('/app/dm')} className="nyptid-btn-secondary mt-4">
                Back to DMs
              </button>
            </div>
          ) : AGORA_APP_ID ? (
            <div className="w-full max-w-6xl">
              {mediaError && (
                <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                  {mediaError}
                  {mediaErrorDetail && (
                    <div className="mt-1 text-xs text-red-200/80 break-all">{mediaErrorDetail}</div>
                  )}
                </div>
              )}
              <div className={`grid gap-3 ${remoteTiles.length > 1 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2'}`}>
                <div className={`rounded-2xl border bg-surface-900 overflow-hidden h-[42vh] flex items-center justify-center ${isLocalSpeaking ? 'border-nyptid-300/70 shadow-glow' : 'border-surface-700'}`}>
                  {(isVideoOn || isScreenSharing) ? (
                    <div ref={bindLocalVideo} className="w-full h-full" />
                  ) : (
                    <div className="text-center">
                      <div className="w-20 h-20 rounded-full bg-surface-800 mx-auto mb-3 flex items-center justify-center text-surface-300 text-xl font-bold">
                        {(profile.display_name || profile.username || 'U').slice(0, 1).toUpperCase()}
                      </div>
                      <p className="text-surface-400">You</p>
                    </div>
                  )}
                </div>

                {remoteTiles.length === 0 ? (
                  <div className="rounded-2xl border border-surface-700 bg-surface-900 overflow-hidden h-[42vh] flex items-center justify-center">
                    <div className="text-center px-4">
                      <p className="text-surface-300 font-medium">Waiting for participants...</p>
                      <p className="text-surface-500 text-sm mt-1">They can join audio/camera from the same DM call route.</p>
                    </div>
                  </div>
                ) : remoteTiles.map((uid) => {
                  const hasVideo = remoteVideoUids.includes(uid);
                  const participantName = getParticipantName(uid);
                  const isSpeaking = activeSpeakerUids.includes(uid);
                  const remoteVolume = remoteVolumesByUid[uid] ?? 100;
                  const isRemoteMuted = remoteVolume <= 0;
                  return (
                    <div
                      key={uid}
                      ref={(node) => setRemoteTileRef(uid, node)}
                      className={`relative rounded-2xl border bg-surface-900 overflow-hidden h-[42vh] flex items-center justify-center ${isSpeaking ? 'border-nyptid-300/70 shadow-glow' : 'border-surface-700'} ${fullscreenFallbackUid === uid ? 'fixed inset-4 z-[80] !h-[calc(100vh-2rem)] !w-[calc(100vw-2rem)]' : ''}`}
                    >
                      <div className="absolute top-2 right-2 z-20 flex items-center gap-2 rounded-full bg-black/55 px-2 py-1">
                        <button
                          type="button"
                          onClick={() => void toggleParticipantFullscreen(uid)}
                          className="text-white/90 hover:text-white transition-colors"
                          title={fullscreenUid === uid ? 'Exit fullscreen' : 'Fullscreen'}
                        >
                          {fullscreenUid === uid ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                        </button>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => toggleRemoteMute(uid)}
                            className="text-white/90 hover:text-white transition-colors"
                            title={isRemoteMuted ? 'Unmute participant audio' : 'Mute participant audio'}
                          >
                            {isRemoteMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
                          </button>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={1}
                            value={remoteVolume}
                            onChange={(event) => handleRemoteVolumeChange(uid, Number(event.target.value))}
                            className="w-20 accent-nyptid-300"
                            title={`Volume ${remoteVolume}%`}
                          />
                        </div>
                      </div>

                      {hasVideo ? (
                        <div className="w-full h-full">
                          <RemoteVideoMount uid={uid} />
                          <div className="absolute bottom-2 left-2 rounded-full bg-black/50 px-2 py-1 text-xs text-white">
                            {participantName}
                          </div>
                        </div>
                      ) : (
                        <div className="text-center">
                          <div className="w-16 h-16 rounded-full bg-surface-800 mx-auto mb-2 flex items-center justify-center text-surface-300 text-lg font-bold">
                            {participantName.slice(0, 1).toUpperCase()}
                          </div>
                          <p className="text-surface-400 text-sm">{participantName}</p>
                          <p className="text-surface-600 text-xs mt-1">Audio connected</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="text-center">
              <p className="text-yellow-400 font-semibold">Agora is not configured.</p>
              <p className="text-surface-500 text-sm mt-1">Set `VITE_AGORA_APP_ID` to enable calling.</p>
            </div>
          )}
        </div>

        <div className="border-t border-surface-800 bg-surface-900 py-4">
          <div className="flex items-center justify-center gap-3 flex-wrap px-3">
            <button
              onClick={toggleMute}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${isMuted ? 'bg-red-600 text-white' : 'bg-surface-700 text-surface-200 hover:bg-surface-600'}`}
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
            </button>

            <button
              onClick={toggleVideo}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${isVideoOn ? 'bg-nyptid-300 text-surface-950' : 'bg-surface-700 text-surface-200 hover:bg-surface-600'}`}
              title={isVideoOn ? 'Turn off camera' : 'Turn on camera'}
            >
              {isVideoOn ? <Video size={18} /> : <VideoOff size={18} />}
            </button>

            <button
              onClick={toggleScreenShare}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${isScreenSharing ? 'bg-green-500 text-white' : 'bg-surface-700 text-surface-200 hover:bg-surface-600'}`}
              title={isScreenSharing ? 'Stop screen share' : 'Start screen share'}
            >
              <MonitorUp size={18} />
            </button>

            <select
              value={screenQuality}
              onChange={(e) => {
                const next = e.target.value as ScreenShareQuality;
                const clamped = clampScreenShareQuality(next, maxScreenShareQuality) as ScreenShareQuality;
                setScreenQuality(clamped);
                saveCallSettings({ ...loadCallSettings(), screenShareQuality: clamped });
              }}
              className="nyptid-input w-auto text-xs py-2"
            >
              <option value="720p30">Screen: 720p 30fps</option>
              <option value="1080p120" disabled={!canUse1080}>
                {canUse1080 ? 'Screen: 1080p 120fps' : 'Screen: 1080p 120fps (unlock at Level 35)'}
              </option>
              <option value="4k60" disabled={!canUse4k}>
                {canUse4k ? 'Screen: 4K 60fps' : 'Screen: 4K 60fps (Boost)'}
              </option>
            </select>

            {screenSources.length > 0 && (
              <select
                value={screenSourceId}
                onChange={(e) => setScreenSourceId(e.target.value)}
                className="nyptid-input w-auto max-w-[240px] text-xs py-2"
                title="Choose screen or app window for screen share"
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
                onClick={() => void loadScreenSources()}
                className="h-10 px-3 rounded-lg text-xs font-semibold bg-surface-700 text-surface-200 hover:bg-surface-600 transition-colors"
                title="Refresh screen share sources"
              >
                {loadingScreenSources ? 'Refreshing...' : 'Refresh Sources'}
              </button>
            )}

            <button
              onClick={toggleNoiseSuppression}
              className={`h-10 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                noiseSuppressionEnabled
                  ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40'
                  : 'bg-surface-700 text-surface-200 hover:bg-surface-600'
              }`}
              title={noiseSuppressionEnabled ? 'Noise suppression on' : 'Noise suppression off'}
            >
              <Waves size={14} />
              {noiseSuppressionEnabled ? 'Noise Suppression On' : 'Noise Suppression Off'}
            </button>

            <button
              onClick={handleHangup}
              className="w-12 h-12 rounded-full bg-red-600 text-white flex items-center justify-center hover:bg-red-500 transition-colors"
              title={profile?.platform_role === 'owner' ? 'End call for everyone' : 'Leave call'}
            >
              <PhoneOff size={18} />
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
