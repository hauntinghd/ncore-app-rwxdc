/**
 * Channel unread state — client surface.
 *
 * Schema and RPCs live in `20260729120000_channel_read_state_and_search.sql`.
 * The read cursor is per-user and private; the server refuses to mark a
 * channel read that the caller lacks READ_MESSAGES on.
 */
import { supabase } from './supabase';

export interface ChannelUnread {
  channelId: string;
  unreadCount: number;
  mentionCount: number;
  lastMessageAt: string | null;
}

export interface CommunityUnread {
  communityId: string;
  unreadCount: number;
  mentionCount: number;
}

interface CommunityUnreadRow {
  channel_id: string;
  unread_count: number | null;
  mention_count: number | null;
  last_message_at: string | null;
}

interface UserUnreadRow {
  community_id: string;
  unread_count: number | null;
  mention_count: number | null;
}

/** Per-channel unread + mention counts for one community. */
export async function fetchCommunityUnread(communityId: string): Promise<ChannelUnread[]> {
  const { data, error } = await supabase.rpc('community_unread_summary', {
    p_community_id: communityId,
  });
  if (error) throw error;

  return ((data ?? []) as CommunityUnreadRow[]).map((row) => ({
    channelId: String(row.channel_id),
    unreadCount: Number(row.unread_count ?? 0),
    mentionCount: Number(row.mention_count ?? 0),
    lastMessageAt: row.last_message_at ?? null,
  }));
}

/** Rolled-up unread per community, for the server rail badges. */
export async function fetchUserUnread(): Promise<CommunityUnread[]> {
  const { data, error } = await supabase.rpc('user_unread_summary');
  if (error) throw error;

  return ((data ?? []) as UserUnreadRow[]).map((row) => ({
    communityId: String(row.community_id),
    unreadCount: Number(row.unread_count ?? 0),
    mentionCount: Number(row.mention_count ?? 0),
  }));
}

/**
 * Move the read cursor for a channel. The server clamps this so it can only
 * move forward, so a stale caller cannot resurrect already-read messages.
 */
export async function markChannelRead(
  channelId: string,
  options: { readAt?: string; messageId?: string | null } = {},
): Promise<void> {
  const { error } = await supabase.rpc('mark_channel_read', {
    p_channel_id: channelId,
    p_read_at: options.readAt ?? new Date().toISOString(),
    p_message_id: options.messageId ?? null,
  });
  if (error) throw error;
}

/** Sum unread/mentions across channels, for a community-level badge. */
export function rollUpChannelUnread(entries: readonly ChannelUnread[]): {
  unreadCount: number;
  mentionCount: number;
} {
  return entries.reduce(
    (acc, entry) => ({
      unreadCount: acc.unreadCount + entry.unreadCount,
      mentionCount: acc.mentionCount + entry.mentionCount,
    }),
    { unreadCount: 0, mentionCount: 0 },
  );
}

/** Discord caps the numeric badge; anything past the cap renders as "99+". */
export function formatBadgeCount(count: number, cap = 99): string {
  if (count <= 0) return '';
  return count > cap ? `${cap}+` : String(count);
}
