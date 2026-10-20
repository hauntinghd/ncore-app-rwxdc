import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, Gavel, ScrollText, ShieldAlert, Undo2 } from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import {
  clearTimeout as clearMemberTimeout,
  fetchAuditFeed,
  formatDuration,
  listActiveTimeouts,
  listBans,
  summarizeAuditEntry,
  unbanMember,
  type AuditEntry,
  type CommunityBan,
  type CommunityTimeout,
} from '../../lib/moderation';
import { formatRelativeTime } from '../../lib/utils';

interface ModerationSectionProps {
  communityId: string;
  /** Holds BAN_MEMBERS. Gates the ban list. */
  canBan: boolean;
  /** Holds MUTE_MEMBERS. Gates the timeout list. */
  canTimeout: boolean;
  /** Holds VIEW_AUDIT_LOG. Gates the audit feed. */
  canViewAudit: boolean;
}

type Tab = 'bans' | 'timeouts' | 'audit';

const AUDIT_PAGE_SIZE = 50;

/**
 * Moderation surface: who is banned, who is silenced, and a record of who did
 * what. The record is the point — a moderation tool without an audit trail
 * turns every disagreement about a past action into someone's word against
 * someone else's.
 */
export function ModerationSection({
  communityId,
  canBan,
  canTimeout,
  canViewAudit,
}: ModerationSectionProps) {
  const availableTabs = useMemo(() => {
    const tabs: Tab[] = [];
    if (canBan) tabs.push('bans');
    if (canTimeout) tabs.push('timeouts');
    if (canViewAudit) tabs.push('audit');
    return tabs;
  }, [canBan, canTimeout, canViewAudit]);

  const [tab, setTab] = useState<Tab>(availableTabs[0] ?? 'bans');
  const [bans, setBans] = useState<CommunityBan[]>([]);
  const [timeouts, setTimeouts] = useState<CommunityTimeout[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [auditExhausted, setAuditExhausted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [error, setError] = useState('');

  // A permission change can strip the tab out from under the user.
  useEffect(() => {
    if (availableTabs.length > 0 && !availableTabs.includes(tab)) {
      setTab(availableTabs[0]);
    }
  }, [availableTabs, tab]);

  const load = useCallback(async () => {
    if (!communityId) return;
    setLoading(true);
    setError('');
    try {
      if (tab === 'bans') {
        setBans(await listBans(communityId));
      } else if (tab === 'timeouts') {
        setTimeouts(await listActiveTimeouts(communityId));
      } else {
        const entries = await fetchAuditFeed(communityId, { limit: AUDIT_PAGE_SIZE });
        setAudit(entries);
        setAuditExhausted(entries.length < AUDIT_PAGE_SIZE);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load moderation data.');
    } finally {
      setLoading(false);
    }
  }, [communityId, tab]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadMoreAudit() {
    const oldest = audit[audit.length - 1];
    if (!oldest) return;
    setLoading(true);
    try {
      const older = await fetchAuditFeed(communityId, {
        limit: AUDIT_PAGE_SIZE,
        before: oldest.createdAt,
      });
      setAudit((current) => [...current, ...older]);
      if (older.length < AUDIT_PAGE_SIZE) setAuditExhausted(true);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load more entries.');
    } finally {
      setLoading(false);
    }
  }

  async function runAction(userId: string, action: () => Promise<void>) {
    setBusyUserId(userId);
    setError('');
    try {
      await action();
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'That action failed.');
    } finally {
      setBusyUserId(null);
    }
  }

  if (availableTabs.length === 0) return null;

  return (
    <div className="nyptid-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <ShieldAlert size={16} className="text-nyptid-300" />
        <h2 className="text-lg font-bold text-surface-100">Moderation</h2>
      </div>

      <div className="mb-4 flex flex-wrap gap-1 border-b border-surface-700">
        {availableTabs.map((candidate) => (
          <button
            key={candidate}
            type="button"
            onClick={() => setTab(candidate)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === candidate
                ? 'border-nyptid-300 text-nyptid-200'
                : 'border-transparent text-surface-400 hover:text-surface-200'
            }`}
          >
            {candidate === 'bans' && <Gavel size={14} />}
            {candidate === 'timeouts' && <Clock size={14} />}
            {candidate === 'audit' && <ScrollText size={14} />}
            {candidate === 'bans' ? 'Bans' : candidate === 'timeouts' ? 'Timeouts' : 'Audit Log'}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      {loading && audit.length === 0 && bans.length === 0 && timeouts.length === 0 ? (
        <div className="py-6 text-center text-sm text-surface-500">Loading…</div>
      ) : tab === 'bans' ? (
        <BanList bans={bans} busyUserId={busyUserId} onUnban={(userId) =>
          void runAction(userId, () => unbanMember(communityId, userId))
        } />
      ) : tab === 'timeouts' ? (
        <TimeoutList timeouts={timeouts} busyUserId={busyUserId} onClear={(userId) =>
          void runAction(userId, () => clearMemberTimeout(communityId, userId))
        } />
      ) : (
        <AuditList
          entries={audit}
          loading={loading}
          exhausted={auditExhausted}
          onLoadMore={() => void loadMoreAudit()}
        />
      )}
    </div>
  );
}

function BanList({
  bans,
  busyUserId,
  onUnban,
}: {
  bans: CommunityBan[];
  busyUserId: string | null;
  onUnban: (userId: string) => void;
}) {
  if (bans.length === 0) {
    return <div className="py-6 text-center text-sm text-surface-500">Nobody is banned.</div>;
  }

  return (
    <div className="space-y-1">
      {bans.map((ban) => (
        <div
          key={ban.userId}
          className="flex flex-wrap items-center gap-3 rounded-lg border border-surface-700/70 bg-surface-900/40 px-3 py-2.5"
        >
          <Avatar src={ban.avatarUrl} name={ban.displayName || ban.username} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-surface-200">
              {ban.displayName || ban.username}
              <span className="ml-1.5 text-xs text-surface-500">@{ban.username}</span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-surface-500">
              <span>
                {ban.bannedByUsername ? `by ${ban.bannedByUsername}` : 'by a former moderator'}
              </span>
              <span aria-hidden="true">·</span>
              <span>{formatRelativeTime(ban.createdAt)}</span>
              {ban.expiresAt && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-amber-300/80">lifts in {formatDuration(ban.expiresAt)}</span>
                </>
              )}
            </div>
            {ban.reason && (
              <div className="mt-1 truncate text-xs text-surface-400 italic">"{ban.reason}"</div>
            )}
          </div>
          <button
            type="button"
            onClick={() => onUnban(ban.userId)}
            disabled={busyUserId === ban.userId}
            className="nyptid-btn-secondary flex items-center gap-1.5 px-2.5 py-1 text-xs"
          >
            <Undo2 size={12} /> Unban
          </button>
        </div>
      ))}
    </div>
  );
}

function TimeoutList({
  timeouts,
  busyUserId,
  onClear,
}: {
  timeouts: CommunityTimeout[];
  busyUserId: string | null;
  onClear: (userId: string) => void;
}) {
  if (timeouts.length === 0) {
    return <div className="py-6 text-center text-sm text-surface-500">Nobody is timed out.</div>;
  }

  return (
    <div className="space-y-1">
      {timeouts.map((timeout) => (
        <div
          key={timeout.userId}
          className="flex flex-wrap items-center gap-3 rounded-lg border border-surface-700/70 bg-surface-900/40 px-3 py-2.5"
        >
          <Avatar src={timeout.avatarUrl} name={timeout.displayName || timeout.username} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-surface-200">
              {timeout.displayName || timeout.username}
              <span className="ml-1.5 text-xs text-surface-500">@{timeout.username}</span>
            </div>
            <div className="mt-0.5 text-xs text-amber-300/80">
              {formatDuration(timeout.timedOutUntil)} remaining
            </div>
            {timeout.reason && (
              <div className="mt-1 truncate text-xs text-surface-400 italic">"{timeout.reason}"</div>
            )}
          </div>
          <button
            type="button"
            onClick={() => onClear(timeout.userId)}
            disabled={busyUserId === timeout.userId}
            className="nyptid-btn-secondary px-2.5 py-1 text-xs"
          >
            Lift
          </button>
        </div>
      ))}
    </div>
  );
}

function AuditList({
  entries,
  loading,
  exhausted,
  onLoadMore,
}: {
  entries: AuditEntry[];
  loading: boolean;
  exhausted: boolean;
  onLoadMore: () => void;
}) {
  if (entries.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-surface-500">
        No recorded actions yet.
      </div>
    );
  }

  return (
    <div>
      <div className="space-y-0.5">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="flex items-start gap-2.5 rounded-lg px-2 py-2 hover:bg-surface-800/40"
          >
            <Avatar src={entry.actorAvatarUrl} name={entry.actorUsername || '?'} size="xs" />
            <div className="min-w-0 flex-1">
              <div className="text-sm break-words text-surface-300">
                {summarizeAuditEntry(entry)}
              </div>
              <div className="text-xs text-surface-600">{formatRelativeTime(entry.createdAt)}</div>
            </div>
          </div>
        ))}
      </div>

      {!exhausted && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loading}
          className="nyptid-btn-secondary mt-3 w-full py-1.5 text-xs"
        >
          {loading ? 'Loading…' : 'Load older entries'}
        </button>
      )}
    </div>
  );
}
