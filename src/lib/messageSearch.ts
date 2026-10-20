/**
 * Full-text message search — client surface.
 *
 * Backed by `search_messages` in
 * `20260729120000_channel_read_state_and_search.sql`.
 *
 * Scope note: this searches **channel messages only**. Direct messages are
 * end-to-end encrypted, so the server holds ciphertext it cannot index.
 * Searching DMs has to happen client-side over the decrypted cache — see
 * `searchDecryptedMessages` below.
 */
import { supabase } from './supabase';

export interface MessageSearchFilters {
  communityId?: string | null;
  channelId?: string | null;
  authorId?: string | null;
  hasAttachment?: boolean | null;
  before?: string | null;
  after?: string | null;
  limit?: number;
  offset?: number;
}

export interface MessageSearchHit {
  id: string;
  channelId: string;
  channelName: string;
  communityId: string;
  authorId: string | null;
  authorUsername: string | null;
  authorDisplayName: string | null;
  authorAvatarUrl: string | null;
  content: string;
  createdAt: string;
  rank: number;
}

export interface MessageSearchResult {
  hits: MessageSearchHit[];
  totalCount: number;
  hasMore: boolean;
}

interface SearchRow {
  id: string;
  channel_id: string;
  channel_name: string | null;
  community_id: string;
  author_id: string | null;
  author_username: string | null;
  author_display_name: string | null;
  author_avatar_url: string | null;
  content: string | null;
  created_at: string;
  rank: number | null;
  total_count: number | string | null;
}

export const SEARCH_PAGE_SIZE = 25;

/**
 * Parse Discord-style `key:value` filter tokens out of a raw query string,
 * returning the leftover free text plus the tokens we recognise.
 *
 * Supported: `from:`, `in:`, `has:attachment`, `before:`, `after:`.
 * Unrecognised tokens stay in the free text rather than being silently eaten.
 */
export function parseSearchQuery(raw: string): {
  text: string;
  from: string | null;
  channel: string | null;
  hasAttachment: boolean | null;
  before: string | null;
  after: string | null;
} {
  const tokens = String(raw || '').split(/\s+/).filter(Boolean);
  const rest: string[] = [];
  let from: string | null = null;
  let channel: string | null = null;
  let hasAttachment: boolean | null = null;
  let before: string | null = null;
  let after: string | null = null;

  const asDate = (value: string): string | null => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  };

  for (const token of tokens) {
    const match = /^(from|in|has|before|after):(.+)$/i.exec(token);
    if (!match) {
      rest.push(token);
      continue;
    }

    const key = match[1].toLowerCase();
    const value = match[2].replace(/^[@#]/, '');

    if (key === 'from' && value) from = value;
    else if (key === 'in' && value) channel = value;
    else if (key === 'has' && value.toLowerCase() === 'attachment') hasAttachment = true;
    else if (key === 'before' && asDate(value)) before = asDate(value);
    else if (key === 'after' && asDate(value)) after = asDate(value);
    else rest.push(token);
  }

  return { text: rest.join(' '), from, channel, hasAttachment, before, after };
}

export async function searchMessages(
  query: string,
  filters: MessageSearchFilters = {},
): Promise<MessageSearchResult> {
  const trimmed = String(query || '').trim();
  const limit = filters.limit ?? SEARCH_PAGE_SIZE;
  const offset = filters.offset ?? 0;

  if (!trimmed) {
    return { hits: [], totalCount: 0, hasMore: false };
  }

  const { data, error } = await supabase.rpc('search_messages', {
    p_query: trimmed,
    p_community_id: filters.communityId ?? null,
    p_channel_id: filters.channelId ?? null,
    p_author_id: filters.authorId ?? null,
    p_has_attachment: filters.hasAttachment ?? null,
    p_before: filters.before ?? null,
    p_after: filters.after ?? null,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;

  const rows = (data ?? []) as SearchRow[];
  const hits: MessageSearchHit[] = rows.map((row) => ({
    id: String(row.id),
    channelId: String(row.channel_id),
    channelName: String(row.channel_name || 'unknown'),
    communityId: String(row.community_id),
    authorId: row.author_id ?? null,
    authorUsername: row.author_username ?? null,
    authorDisplayName: row.author_display_name ?? null,
    authorAvatarUrl: row.author_avatar_url ?? null,
    content: String(row.content || ''),
    createdAt: row.created_at,
    rank: Number(row.rank ?? 0),
  }));

  const totalCount = rows.length > 0 ? Number(rows[0].total_count ?? hits.length) : 0;

  return { hits, totalCount, hasMore: offset + hits.length < totalCount };
}

/**
 * Client-side substring search, used for end-to-end encrypted direct messages
 * where the server cannot help. Operates on already-decrypted text held in
 * memory; nothing here reaches the network.
 */
export function searchDecryptedMessages<T extends { content: string; created_at: string }>(
  messages: readonly T[],
  query: string,
  limit = SEARCH_PAGE_SIZE,
): T[] {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return [];

  return messages
    .filter((message) => String(message.content || '').toLowerCase().includes(needle))
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .slice(0, Math.max(1, limit));
}

/**
 * Split content into segments around search-term matches so a result row can
 * highlight what matched without using `dangerouslySetInnerHTML`.
 */
export function highlightSegments(
  content: string,
  query: string,
): Array<{ text: string; match: boolean }> {
  const terms = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.replace(/^[-"]+|"+$/g, ''))
    .filter((term) => term.length > 1);

  if (terms.length === 0) return [{ text: content, match: false }];

  const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');

  return content
    .split(pattern)
    .filter((part) => part.length > 0)
    .map((part) => ({ text: part, match: terms.includes(part.toLowerCase()) }));
}
