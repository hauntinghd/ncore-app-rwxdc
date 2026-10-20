import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { computeSafetyNumber, fetchPeerFingerprint } from '../../lib/crypto/deviceManagement';
import { getCachedIdentity, isE2EEnabled } from '../../lib/crypto/e2eManager';

interface SafetyNumberBadgeProps {
  /** The other participant. Group conversations have no single peer, so the
   *  badge hides itself rather than implying a verification it cannot do. */
  peerUserId: string | null;
  peerName: string;
}

const VERIFIED_KEY_PREFIX = 'ncore.e2e.verified.';

function readVerified(peerUserId: string): string | null {
  try {
    return window.localStorage.getItem(`${VERIFIED_KEY_PREFIX}${peerUserId}`);
  } catch {
    return null;
  }
}

function writeVerified(peerUserId: string, safetyNumber: string) {
  try {
    window.localStorage.setItem(`${VERIFIED_KEY_PREFIX}${peerUserId}`, safetyNumber);
  } catch {
    // Non-fatal: verification is an aid, not a gate.
  }
}

/**
 * Shows the safety number for a one-to-one encrypted conversation, so two
 * people can confirm out-of-band that no one is sitting in the middle.
 *
 * If a previously verified peer's number changes, that is surfaced loudly —
 * it means they reinstalled, added a device, or someone swapped their key.
 */
export function SafetyNumberBadge({ peerUserId, peerName }: SafetyNumberBadgeProps) {
  const [open, setOpen] = useState(false);
  const [safetyNumber, setSafetyNumber] = useState('');
  const [verified, setVerified] = useState(false);
  const [changed, setChanged] = useState(false);
  const [loading, setLoading] = useState(false);

  const identity = getCachedIdentity();

  const load = useCallback(async () => {
    if (!peerUserId || !identity?.fingerprint) return;
    setLoading(true);
    try {
      const peerFingerprint = await fetchPeerFingerprint(peerUserId);
      if (!peerFingerprint) {
        setSafetyNumber('');
        return;
      }
      const next = await computeSafetyNumber(identity.fingerprint, peerFingerprint);
      setSafetyNumber(next);

      const stored = readVerified(peerUserId);

      setVerified(Boolean(stored) && stored === next);
      setChanged(Boolean(stored) && stored !== next);
    } catch {
      setSafetyNumber('');
    } finally {
      setLoading(false);
    }
  }, [peerUserId, identity?.fingerprint]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!isE2EEnabled() || !peerUserId || !identity) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={
          changed
            ? 'Safety number changed — re-verify'
            : verified
              ? 'Encrypted and verified'
              : 'Encrypted — tap to verify'
        }
        aria-label="View safety number"
        className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
          changed
            ? 'text-amber-300 hover:bg-amber-500/10'
            : verified
              ? 'text-green-300 hover:bg-green-500/10'
              : 'text-surface-400 hover:bg-surface-700 hover:text-surface-200'
        }`}
      >
        <ShieldCheck size={16} />
      </button>

      <Modal isOpen={open} onClose={() => setOpen(false)} title="Verify safety number" size="md">
        <div className="space-y-4">
          {changed && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              This safety number has changed since you last verified it. That usually means{' '}
              {peerName} reinstalled or added a device — but it can also mean someone is
              intercepting. Confirm the new number with them before sharing anything sensitive.
            </div>
          )}

          <p className="text-sm text-surface-400">
            Compare this number with {peerName} over a channel you both trust — in person, or on a
            call. If it matches on both sides, your conversation is encrypted end to end with no
            one in the middle.
          </p>

          {loading ? (
            <div className="py-6 text-center text-sm text-surface-500">Computing…</div>
          ) : safetyNumber ? (
            <div className="rounded-xl border border-surface-700 bg-surface-950 p-4">
              <div className="grid grid-cols-3 gap-x-6 gap-y-2 text-center font-mono text-base tracking-wider text-surface-200">
                {safetyNumber.split(' ').map((group, index) => (
                  <span key={index}>{group}</span>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-surface-700 bg-surface-900/50 px-3 py-2 text-sm text-surface-400">
              {peerName} has not published an encryption key yet, so there is nothing to verify.
              This happens before their client has opened an encrypted conversation.
            </div>
          )}

          {safetyNumber && (
            <div className="flex justify-end gap-2">
              {verified ? (
                <span className="inline-flex items-center gap-1.5 text-sm text-green-300">
                  <ShieldCheck size={15} /> Marked verified
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    writeVerified(peerUserId, safetyNumber);
                    setVerified(true);
                    setChanged(false);
                  }}
                  className="nyptid-btn-primary text-sm"
                >
                  Mark as verified
                </button>
              )}
            </div>
          )}

          <p className="border-t border-surface-700 pt-3 text-xs text-surface-600">
            Verification is recorded on this device only. It is a check you perform, not a promise
            NCore makes on your behalf.
          </p>
        </div>
      </Modal>
    </>
  );
}
