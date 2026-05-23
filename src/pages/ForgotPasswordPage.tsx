import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CheckCircle2, KeyRound, Loader2, Mail } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { AuthShell } from './AuthPage';

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const { sendPasswordResetEmail } = useAuth();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

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

  return (
    <AuthShell title="Reset your password" subtitle="We'll email you a secure link to set a new password.">
      <form className="space-y-4" onSubmit={handleSubmit}>
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
              If an account exists for <strong>{email}</strong>, a reset link is on its way. Check your inbox (and spam).
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
            />
          </div>
        </label>

        <button type="submit" disabled={loading || sent} className="nyptid-btn-primary w-full py-3">
          {loading ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Sending reset link...
            </>
          ) : sent ? (
            <>
              <CheckCircle2 size={16} />
              Sent
            </>
          ) : (
            <>
              <KeyRound size={16} />
              Send Reset Link
            </>
          )}
        </button>

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
