import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, Loader2, ShieldAlert } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { LoadingScreen } from '../components/ui/Spinner';
import { supabase } from '../lib/supabase';
import { clearPendingInviteCode, storePendingInviteCode } from '../lib/inviteLinks';

export function InvitePage() {
  const { inviteCode = '' } = useParams();
  const navigate = useNavigate();
  const { user, profile, loading, profileLoading } = useAuth();
  const [state, setState] = useState<'working' | 'done' | 'error'>('working');
  const [message, setMessage] = useState('Resolving your NCore invite...');

  const normalizedCode = String(inviteCode || '').trim();

  useEffect(() => {
    if (!normalizedCode) return;
    storePendingInviteCode(normalizedCode);
  }, [normalizedCode]);

  useEffect(() => {
    if (!normalizedCode || loading || profileLoading || !user || !profile?.username) return;

    let cancelled = false;

    async function resolveInvite() {
      setState('working');
      setMessage('Checking invite status...');

      const { data: inviteRow, error: inviteError } = await supabase
        .from('community_invites')
        .select('community_id, code, expires_at')
        .eq('code', normalizedCode)
        .maybeSingle();

      if (cancelled) return;

      if (inviteError || !(inviteRow as any)?.community_id) {
        setState('error');
        setMessage(inviteError?.message || 'This invite link is invalid or no longer available.');
        return;
      }

      const communityId = String((inviteRow as any).community_id || '').trim();
      if (!communityId) {
        setState('error');
        setMessage('This invite does not point to a valid server.');
        return;
      }

      setMessage('Joining server...');

      const { error: joinError } = await supabase.rpc('join_community_with_invite', {
        p_code: normalizedCode,
        p_community_id: communityId,
      } as any);

      if (cancelled) return;

      const joinMessage = String(joinError?.message || '').toLowerCase();
      const canIgnoreJoinError = !joinError
        || joinMessage.includes('already')
        || joinMessage.includes('duplicate')
        || joinMessage.includes('unique');

      if (!canIgnoreJoinError) {
        setState('error');
        setMessage(joinError?.message || 'Join failed for this invite.');
        return;
      }

      clearPendingInviteCode();
      setState('done');
      setMessage('Invite accepted. Opening server...');
      window.setTimeout(() => {
        navigate(`/app/community/${communityId}?invite=${encodeURIComponent(normalizedCode)}`, { replace: true });
      }, 250);
    }

    void resolveInvite();
    return () => {
      cancelled = true;
    };
  }, [loading, navigate, normalizedCode, profile?.username, profileLoading, user]);

  if (!normalizedCode) {
    return <Navigate to="/" replace />;
  }

  if (loading || (user && profileLoading)) {
    return <LoadingScreen />;
  }

  if (!user) {
    return <Navigate to={`/login?invite=${encodeURIComponent(normalizedCode)}`} replace />;
  }

  if (user && !profile?.username) {
    return <Navigate to="/onboarding" replace />;
  }

  return (
    <div className="min-h-screen bg-surface-950 text-surface-100 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-grid pointer-events-none" />
      <div className="absolute inset-0 bg-hero-gradient pointer-events-none" />
      <div className="relative z-10 w-full max-w-lg rounded-[28px] border border-nyptid-300/20 bg-surface-900/92 p-8 shadow-2xl backdrop-blur">
        <div className="text-[11px] uppercase tracking-[0.28em] text-nyptid-200 font-bold">NCore Invite Link</div>
        <div className="mt-3 text-3xl font-black text-surface-100">Joining server</div>
        <div className="mt-2 text-sm text-surface-400">
          {state === 'error'
            ? 'The invite could not be completed.'
            : 'NCore is validating the invite and routing you into the correct server.'}
        </div>

        <div className={`mt-6 rounded-2xl border px-4 py-4 ${
          state === 'error'
            ? 'border-red-500/30 bg-red-500/10'
            : state === 'done'
              ? 'border-emerald-500/30 bg-emerald-500/10'
              : 'border-surface-700 bg-surface-950/70'
        }`}>
          <div className="flex items-start gap-3">
            {state === 'error' ? (
              <ShieldAlert size={18} className="mt-0.5 text-red-300" />
            ) : state === 'done' ? (
              <CheckCircle2 size={18} className="mt-0.5 text-emerald-300" />
            ) : (
              <Loader2 size={18} className="mt-0.5 animate-spin text-nyptid-200" />
            )}
            <div>
              <div className="text-sm font-semibold text-surface-100">{message}</div>
              <div className="mt-1 text-xs text-surface-500">Invite code: {normalizedCode}</div>
            </div>
          </div>
        </div>

        {state === 'error' && (
          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={() => navigate('/app/discover', { replace: true })}
              className="nyptid-btn-secondary flex-1"
            >
              Open Discover
            </button>
            <button
              type="button"
              onClick={() => navigate('/app/dm', { replace: true })}
              className="nyptid-btn-primary flex-1"
            >
              Go to Inbox
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
