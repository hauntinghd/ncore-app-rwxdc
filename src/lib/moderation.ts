/**
 * Community moderation — client surface.
 *
 * Schema and enforcement live in `20260730110000_moderation.sql`. Every write
 * here is a thin wrapper over a SECURITY DEFINER RPC that re-checks the
 * permission bit *and* the role hierarchy, so nothing in this file is load
 * bearing for authorization — it decides what to show, not what is allowed.
 */
import { supabase } from './supabase';

export interface CommunityBan {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  bannedBy: string | null;
  bannedByUsername: string | null;
  reason: string;
  expiresAt: string | null;
  createdAt: string;
}

export interface CommunityTimeout {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  timedOutUntil: string;
  timedOutBy: string | null;
  reason: string;
}

export interface AuditEntry {
  id: string;
  actorId: string | null;
  actorUsername: string | null;
  actorAvatarUrl: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetUsername: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

/** Timeout presets, matching the durations people actually reach for. */
export const TIMEOUT_PRESETS: Array<{ label: string; minutes: number }> = [
  { label: '60 seconds', minutes: 1 },
  { label: '5 minutes', minutes: 5 },
  { label: '10 minutes', minutes: 10 },
  { label: '1 hour', minutes: 60 },
  { label: '1 day', minutes: 1440 },
  { label: '1 week', minutes: 10080 },
];

/** How much of a banned member's recent history to remove, in hours. */
export const BAN_CLEANUP_PRESETS: Array<{ label: string; hours: number }> = [
  { label: "Don't delete any", hours: 0 },
  { label: 'Previous hour', hours: 1 },
  { label: 'Previous 6 hours', hours: 6 },
  { label: 'Previous 24 hours', hours: 24 },
  { label: 'Previous 7 days', hours: 168 },
];

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

interface BanRow {
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  banned_by: string | null;
  banned_by_username: string | null;
  reason: string | null;
  expires_at: string | null;
  created_at: string;
}

export async function listBans(communityId: string): Promise<CommunityBan[]> {
  const { data, error } = await supabase.rpc('community_ban_list', {
    p_community_id: communityId,
  });
  if (error) throw error;
  return ((data ?? []) as BanRow[]).map((row) => ({
    userId: row.user_id,
    username: row.username || 'deleted user',
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    bannedBy: row.banned_by,
    bannedByUsername: row.banned_by_username,
    reason: row.reason || '',
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }));
}

interface TimeoutRow {
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  timed_out_until: string;
  timed_out_by: string | null;
  timeout_reason: string | null;
}

export async function listActiveTimeouts(communityId: string): Promise<CommunityTimeout[]> {
  const { data, error } = await supabase.rpc('community_active_timeouts', {
    p_community_id: communityId,
  });
  if (error) throw error;
  return ((data ?? []) as TimeoutRow[]).map((row) => ({
    userId: row.user_id,
    username: row.username || 'deleted user',
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    timedOutUntil: row.timed_out_until,
    timedOutBy: row.timed_out_by,
    reason: row.timeout_reason || '',
  }));
}

interface AuditRow {
  id: string;
  actor_id: string | null;
  actor_username: string | null;
  actor_avatar_url: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  target_username: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export async function fetchAuditFeed(
  communityId: string,
  options: { limit?: number; before?: string | null } = {},
): Promise<AuditEntry[]> {
  const { data, error } = await supabase.rpc('community_audit_feed', {
    p_community_id: communityId,
    p_limit: options.limit ?? 50,
    p_before: options.before ?? null,
  });
  if (error) throw error;
  return ((data ?? []) as AuditRow[]).map((row) => ({
    id: row.id,
    actorId: row.actor_id,
    actorUsername: row.actor_username,
    actorAvatarUrl: row.actor_avatar_url,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    targetUsername: row.target_username,
    details: row.details ?? {},
    createdAt: row.created_at,
  }));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

interface BanArgs {
  communityId: string;
  userId: string;
  reason?: string;
  deleteMessageHours?: number;
  expiresAt?: string | null;
}

export async function banMember(args: BanArgs): Promise<void> {
  const { error } = await supabase.rpc('community_ban_member', {
    p_community_id: args.communityId,
    p_user_id: args.userId,
    p_reason: args.reason ?? '',
    p_delete_message_hours: args.deleteMessageHours ?? 0,
    p_expires_at: args.expiresAt ?? null,
  });
  if (error) throw error;
}

export async function unbanMember(communityId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('community_unban_member', {
    p_community_id: communityId,
    p_user_id: userId,
  });
  if (error) throw error;
}

export async function kickMember(
  communityId: string,
  userId: string,
  reason = '',
): Promise<void> {
  const { error } = await supabase.rpc('community_kick_member', {
    p_community_id: communityId,
    p_user_id: userId,
    p_reason: reason,
  });
  if (error) throw error;
}

/** Returns the timestamp the timeout runs until. */
export async function timeoutMember(
  communityId: string,
  userId: string,
  minutes: number,
  reason = '',
): Promise<string> {
  const { data, error } = await supabase.rpc('community_timeout_member', {
    p_community_id: communityId,
    p_user_id: userId,
    p_minutes: minutes,
    p_reason: reason,
  });
  if (error) throw error;
  return String(data ?? '');
}

export async function clearTimeout(communityId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('community_clear_timeout', {
    p_community_id: communityId,
    p_user_id: userId,
  });
  if (error) throw error;
}

/**
 * The position of a member's highest role, used to grey out actions the server
 * would refuse anyway. Purely cosmetic — `assert_can_moderate` is the real
 * check, and it runs regardless of what this returns.
 */
export async function fetchTopRolePosition(
  communityId: string,
  userId: string,
): Promise<number> {
  const { data, error } = await supabase.rpc('community_member_top_role_position', {
    p_community_id: communityId,
    p_user_id: userId,
  });
  if (error) return -1;
  return Number(data ?? -1);
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

const AUDIT_ACTION_LABELS: Record<string, string> = {
  member_ban: 'banned',
  member_unban: 'unbanned',
  member_kick: 'kicked',
  member_timeout: 'timed out',
  member_timeout_clear: 'cleared the timeout on',
  role_change: 'changed roles for',
  channel_create: 'created channel',
  channel_delete: 'deleted channel',
  settings_update: 'updated settings',
  invite_revoke: 'revoked invite',
  webhook_create: 'created webhook',
  bot_add: 'added bot',
};

export function describeAuditAction(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action.replace(/_/g, ' ');
}

/** A one-line human summary of an audit entry, for the log list. */
export function summarizeAuditEntry(entry: AuditEntry): string {
  const actor = entry.actorUsername || 'Someone';
  const verb = describeAuditAction(entry.action);
  const target = entry.targetUsername || entry.targetId || '';

  const parts = [actor, verb, target].filter(Boolean);
  let summary = parts.join(' ');

  const reason = typeof entry.details.reason === 'string' ? entry.details.reason.trim() : '';
  if (reason) summary += ` — "${reason}"`;

  const deleted = Number(entry.details.messages_deleted ?? 0);
  if (deleted > 0) {
    summary += ` (${deleted} message${deleted === 1 ? '' : 's'} deleted)`;
  }

  return summary;
}

/** "3 days", "4 hours", "12 minutes" — how long until a timeout or ban lifts. */
export function formatDuration(untilIso: string): string {
  const ms = new Date(untilIso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'expired';

  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;

  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;

  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}
