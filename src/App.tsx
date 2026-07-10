import { BrowserRouter, HashRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, Suspense, lazy, useRef } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LoadingScreen } from './components/ui/Spinner';
import { probeRunPodBackend } from './lib/runpod';
import { PwaExperienceBar } from './components/pwa/PwaExperienceBar';
import { detectWebSurface, type WebSurface } from './lib/webSurface';
import { readPendingInviteCode } from './lib/inviteLinks';
import { createDurationTracker, queueRuntimeEvent, reportRuntimeError } from './lib/runtimeTelemetry';
import { supabase } from './lib/supabase';
import { isDesktopRuntime } from './lib/desktopRuntime';

const LandingPage = lazy(() => import('./pages/LandingPage').then((m) => ({ default: m.LandingPage })));
const MarketplaceWebPage = lazy(() => import('./pages/MarketplaceWebPage').then((m) => ({ default: m.MarketplaceWebPage })));
const LoginPage = lazy(() => import('./pages/AuthPage').then((m) => ({ default: m.LoginPage })));
const SignupPage = lazy(() => import('./pages/AuthPage').then((m) => ({ default: m.SignupPage })));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })));
const MfaChallengePage = lazy(() => import('./pages/MfaChallengePage').then((m) => ({ default: m.MfaChallengePage })));
const OnboardingPage = lazy(() => import('./pages/OnboardingPage').then((m) => ({ default: m.OnboardingPage })));
const DiscoverPage = lazy(() => import('./pages/DiscoverPage').then((m) => ({ default: m.DiscoverPage })));
const FriendsPage = lazy(() => import('./pages/FriendsPage').then((m) => ({ default: m.FriendsPage })));
const MarketplacePage = lazy(() => import('./pages/MarketplacePage').then((m) => ({ default: m.MarketplacePage })));
const CommunityPage = lazy(() => import('./pages/CommunityPage').then((m) => ({ default: m.CommunityPage })));
const CommunitySettingsPage = lazy(() => import('./pages/CommunitySettingsPage').then((m) => ({ default: m.CommunitySettingsPage })));
const ChatPage = lazy(() => import('./pages/ChatPage').then((m) => ({ default: m.ChatPage })));
const VoiceChannelPage = lazy(() => import('./pages/VoiceChannelPage').then((m) => ({ default: m.VoiceChannelPage })));
const ForumChannelPage = lazy(() => import('./pages/ForumChannelPage'));
const GameLibraryPage = lazy(() => import('./pages/GameLibraryPage'));
const GameDetailPage = lazy(() => import('./pages/GameDetailPage'));
const DeveloperPortalPage = lazy(() => import('./pages/DeveloperPortalPage'));
const DirectMessagePage = lazy(() => import('./pages/DirectMessagePage').then((m) => ({ default: m.DirectMessagePage })));
const DirectCallPage = lazy(() => import('./pages/DirectCallPage').then((m) => ({ default: m.DirectCallPage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage').then((m) => ({ default: m.ProfilePage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const LeaderboardPage = lazy(() => import('./pages/LeaderboardPage').then((m) => ({ default: m.LeaderboardPage })));
const AdminPage = lazy(() => import('./pages/AdminPage').then((m) => ({ default: m.AdminPage })));
const InvitePage = lazy(() => import('./pages/InvitePage').then((m) => ({ default: m.InvitePage })));

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, profile, loading, profileLoading, mfaPending } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (mfaPending && location.pathname !== '/mfa') return <Navigate to="/mfa" state={{ from: location }} replace />;
  if (user && !profileLoading && !profile?.username && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }
  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, profile, loading, profileLoading, mfaPending } = useAuth();
  const location = useLocation();

  if (loading || (user && profileLoading)) return <LoadingScreen />;
  if (user && mfaPending) return <Navigate to="/mfa" replace />;
  if (user && profile?.username) {
    const params = new URLSearchParams(location.search);
    const inviteCode = String(params.get('invite') || readPendingInviteCode() || '').trim();
    if (inviteCode) {
      return <Navigate to={`/invite/${encodeURIComponent(inviteCode)}`} replace />;
    }
    return <Navigate to="/app/dm" replace />;
  }
  if (user && !profile?.username) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

function AppRoutes({ isDesktop, webSurface }: { isDesktop: boolean; webSurface: WebSurface }) {
  const location = useLocation();
  const authHash = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
  const isRecoveryCallback = authHash.get('type') === 'recovery' || authHash.has('error');

  return (
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        <Route
          path="/"
          element={
            isRecoveryCallback ? (
              <Navigate to={`/reset-password${location.hash}`} replace />
            ) : isDesktop ? (
              <Navigate to="/app" replace />
            ) : webSurface === 'app' ? (
              <Navigate to="/app/dm" replace />
            ) : webSurface === 'marketplace' ? (
              <MarketplaceWebPage />
            ) : (
              <PublicRoute><LandingPage /></PublicRoute>
            )
          }
        />
        <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
        <Route path="/signup" element={<PublicRoute><SignupPage /></PublicRoute>} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/mfa" element={<ProtectedRoute><MfaChallengePage /></ProtectedRoute>} />
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/invite/:inviteCode" element={<InvitePage />} />
        <Route path="/:inviteCode" element={<InvitePage />} />
        <Route
          path="/marketplace"
          element={webSurface === 'app' ? <Navigate to="/app/marketplace" replace /> : <MarketplaceWebPage />}
        />
        <Route
          path="/marketplace/*"
          element={webSurface === 'app' ? <Navigate to="/app/marketplace" replace /> : <MarketplaceWebPage />}
        />

        <Route path="/app" element={<Navigate to="/app/dm" replace />} />
        <Route path="/app/discover" element={<ProtectedRoute><DiscoverPage /></ProtectedRoute>} />
        <Route path="/app/friends" element={<ProtectedRoute><FriendsPage /></ProtectedRoute>} />
        <Route path="/app/marketplace" element={<ProtectedRoute><MarketplacePage /></ProtectedRoute>} />
        <Route path="/app/marketplace/quickdraw" element={<ProtectedRoute><MarketplacePage /></ProtectedRoute>} />
        <Route path="/app/marketplace/games" element={<ProtectedRoute><MarketplacePage /></ProtectedRoute>} />
        <Route path="/app/dm" element={<ProtectedRoute><DirectMessagePage /></ProtectedRoute>} />
        <Route path="/app/dm/:conversationId" element={<ProtectedRoute><DirectMessagePage /></ProtectedRoute>} />
        <Route path="/app/dm/:conversationId/call" element={<ProtectedRoute><DirectCallPage /></ProtectedRoute>} />
        <Route path="/app/community/:communityId" element={<ProtectedRoute><CommunityPage /></ProtectedRoute>} />
        <Route path="/app/community/:communityId/settings" element={<ProtectedRoute><CommunitySettingsPage /></ProtectedRoute>} />
        <Route path="/app/community/:communityId/channel/:channelId" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
        <Route path="/app/community/:communityId/voice/:channelId" element={<ProtectedRoute><VoiceChannelPage /></ProtectedRoute>} />
        <Route path="/app/community/:communityId/forum/:channelId" element={<ProtectedRoute><ForumChannelPage /></ProtectedRoute>} />
        <Route path="/app/games" element={<ProtectedRoute><GameLibraryPage /></ProtectedRoute>} />
        <Route path="/app/marketplace/games/:gameSlug" element={<ProtectedRoute><GameDetailPage /></ProtectedRoute>} />
        <Route path="/app/developer" element={<ProtectedRoute><DeveloperPortalPage /></ProtectedRoute>} />
        <Route path="/app/profile/:userId" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
        <Route path="/app/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
        <Route path="/app/leaderboard" element={<ProtectedRoute><LeaderboardPage /></ProtectedRoute>} />
        <Route path="/app/admin" element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  const isDesktop = isDesktopRuntime();
  const webSurface = detectWebSurface(isDesktop);

  const Router = isDesktop ? HashRouter : BrowserRouter;

  return (
    <Router>
      <AuthProvider>
        <RealtimeBridge />
        <PwaExperienceBar isElectron={isDesktop} />
        <AppRoutes isDesktop={isDesktop} webSurface={webSurface} />
      </AuthProvider>
    </Router>
  );
}

function RealtimeBridge() {
  const isDesktop = isDesktopRuntime();
  const { session, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const shouldProbeRunPod = import.meta.env.DEV || String(import.meta.env.VITE_ENABLE_RUNPOD_PROBE || '').trim() === '1';
  const previousRouteRef = useRef<string>('');

  useEffect(() => {
    const onWindowError = (event: ErrorEvent) => {
      reportRuntimeError('window_error', event.error || event.message, {
        filename: event.filename || '',
        lineno: Number(event.lineno || 0),
        colno: Number(event.colno || 0),
      }, { userId: profile?.id, sampleRate: 1 });
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      reportRuntimeError('unhandled_rejection', event.reason, {}, { userId: profile?.id, sampleRate: 1 });
    };
    window.addEventListener('error', onWindowError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => {
      window.removeEventListener('error', onWindowError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, [profile?.id]);

  useEffect(() => {
    const routeKey = `${location.pathname}${location.search}`;
    const previousRoute = previousRouteRef.current;
    const end = createDurationTracker('route_transition_duration_ms', {
      route: routeKey,
      from_route: previousRoute || null,
    }, {
      userId: profile?.id,
      sampleRate: 0.35,
    });
    const rafId = window.requestAnimationFrame(() => {
      end({ route: routeKey });
    });
    previousRouteRef.current = routeKey;
    return () => window.cancelAnimationFrame(rafId);
  }, [location.pathname, location.search, profile?.id]);

  useEffect(() => {
    if (!shouldProbeRunPod) return;
    let cancelled = false;
    const runProbe = () => {
      void probeRunPodBackend().then((result) => {
        if (cancelled) return;
        if (result.ok) {
          console.info('[RunPod] Backend reachable:', result.url);
        } else {
          console.warn('[RunPod] Backend probe failed:', result.url, result.error || 'Unknown error');
        }
      });
    };

    let idleId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const requestIdle = (window as any).requestIdleCallback as
      | ((cb: () => void, opts?: { timeout: number }) => number)
      | undefined;

    if (typeof requestIdle === 'function') {
      idleId = requestIdle(runProbe, { timeout: 2500 });
    } else {
      timeoutId = setTimeout(runProbe, 700);
    }

    return () => {
      cancelled = true;
      if (idleId !== null) {
        const cancelIdle = (window as any).cancelIdleCallback as ((id: number) => void) | undefined;
        if (typeof cancelIdle === 'function') cancelIdle(idleId);
      }
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [shouldProbeRunPod]);

  // Start/stop realtime listener in main process when running in Electron
  useEffect(() => {
    if (!isDesktop) return;
    if (!session) return;
    const token = (session as any).access_token;
    if (!token) return;

    // start
    try {
      void window.desktopBridge?.realtimeStart(token);
    } catch (err) {
      console.warn('desktopBridge.realtimeStart failed', err);
    }

    const onIncoming = (data: any) => {
      try {
        const convId = data?.conversation_id || data?.conversationId || data?.conversation || data?.conversation_id;
        const video = !!(data?.video);
        const fallbackJoin = Boolean(data?.fallback_join || !data?.call_id);
        if (convId && navigate) {
          const params = new URLSearchParams();
          if (video) params.set('video', '1');
          if (fallbackJoin) params.set('fallback', '1');
          const query = params.toString();
          navigate(`/app/dm/${convId}/call${query ? `?${query}` : ''}`);
        }
      } catch (err) {
        console.warn('incoming-call handler failed', err);
      }
    };

    let detachIncomingListener: (() => void) | undefined;
    try {
      detachIncomingListener = window.desktopBridge?.onIncomingCall(onIncoming);
    } catch (err) {
      console.warn('desktopBridge.onIncomingCall failed', err);
    }

    let detachNotificationClick: (() => void) | undefined;
    try {
      detachNotificationClick = window.desktopBridge?.onDesktopNotificationClick((payload: any) => {
        const type = String(payload?.type || '').trim();
        const data = payload?.data || {};
        const convId = data?.conversation_id || data?.conversationId;
        if (type === 'incoming_call' && convId) {
          const video = !!data?.video;
          const fallbackJoin = Boolean(data?.fallback_join || !data?.call_id);
          const params = new URLSearchParams();
          if (video) params.set('video', '1');
          if (fallbackJoin) params.set('fallback', '1');
          const query = params.toString();
          navigate(`/app/dm/${convId}/call${query ? `?${query}` : ''}`);
          return;
        }
        if (type === 'direct_message' && convId) {
          navigate(`/app/dm/${convId}`);
          return;
        }
        navigate('/app/dm');
      });
    } catch (err) {
      console.warn('desktopBridge.onDesktopNotificationClick failed', err);
    }

    return () => {
      try {
        detachIncomingListener?.();
        detachNotificationClick?.();
        void window.desktopBridge?.realtimeStop();
      } catch (err) {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDesktop, session]);

  useEffect(() => {
    if (!isDesktop || !session || !profile) return;
    try {
      void window.desktopBridge?.realtimeSetStatus(profile.status || 'online');
    } catch (err) {
      console.warn('desktopBridge.realtimeSetStatus failed', err);
    }
  }, [isDesktop, session, profile?.status, profile?.id]);

  useEffect(() => {
    queueRuntimeEvent('session_bridge_ready', {
      is_desktop: isDesktop,
      has_session: Boolean(session),
      route: `${location.pathname}${location.search}`,
    }, { userId: profile?.id, sampleRate: 0.2 });
  }, [isDesktop, location.pathname, location.search, profile?.id, session]);

  // iOS Safari evicts localStorage for sites not opened in ~7 days (for non-installed
  // origins) and pauses Supabase's auto-refresh while the tab is backgrounded. When
  // the PWA returns to foreground, proactively refresh the session so we don't leave
  // the user on a silently-expired token.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      void (async () => {
        try {
          const { data } = await supabase.auth.refreshSession();
          if (!data?.session) {
            queueRuntimeEvent('auth_session_stale_on_resume', {}, { userId: profile?.id, sampleRate: 1 });
          }
        } catch (err) {
          reportRuntimeError('auth_resume_refresh_failed', err, {}, { userId: profile?.id, sampleRate: 1 });
        }
      })();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [profile?.id]);

  return null;
}
