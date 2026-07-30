import { useState } from 'react';
import { Ban, Clock, ShieldAlert, UserMinus } from 'lucide-react';
import { Modal } from '../ui/Modal';
import {
  BAN_CLEANUP_PRESETS,
  TIMEOUT_PRESETS,
  banMember,
  kickMember,
  timeoutMember,
} from '../../lib/moderation';

interface MemberModerationMenuProps {
  communityId: string;
  userId: string;
  memberName: string;
  canKick: boolean;
  canBan: boolean;
  canTimeout: boolean;
  /** Called after a successful action so the caller can refresh its list. */
  onActionComplete: () => void;
}

type Action = 'timeout' | 'kick' | 'ban';

/**
 * Per-member moderation actions.
 *
 * Timeout is listed first and defaults to a short duration, because it is
 * almost always the proportionate response — the argument needs to cool off,
 * not the person to be evicted. Ban is last and asks for confirmation of what
 * it will delete.
 */
export function MemberModerationMenu({
  communityId,
  userId,
  memberName,
  canKick,
  canBan,
  canTimeout,
  onActionComplete,
}: MemberModerationMenuProps) {
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState('');
  const [minutes, setMinutes] = useState(TIMEOUT_PRESETS[1].minutes);
  const [cleanupHours, setCleanupHours] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!canKick && !canBan && !canTimeout) return null;

  function open(next: Action) {
    setAction(next);
    setReason('');
    setError('');
    setCleanupHours(0);
    setMinutes(TIMEOUT_PRESETS[1].minutes);
  }

  async function submit() {
    if (!action) return;
    setBusy(true);
    setError('');
    try {
      if (action === 'timeout') {
        await timeoutMember(communityId, userId, minutes, reason);
      } else if (action === 'kick') {
        await kickMember(communityId, userId, reason);
      } else {
        await banMember({
          communityId,
          userId,
          reason,
          deleteMessageHours: cleanupHours,
        });
      }
      setAction(null);
      onActionComplete();
    } catch (submitError) {
      // The server refuses on both permission and role hierarchy, and its
      // message says which — surface it rather than a generic failure.
      setError(submitError instanceof Error ? submitError.message : 'That action failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-1">
        {canTimeout && (
          <button
            type="button"
            onClick={() => open('timeout')}
            title={`Time out ${memberName}`}
            className="nyptid-btn-secondary flex items-center gap-1 px-2 py-1.5 text-xs"
          >
            <Clock size={12} /> Timeout
          </button>
        )}
        {canKick && (
          <button
            type="button"
            onClick={() => open('kick')}
            title={`Kick ${memberName}`}
            className="nyptid-btn-secondary flex items-center gap-1 px-2 py-1.5 text-xs text-amber-200 hover:bg-amber-500/10"
          >
            <UserMinus size={12} /> Kick
          </button>
        )}
        {canBan && (
          <button
            type="button"
            onClick={() => open('ban')}
            title={`Ban ${memberName}`}
            className="nyptid-btn-secondary flex items-center gap-1 px-2 py-1.5 text-xs text-red-200 hover:bg-red-500/10"
          >
            <Ban size={12} /> Ban
          </button>
        )}
      </div>

      <Modal
        isOpen={action !== null}
        onClose={() => !busy && setAction(null)}
        title={
          action === 'timeout'
            ? `Time out ${memberName}`
            : action === 'kick'
              ? `Kick ${memberName}`
              : `Ban ${memberName}`
        }
        size="md"
      >
        <div className="space-y-4">
          {action === 'timeout' && (
            <>
              <p className="text-sm text-surface-400">
                {memberName} stays in the server but cannot send messages until the timeout
                expires. They can still read.
              </p>
              <div>
                <label htmlFor="timeout-duration" className="mb-1.5 block text-xs font-semibold text-surface-400">
                  Duration
                </label>
                <select
                  id="timeout-duration"
                  value={minutes}
                  onChange={(event) => setMinutes(Number(event.target.value))}
                  className="nyptid-input w-full text-sm"
                >
                  {TIMEOUT_PRESETS.map((preset) => (
                    <option key={preset.minutes} value={preset.minutes}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {action === 'kick' && (
            <p className="text-sm text-surface-400">
              {memberName} is removed from the server. Nothing stops them rejoining with a new
              invite — use a ban if that is the intent.
            </p>
          )}

          {action === 'ban' && (
            <>
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {memberName} is removed and cannot rejoin this server.
              </div>
              <div>
                <label htmlFor="ban-cleanup" className="mb-1.5 block text-xs font-semibold text-surface-400">
                  Delete their recent messages
                </label>
                <select
                  id="ban-cleanup"
                  value={cleanupHours}
                  onChange={(event) => setCleanupHours(Number(event.target.value))}
                  className="nyptid-input w-full text-sm"
                >
                  {BAN_CLEANUP_PRESETS.map((preset) => (
                    <option key={preset.hours} value={preset.hours}>
                      {preset.label}
                    </option>
                  ))}
                </select>
                {cleanupHours > 0 && (
                  <p className="mt-1.5 text-xs text-amber-300/80">
                    This permanently deletes their messages from that window across every channel.
                    It cannot be undone.
                  </p>
                )}
              </div>
            </>
          )}

          <div>
            <label htmlFor="moderation-reason" className="mb-1.5 block text-xs font-semibold text-surface-400">
              Reason <span className="font-normal text-surface-600">(recorded in the audit log)</span>
            </label>
            <input
              id="moderation-reason"
              type="text"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={300}
              placeholder="Optional, but future-you will want it"
              className="nyptid-input w-full text-sm"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-surface-700 pt-3">
            <button
              type="button"
              onClick={() => setAction(null)}
              disabled={busy}
              className="nyptid-btn-secondary text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy}
              className={`text-sm ${
                action === 'ban' ? 'nyptid-btn-secondary text-red-200 hover:bg-red-500/15' : 'nyptid-btn-primary'
              }`}
            >
              <ShieldAlert size={13} className="mr-1 inline" />
              {busy
                ? 'Working…'
                : action === 'timeout'
                  ? 'Apply timeout'
                  : action === 'kick'
                    ? 'Kick'
                    : 'Ban'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
