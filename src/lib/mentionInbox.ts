/**
 * Mention inbox — client surface.
 *
 * Schema lives in `20260730120000_mention_inbox.sql`. Mentions are resolved at
 * insert time into `message_mentions`, so the feed is an index scan rather than
 * a sweep over every message in every community.
 *
 * Unread is derived from `channel_read_state` — the same cursor the channel
 * badges use. One notion of read, so opening a channel clears its mentions
 * instead of leaving a second counter to drift out of sync.
 */
import { supabase } from './supabase';

export interface MentionEntry {
  messageId: string;
  channelId: string;
  channelName: string;
  communityId: string | null;
  communityName: string | null;
  authorId: string | null;
  authorUsername: string | null;
  authorDisplayName: string | null;
  authorAvatarUrl: string | null;
  content: string;
  /** True for @everyone / @here, which addressed the channel rather than you. */
  isBroadcast: boolean;
  createdAt: string;
}

interface MentionRow {
  message_id: string;
  channel_id: string;
  channel_name: string | null;
  community_id: string | null;
  community_name: string | null;
  author_id: string | null;
  author_username: string | null;
  author_display_name: string | null;
  author_avatar_url: string | null;
  content: string | null;
  is_broadcast: boolean;
  created_at: string;
}

export interface MentionFeedOptions {
  limit?: number;
  before?: string | null;
  /** Set false to hide @everyone noise and see only direct mentions. */
  includeBroadcast?: boolean;
}

export async function fetchMentionFeed(
  options: MentionFeedOptions = {},
): Promise<MentionEntry[]> {
  const { data, error } = await supabase.rpc('user_mention_feed', {
    p_limit: options.limit ?? 50,
    p_before: options.before ?? null,
    p_include_broadcast: options.includeBroadcast ?? true,
  });
  if (error) throw error;

  return ((data ?? []) as MentionRow[]).map((row) => ({
    messageId: row.message_id,
    channelId: row.channel_id,
    channelName: row.channel_name || 'unknown',
    communityId: row.community_id,
    communityName: row.community_name,
    authorId: row.author_id,
    authorUsername: row.author_username,
    authorDisplayName: row.author_display_name,
    authorAvatarUrl: row.author_avatar_url,
    content: row.content || '',
    isBroadcast: Boolean(row.is_broadcast),
    createdAt: row.created_at,
  }));
}

/** Mentions that arrived after the reader last read the channel they are in. */
export async function fetchMentionUnreadCount(): Promise<number> {
  const { data, error } = await supabase.rpc('user_mention_unread_count');
  if (error) return 0;
  return Number(data ?? 0);
}

/** Deep link to the mentioned message, using the jump-to-message param. */
export function mentionPath(entry: MentionEntry): string {
  if (!entry.communityId) return '/app/dm';
  return `/app/community/${entry.communityId}/channel/${entry.channelId}?message=${entry.messageId}`;
}

export function mentionAuthorName(entry: MentionEntry): string {
  return entry.authorDisplayName || entry.authorUsername || 'Unknown';
}
