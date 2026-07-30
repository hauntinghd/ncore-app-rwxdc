import { useCallback, useEffect, useState } from 'react';
import { BellOff, Hash, Users } from 'lucide-react';
import {
  MODE_LABELS,
  describeMute,
  fetchMutedScopes,
  unmuteScope,
  type NotificationPreference,
} from '../../lib/notificationPrefs';
import { supabase } from '../../lib/supabase';

/**
 * Everything the user has muted, in one place.
 *
 * Mute is easy to set from a channel and then impossible to find again — six
 * months later you are wondering why a server is silent. This is the list that
 * answers that.
 */
export function MutedScopesSection() {
  const [scopes, setScopes] = useState<NotificationPreference[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const loaded = await fetchMutedScopes();
      setScopes(loaded);
      setNames(await resolveScopeNames(loaded));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function clear(scope: NotificationPreference) {
    const key = scopeKey(scope);
    setBusyKey(key);
    try {
      await unmuteScope(scope.scopeKind, scope.scopeId);
      await load();
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="nyptid-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <BellOff size={16} className="text-nyptid-300" />
        <h2 className="text-lg font-bold text-surface-100">Muted Channels & Servers</h2>
      </div>

      <p className="mb-4 text-sm text-surface-400">
        Notification settings follow your account, so a channel you mute here is muted everywhere
        you sign in.
      </p>

      {loading ? (
        <div className="py-6 text-center text-sm text-surface-500">Loading…</div>
      ) : scopes.length === 0 ? (
        <div className="py-6 text-center text-sm text-surface-500">
          Nothing is muted right now.
        </div>
      ) : (
        <div className="space-y-1">
          {scopes.map((scope) => {
            const key = scopeKey(scope);
            const label = names[key] || defaultScopeLabel(scope);
            const detail = describeMute(scope) || MODE_LABELS[scope.mode];

            return (
              <div
                key={key}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-surface-700/70 bg-surface-900/40 px-3 py-2.5"
              >
                {scope.scopeKind === 'community' ? (
                  <Users size={14} className="flex-shrink-0 text-surface-500" />
                ) : (
                  <Hash size={14} className="flex-shrink-0 text-surface-500" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-surface-200">{label}</div>
                  <div className="text-xs text-surface-500">{detail}</div>
                </div>
                <button
                  type="button"
                  onClick={() => void clear(scope)}
                  disabled={busyKey === key}
                  className="nyptid-btn-secondary px-2.5 py-1 text-xs"
                >
                  Reset
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function scopeKey(scope: NotificationPreference): string {
  return `${scope.scopeKind}:${scope.scopeId ?? 'global'}`;
}

function defaultScopeLabel(scope: NotificationPreference): string {
  if (scope.scopeKind === 'global') return 'Everything';
  if (scope.scopeKind === 'community') return 'A server you have left';
  if (scope.scopeKind === 'dm') return 'A conversation';
  return 'A deleted channel';
}

/**
 * Resolves channel and community names for the muted list.
 *
 * A muted scope can outlive the thing it points at — a channel gets deleted,
 * a server is left. Those rows still render, under a label that says so,
 * because a stale mute the user cannot see or clear is worse than a vague one.
 */
async function resolveScopeNames(
  scopes: readonly NotificationPreference[],
): Promise<Record<string, string>> {
  const channelIds = scopes
    .filter((scope) => scope.scopeKind === 'channel' && scope.scopeId)
    .map((scope) => scope.scopeId as string);
  const communityIds = scopes
    .filter((scope) => scope.scopeKind === 'community' && scope.scopeId)
    .map((scope) => scope.scopeId as string);

  const names: Record<string, string> = {};

  if (channelIds.length > 0) {
    const { data } = await supabase.from('channels').select('id, name').in('id', channelIds);
    for (const row of (data ?? []) as Array<{ id: string; name: string }>) {
      names[`channel:${row.id}`] = `#${row.name}`;
    }
  }

  if (communityIds.length > 0) {
    const { data } = await supabase.from('communities').select('id, name').in('id', communityIds);
    for (const row of (data ?? []) as Array<{ id: string; name: string }>) {
      names[`community:${row.id}`] = row.name;
    }
  }

  return names;
}
