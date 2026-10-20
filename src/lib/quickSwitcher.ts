/**
 * Quick switcher index and ranking.
 *
 * Settings has advertised a "Quick Switcher" keybind since the rollout pass,
 * but nothing was ever bound to it. This is the missing half.
 *
 * The index is built on demand and cached briefly rather than kept live: the
 * switcher is opened for a second at a time, and a stale channel name for a few
 * seconds costs nothing next to four subscriptions running all session.
 */
import { supabase } from './supabase';

export type QuickTargetKind = 'channel' | 'voice' | 'forum' | 'dm' | 'community' | 'page';

export interface QuickTarget {
  id: string;
  kind: QuickTargetKind;
  /** What the user searches against and reads. */
  label: string;
  /** Server name, other participants — shown dimmed after the label. */
  context: string;
  path: string;
  avatarUrl?: string | null;
}

interface ScoredTarget {
  target: QuickTarget;
  score: number;
}

const STATIC_PAGES: QuickTarget[] = [
  { id: 'page:friends', kind: 'page', label: 'Friends', context: '', path: '/app/friends' },
  { id: 'page:dms', kind: 'page', label: 'Direct Messages', context: '', path: '/app/dm' },
  { id: 'page:discover', kind: 'page', label: 'Discover', context: '', path: '/app/discover' },
  { id: 'page:settings', kind: 'page', label: 'Settings', context: '', path: '/app/settings' },
  { id: 'page:games', kind: 'page', label: 'Game Library', context: '', path: '/app/games' },
];

// ---------------------------------------------------------------------------
// Index construction
// ---------------------------------------------------------------------------

interface CachedIndex {
  targets: QuickTarget[];
  builtAt: number;
  userId: string;
}

let cache: CachedIndex | null = null;
const CACHE_TTL_MS = 60_000;

function channelPath(communityId: string, channelId: string, channelType: string): string {
  if (channelType === 'voice') return `/app/community/${communityId}/voice/${channelId}`;
  if (channelType === 'forum') return `/app/community/${communityId}/forum/${channelId}`;
  return `/app/community/${communityId}/channel/${channelId}`;
}

function kindForChannel(channelType: string): QuickTargetKind {
  if (channelType === 'voice') return 'voice';
  if (channelType === 'forum') return 'forum';
  return 'channel';
}

/**
 * Everything the user can jump to: their servers, every channel in them, their
 * DM conversations, and the fixed app pages.
 */
export async function buildQuickSwitcherIndex(userId: string): Promise<QuickTarget[]> {
  if (cache && cache.userId === userId && Date.now() - cache.builtAt < CACHE_TTL_MS) {
    return cache.targets;
  }

  const targets: QuickTarget[] = [...STATIC_PAGES];

  const { data: memberships } = await supabase
    .from('community_members')
    .select('community_id')
    .eq('user_id', userId);

  const communityIds = [...new Set(
    ((memberships ?? []) as Array<{ community_id: string | null }>)
      .map((row) => String(row.community_id || ''))
      .filter(Boolean),
  )];

  if (communityIds.length > 0) {
    const { data: communities } = await supabase
      .from('communities')
      .select('id, name, icon_url')
      .in('id', communityIds);

    const communityNames = new Map<string, string>();
    for (const row of (communities ?? []) as Array<{ id: string; name: string; icon_url: string | null }>) {
      communityNames.set(String(row.id), String(row.name || 'Untitled'));
      targets.push({
        id: `community:${row.id}`,
        kind: 'community',
        label: String(row.name || 'Untitled'),
        context: 'Server',
        path: `/app/community/${row.id}`,
        avatarUrl: row.icon_url,
      });
    }

    // Channels hang off servers, which hang off communities. Fetch the server
    // ids first so the channel query is a single `in` rather than a join that
    // PostgREST would have to embed.
    const { data: servers } = await supabase
      .from('servers')
      .select('id, community_id')
      .in('community_id', communityIds);

    const serverToCommunity = new Map<string, string>();
    for (const row of (servers ?? []) as Array<{ id: string; community_id: string }>) {
      serverToCommunity.set(String(row.id), String(row.community_id));
    }

    if (serverToCommunity.size > 0) {
      const { data: channels } = await supabase
        .from('channels')
        .select('id, name, type, server_id')
        .in('server_id', [...serverToCommunity.keys()])
        .limit(1000);

      for (const row of (channels ?? []) as Array<{
        id: string; name: string; type: string; server_id: string;
      }>) {
        const communityId = serverToCommunity.get(String(row.server_id));
        if (!communityId) continue;
        const channelType = String(row.type || 'text');
        targets.push({
          id: `channel:${row.id}`,
          kind: kindForChannel(channelType),
          label: String(row.name || 'unnamed'),
          context: communityNames.get(communityId) || '',
          path: channelPath(communityId, String(row.id), channelType),
        });
      }
    }
  }

  // DM conversations, named by the other participants.
  const { data: dmMemberships } = await supabase
    .from('direct_conversation_members')
    .select('conversation_id')
    .eq('user_id', userId);

  const conversationIds = [...new Set(
    ((dmMemberships ?? []) as Array<{ conversation_id: string | null }>)
      .map((row) => String(row.conversation_id || ''))
      .filter(Boolean),
  )];

  if (conversationIds.length > 0) {
    const [{ data: conversations }, { data: participants }] = await Promise.all([
      supabase.from('direct_conversations').select('id, is_group, name').in('id', conversationIds),
      supabase
        .from('direct_conversation_members')
        .select('conversation_id, user_id, profile:profiles(id, username, display_name, avatar_url)')
        .in('conversation_id', conversationIds),
    ]);

    const others = new Map<string, Array<{ name: string; avatar: string | null }>>();
    for (const row of (participants ?? []) as Array<{
      conversation_id: string;
      user_id: string;
      profile?: { username?: string; display_name?: string | null; avatar_url?: string | null } | null;
    }>) {
      if (String(row.user_id) === userId) continue;
      const list = others.get(String(row.conversation_id)) ?? [];
      list.push({
        name: row.profile?.display_name || row.profile?.username || 'Unknown',
        avatar: row.profile?.avatar_url ?? null,
      });
      others.set(String(row.conversation_id), list);
    }

    for (const row of (conversations ?? []) as Array<{ id: string; is_group: boolean; name: string | null }>) {
      const participantList = others.get(String(row.id)) ?? [];
      // A conversation with no other participants is one the other person left.
      // It is still reachable, so it stays in the index under a clear label.
      const label = row.is_group
        ? row.name || participantList.map((entry) => entry.name).join(', ') || 'Group'
        : participantList[0]?.name || 'Empty conversation';

      targets.push({
        id: `dm:${row.id}`,
        kind: 'dm',
        label,
        context: row.is_group ? `Group · ${participantList.length + 1} members` : 'Direct message',
        path: `/app/dm/${row.id}`,
        avatarUrl: row.is_group ? null : participantList[0]?.avatar ?? null,
      });
    }
  }

  cache = { targets, builtAt: Date.now(), userId };
  return targets;
}

/** Drops the memo — call after joining or leaving a server. */
export function invalidateQuickSwitcherIndex() {
  cache = null;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * Subsequence match with positional scoring.
 *
 * Not a general fuzzy-finder: it rewards the things that actually distinguish a
 * channel name — matching from the start, matching at a word boundary, and
 * matching contiguously — and refuses matches whose characters are scattered
 * across the whole string, which are almost always noise.
 */
export function scoreMatch(text: string, query: string): number {
  if (!query) return 1;

  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();

  if (haystack === needle) return 1000;
  if (haystack.startsWith(needle)) return 900 - haystack.length;

  const directIndex = haystack.indexOf(needle);
  if (directIndex >= 0) {
    // A match right after a separator reads as the start of a word.
    const isWordStart = directIndex === 0 || /[\s\-_./#]/.test(haystack[directIndex - 1]);
    return (isWordStart ? 700 : 500) - directIndex - haystack.length * 0.1;
  }

  let score = 0;
  let haystackIndex = 0;
  let lastMatch = -1;
  let streak = 0;

  for (const character of needle) {
    const found = haystack.indexOf(character, haystackIndex);
    if (found === -1) return 0;

    if (found === lastMatch + 1) {
      streak += 1;
      score += 10 + streak * 5;
    } else {
      streak = 0;
      score += 5;
      const isWordStart = found === 0 || /[\s\-_./#]/.test(haystack[found - 1]);
      if (isWordStart) score += 15;
    }

    lastMatch = found;
    haystackIndex = found + 1;
  }

  // Characters spread across most of a long string is coincidence, not intent.
  const span = lastMatch + 1;
  if (span > needle.length * 6 && span > 20) return 0;

  return Math.max(score - haystack.length * 0.2, 1);
}

const KIND_WEIGHT: Record<QuickTargetKind, number> = {
  dm: 12,
  channel: 10,
  community: 8,
  voice: 6,
  forum: 6,
  page: 2,
};

export function searchQuickTargets(
  targets: QuickTarget[],
  query: string,
  recentIds: string[],
  limit = 12,
): QuickTarget[] {
  const trimmed = query.trim();

  // With no query the switcher is a recents list — that is what it is for most
  // of the time, jumping between the two or three places you were just in.
  if (!trimmed) {
    const byId = new Map(targets.map((target) => [target.id, target]));
    const recents = recentIds
      .map((id) => byId.get(id))
      .filter((target): target is QuickTarget => Boolean(target));
    if (recents.length >= limit) return recents.slice(0, limit);

    const seen = new Set(recents.map((target) => target.id));
    const filler = targets
      .filter((target) => !seen.has(target.id) && target.kind !== 'page')
      .slice(0, limit - recents.length);
    return [...recents, ...filler];
  }

  const recentRank = new Map(recentIds.map((id, index) => [id, recentIds.length - index]));

  const scored: ScoredTarget[] = [];
  for (const target of targets) {
    const labelScore = scoreMatch(target.label, trimmed);
    // Context matches count for much less: typing a server name should surface
    // the server, not all 40 of its channels above the channel you meant.
    const contextScore = target.context ? scoreMatch(target.context, trimmed) * 0.15 : 0;
    const best = Math.max(labelScore, contextScore);
    if (best <= 0) continue;

    scored.push({
      target,
      score: best + KIND_WEIGHT[target.kind] + (recentRank.get(target.id) ?? 0) * 3,
    });
  }

  scored.sort((left, right) => right.score - left.score);
  return scored.slice(0, limit).map((entry) => entry.target);
}

// ---------------------------------------------------------------------------
// Recents
// ---------------------------------------------------------------------------

const RECENTS_KEY = 'ncore.quickswitcher.recents.v1';
const MAX_RECENTS = 20;

export function readRecents(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function pushRecent(targetId: string) {
  try {
    const next = [targetId, ...readRecents().filter((id) => id !== targetId)].slice(0, MAX_RECENTS);
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // Recents are a convenience; a full or blocked localStorage is not an error.
  }
}
