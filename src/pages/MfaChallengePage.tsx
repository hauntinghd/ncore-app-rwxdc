import { useEffect, useState } from 'react';
import { AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AuthShell } from './AuthPage';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

interface LocationState {
  from?: { pathname?: string; search?: string; hash?: string };
}

/** Completes the second factor required by a previously enrolled TOTP factor. */
export function MfaChallengePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut, refreshMfaState } = useAuth();
  const [factorId, setFactorId] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const destination = (() => {
    const state = location.state as LocationState | null;
    const from = state?.from;
    if (!from?.pathname || from.pathname === '/mfa') return '/app/dm';
    return `${from.pathname}${from.search || ''}${from.hash || ''}`;
  })();

  useEffect(() => {
    let cancelled = false;
    async function loadFactor() {
      const { data, error: factorsError } = await supabase.auth.mfa.listFactors();
      const factor = data?.totp?.find((item) => item.status === 'verified') || data?.totp?.[0];
      if (cancelled) return;
      if (factorsError || !factor) {
        setError('No verified authenticator app is available for this account.');
      } else {
        setFactorId(factor.id);
      }
      setLoading(false);
    }
    void loadFactor();
    return () => { cancelled = true; };
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!factorId || code.trim().length !== 6) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setSubmitting(true);
    setError('');
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeError || !challenge) {
      setError(challengeError?.message || 'Could not start the security check. Try again.');
      setSubmitting(false);
      return;
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: code.trim(),
    });
    if (verifyError) {
      setError(verifyError.message || 'That code was not accepted.');
      setSubmitting(false);
      return;
    }
    await refreshMfaState();
    navigate(destination, { replace: true });
  }

  return (
    <AuthShell title="Verify it’s you" subtitle="Open your authenticator app and enter the current 6-digit code.">
      {loading ? (
        <div className="flex items-center justify-center py-8 text-surface-400"><Loader2 className="animate-spin" size={20} /></div>
      ) : (
        <form className="space-y-5" onSubmit={handleSubmit}>
          {error && (
            <div className="rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2 text-sm text-red-200 flex items-start gap-2">
              <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <div className="rounded-xl border border-nyptid-500/25 bg-nyptid-500/10 p-4 flex gap-3 text-sm text-surface-200">
            <ShieldCheck className="mt-0.5 text-nyptid-200 flex-shrink-0" size={19} />
            <span>This extra step protects your account even if someone knows your password.</span>
          </div>
          <label className="block">
            <span className="text-sm text-surface-300">Authenticator code</span>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              className="nyptid-input mt-1 text-center text-xl tracking-[0.45em] font-mono"
              placeholder="000000"
              disabled={!factorId || submitting}
              autoFocus
            />
          </label>
          <button type="submit" disabled={!factorId || submitting} className="nyptid-btn-primary w-full py-3">
            {submitting ? <><Loader2 size={16} className="animate-spin" /> Verifying…</> : <><ShieldCheck size={16} /> Verify and continue</>}
          </button>
          <button
            type="button"
            onClick={() => void signOut().then(() => navigate('/login', { replace: true }))}
            className="w-full text-sm text-surface-400 hover:text-surface-100"
          >
            Use a different account
          </button>
        </form>
      )}
    </AuthShell>
  );
}
