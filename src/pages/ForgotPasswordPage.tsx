import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CheckCircle2, KeyRound, Loader2, Mail } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { AuthShell } from './AuthPage';
import { supabase } from '../lib/supabase';

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const { sendPasswordResetEmail } = useAuth();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [codeEntry, setCodeEntry] = useState(false);
  const [code, setCode] = useState('');

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);

    const { error: resetError } = await sendPasswordResetEmail(email.trim());
    setLoading(false);
    if (resetError) {
      setError(resetError.message || 'Could not send reset email. Try again.');
      return;
    }
    setSent(true);
  }

  async function handleCodeSubmit(event: React.FormEvent) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^\d{8}$/.test(code.trim())) {
      setError('Enter the 8-digit code from the reset email.');
      return;
    }
    setError('');
    setVerifying(true);
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: normalizedEmail,
      token: code.trim(),
      type: 'recovery',
    });
    setVerifying(false);
    if (verifyError) {
      setError(verifyError.message || 'That code is invalid or has expired.');
      return;
    }
    navigate('/reset-password', { replace: true });
  }

  return (
    <AuthShell title="Reset your password" subtitle={sent || codeEntry ? 'Enter the 8-digit code we sent to your email.' : 'We’ll email you an 8-digit code to reset your password.'}>
      <form className="space-y-4" onSubmit={sent || codeEntry ? handleCodeSubmit : handleSubmit}>
        {error && (
          <div className="rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2 text-sm text-red-200 flex items-start gap-2">
            <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {sent && (
          <div className="rounded-lg border border-green-500/35 bg-green-500/10 px-3 py-2 text-sm text-green-200 flex items-start gap-2">
            <CheckCircle2 size={15} className="mt-0.5 flex-shrink-0" />
            <span>
              If an account exists for <strong>{email}</strong>, an 8-digit reset code is on its way. Check your inbox (and spam), then enter it below.
            </span>
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
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="nyptid-input pl-9"
              required
              disabled={sent}
            />
          </div>
        </label>

        {(sent || codeEntry) && (
          <label className="block">
            <span className="text-sm text-surface-300">Reset code</span>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 8))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="00000000"
              className="nyptid-input mt-1 text-center text-xl tracking-[0.45em] font-mono"
              required
              autoFocus
            />
          </label>
        )}

        <button type="submit" disabled={loading || verifying} className="nyptid-btn-primary w-full py-3">
          {loading ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Sending reset code...
            </>
          ) : verifying ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Verifying code...
            </>
          ) : sent || codeEntry ? (
            <><KeyRound size={16} /> Verify reset code</>
          ) : (
            <>
              <KeyRound size={16} />
              Send Reset Code
            </>
          )}
        </button>

        {!sent && !codeEntry && (
          <button
            type="button"
            onClick={() => { setCodeEntry(true); setError(''); }}
            className="w-full text-sm text-nyptid-200 hover:text-nyptid-100"
          >
            I already have a reset code
          </button>
        )}

        <button
          type="button"
          onClick={() => navigate('/login')}
          className="w-full text-sm text-surface-300 hover:text-surface-100 inline-flex items-center justify-center gap-2 py-2"
        >
          <ArrowLeft size={14} />
          Back to sign in
        </button>
      </form>
    </AuthShell>
  );
}
