interface MentionTarget {
  id?: string | null;
  username?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  status?: string | null;
}

export interface MentionTextSegment {
  text: string;
  isMention: boolean;
}

export interface ActiveMentionQuery {
  start: number;
  end: number;
  query: string;
}

export interface MentionSuggestion {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  status?: string | null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeHandle(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9_.-]/g, '');
}

function scoreMentionSuggestion(target: MentionSuggestion, query: string): number {
  const normalizedQuery = normalizeHandle(query);
  if (!normalizedQuery) return 0;

  const username = normalizeHandle(target.username);
  const display = normalizeHandle(target.display_name || '');

  if (username === normalizedQuery) return 0;
  if (display === normalizedQuery) return 1;
  if (username.startsWith(normalizedQuery)) return 2;
  if (display.startsWith(normalizedQuery)) return 3;
  if (username.includes(normalizedQuery)) return 4;
  if (display.includes(normalizedQuery)) return 5;
  return Number.POSITIVE_INFINITY;
}

function buildMentionCandidates(target: MentionTarget): string[] {
  const values = [target.username, target.display_name]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return Array.from(new Set(values));
}

function hasNamedMention(content: string, candidate: string): boolean {
  const trimmed = String(candidate || '').trim();
  if (!trimmed) return false;
  const escaped = escapeRegex(trimmed).replace(/\s+/g, '\\s+');
  const pattern = new RegExp(`(^|[\\s([{'"])@${escaped}(?=$|[\\s.,!?;:)}\\]'"])`, 'i');
  return pattern.test(content);
}

export function hasBroadcastMention(content: unknown): boolean {
  const text = String(content || '');
  return /@everyone\b/i.test(text) || /@here\b/i.test(text);
}

export function extractMentionHandles(content: unknown): Set<string> {
  const text = String(content || '');
  const regex = /@([a-z0-9_.-]{2,32})/gi;
  const handles = new Set<string>();
  let match: RegExpExecArray | null = regex.exec(text);
  while (match) {
    const handle = normalizeHandle(match[1]);
    if (handle && handle !== 'everyone' && handle !== 'here') {
      handles.add(handle);
    }
    match = regex.exec(text);
  }
  return handles;
}

export function getActiveMentionQuery(content: unknown, caretPosition?: number | null): ActiveMentionQuery | null {
  const text = String(content || '');
  const normalizedCaret = Number.isFinite(Number(caretPosition))
    ? Math.max(0, Math.min(Number(caretPosition), text.length))
    : text.length;
  const beforeCaret = text.slice(0, normalizedCaret);
  const atIndex = beforeCaret.lastIndexOf('@');

  if (atIndex < 0) return null;
  if (atIndex > 0) {
    const leadingChar = beforeCaret[atIndex - 1];
    if (leadingChar && !/[\s([{'"]/.test(leadingChar)) {
      return null;
    }
  }

  const query = beforeCaret.slice(atIndex + 1);
  if (/[^a-z0-9_.-]/i.test(query)) return null;

  let end = normalizedCaret;
  while (end < text.length && /[a-z0-9_.-]/i.test(text[end])) {
    end += 1;
  }

  return {
    start: atIndex,
    end,
    query,
  };
}

export function buildMentionSuggestions(
  targets: MentionTarget[],
  query: unknown,
  maxResults = 8,
): MentionSuggestion[] {
  const deduped = new Map<string, MentionSuggestion>();

  for (const target of targets || []) {
    const id = String(target?.id || '').trim();
    const username = String(target?.username || '').trim();
    if (!id || !username) continue;

    deduped.set(id, {
      id,
      username,
      display_name: target?.display_name ? String(target.display_name) : null,
      avatar_url: target?.avatar_url ? String(target.avatar_url) : null,
      status: target?.status ? String(target.status) : null,
    });
  }

  const normalizedQuery = normalizeHandle(query);
  return Array.from(deduped.values())
    .filter((target) => {
      if (!normalizedQuery) return true;
      return scoreMentionSuggestion(target, normalizedQuery) !== Number.POSITIVE_INFINITY;
    })
    .sort((left, right) => {
      const leftScore = scoreMentionSuggestion(left, normalizedQuery);
      const rightScore = scoreMentionSuggestion(right, normalizedQuery);
      if (leftScore !== rightScore) return leftScore - rightScore;

      const leftLabel = String(left.display_name || left.username).toLowerCase();
      const rightLabel = String(right.display_name || right.username).toLowerCase();
      return leftLabel.localeCompare(rightLabel);
    })
    .slice(0, Math.max(1, maxResults));
}

export function insertMentionSuggestion(
  content: unknown,
  mention: ActiveMentionQuery,
  suggestion: Pick<MentionSuggestion, 'username'> | string,
): { value: string; caretPosition: number } {
  const text = String(content || '');
  const username = typeof suggestion === 'string'
    ? normalizeHandle(suggestion)
    : normalizeHandle(suggestion.username);
  if (!username) {
    return { value: text, caretPosition: text.length };
  }

  const before = text.slice(0, mention.start);
  const after = text.slice(mention.end);
  const needsTrailingSpace = after.length === 0 || !/^[\s.,!?;:)}\]]/.test(after);
  const inserted = `@${username}${needsTrailingSpace ? ' ' : ''}`;
  const value = `${before}${inserted}${after}`;

  return {
    value,
    caretPosition: before.length + inserted.length,
  };
}

export function isMentioningTarget(content: unknown, target: MentionTarget, allowBroadcast = true): boolean {
  const text = String(content || '');
  if (!text) return false;

  const targetId = String(target.id || '').trim();
  if (targetId && (text.includes(`<@${targetId}>`) || text.includes(`<@!${targetId}>`))) {
    return true;
  }

  if (allowBroadcast && hasBroadcastMention(text)) return true;

  const candidates = buildMentionCandidates(target);
  if (candidates.some((candidate) => hasNamedMention(text, candidate))) {
    return true;
  }

  const handles = extractMentionHandles(text);
  if (handles.size === 0) return false;
  const username = normalizeHandle(target.username || '');
  const display = normalizeHandle(target.display_name || '');
  if (username && handles.has(username)) return true;
  if (display && handles.has(display)) return true;
  return false;
}

export function resolveMentionTargetIds(
  content: unknown,
  targets: MentionTarget[],
  allowBroadcast = true,
): Set<string> {
  const text = String(content || '');
  const ids = new Set<string>();
  if (!text) return ids;

  const broadcast = allowBroadcast && hasBroadcastMention(text);
  for (const target of targets || []) {
    const targetId = String(target?.id || '').trim();
    if (!targetId) continue;
    if (broadcast || isMentioningTarget(text, target, false)) {
      ids.add(targetId);
    }
  }

  return ids;
}

export function splitMentionText(content: unknown): MentionTextSegment[] {
  const text = String(content || '');
  if (!text) return [];

  const segments: MentionTextSegment[] = [];
  const mentionRegex = /(<@!?[0-9a-f-]{36}>|@(everyone|here|[a-z0-9_.-]{2,32}))/gi;
  let lastIndex = 0;
  let match = mentionRegex.exec(text);

  while (match) {
    if (match.index > lastIndex) {
      segments.push({
        text: text.slice(lastIndex, match.index),
        isMention: false,
      });
    }
    segments.push({
      text: match[0],
      isMention: true,
    });
    lastIndex = match.index + match[0].length;
    match = mentionRegex.exec(text);
  }

  if (lastIndex < text.length) {
    segments.push({
      text: text.slice(lastIndex),
      isMention: false,
    });
  }

  return segments;
}

export { normalizeHandle };
