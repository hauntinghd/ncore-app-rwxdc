import { BrowserRouter, HashRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, Suspense, lazy } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LoadingScreen } from './components/ui/Spinner';
import { probeRunPodBackend } from './lib/runpod';
import { PwaExperienceBar } from './components/pwa/PwaExperienceBar';
import { detectWebSurface, type WebSurface } from './lib/webSurface';

const LandingPage = lazy(() => import('./pages/LandingPage').then((m) => ({ default: m.LandingPage })));
const MarketplaceWebPage = lazy(() => import('./pages/MarketplaceWebPage').then((m) => ({ default: m.MarketplaceWebPage })));
const LoginPage = lazy(() => import('./pages/AuthPage').then((m) => ({ default: m.LoginPage })));
const SignupPage = lazy(() => import('./pages/AuthPage').then((m) => ({ default: m.SignupPage })));
const OnboardingPage = lazy(() => import('./pages/OnboardingPage').then((m) => ({ default: m.OnboardingPage })));
const DiscoverPage = lazy(() => import('./pages/DiscoverPage').then((m) => ({ default: m.DiscoverPage })));
const FriendsPage = lazy(() => import('./pages/FriendsPage').then((m) => ({ default: m.FriendsPage })));
const MarketplacePage = lazy(() => import('./pages/MarketplacePage').then((m) => ({ default: m.MarketplacePage })));
const CommunityPage = lazy(() => import('./pages/CommunityPage').then((m) => ({ default: m.CommunityPage })));
const CommunitySettingsPage = lazy(() => import('./pages/CommunitySettingsPage').then((m) => ({ default: m.CommunitySettingsPage })));
const ChatPage = lazy(() => import('./pages/ChatPage').then((m) => ({ default: m.ChatPage })));
const VoiceChannelPage = lazy(() => import('./pages/VoiceChannelPage').then((m) => ({ default: m.VoiceChannelPage })));
const DirectMessagePage = lazy(() => import('./pages/DirectMessagePage').then((m) => ({ default: m.DirectMessagePage })));
const DirectCallPage = lazy(() => import('./pages/DirectCallPage').then((m) => ({ default: m.DirectCallPage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage').then((m) => ({ default: m.ProfilePage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const LeaderboardPage = lazy(() => import('./pages/LeaderboardPage').then((m) => ({ default: m.LeaderboardPage })));
const AdminPage = lazy(() => import('./pages/AdminPage').then((m) => ({ default: m.AdminPage })));

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, profile, loading, profileLoading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (user && !profileLoading && !profile?.username && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }
  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, profile, loading, profileLoading } = useAuth();

  if (loading || (user && profileLoading)) return <LoadingScreen />;
  if (user && profile?.username) return <Navigate to="/app/dm" replace />;
  if (user && !profile?.username) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

function AppRoutes({ isElectron, webSurface }: { isElectron: boolean; webSurface: WebSurface }) {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        <Route
          path="/"
          element={
            isElectron ? (
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
        <Route path="/onboarding" element={<OnboardingPage />} />
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
  const isElectron =
    typeof window !== 'undefined' &&
    (window.location.protocol === 'file:' || navigator.userAgent.toLowerCase().includes('electron'));
  const webSurface = detectWebSurface(isElectron);

  const Router = isElectron ? HashRouter : BrowserRouter;

  return (
    <Router>
      <AuthProvider>
        <RealtimeBridge />
        <PwaExperienceBar isElectron={isElectron} />
        <AppRoutes isElectron={isElectron} webSurface={webSurface} />
      </AuthProvider>
    </Router>
  );
}

function RealtimeBridge() {
  const isElectron =
    typeof window !== 'undefined' && (window.location.protocol === 'file:' || navigator.userAgent.toLowerCase().includes('electron'));
  const { session, profile } = useAuth();
  const navigate = useNavigate();
  const shouldProbeRunPod = import.meta.env.DEV || String(import.meta.env.VITE_ENABLE_RUNPOD_PROBE || '').trim() === '1';

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
    if (!isElectron) return;
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
  }, [isElectron, session]);

  useEffect(() => {
    if (!isElectron || !session || !profile) return;
    try {
      void window.desktopBridge?.realtimeSetStatus(profile.status || 'online');
    } catch (err) {
      console.warn('desktopBridge.realtimeSetStatus failed', err);
    }
  }, [isElectron, session, profile?.status, profile?.id]);

  return null;
}
