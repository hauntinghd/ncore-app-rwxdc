import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Bell, Crown, LogOut, PanelLeftClose, PanelLeftOpen, PhoneCall, PhoneOff,
  Download, Mic, MicOff, RefreshCw, Search, Settings, User, Volume2, VolumeX, X, Zap,
} from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import { Badge } from '../ui/Badge';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { hangupDirectCall, toggleDirectCallDeafen, toggleDirectCallMute, useDirectCallShellState } from '../../lib/directCallShell';
import type { Notification } from '../../lib/types';
import { formatRelativeTime } from '../../lib/utils';
import { playNotificationSound, primeNotificationAudio, startIncomingCallRing, stopIncomingCallRing, type NotificationSoundKind } from '../../lib/notificationSound';
import { getStreamerModeSettings, sanitizeNotificationBody, sanitizeNotificationTitle } from '../../lib/streamerMode';
import {
  DEFAULT_UPDATE_FEED_URL,
  compareSemver,
  dedupeAndSortReleaseLog,
  fetchLatestReleaseVersion,
  fetchReleaseNotesFromFeed,
  type ReleaseLogEntry,
  resolveUpdateFeedBase,
} from '../../lib/releaseFeed';

interface TopBarProps {
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  showSidebarToggle?: boolean;
  onToggleSidebar?: () => void;
  sidebarOpen?: boolean;
}

const RELEASE_SEEN_VERSION_KEY = 'ncore.release.seenVersion';
const RELEASE_CACHE_KEY = 'ncore.release.cache.v1';
const RELEASE_CACHE_TTL_MS = 120000;
const EMPTY_UPDATE_RUNTIME_STATE = {
  portable: false,
  ready: false,
  checking: false,
  downloading: false,
  progress: 0,
  installing: false,
  version: '',
  latestVersion: '',
  message: '',
};

function sortNotificationsByCreatedAt(list: Notification[]): Notification[] {
  return [...list].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
}

function mergeNotificationLists(current: Notification[], incoming: Notification[]): Notification[] {
  const merged = new Map<string, Notification>();

  for (const notification of [...current, ...incoming]) {
    const id = String(notification?.id || '').trim();
    if (!id) continue;
    const existing = merged.get(id);
    merged.set(id, existing ? {
      ...existing,
      ...notification,
      is_read: Boolean(existing.is_read || notification.is_read),
    } : notification);
  }

  return sortNotificationsByCreatedAt(Array.from(merged.values()));
}

function readSeenReleaseVersion(): string {
  if (typeof window === 'undefined') return '';
  return String(window.localStorage.getItem(RELEASE_SEEN_VERSION_KEY) || '').trim();
}

function readReleaseCache(): { releases: ReleaseLogEntry[]; latestVersion: string; cachedAt: number } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(RELEASE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      releases?: ReleaseLogEntry[];
      latestVersion?: string;
      cachedAt?: number;
    };
    if (!Array.isArray(parsed.releases)) return null;
    if (!Number.isFinite(parsed.cachedAt)) return null;
    return {
      releases: parsed.releases,
      latestVersion: String(parsed.latestVersion || ''),
      cachedAt: Number(parsed.cachedAt),
    };
  } catch {
    return null;
  }
}

function writeReleaseCache(releases: ReleaseLogEntry[], latestVersion: string) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(
      RELEASE_CACHE_KEY,
      JSON.stringify({
        releases,
        latestVersion,
        cachedAt: Date.now(),
      }),
    );
  } catch {
    // best-effort cache
  }
}

function getNotificationSoundKind(notification: Notification): NotificationSoundKind {
  const type = String(notification.type || '').trim().toLowerCase();
  const data = (notification.data || {}) as any;
  if (type === 'incoming_call') return 'call';
  if (type === 'mention' || Boolean(data.mention)) return 'ping';
  return 'message';
}

function canUseRendererNotificationAudio(): boolean {
  if (typeof document === 'undefined') return false;
  return !document.hidden && document.hasFocus();
}

export function TopBar({ title, subtitle, actions, showSidebarToggle, onToggleSidebar, sidebarOpen }: TopBarProps) {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const callSession = useDirectCallShellState();
  const useMainProcessDesktopNotifications = typeof window !== 'undefined' && Boolean(window.desktopBridge?.realtimeStart);
  const [searchQuery, setSearchQuery] = useState('');
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [lastClearedAt, setLastClearedAt] = useState<string | null>(() => {
    try { return localStorage.getItem('ncore.notifications.lastClearedAt'); } catch { return null; }
  });
  const [incomingCall, setIncomingCall] = useState<Notification | null>(null);
  const [notificationError, setNotificationError] = useState('');
  const [callNowMs, setCallNowMs] = useState(Date.now());
  const [releaseUpdates, setReleaseUpdates] = useState<ReleaseLogEntry[]>([]);
  const [latestReleaseVersion, setLatestReleaseVersion] = useState('');
  const [seenReleaseVersion, setSeenReleaseVersion] = useState(() => readSeenReleaseVersion());
  const [streamerMode, setStreamerMode] = useState(() => getStreamerModeSettings());
  const [updateRuntimeState, setUpdateRuntimeState] = useState(EMPTY_UPDATE_RUNTIME_STATE);
  const [installingFromTopbar, setInstallingFromTopbar] = useState(false);
  const seenNotificationIdsRef = useRef<Set<string>>(new Set());
  const notifRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const notificationUnreadCount = notifications.filter((notification) => !notification.is_read).length;
  const updateUnreadCount = releaseUpdates.filter((release) => {
    if (!release.version) return false;
    if (!seenReleaseVersion) return true;
    return compareSemver(release.version, seenReleaseVersion) > 0;
  }).length;
  const unreadCount = notificationUnreadCount + updateUnreadCount;
  const hasActiveCall = callSession.phase === 'active' || callSession.phase === 'connecting';
  const isElectronClient = typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent);
  const topBarStyle: CSSProperties | undefined = isElectronClient
    ? ({ paddingRight: 156, WebkitAppRegion: 'drag' } as CSSProperties)
    : undefined;
  const noDragStyle: CSSProperties | undefined = isElectronClient
    ? ({ WebkitAppRegion: 'no-drag' } as CSSProperties)
    : undefined;
  const streamerBannerTop = isElectronClient ? 36 : 8;
  const activeCallConversationId = callSession.conversationId;
  const isOnActiveCallRoute = activeCallConversationId
    ? location.pathname === `/app/dm/${activeCallConversationId}/call`
    : false;
  const updateInstallInProgress = installingFromTopbar || updateRuntimeState.installing;
  const updateDownloadInProgress = updateRuntimeState.checking || updateRuntimeState.downloading;
  const showTopbarUpdateButton = !updateRuntimeState.portable && (updateRuntimeState.ready || updateInstallInProgress || updateDownloadInProgress);

  function markReleaseUpdatesRead(version = latestReleaseVersion) {
    const normalized = String(version || '').trim();
    if (!normalized || typeof window === 'undefined') return;
    window.localStorage.setItem(RELEASE_SEEN_VERSION_KEY, normalized);
    setSeenReleaseVersion(normalized);
  }

  function openWhatsNew(version?: string) {
    if (version) {
      markReleaseUpdatesRead(version);
    } else {
      markReleaseUpdatesRead();
    }
    setShowNotifications(false);
    navigate('/app/settings?section=whats-new');
  }

  useEffect(() => {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') {
      Notification.requestPermission().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    const prime = () => {
      primeNotificationAudio();
    };
    window.addEventListener('pointerdown', prime, { passive: true });
    window.addEventListener('keydown', prime, { passive: true } as AddEventListenerOptions);
    return () => {
      window.removeEventListener('pointerdown', prime);
      window.removeEventListener('keydown', prime);
    };
  }, []);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== RELEASE_SEEN_VERSION_KEY) return;
      setSeenReleaseVersion(readSeenReleaseVersion());
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    const syncStreamerMode = () => {
      setStreamerMode(getStreamerModeSettings());
    };
    syncStreamerMode();
    window.addEventListener('storage', syncStreamerMode);
    window.addEventListener('ncore:rollout-settings-updated', syncStreamerMode as EventListener);
    return () => {
      window.removeEventListener('storage', syncStreamerMode);
      window.removeEventListener('ncore:rollout-settings-updated', syncStreamerMode as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!window.desktopBridge?.setStreamerModeConfig) return;
    void window.desktopBridge.setStreamerModeConfig({
      enabled: streamerMode.enabled,
      hideDmPreviews: streamerMode.hideDmPreviews,
      silentNotifications: streamerMode.silentNotifications,
    });
  }, [streamerMode.enabled, streamerMode.hideDmPreviews, streamerMode.silentNotifications]);

  useEffect(() => {
    const desktopBridge = window.desktopBridge;
    if (!desktopBridge?.getUpdateRuntimeState) return;

    let mounted = true;
    const applyRuntimeState = (payload?: DesktopUpdateRuntimeState | null) => {
      if (!mounted || !payload?.ok) return;
      setUpdateRuntimeState({
        portable: Boolean(payload.portable),
        ready: Boolean(payload.ready),
        checking: Boolean(payload.checking),
        downloading: Boolean(payload.downloading),
        progress: Number(payload.progress || 0),
        installing: Boolean(payload.installing),
        version: String(payload.version || ''),
        latestVersion: String(payload.latestVersion || ''),
        message: String(payload.message || ''),
      });
      if (!payload.installing) {
        setInstallingFromTopbar(false);
      }
    };

    const loadRuntimeState = async () => {
      try {
        const state = await desktopBridge.getUpdateRuntimeState();
        applyRuntimeState(state);
      } catch {
        // ignore updater runtime sync failures
      }
    };

    void loadRuntimeState();
    const unsubscribe = desktopBridge.onUpdateReady
      ? desktopBridge.onUpdateReady((payload) => applyRuntimeState(payload))
      : undefined;

    return () => {
      mounted = false;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!hasActiveCall || !callSession.startedAt) return;
    setCallNowMs(Date.now());
    const timer = window.setInterval(() => {
      setCallNowMs(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [hasActiveCall, callSession.startedAt]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const cached = readReleaseCache();
      if (cached && Date.now() - cached.cachedAt < RELEASE_CACHE_TTL_MS) {
        setReleaseUpdates(cached.releases.slice(0, 5));
        setLatestReleaseVersion(cached.latestVersion || cached.releases[0]?.version || '');
        return;
      }

      try {
        const feedBase = await resolveUpdateFeedBase(DEFAULT_UPDATE_FEED_URL);
        const [releaseLog, latestVersion] = await Promise.all([
          fetchReleaseNotesFromFeed(feedBase),
          fetchLatestReleaseVersion(feedBase),
        ]);
        if (cancelled) return;

        const deduped = dedupeAndSortReleaseLog(releaseLog);

        const latest = String(latestVersion || '').trim();
        if (latest && !deduped.some((entry) => compareSemver(entry.version, latest) === 0)) {
          deduped.unshift({
            version: latest,
            date: 'Latest release',
            badge: 'Release',
            improvements: ["Newest installer and notes are available in What's New."],
            bugFixes: [],
          });
        }

        setReleaseUpdates(deduped.slice(0, 5));
        setLatestReleaseVersion(deduped[0]?.version || latest);
        writeReleaseCache(deduped.slice(0, 5), deduped[0]?.version || latest);
      } catch {
        if (cancelled) return;
        setReleaseUpdates([]);
        setLatestReleaseVersion('');
      }
    };

    let idleId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const requestIdle = (window as any).requestIdleCallback as
      | ((cb: () => void, opts?: { timeout: number }) => number)
      | undefined;

    if (typeof requestIdle === 'function') {
      idleId = requestIdle(() => {
        void run();
      }, { timeout: 1800 });
    } else {
      timeoutId = setTimeout(() => {
        void run();
      }, 700);
    }

    return () => {
      cancelled = true;
      if (idleId !== null) {
        const cancelIdle = (window as any).cancelIdleCallback as ((id: number) => void) | undefined;
        if (typeof cancelIdle === 'function') cancelIdle(idleId);
      }
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    if (!profile) return;
    const pullNotifications = async (emitDesktopForNew: boolean) => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) {
        setNotificationError(error.message || 'Could not refresh notifications.');
        return;
      }
      if (!data) return;
      const filtered = lastClearedAt
        ? (data as Notification[]).filter((n) => n.created_at > lastClearedAt)
        : (data as Notification[]);
      const list = sortNotificationsByCreatedAt(filtered);
      setNotificationError('');
      setNotifications((prev) => mergeNotificationLists(prev, list).slice(0, 50));
      const latestIncomingCall = list.find((notification) => notification.type === 'incoming_call' && !notification.is_read) || null;
      setIncomingCall(latestIncomingCall);

      if (!useMainProcessDesktopNotifications && emitDesktopForNew && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        for (const notification of list) {
          if (!seenNotificationIdsRef.current.has(notification.id)) {
            seenNotificationIdsRef.current.add(notification.id);
            new Notification(
              sanitizeNotificationTitle(notification.title || 'NCore', notification.type || ''),
              { body: sanitizeNotificationBody(notification.body || '', notification.type || '') },
            );
            const soundKind = getNotificationSoundKind(notification);
            if (soundKind === 'call') {
              startIncomingCallRing({ status: profile.status });
            } else {
              playNotificationSound(soundKind, { status: profile.status });
            }
          }
        }
      } else {
        for (const notification of list) {
          seenNotificationIdsRef.current.add(notification.id);
        }
      }
    };

    void pullNotifications(false);

    const channel = supabase
      .channel(`notifications:${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${profile.id}`,
        },
        (payload) => {
          const incoming = payload.new as Notification;
          if (lastClearedAt && incoming.created_at <= lastClearedAt) return;
          setNotifications((prev) => mergeNotificationLists(prev, [incoming]).slice(0, 50));
          setNotificationError('');
          if (incoming.type === 'incoming_call') {
            setIncomingCall(incoming);
          }
          if (canUseRendererNotificationAudio()) {
            const soundKind = getNotificationSoundKind(incoming);
            if (soundKind === 'call') {
              startIncomingCallRing({ status: profile.status });
            } else {
              playNotificationSound(soundKind, { status: profile.status });
            }
          }
          if (!useMainProcessDesktopNotifications && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            new Notification(sanitizeNotificationTitle(incoming.title || 'NCore', incoming.type || ''), {
              body: sanitizeNotificationBody(incoming.body || '', incoming.type || ''),
            });
          }
        },
      )
      .subscribe();

    const interval = window.setInterval(() => {
      if (document.hidden) return;
      void pullNotifications(true);
    }, 60000);

    return () => {
      supabase.removeChannel(channel);
      window.clearInterval(interval);
    };
  }, [profile, useMainProcessDesktopNotifications]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) setShowNotifications(false);
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) setShowUserMenu(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    setShowNotifications(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (streamerMode.silentNotifications) {
      stopIncomingCallRing();
      return;
    }
    if (!canUseRendererNotificationAudio()) {
      stopIncomingCallRing();
      return;
    }
    if (incomingCall) {
      startIncomingCallRing({ status: profile?.status });
      return () => {
        stopIncomingCallRing();
      };
    }
    stopIncomingCallRing();
    return;
  }, [incomingCall?.id, profile?.status, streamerMode.silentNotifications]);

  async function markAllRead() {
    markReleaseUpdatesRead();
    if (!profile) return;
    await supabase.from('notifications').update({ is_read: true }).eq('user_id', profile.id);
    const clearedAt = new Date().toISOString();
    setLastClearedAt(clearedAt);
    try { localStorage.setItem('ncore.notifications.lastClearedAt', clearedAt); } catch { /* noop */ }
    setNotifications([]);
    setIncomingCall(null);
    setShowNotifications(false);
    stopIncomingCallRing();
  }

  async function handleSignOut() {
    await signOut();
    navigate('/');
  }

  async function handleNotificationClick(notification: Notification) {
    setShowNotifications(false);
    if (!notification.is_read) {
      await supabase.from('notifications').update({ is_read: true }).eq('id', notification.id);
      setNotifications((prev) => prev.map((entry) => (entry.id === notification.id ? { ...entry, is_read: true } : entry)));
    }

    if (notification.type === 'incoming_call') {
      const data = (notification.data || {}) as any;
      const conversationId = data.conversation_id as string | undefined;
      const video = Boolean(data.video);
      const fallbackJoin = Boolean(data.fallback_join || !data.call_id);
      setIncomingCall(null);
      stopIncomingCallRing();

      if (conversationId) {
        navigate(buildCallRoute(conversationId, video, fallbackJoin));
        return;
      }
    }

    if (notification.type === 'mention') {
      const data = (notification.data || {}) as any;
      const targetConversationId = data.conversation_id as string | undefined;
      const targetCommunityId = data.community_id as string | undefined;
      const targetChannelId = data.channel_id as string | undefined;
      if (targetCommunityId && targetChannelId) {
        navigate(`/app/community/${targetCommunityId}/channel/${targetChannelId}`);
        return;
      }
      if (targetConversationId) {
        navigate(`/app/dm/${targetConversationId}`);
        return;
      }
    }

    if (notification.type === 'direct_message') {
      const data = (notification.data || {}) as any;
      const targetConversationId = data.conversation_id as string | undefined;
      if (targetConversationId) {
        navigate(`/app/dm/${targetConversationId}`);
      }
    }
  }

  async function handleIncomingCallAction(action: 'accept' | 'dismiss') {
    if (!incomingCall) return;
    stopIncomingCallRing();

    if (!incomingCall.is_read) {
      await supabase.from('notifications').update({ is_read: true }).eq('id', incomingCall.id);
      setNotifications((prev) => prev.map((entry) => (entry.id === incomingCall.id ? { ...entry, is_read: true } : entry)));
    }

    const data = (incomingCall.data || {}) as any;
    const conversationId = data.conversation_id as string | undefined;
    const video = Boolean(data.video);
    const callId = data.call_id as string | undefined;
    const fallbackJoin = Boolean(data.fallback_join || !callId);

    if (action === 'accept') {
      if (callId) {
        await supabase.from('calls').update({ state: 'accepted' }).eq('id', callId);
      }
      if (conversationId) {
        navigate(buildCallRoute(conversationId, video, fallbackJoin));
      }
    } else if (action === 'dismiss' && callId) {
      await supabase.from('calls').update({ state: 'declined' }).eq('id', callId);
    }

    setIncomingCall(null);
  }

  async function handleEndActiveCall() {
    const targetConversationId = callSession.conversationId;
    const canEndForEveryone = profile?.platform_role === 'owner';
    if (targetConversationId) {
      navigate(`/app/dm/${targetConversationId}`, { replace: true });
    }
    window.setTimeout(() => {
      void hangupDirectCall({ signalEnded: canEndForEveryone });
    }, 0);
  }

  async function handleInstallUpdateFromTopbar() {
    const installDownloadedUpdate = window.desktopBridge?.installDownloadedUpdate;
    if (!installDownloadedUpdate || updateInstallInProgress || !updateRuntimeState.ready) return;
    setInstallingFromTopbar(true);
    try {
      const result = await installDownloadedUpdate();
      if (!result?.ok) {
        setInstallingFromTopbar(false);
      }
    } catch {
      setInstallingFromTopbar(false);
    }
  }

  return (
    <>
    <div
      className="relative z-10 flex h-14 flex-shrink-0 items-center gap-3 border-b border-surface-800 bg-surface-900 px-4"
      style={topBarStyle}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {showSidebarToggle && (
          <button
            onClick={onToggleSidebar}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-surface-400 transition-colors hover:bg-surface-700 hover:text-surface-200"
            style={noDragStyle}
          >
            {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          </button>
        )}
        {title && (
          <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-surface-100">{title}</div>
              {subtitle && <div className="truncate text-xs text-surface-500">{subtitle}</div>}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2" style={noDragStyle}>
        {hasActiveCall && activeCallConversationId && (
          <div className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 px-2.5 py-1.5">
            <PhoneCall size={14} className="flex-shrink-0 text-green-300" />
            <span className="text-xs font-semibold text-green-200">
              {callSession.phase === 'connecting'
                ? 'Connecting call...'
                : `In call ${formatCallDuration(callNowMs - (callSession.startedAt || callNowMs))}`}
            </span>
            <button
              type="button"
              onClick={() => void toggleDirectCallMute()}
              className={`rounded p-1 transition-colors ${
                callSession.isMuted
                  ? 'bg-red-600/90 text-white hover:bg-red-500'
                  : 'bg-surface-700/70 text-surface-100 hover:bg-surface-600'
              }`}
              title={callSession.isMuted ? 'Unmute' : 'Mute'}
            >
              {callSession.isMuted ? <MicOff size={12} /> : <Mic size={12} />}
            </button>
            <button
              type="button"
              onClick={() => void toggleDirectCallDeafen()}
              className={`rounded p-1 transition-colors ${
                callSession.isDeafened
                  ? 'bg-red-600/90 text-white hover:bg-red-500'
                  : 'bg-surface-700/70 text-surface-100 hover:bg-surface-600'
              }`}
              title={callSession.isDeafened ? 'Undeafen' : 'Deafen'}
            >
              {callSession.isDeafened ? <VolumeX size={12} /> : <Volume2 size={12} />}
            </button>
            {!isOnActiveCallRoute && (
              <button
                onClick={() => navigate(`/app/dm/${activeCallConversationId}/call${callSession.wantsVideo ? '?video=1' : ''}`)}
                className="rounded bg-surface-700/70 px-2 py-1 text-[11px] font-semibold text-surface-100 transition-colors hover:bg-surface-600"
              >
                Return
              </button>
            )}
            <button
              onClick={handleEndActiveCall}
              className="rounded bg-red-600/90 p-1 text-white transition-colors hover:bg-red-500"
              title="End call"
            >
              <PhoneOff size={12} />
            </button>
          </div>
        )}

        {actions}

        {showTopbarUpdateButton && (
          <button
            type="button"
            onClick={handleInstallUpdateFromTopbar}
            disabled={!updateRuntimeState.ready || updateInstallInProgress}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
              updateRuntimeState.ready || updateInstallInProgress
                ? 'border-green-500/40 bg-green-500/15 text-green-100 hover:bg-green-500/25'
                : 'border-amber-500/35 bg-amber-500/12 text-amber-100 hover:bg-amber-500/18'
            } disabled:cursor-not-allowed disabled:opacity-70`}
            title={updateInstallInProgress
              ? 'Applying update and restarting NCore...'
              : updateDownloadInProgress
                ? (updateRuntimeState.message || 'NCore is downloading the latest update in the background.')
                : 'Apply downloaded update and restart NCore'}
          >
            {updateInstallInProgress || updateDownloadInProgress
              ? <RefreshCw size={13} className="animate-spin" />
              : <Download size={13} />}
            <span>
              {updateInstallInProgress
                ? 'Updating...'
                : updateDownloadInProgress
                  ? (updateRuntimeState.downloading
                    ? `Downloading${updateRuntimeState.progress ? ` ${Math.round(updateRuntimeState.progress)}%` : '...'}`
                    : 'Checking...')
                  : `Update${updateRuntimeState.version ? ` v${updateRuntimeState.version}` : ' Ready'}`}
            </span>
          </button>
        )}

        <div className="relative hidden md:block">
          <Search size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-surface-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search..."
            className="w-48 rounded-lg border border-surface-700 bg-surface-950 py-1.5 pr-4 pl-9 text-sm text-surface-300 placeholder-surface-600 transition-all focus:border-nyptid-300 focus:outline-none"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute top-1/2 right-2 -translate-y-1/2 text-surface-500 hover:text-surface-300">
              <X size={14} />
            </button>
          )}
        </div>

        <div ref={notifRef} className="relative">
          <button
            onClick={() => setShowNotifications((value) => !value)}
            className="relative flex h-9 w-9 items-center justify-center rounded-lg text-surface-400 transition-colors hover:bg-surface-700 hover:text-surface-200"
          >
            <Bell size={18} />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {showNotifications && (
            <div className="animate-slide-up absolute top-full right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-surface-700 bg-surface-800 shadow-2xl">
              <div className="flex items-center justify-between border-b border-surface-700 px-4 py-3">
                <span className="text-sm font-semibold text-surface-100">Notifications</span>
                {unreadCount > 0 && (
                  <button onClick={markAllRead} className="text-xs text-nyptid-300 transition-colors hover:text-nyptid-200">
                    Mark all read
                  </button>
                )}
              </div>

              {releaseUpdates.length > 0 && (
                <div className="space-y-2 border-b border-surface-700 px-3 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-surface-500">
                      <Zap size={12} className="text-nyptid-300" />
                      Product Updates
                    </div>
                    <button
                      type="button"
                      onClick={() => openWhatsNew()}
                      className="text-[11px] font-semibold text-nyptid-300 transition-colors hover:text-nyptid-200"
                    >
                      View all
                    </button>
                  </div>
                  {releaseUpdates.slice(0, 3).map((release) => {
                    const isUnread = !seenReleaseVersion || compareSemver(release.version, seenReleaseVersion) > 0;
                    const summary = release.improvements[0] || release.bugFixes[0] || 'New release available.';
                    return (
                      <button
                        key={`release-${release.version}`}
                        type="button"
                        onClick={() => openWhatsNew(release.version)}
                        className="w-full rounded-lg border border-surface-700 bg-surface-900/60 px-3 py-2 text-left transition-colors hover:border-nyptid-300/50 hover:bg-surface-700/60"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-surface-100">v{release.version}</span>
                          {isUnread && (
                            <span className="rounded-full border border-nyptid-300/30 bg-nyptid-300/15 px-1.5 py-0.5 text-[10px] font-bold text-nyptid-200">
                              New
                            </span>
                          )}
                        </div>
                        <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-surface-400">{summary}</div>
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="max-h-80 overflow-y-auto">
                {notificationError && (
                  <div className="border-b border-red-500/20 bg-red-500/10 px-4 py-2 text-xs text-red-200">
                    {notificationError}
                  </div>
                )}
                {notifications.length === 0 ? (
                  <div className="py-8 text-center text-sm text-surface-500">No account notifications yet</div>
                ) : notifications.map((notification) => (
                  <button
                    key={notification.id}
                    type="button"
                    onClick={() => handleNotificationClick(notification)}
                    className={`w-full border-b border-surface-700/50 px-4 py-3 text-left transition-colors hover:bg-surface-700/30 ${!notification.is_read ? 'bg-nyptid-300/5' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      {!notification.is_read && <div className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-nyptid-300" />}
                      <div className={!notification.is_read ? '' : 'ml-5'}>
                        <div className="text-sm font-medium text-surface-200">
                          {sanitizeNotificationTitle(notification.title || 'NCore', notification.type || '')}
                        </div>
                        <div className="mt-0.5 text-xs text-surface-400">
                          {sanitizeNotificationBody(notification.body || '', notification.type || '')}
                        </div>
                        <div className="mt-1 text-xs text-surface-600">{formatRelativeTime(notification.created_at)}</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div ref={userMenuRef} className="relative">
          <button
            onClick={() => setShowUserMenu((value) => !value)}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-700"
          >
            {profile && (
              <Avatar
                src={profile.avatar_url}
                name={profile.display_name || profile.username}
                size="sm"
                status={profile.status}
              />
            )}
          </button>

          {showUserMenu && profile && (
            <div className="animate-slide-up absolute top-full right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-surface-700 bg-surface-800 shadow-2xl">
              <div className="border-b border-surface-700 px-4 py-3">
                <div className="text-sm font-semibold text-surface-100">{profile.display_name || profile.username}</div>
                <div className="text-xs text-surface-500">@{profile.username}</div>
                <div className="mt-1.5 flex items-center gap-2">
                  <Badge variant="primary" size="sm">{profile.rank}</Badge>
                  {profile.platform_role === 'owner' && (
                    <Badge variant="primary" size="sm">OWNER</Badge>
                  )}
                </div>
              </div>
              <div className="py-1">
                <button
                  onClick={() => { navigate(`/app/profile/${profile.id}`); setShowUserMenu(false); }}
                  className="w-full px-4 py-2 text-left text-sm text-surface-300 transition-colors hover:bg-surface-700 hover:text-surface-100"
                >
                  <span className="flex items-center gap-3"><User size={16} /> View Profile</span>
                </button>
                <button
                  onClick={() => { navigate('/app/settings'); setShowUserMenu(false); }}
                  className="w-full px-4 py-2 text-left text-sm text-surface-300 transition-colors hover:bg-surface-700 hover:text-surface-100"
                >
                  <span className="flex items-center gap-3"><Settings size={16} /> Settings</span>
                </button>
                {profile.platform_role === 'owner' && (
                  <button
                    onClick={() => { navigate('/app/admin'); setShowUserMenu(false); }}
                    className="w-full px-4 py-2 text-left text-sm text-nyptid-300 transition-colors hover:bg-surface-700"
                  >
                    <span className="flex items-center gap-3"><Crown size={16} /> Admin Panel</span>
                  </button>
                )}
                <div className="nyptid-separator mx-2" />
                <button
                  onClick={handleSignOut}
                  className="w-full px-4 py-2 text-left text-sm text-red-400 transition-colors hover:bg-red-500/10"
                >
                  <span className="flex items-center gap-3"><LogOut size={16} /> Sign Out</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {incomingCall && (
        <div
          className="absolute top-[calc(100%+10px)] right-4 z-[80] w-80 rounded-xl border border-nyptid-300/30 bg-surface-800 p-4 shadow-2xl"
          style={noDragStyle}
        >
          <div className="text-sm font-semibold text-surface-100">
            {sanitizeNotificationTitle(incomingCall.title || 'Incoming call', incomingCall.type || 'incoming_call')}
          </div>
          <div className="mt-1 text-xs text-surface-400">
            {sanitizeNotificationBody(incomingCall.body || '', incomingCall.type || 'incoming_call')}
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => handleIncomingCallAction('dismiss')}
              className="nyptid-btn-secondary flex-1 py-2 text-xs"
            >
              Dismiss
            </button>
            <button
              onClick={() => handleIncomingCallAction('accept')}
              className="nyptid-btn-primary flex-1 py-2 text-xs"
            >
              Join
            </button>
          </div>
        </div>
      )}
    </div>
      {streamerMode.enabled && (
        <div
          className="fixed left-1/2 z-[95] -translate-x-1/2 rounded-lg border border-violet-400/40 bg-violet-500/20 px-3 py-1.5 text-xs text-violet-100 shadow-xl backdrop-blur"
          style={{ top: streamerBannerTop }}
        >
          <span className="font-semibold">Streamer Mode Enabled</span>
          <span className="mx-1.5 text-violet-200/80">•</span>
          <span>
            Sensitive previews hidden and notifications reduced
            {String(profile?.status || '').toLowerCase() === 'streaming' ? '. Streaming status detected.' : '.'}
          </span>
        </div>
      )}
    </>
  );
}

function formatCallDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function buildCallRoute(conversationId: string, video: boolean, fallbackJoin: boolean): string {
  const params = new URLSearchParams();
  if (video) params.set('video', '1');
  if (fallbackJoin) params.set('fallback', '1');
  const query = params.toString();
  return `/app/dm/${conversationId}/call${query ? `?${query}` : ''}`;
}
