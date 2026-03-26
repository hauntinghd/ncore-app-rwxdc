interface MentionTarget {
  id?: string | null;
  username?: string | null;
  display_name?: string | null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeHandle(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9_]/g, '');
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
  const regex = /@([a-z0-9_]{2,32})/gi;
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

export { normalizeHandle };
