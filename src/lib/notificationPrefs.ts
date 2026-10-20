/**
 * Notification preferences — client surface.
 *
 * `notification_preferences` has existed since `20260522210000_mobile_push.sql`
 * and nothing read or wrote it, so there was no mute in the product at all.
 * Resolution logic lives in `20260730130000_notification_preferences_surface.sql`.
 *
 * Precedence, most specific first: channel/dm → community → global → 'all'.
 */
import { supabase } from './supabase';

export type NotificationMode = 'all' | 'mentions' | 'none';
export type NotificationScopeKind = 'dm' | 'channel' | 'community' | 'global';

export interface NotificationPreference {
  scopeKind: NotificationScopeKind;
  scopeId: string | null;
  mode: NotificationMode;
  mutedUntil: string | null;
}

/** Temporary-mute durations, in minutes. `null` means "until I turn it back on". */
export const MUTE_DURATIONS: Array<{ label: string; minutes: number | null }> = [
  { label: 'For 15 minutes', minutes: 15 },
  { label: 'For 1 hour', minutes: 60 },
  { label: 'For 8 hours', minutes: 480 },
  { label: 'For 24 hours', minutes: 1440 },
  { label: 'Until I turn it back on', minutes: null },
];

export const MODE_LABELS: Record<NotificationMode, string> = {
  all: 'All messages',
  mentions: 'Only @mentions',
  none: 'Nothing',
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

interface PreferenceRow {
  scope_kind: string;
  scope_id: string | null;
  mode: string;
  muted_until: string | null;
}

function rowToPreference(row: PreferenceRow): NotificationPreference {
  const scopeKind: NotificationScopeKind = ['dm', 'channel', 'community', 'global'].includes(
    row.scope_kind,
  )
    ? (row.scope_kind as NotificationScopeKind)
    : 'global';
  const mode: NotificationMode = ['all', 'mentions', 'none'].includes(row.mode)
    ? (row.mode as NotificationMode)
    : 'all';
  return { scopeKind, scopeId: row.scope_id, mode, mutedUntil: row.muted_until };
}

/** Every scope the user has moved off the default. */
export async function fetchMutedScopes(): Promise<NotificationPreference[]> {
  const { data, error } = await supabase.rpc('user_muted_scopes');
  if (error) return [];
  return ((data ?? []) as PreferenceRow[]).map(rowToPreference);
}

/** Effective mode for a single channel, resolved server-side. */
export async function resolveChannelMode(
  channelId: string,
  communityId: string | null,
): Promise<NotificationMode> {
  const { data, error } = await supabase.rpc('resolve_channel_notification_mode', {
    p_channel_id: channelId,
    p_community_id: communityId,
  });
  if (error) throw error;
  const mode = String(data ?? 'all');
  return ['all', 'mentions', 'none'].includes(mode) ? (mode as NotificationMode) : 'all';
}

interface ChannelModeRow {
  channel_id: string;
  mode: string;
}

/** Effective mode for every channel in a community, in one round trip. */
export async function fetchCommunityModes(
  communityId: string,
): Promise<Record<string, NotificationMode>> {
  const { data, error } = await supabase.rpc('community_notification_modes', {
    p_community_id: communityId,
  });
  if (error) return {};

  const modes: Record<string, NotificationMode> = {};
  for (const row of (data ?? []) as ChannelModeRow[]) {
    const mode: NotificationMode = ['all', 'mentions', 'none'].includes(row.mode)
      ? (row.mode as NotificationMode)
      : 'all';
    // Only overrides are worth carrying; 'all' is the default everywhere.
    if (mode !== 'all') modes[String(row.channel_id)] = mode;
  }
  return modes;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

interface SetPreferenceArgs {
  scopeKind: NotificationScopeKind;
  scopeId: string | null;
  mode?: NotificationMode;
  /** Minutes from now, or null for an indefinite mute. Omit for no timed mute. */
  muteMinutes?: number | null;
}

export async function setNotificationPreference(args: SetPreferenceArgs): Promise<void> {
  const mutedUntil =
    args.muteMinutes === undefined || args.muteMinutes === null
      ? null
      : new Date(Date.now() + args.muteMinutes * 60_000).toISOString();

  const { error } = await supabase.rpc('set_notification_preference', {
    p_scope_kind: args.scopeKind,
    p_scope_id: args.scopeId,
    p_mode: args.mode ?? 'all',
    p_muted_until: mutedUntil,
  });
  if (error) throw error;
}

/**
 * Mutes a scope. `minutes === null` is an indefinite mute, stored as mode
 * 'none' rather than a far-future timestamp so "muted" and "muted until 2099"
 * do not become two ways of saying the same thing.
 */
export async function muteScope(
  scopeKind: NotificationScopeKind,
  scopeId: string | null,
  minutes: number | null,
): Promise<void> {
  if (minutes === null) {
    await setNotificationPreference({ scopeKind, scopeId, mode: 'none' });
    return;
  }
  await setNotificationPreference({ scopeKind, scopeId, mode: 'all', muteMinutes: minutes });
}

/** Clears any override, returning the scope to the default. */
export async function unmuteScope(
  scopeKind: NotificationScopeKind,
  scopeId: string | null,
): Promise<void> {
  await setNotificationPreference({ scopeKind, scopeId, mode: 'all' });
}

// ---------------------------------------------------------------------------
// Resolution helpers
// ---------------------------------------------------------------------------

/**
 * Client-side mirror of `resolve_channel_notification_mode`, for when the
 * caller already holds the preference list and a round trip would be silly.
 */
export function resolveMode(
  preferences: readonly NotificationPreference[],
  channelId: string | null,
  communityId: string | null,
): NotificationMode {
  const order: Array<[NotificationScopeKind, string | null]> = [
    ['channel', channelId],
    ['dm', channelId],
    ['community', communityId],
    ['global', null],
  ];

  for (const [kind, id] of order) {
    if (kind !== 'global' && !id) continue;
    const match = preferences.find(
      (preference) => preference.scopeKind === kind && preference.scopeId === id,
    );
    if (!match) continue;

    if (match.mutedUntil && new Date(match.mutedUntil).getTime() > Date.now()) return 'none';
    return match.mode;
  }

  return 'all';
}

/** Whether a mode should suppress the plain unread indicator. */
export function suppressesUnread(mode: NotificationMode): boolean {
  return mode !== 'all';
}

/**
 * Whether a mode should suppress a mention badge.
 *
 * Only 'none' does. Muting a busy server exists so you can stay in it without
 * watching it — swallowing a direct ping as well would make mute unusable, and
 * people would leave the server instead.
 */
export function suppressesMentions(mode: NotificationMode): boolean {
  return mode === 'none';
}

/** "muted for 42 minutes" / "muted" — for the menu's current-state line. */
export function describeMute(preference: NotificationPreference | null): string {
  if (!preference) return '';
  if (preference.mutedUntil) {
    const remaining = new Date(preference.mutedUntil).getTime() - Date.now();
    if (remaining <= 0) return '';
    const minutes = Math.round(remaining / 60_000);
    if (minutes < 60) return `Muted for ${minutes} more minute${minutes === 1 ? '' : 's'}`;
    const hours = Math.round(minutes / 60);
    return `Muted for ${hours} more hour${hours === 1 ? '' : 's'}`;
  }
  if (preference.mode === 'none') return 'Muted';
  if (preference.mode === 'mentions') return 'Only @mentions';
  return '';
}
