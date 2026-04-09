import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Maximize2, Mic, MicOff, Minimize2, MonitorUp, PhoneOff, Video, VideoOff, Volume2, VolumeX, Waves } from 'lucide-react';
import { createPortal } from 'react-dom';
import { AppShell } from '../components/layout/AppShell';
import { useAuth } from '../contexts/AuthContext';
import { trackGrowthEvent } from '../lib/growthEvents';
import { supabase } from '../lib/supabase';
import { directCallSession, ScreenShareQuality, useDirectCallSession } from '../lib/directCallSession';
import { loadCallSettings, saveCallSettings } from '../lib/callSettings';
import { clampScreenShareQuality, compareScreenShareQuality, useEntitlements } from '../lib/entitlements';
import {
  buildLegacyCallStateUpdate,
  isCallsModernSchemaMissingError,
  normalizeCallRow,
  normalizeCallStateFromRow,
  type CallState,
} from '../lib/callsCompat';
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

interface RemoteVolumeContextMenuState {
  uid: string;
  x: number;
  y: number;
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

async function loadLatestCallRowForConversation(targetConversationId: string) {
  const modernResponse = await supabase
    .from('calls')
    .select('*')
    .eq('conversation_id', targetConversationId)
    .in('state', ['ringing', 'accepted'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!modernResponse.error) {
    return {
      row: modernResponse.data ? normalizeCallRow(modernResponse.data) : null,
      error: null,
    };
  }

  if (!isCallsModernSchemaMissingError(modernResponse.error)) {
    return {
      row: null,
      error: modernResponse.error,
    };
  }

  const legacyResponse = await supabase
    .from('calls')
    .select('*')
    .eq('room', targetConversationId)
    .in('status', ['ringing', 'accepted'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    row: legacyResponse.data ? normalizeCallRow(legacyResponse.data) : null,
    error: legacyResponse.error,
  };
}

async function updateCallStateWithFallback(callId: string, nextState: CallState) {
  const modernResponse = await supabase
    .from('calls')
    .update({ state: nextState } as any)
    .eq('id', callId);
  if (!modernResponse.error) return null;
  if (!isCallsModernSchemaMissingError(modernResponse.error)) return modernResponse.error;

  const legacyResponse = await supabase
    .from('calls')
    .update(buildLegacyCallStateUpdate(nextState) as any)
    .eq('id', callId);
  return legacyResponse.error || null;
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
  const [noiseSuppressionPreference, setNoiseSuppressionPreference] = useState<boolean>(() => loadCallSettings().noiseSuppression);
  const [participantProfilesByUid, setParticipantProfilesByUid] = useState<Record<string, CallParticipantProfile>>({});
  const [screenSources, setScreenSources] = useState<ScreenSourceOption[]>([]);
  const [screenSourceId, setScreenSourceId] = useState('');
  const [loadingScreenSources, setLoadingScreenSources] = useState(false);
  const [screenShareTransitioning, setScreenShareTransitioning] = useState(false);
  const [fullscreenFallbackUid, setFullscreenFallbackUid] = useState<string | null>(null);
  const [remoteVolumesByUid, setRemoteVolumesByUid] = useState<Record<string, number>>({});
  const [remoteVolumeContextMenu, setRemoteVolumeContextMenu] = useState<RemoteVolumeContextMenuState | null>(null);
  const [callStartedAtMs, setCallStartedAtMs] = useState<number | null>(null);
  const remoteTileRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const fullscreenOverlayRef = useRef<HTMLDivElement | null>(null);
  const previousRemoteVolumeRef = useRef<Record<string, number>>({});
  const sessionWasLiveRef = useRef(false);
  const callConnectedTrackedRef = useRef(false);
  const callDroppedTrackedRef = useRef(false);

  const isThisConversationSession = session.conversationId === (conversationId || null);
  const hasLiveSession = isThisConversationSession && (session.phase === 'active' || session.phase === 'connecting');
  const isConnecting = (!hasLiveSession && loadingAccess) || (isThisConversationSession && session.isConnecting);
  const isMuted = isThisConversationSession ? session.isMuted : false;
  const isDeafened = isThisConversationSession ? session.isDeafened : false;
  const isVideoOn = isThisConversationSession ? session.isVideoOn : false;
  const isScreenSharing = isThisConversationSession ? session.isScreenSharing : false;
  const noiseSuppressionEnabled = isThisConversationSession
    ? session.noiseSuppressionEnabled
    : noiseSuppressionPreference;
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
  const [isMobileViewport, setIsMobileViewport] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 767px)').matches;
  });
  const connectionTelemetryLabel = useMemo(() => {
    if (!isThisConversationSession) return '';
    const segments: string[] = [];
    if (session.averagePingMs != null) {
      segments.push(`${session.averagePingMs} ms`);
    }
    if (session.outboundPacketLossPct != null) {
      segments.push(`${session.outboundPacketLossPct}% loss`);
    }
    return segments.join(' • ');
  }, [isThisConversationSession, session.averagePingMs, session.outboundPacketLossPct]);

  useEffect(() => {
    sessionWasLiveRef.current = false;
    callConnectedTrackedRef.current = false;
    callDroppedTrackedRef.current = false;
    setCallStartedAtMs(null);
    setFullscreenFallbackUid(null);
  }, [conversationId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(max-width: 767px)');
    const onChange = () => setIsMobileViewport(media.matches);
    onChange();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    }
    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, []);

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

  useEffect(() => {
    setNoiseSuppressionPreference(session.noiseSuppressionEnabled);
  }, [session.noiseSuppressionEnabled]);

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
    if (!remoteVolumeContextMenu) return;
    if (!remoteParticipantUids.includes(remoteVolumeContextMenu.uid)) {
      setRemoteVolumeContextMenu(null);
    }
  }, [remoteParticipantUids, remoteVolumeContextMenu]);

  useEffect(() => {
    if (!remoteVolumeContextMenu) return undefined;
    const close = () => setRemoteVolumeContextMenu(null);
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setRemoteVolumeContextMenu(null);
    };
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    window.addEventListener('keydown', onEscape);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
      window.removeEventListener('keydown', onEscape);
      window.removeEventListener('resize', close);
    };
  }, [remoteVolumeContextMenu]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => {});
        return;
      }
      setFullscreenFallbackUid(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!fullscreenFallbackUid || typeof document === 'undefined') return undefined;
    const overlayNode = fullscreenOverlayRef.current;
    if (!overlayNode || typeof overlayNode.requestFullscreen !== 'function') return undefined;

    let cancelled = false;
    window.setTimeout(() => {
      if (cancelled) return;
      if (document.fullscreenElement === overlayNode) return;
      void overlayNode.requestFullscreen().catch(() => {});
    }, 0);

    return () => {
      cancelled = true;
      if (document.fullscreenElement === overlayNode) {
        void document.exitFullscreen().catch(() => {});
      }
    };
  }, [fullscreenFallbackUid]);

  useEffect(() => {
    if (!conversationId) return;
    if (callState === 'accepted' && session.phase === 'active' && !callConnectedTrackedRef.current) {
      callConnectedTrackedRef.current = true;
      void trackGrowthEvent('call_connected', {
        conversation_id: conversationId,
        remote_participant_count: remoteParticipantUids.length,
      }, { userId: profile?.id || null });
    }
    if (session.phase === 'connecting' || session.phase === 'active') {
      sessionWasLiveRef.current = true;
      return;
    }
    // Keep caller on the call route while ringing, even if media/session
    // briefly drops to idle during signaling retries.
    if (callState === 'ringing') {
      return;
    }
    if (sessionWasLiveRef.current && session.phase === 'idle') {
      if (!callDroppedTrackedRef.current) {
        callDroppedTrackedRef.current = true;
        void trackGrowthEvent('call_dropped', {
          conversation_id: conversationId,
          previous_state: callState || 'unknown',
        }, { userId: profile?.id || null });
      }
      navigate(`/app/dm/${conversationId}`);
    }
  }, [callState, conversationId, navigate, profile?.id, remoteParticipantUids.length, session.phase]);

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

      const { row: callRow, error: callError } = await loadLatestCallRowForConversation(conversationId);

      if (callError) {
        console.warn('Call row lookup failed; using fallback join path.', callError);
      }
      if (cancelled) return;

      if (callRow && (callRow as any).id) {
        const c = callRow as any;
        const sourceRow = c.raw || c;
        const rowCallId = String(c.id);
        const callerFlag = String(c.caller_id) === String(profile.id);
        const rowStartedAtMs = resolveCallStartedAtMs(sourceRow);
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
              const nextState = normalizeCallStateFromRow(updated);
              setCallState(nextState || null);

              if (nextState === 'accepted') {
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

              if (nextState === 'declined' || nextState === 'ended') {
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
              .select('*')
              .eq('id', rowCallId)
              .maybeSingle();
            if (!data || cancelled) return;
            const normalizedPollRow = normalizeCallRow(data);
            const nextState = normalizedPollRow?.state || normalizeCallStateFromRow(data);
            const nextStartedAt = resolveCallStartedAtMs((normalizedPollRow?.raw || data));
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

        const canUseFallbackJoinFlow = allowFallbackJoin || isOutgoingFallback;

        if (!hasLiveSessionForConversation && !canUseFallbackJoinFlow) {
          setCallId(null);
          setCallState(null);
          setIsCaller(false);
          setLoadingAccess(false);
          navigate(`/app/dm/${conversationId}`, { replace: true });
          return;
        }

        if (!hasLiveSessionForConversation && canUseFallbackJoinFlow) {
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

  const closeFullscreenFallback = useCallback(async () => {
    setFullscreenFallbackUid(null);
    if (typeof document !== 'undefined' && document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        // noop
      }
    }
  }, []);

  async function toggleMute() {
    await directCallSession.toggleMute();
  }

  async function toggleDeafen() {
    await directCallSession.toggleDeafen();
  }

  async function toggleVideo() {
    await directCallSession.toggleVideo();
  }

  async function toggleScreenShare() {
    if (screenShareTransitioning) return;
    setScreenShareTransitioning(true);
    try {
      if (!isScreenSharing && screenSourceId && window.desktopBridge?.setPreferredDesktopCaptureSource) {
        await window.desktopBridge.setPreferredDesktopCaptureSource(screenSourceId);
      }
      await directCallSession.toggleScreenShare({
        quality: screenQuality,
        maxQuality: maxScreenShareQuality,
      });
    } catch (error) {
      console.error('Direct-call screen share toggle failed', error);
    } finally {
      setScreenShareTransitioning(false);
    }
  }

  async function toggleParticipantFullscreen(uid: string) {
    if (fullscreenFallbackUid === uid) {
      await closeFullscreenFallback();
      return;
    }
    setFullscreenFallbackUid(uid);
  }

  function setRemoteTileRef(uid: string, node: HTMLDivElement | null) {
    if (!uid) return;
    remoteTileRefs.current[uid] = node;
  }

  function openRemoteVolumeContextMenu(event: ReactMouseEvent<HTMLDivElement>, uid: string) {
    event.preventDefault();
    event.stopPropagation();
    setRemoteVolumeContextMenu({
      uid,
      x: event.clientX,
      y: event.clientY,
    });
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
    setNoiseSuppressionPreference(next);
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
        const updateError = await updateCallStateWithFallback(callId, 'accepted');
        if (updateError) {
          throw updateError;
        }
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
        const updateError = await updateCallStateWithFallback(callId, 'declined');
        if (updateError) {
          throw updateError;
        }
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

  const prioritizedRemoteUid = useMemo(() => {
    if (remoteTiles.length === 0) return null;
    const screenShareUid = remoteTiles.find((uid) => uid.includes('::screen'));
    if (screenShareUid) return screenShareUid;
    const activeRemoteSpeakerUid = activeSpeakerUids.find((uid) => remoteTiles.includes(uid));
    if (activeRemoteSpeakerUid) return activeRemoteSpeakerUid;
    return remoteTiles[0];
  }, [activeSpeakerUids, remoteTiles]);

  const hasGroupLayout = remoteTiles.length >= 3;
  const galleryRemoteUids = hasGroupLayout && prioritizedRemoteUid
    ? remoteTiles.filter((uid) => uid !== prioritizedRemoteUid)
    : remoteTiles;
  const standardTileHeightClass = 'h-[32vh] sm:h-[34vh] lg:h-[42vh]';
  const compactTileHeightClass = 'h-[22vh] sm:h-[24vh] lg:h-[28vh]';
  const spotlightHeightClass = isMobileViewport ? 'h-[36vh]' : 'h-[46vh]';
  const localDisplayLabel = profile?.display_name || profile?.username || 'You';
  const localDisplayInitial = localDisplayLabel.slice(0, 1).toUpperCase();

  const renderLocalTile = (compact = false) => (
    <div className={`rounded-2xl border bg-surface-900 overflow-hidden ${compact ? compactTileHeightClass : standardTileHeightClass} flex items-center justify-center ${isLocalSpeaking ? 'border-nyptid-300/70 shadow-glow' : 'border-surface-700'}`}>
      {(isVideoOn || isScreenSharing) ? (
        <div ref={bindLocalVideo} className="w-full h-full" />
      ) : (
        <div className="text-center">
          <div className="w-20 h-20 rounded-full bg-surface-800 mx-auto mb-3 flex items-center justify-center text-surface-300 text-xl font-bold">
            {localDisplayInitial}
          </div>
          <p className="text-surface-400">{localDisplayLabel === 'You' ? 'You' : localDisplayLabel}</p>
        </div>
      )}
    </div>
  );

  const renderRemoteTile = (uid: string, compact = false, heightClassOverride?: string) => {
    const hasVideo = remoteVideoUids.includes(uid);
    const participantName = getParticipantName(uid);
    const isSpeaking = activeSpeakerUids.includes(uid);
    const isScreenShareStream = uid.includes('::screen');
    const remoteVolume = remoteVolumesByUid[uid] ?? 100;
    const isRemoteMuted = remoteVolume <= 0;
    const isPoppedOut = fullscreenFallbackUid === uid;
    const heightClass = heightClassOverride || (compact ? compactTileHeightClass : standardTileHeightClass);

    return (
      <div
        key={uid}
        ref={(node) => setRemoteTileRef(uid, node)}
        onContextMenuCapture={(event) => openRemoteVolumeContextMenu(event, uid)}
        title="Right-click for volume controls"
        className={`relative rounded-2xl border bg-surface-900 overflow-hidden ${heightClass} flex items-center justify-center ${isSpeaking ? 'border-nyptid-300/70 shadow-glow' : 'border-surface-700'}`}
      >
        <div className="absolute top-2 right-2 z-[30] pointer-events-auto flex items-center gap-2 rounded-full bg-black/55 px-2 py-1">
          <button
            type="button"
            onClick={() => void toggleParticipantFullscreen(uid)}
            className="text-white/90 hover:text-white transition-colors"
            title={isPoppedOut ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isPoppedOut ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            type="button"
            onClick={() => toggleRemoteMute(uid)}
            className={`text-white/90 hover:text-white transition-colors ${isScreenShareStream ? 'px-1.5 py-0.5 rounded-md bg-black/35' : ''}`}
            title={isScreenShareStream
              ? (isRemoteMuted ? 'Unmute screen share audio' : 'Mute screen share audio')
              : (isRemoteMuted ? 'Unmute participant audio' : 'Mute participant audio')}
          >
            {isRemoteMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
          </button>
        </div>

        {hasVideo && !isPoppedOut ? (
          <div className="w-full h-full pointer-events-none">
            <RemoteVideoMount uid={uid} />
            <div className="absolute bottom-2 left-2 rounded-full bg-black/50 px-2 py-1 text-xs text-white">
              {participantName}
            </div>
          </div>
        ) : hasVideo && isPoppedOut ? (
          <div className="text-center">
            <p className="text-surface-300 text-sm font-medium">Popped out to fullscreen view</p>
            <p className="text-surface-500 text-xs mt-1">Press the fullscreen button again to return.</p>
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
  };

  if (!profile) return null;

  return (
    <AppShell showChannelSidebar={false} title="Direct Call">
      <div className="h-full flex flex-col bg-surface-950 relative">
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

        <div className="flex-1 flex items-center justify-center p-3 sm:p-6">
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
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => window.location.reload()}
                      className="nyptid-btn-secondary px-2.5 py-1 text-xs"
                    >
                      Retry Join
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate('/app/settings?section=voice-video')}
                      className="nyptid-btn-secondary px-2.5 py-1 text-xs"
                    >
                      Re-select Devices
                    </button>
                  </div>
                </div>
              )}
              {remoteTiles.length === 0 ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {renderLocalTile(false)}
                  <div className={`rounded-2xl border border-surface-700 bg-surface-900 overflow-hidden ${standardTileHeightClass} flex items-center justify-center`}>
                    <div className="text-center px-4">
                      <p className="text-surface-300 font-medium">Waiting for participants...</p>
                      <p className="text-surface-500 text-sm mt-1">They can join audio/camera from the same DM call route.</p>
                    </div>
                  </div>
                </div>
              ) : hasGroupLayout && prioritizedRemoteUid ? (
                <div className="space-y-3">
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
                    {renderRemoteTile(prioritizedRemoteUid, false, spotlightHeightClass)}
                    {renderLocalTile(true)}
                  </div>
                  {galleryRemoteUids.length > 0 && (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {galleryRemoteUids.map((uid) => renderRemoteTile(uid, true))}
                    </div>
                  )}
                </div>
              ) : (
                <div className={`grid gap-3 ${remoteTiles.length > 1 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2'}`}>
                  {renderLocalTile(false)}
                  {remoteTiles.map((uid) => renderRemoteTile(uid, false))}
                </div>
              )}
            </div>
          ) : (
            <div className="text-center">
              <p className="text-yellow-400 font-semibold">Agora is not configured.</p>
              <p className="text-surface-500 text-sm mt-1">Set `VITE_AGORA_APP_ID` to enable calling.</p>
            </div>
          )}
        </div>

        {fullscreenFallbackUid && typeof document !== 'undefined' && createPortal((() => {
          const uid = fullscreenFallbackUid;
          const hasVideo = remoteVideoUids.includes(uid);
          const participantName = getParticipantName(uid);
          const remoteVolume = remoteVolumesByUid[uid] ?? 100;
          const isRemoteMuted = remoteVolume <= 0;
          return (
            <div
              ref={fullscreenOverlayRef}
              className="fixed inset-0 z-[130] bg-black/90 p-4 sm:p-6"
              onClick={() => void closeFullscreenFallback()}
            >
              <div
                className="relative h-full w-full rounded-2xl border border-surface-700 bg-surface-950 overflow-hidden"
                onClick={(event) => event.stopPropagation()}
                onContextMenuCapture={(event) => openRemoteVolumeContextMenu(event as any, uid)}
              >
                <div className="absolute top-3 right-3 z-[40] pointer-events-auto flex items-center gap-2 rounded-full bg-black/60 px-2 py-1">
                  <button
                    type="button"
                    onClick={() => void closeFullscreenFallback()}
                    className="text-white/90 hover:text-white transition-colors"
                    title="Exit fullscreen"
                  >
                    <Minimize2 size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleRemoteMute(uid)}
                    className="text-white/90 hover:text-white transition-colors"
                    title={isRemoteMuted ? 'Unmute audio' : 'Mute audio'}
                  >
                    {isRemoteMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
                  </button>
                </div>
                {hasVideo ? (
                  <div className="absolute inset-0 z-0 pointer-events-none">
                    <RemoteVideoMount uid={uid} />
                  </div>
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <div className="text-center">
                      <div className="w-24 h-24 rounded-full bg-surface-800 mx-auto mb-3 flex items-center justify-center text-surface-300 text-2xl font-bold">
                        {participantName.slice(0, 1).toUpperCase()}
                      </div>
                      <p className="text-surface-300">{participantName}</p>
                      <p className="text-surface-500 text-sm mt-1">Audio connected</p>
                    </div>
                  </div>
                )}
                <div className="absolute bottom-3 left-3 rounded-full bg-black/60 px-3 py-1 text-sm text-white">
                  {participantName}
                  {connectionTelemetryLabel ? ` • ${connectionTelemetryLabel}` : ''}
                </div>
              </div>
            </div>
          );
        })(), document.body)}

        {remoteVolumeContextMenu && typeof document !== 'undefined' && createPortal((() => {
          const menuWidth = 260;
          const menuHeight = 420;
          const viewportWidth = window.innerWidth;
          const viewportHeight = window.innerHeight;
          const left = Math.max(8, Math.min(remoteVolumeContextMenu.x, viewportWidth - menuWidth - 8));
          const top = Math.max(8, Math.min(remoteVolumeContextMenu.y, viewportHeight - menuHeight - 8));
          const uid = remoteVolumeContextMenu.uid;
          const remoteVolume = remoteVolumesByUid[uid] ?? 100;
          const isRemoteMuted = remoteVolume <= 0;
          return (
            <div className="fixed inset-0 z-[140]">
              <div
                className="absolute w-[260px] rounded-xl border border-surface-600 bg-surface-800 px-3 py-2 shadow-2xl"
                style={{ left, top }}
                onClick={(event) => event.stopPropagation()}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
              >
                <button className="w-full text-left px-2 py-2 rounded-md text-surface-200 hover:bg-surface-700/80 text-sm">Profile</button>
                <button className="w-full text-left px-2 py-2 rounded-md text-surface-200 hover:bg-surface-700/80 text-sm">Mention</button>
                <button className="w-full text-left px-2 py-2 rounded-md text-surface-200 hover:bg-surface-700/80 text-sm">Message</button>
                <button className="w-full text-left px-2 py-2 rounded-md text-surface-200 hover:bg-surface-700/80 text-sm">Start a Call</button>
                <div className="my-2 border-t border-surface-600" />
                <div className="px-2">
                  <div className="text-xs text-surface-400 mb-2">User Volume</div>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={remoteVolume}
                      onChange={(event) => handleRemoteVolumeChange(uid, Number(event.target.value))}
                      className="flex-1 accent-nyptid-300"
                      title={`Volume ${remoteVolume}%`}
                    />
                    <span className="w-8 text-right text-xs text-surface-300">{remoteVolume}</span>
                  </div>
                </div>
                <div className="my-2 border-t border-surface-600" />
                <button
                  type="button"
                  onClick={() => toggleRemoteMute(uid)}
                  className="w-full flex items-center justify-between px-2 py-2 rounded-md text-surface-200 hover:bg-surface-700/80 text-sm"
                >
                  <span>Mute</span>
                  <span className={`h-4 w-4 rounded border ${isRemoteMuted ? 'border-nyptid-300 bg-nyptid-300/20' : 'border-surface-500 bg-transparent'}`} />
                </button>
                <button className="w-full text-left px-2 py-2 rounded-md text-surface-200 hover:bg-surface-700/80 text-sm">Pop Out User</button>
              </div>
            </div>
          );
        })(), document.body)}

        <div className="border-t border-surface-800 bg-surface-900 py-4">
          <div className="relative flex items-center justify-center gap-3 flex-wrap px-3">
            <div className="absolute left-3 text-xs text-surface-500">
              {isThisConversationSession && session.phase === 'active' ? (
                <span className="flex items-center gap-1.5 text-green-400">
                  <span className="inline-flex h-2 w-2 rounded-full bg-green-400 animate-pulse" />
                  {connectionTelemetryLabel ? `Live • ${connectionTelemetryLabel}` : 'Live'}
                </span>
              ) : (
                <span>{isConnecting ? 'Connecting...' : 'Standby'}</span>
              )}
            </div>
            <button
              onClick={toggleMute}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${isMuted ? 'bg-red-600 text-white' : 'bg-surface-700 text-surface-200 hover:bg-surface-600'}`}
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
            </button>

            <button
              onClick={toggleDeafen}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${isDeafened ? 'bg-red-600 text-white' : 'bg-surface-700 text-surface-200 hover:bg-surface-600'}`}
              title={isDeafened ? 'Undeafen' : 'Deafen'}
            >
              {isDeafened ? <VolumeX size={18} /> : <Volume2 size={18} />}
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
              disabled={screenShareTransitioning}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${screenShareTransitioning ? 'cursor-wait bg-surface-800 text-surface-500' : isScreenSharing ? 'bg-green-500 text-white' : 'bg-surface-700 text-surface-200 hover:bg-surface-600'}`}
              title={screenShareTransitioning ? 'Updating screen share...' : (isScreenSharing ? 'Stop screen share' : 'Start screen share')}
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
              disabled={screenShareTransitioning}
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
                disabled={screenShareTransitioning}
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
                disabled={loadingScreenSources || screenShareTransitioning}
                className={`h-10 px-3 rounded-lg text-xs font-semibold transition-colors ${loadingScreenSources || screenShareTransitioning ? 'bg-surface-800 text-surface-500 cursor-wait' : 'bg-surface-700 text-surface-200 hover:bg-surface-600'}`}
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
