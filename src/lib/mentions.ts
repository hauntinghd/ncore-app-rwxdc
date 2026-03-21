interface MentionTarget {
  id?: string | null;
  username?: string | null;
  display_name?: string | null;
}

function normalizeHandle(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9_]/g, '');
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

  const handles = extractMentionHandles(text);
  if (handles.size === 0) return false;
  const username = normalizeHandle(target.username || '');
  const display = normalizeHandle(target.display_name || '');
  if (username && handles.has(username)) return true;
  if (display && handles.has(display)) return true;
  return false;
}

export { normalizeHandle };
