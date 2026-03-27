import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Lock,
  LogIn,
  Mail,
  MessageSquare,
  UserPlus,
  Users,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { consumePendingInviteCode } from '../lib/inviteLinks';
import { supabase } from '../lib/supabase';

interface GlobalStats {
  members: number | null;
  communities: number | null;
  messages: number | null;
  onlineNow: number | null;
}

const EMPTY_STATS: GlobalStats = {
  members: null,
  communities: null,
  messages: null,
  onlineNow: null,
};

function formatCount(value: number | null): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--';
  return value.toLocaleString();
}

function useGlobalStats() {
  const [stats, setStats] = useState<GlobalStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    const loadStats = async () => {
      const [membersRes, communitiesRes, messagesRes, dmMessagesRes, onlineNowRes] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('communities').select('id', { count: 'exact', head: true }),
        supabase.from('messages').select('id', { count: 'exact', head: true }),
        supabase.from('direct_messages').select('id', { count: 'exact', head: true }),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).in('status', ['online', 'idle', 'dnd']),
      ]);

      if (cancelled) return;

      const members = membersRes.error ? null : (membersRes.count ?? 0);
      const communities = communitiesRes.error ? null : (communitiesRes.count ?? 0);
      const roomMessages = messagesRes.error ? 0 : (messagesRes.count ?? 0);
      const directMessages = dmMessagesRes.error ? 0 : (dmMessagesRes.count ?? 0);
      const onlineNow = onlineNowRes.error ? null : (onlineNowRes.count ?? 0);

      setStats({
        members,
        communities,
        messages: roomMessages + directMessages,
        onlineNow,
      });
      setLoading(false);
    };

    const scheduleRefresh = () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }
      refreshTimer = setTimeout(() => {
        void loadStats();
      }, 250);
    };

    void loadStats();

    const statsChannel = supabase
      .channel('auth-global-stats')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'communities' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'direct_messages' }, scheduleRefresh)
      .subscribe();

    return () => {
      cancelled = true;
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }
      void supabase.removeChannel(statsChannel);
    };
  }, []);

  return { stats, loading };
}

function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const { stats, loading } = useGlobalStats();
  const appLogoUrl = `${import.meta.env.BASE_URL}NCore.jpg`;

  const statCards = useMemo(
    () => [
      { label: 'Members', value: stats.members, icon: Users },
      { label: 'Communities', value: stats.communities, icon: Activity },
      { label: 'Messages', value: stats.messages, icon: MessageSquare },
      { label: 'Online now', value: stats.onlineNow, icon: CheckCircle2 },
    ],
    [stats],
  );

  return (
    <div className="min-h-screen bg-surface-950 text-surface-100 px-4 py-6 md:px-8 md:py-8">
      <div className="absolute inset-0 bg-grid pointer-events-none" />
      <div className="absolute inset-0 bg-hero-gradient pointer-events-none" />

      <div className="relative z-10 mx-auto max-w-6xl min-h-[calc(100vh-3rem)] nyptid-card overflow-hidden">
        <div className="grid lg:grid-cols-2 h-full">
          <div className="relative p-8 md:p-10 border-b border-surface-800 lg:border-b-0 lg:border-r">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="inline-flex items-center gap-2 text-sm text-nyptid-200 hover:text-nyptid-100 transition-colors"
            >
              <ArrowLeft size={15} />
              Back to home
            </button>

            <div className="mt-10">
              <div className="w-16 h-16 rounded-2xl overflow-hidden border border-nyptid-300/30 bg-surface-900 mb-5">
                <img
                  src={appLogoUrl}
                  alt="NCore logo"
                  className="w-full h-full object-cover"
                />
              </div>
              <h1 className="text-4xl font-black text-gradient">NCore</h1>
              <p className="mt-3 text-surface-300 max-w-md">
                Real-time communication and learning infrastructure built for serious communities.
              </p>
            </div>

            <div className="mt-10 grid grid-cols-2 gap-3 max-w-md">
              {statCards.map((card) => (
                <div key={card.label} className="rounded-xl border border-surface-700 bg-surface-900/70 p-3">
                  <div className="flex items-center gap-2 text-surface-400 text-xs uppercase tracking-wide">
                    <card.icon size={12} />
                    {card.label}
                  </div>
                  <div className="mt-1 text-lg font-bold text-surface-100">
                    {loading ? (
                      <span className="inline-flex items-center gap-1 text-surface-400">
                        <Loader2 size={14} className="animate-spin" />
                        Syncing...
                      </span>
                    ) : (
                      formatCount(card.value)
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="p-8 md:p-10 flex items-center">
            <div className="w-full max-w-md mx-auto">
              <h2 className="text-4xl font-black text-surface-100 mb-2">{title}</h2>
              <p className="text-surface-400 mb-8">{subtitle}</p>
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);

    const { error: signInError } = await signIn(email.trim(), password);
    if (signInError) {
      setError(signInError.message || 'Sign in failed. Please try again.');
      setLoading(false);
      return;
    }

    const inviteCode = String(searchParams.get('invite') || consumePendingInviteCode() || '').trim();
    navigate(inviteCode ? `/invite/${encodeURIComponent(inviteCode)}` : '/app');
  }

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to your account to continue.">
      <form className="space-y-4" onSubmit={handleSubmit}>
        {error && (
          <div className="rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2 text-sm text-red-200 flex items-start gap-2">
            <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <label className="block">
          <span className="text-sm text-surface-300">Email address</span>
          <div className="mt-1 relative">
            <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500" />
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              className="nyptid-input pl-9"
              required
            />
          </div>
        </label>

        <label className="block">
          <span className="text-sm text-surface-300">Password</span>
          <div className="mt-1 relative">
            <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500" />
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Your password"
              autoComplete="current-password"
              className="nyptid-input pl-9"
              required
            />
          </div>
        </label>

        <button type="submit" disabled={loading} className="nyptid-btn-primary w-full py-3">
          {loading ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Signing in...
            </>
          ) : (
            <>
              <LogIn size={16} />
              Sign In
            </>
          )}
        </button>

        <p className="text-sm text-surface-400 text-center">
          Don&apos;t have an account?{' '}
          <button
            type="button"
            onClick={() => navigate(`/signup${window.location.search || ''}`)}
            className="text-nyptid-200 hover:text-nyptid-100 font-semibold"
          >
            Create one free
          </button>
        </p>
      </form>
    </AuthShell>
  );
}

export function SignupPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setSuccess('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    const { error: signUpError } = await signUp(email.trim(), password);
    if (signUpError) {
      setError(signUpError.message || 'Sign up failed. Please try again.');
      setLoading(false);
      return;
    }

    const { data } = await supabase.auth.getSession();
    if (data.session) {
      const inviteCode = String(searchParams.get('invite') || consumePendingInviteCode() || '').trim();
      navigate(inviteCode ? `/invite/${encodeURIComponent(inviteCode)}` : '/onboarding');
      return;
    }

    setSuccess('Account created. Check your email to verify, then sign in.');
    setLoading(false);
  }

  return (
    <AuthShell title="Create account" subtitle="Start using NCore in under a minute.">
      <form className="space-y-4" onSubmit={handleSubmit}>
        {error && (
          <div className="rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2 text-sm text-red-200 flex items-start gap-2">
            <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {success && (
          <div className="rounded-lg border border-green-500/35 bg-green-500/10 px-3 py-2 text-sm text-green-200 flex items-start gap-2">
            <CheckCircle2 size={15} className="mt-0.5 flex-shrink-0" />
            <span>{success}</span>
          </div>
        )}

        <label className="block">
          <span className="text-sm text-surface-300">Email address</span>
          <div className="mt-1 relative">
            <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500" />
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              className="nyptid-input pl-9"
              required
            />
          </div>
        </label>

        <label className="block">
          <span className="text-sm text-surface-300">Password</span>
          <div className="mt-1 relative">
            <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500" />
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 8 characters"
              autoComplete="new-password"
              className="nyptid-input pl-9"
              required
            />
          </div>
        </label>

        <label className="block">
          <span className="text-sm text-surface-300">Confirm password</span>
          <div className="mt-1 relative">
            <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500" />
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Re-enter password"
              autoComplete="new-password"
              className="nyptid-input pl-9"
              required
            />
          </div>
        </label>

        <button type="submit" disabled={loading} className="nyptid-btn-primary w-full py-3">
          {loading ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Creating account...
            </>
          ) : (
            <>
              <UserPlus size={16} />
              Create Account
            </>
          )}
        </button>

        <p className="text-sm text-surface-400 text-center">
          Already have an account?{' '}
          <button
            type="button"
            onClick={() => navigate(`/login${window.location.search || ''}`)}
            className="text-nyptid-200 hover:text-nyptid-100 font-semibold"
          >
            Sign in
          </button>
        </p>
      </form>
    </AuthShell>
  );
}
