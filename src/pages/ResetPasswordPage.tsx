import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, KeyRound, Loader2, Lock } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { AuthShell } from './AuthPage';

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const { updatePassword } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sessionReady, setSessionReady] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [done, setDone] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSessionReady(data.session ? 'ready' : 'missing');
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        setSessionReady('ready');
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    const { error: updateError } = await updatePassword(password);
    setLoading(false);

    if (updateError) {
      setError(updateError.message || 'Could not update password.');
      return;
    }
    setDone(true);
    setTimeout(() => navigate('/app/dm', { replace: true }), 1400);
  }

  if (sessionReady === 'loading') {
    return (
      <AuthShell title="Set a new password" subtitle="Verifying your reset link...">
        <div className="flex items-center justify-center py-10 text-surface-300">
          <Loader2 size={20} className="animate-spin" />
        </div>
      </AuthShell>
    );
  }

  if (sessionReady === 'missing') {
    return (
      <AuthShell title="Reset link expired" subtitle="This reset link is no longer valid.">
        <div className="space-y-4">
          <div className="rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2 text-sm text-red-200 flex items-start gap-2">
            <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
            <span>
              Reset links expire after a short time or can only be used once. Request a fresh one and try again.
            </span>
          </div>
          <button
            type="button"
            onClick={() => navigate('/forgot-password')}
            className="nyptid-btn-primary w-full py-3"
          >
            <KeyRound size={16} />
            Request a new link
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Set a new password" subtitle="Pick something you'll remember.">
      <form className="space-y-4" onSubmit={handleSubmit}>
        {error && (
          <div className="rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2 text-sm text-red-200 flex items-start gap-2">
            <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {done && (
          <div className="rounded-lg border border-green-500/35 bg-green-500/10 px-3 py-2 text-sm text-green-200 flex items-start gap-2">
            <CheckCircle2 size={15} className="mt-0.5 flex-shrink-0" />
            <span>Password updated. Redirecting you to NCore...</span>
          </div>
        )}

        <label className="block">
          <span className="text-sm text-surface-300">New password</span>
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
              minLength={8}
            />
          </div>
        </label>

        <label className="block">
          <span className="text-sm text-surface-300">Confirm new password</span>
          <div className="mt-1 relative">
            <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500" />
            <input
              type="password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              placeholder="Re-enter password"
              autoComplete="new-password"
              className="nyptid-input pl-9"
              required
              minLength={8}
            />
          </div>
        </label>

        <button type="submit" disabled={loading || done} className="nyptid-btn-primary w-full py-3">
          {loading ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Updating...
            </>
          ) : done ? (
            <>
              <CheckCircle2 size={16} />
              Done
            </>
          ) : (
            <>
              <KeyRound size={16} />
              Set New Password
            </>
          )}
        </button>
      </form>
    </AuthShell>
  );
}
