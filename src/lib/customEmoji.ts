/**
 * Custom per-community emoji — client surface.
 *
 * Schema and RPCs live in `20260729130000_community_emojis.sql`.
 *
 * Wire format is `<:name:uuid>`, matching Discord. The id is what resolves the
 * image, so renaming an emoji never breaks existing messages and two
 * communities can both own a `:shipit:`.
 */
import { supabase } from './supabase';

export interface CustomEmoji {
  id: string;
  communityId: string;
  communityName: string;
  name: string;
  imageUrl: string;
  isAnimated: boolean;
}

export const EMOJI_NAME_PATTERN = /^[a-zA-Z0-9_]{2,32}$/;
export const CUSTOM_EMOJI_TOKEN = /<a?:([a-zA-Z0-9_]{2,32}):([0-9a-f-]{36})>/g;
export const MAX_EMOJI_BYTES = 256 * 1024;

interface EmojiRow {
  id: string;
  community_id: string;
  community_name: string | null;
  name: string;
  image_url: string;
  is_animated: boolean | null;
}

function rowToEmoji(row: EmojiRow): CustomEmoji {
  return {
    id: String(row.id),
    communityId: String(row.community_id),
    communityName: String(row.community_name || ''),
    name: String(row.name),
    imageUrl: String(row.image_url),
    isAnimated: Boolean(row.is_animated),
  };
}

/** Every custom emoji the signed-in user can use, across all their communities. */
export async function fetchUsableEmojis(): Promise<CustomEmoji[]> {
  const { data, error } = await supabase.rpc('usable_community_emojis');
  if (error) throw error;
  return ((data ?? []) as EmojiRow[]).map(rowToEmoji);
}

export async function fetchCommunityEmojis(communityId: string): Promise<CustomEmoji[]> {
  const { data, error } = await supabase
    .from('community_emojis')
    .select('id, community_id, name, image_url, is_animated')
    .eq('community_id', communityId)
    .order('name');
  if (error) throw error;

  return ((data ?? []) as EmojiRow[]).map((row) =>
    rowToEmoji({ ...row, community_name: null }),
  );
}

/**
 * Upload the image, then register the emoji. If registration fails we remove
 * the uploaded object so a rejected name does not leave an orphan behind.
 */
export async function createCommunityEmoji(
  communityId: string,
  name: string,
  file: File,
): Promise<CustomEmoji> {
  if (!EMOJI_NAME_PATTERN.test(name)) {
    throw new Error('Emoji names must be 2-32 characters of letters, numbers, or underscores.');
  }
  if (file.size > MAX_EMOJI_BYTES) {
    throw new Error(`Emoji images must be under ${Math.floor(MAX_EMOJI_BYTES / 1024)} KB.`);
  }
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
    throw new Error('Emoji must be a PNG, JPEG, GIF, or WebP image.');
  }

  const extension = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1];
  const storagePath = `emoji/${communityId}/${crypto.randomUUID()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from('community-assets')
    .upload(storagePath, file, { cacheControl: '31536000', upsert: false });
  if (uploadError) throw uploadError;

  const { data: publicUrl } = supabase.storage.from('community-assets').getPublicUrl(storagePath);

  const { data, error } = await supabase.rpc('community_emoji_create', {
    p_community_id: communityId,
    p_name: name,
    p_image_url: publicUrl.publicUrl,
    p_storage_path: storagePath,
    p_is_animated: file.type === 'image/gif',
  });

  if (error) {
    await supabase.storage.from('community-assets').remove([storagePath]).catch(() => {});
    throw error;
  }

  return rowToEmoji({ ...(data as EmojiRow), community_name: null });
}

export async function renameCommunityEmoji(emojiId: string, name: string): Promise<void> {
  const { error } = await supabase.rpc('community_emoji_rename', {
    p_emoji_id: emojiId,
    p_name: name,
  });
  if (error) throw error;
}

export async function deleteCommunityEmoji(emojiId: string): Promise<void> {
  const { error } = await supabase.rpc('community_emoji_delete', { p_emoji_id: emojiId });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Wire format
// ---------------------------------------------------------------------------

export function toEmojiToken(emoji: Pick<CustomEmoji, 'id' | 'name' | 'isAnimated'>): string {
  return `<${emoji.isAnimated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
}

export interface ParsedEmojiToken {
  name: string;
  id: string;
  animated: boolean;
}

/** Parse a single `<:name:id>` token, or null if the text is not one. */
export function parseEmojiToken(token: string): ParsedEmojiToken | null {
  const match = /^<(a?):([a-zA-Z0-9_]{2,32}):([0-9a-f-]{36})>$/.exec(token);
  if (!match) return null;
  return { animated: match[1] === 'a', name: match[2], id: match[3] };
}

/**
 * A message that is nothing but custom emoji renders them large, the way
 * Discord does for an emoji-only message.
 */
export function isEmojiOnly(content: string): boolean {
  const stripped = String(content || '').replace(CUSTOM_EMOJI_TOKEN, '').trim();
  return stripped.length === 0 && CUSTOM_EMOJI_TOKEN.test(String(content || ''));
}

/**
 * Resolve the active `:query` the caret sits in, for autocomplete. Mirrors the
 * mention-query helper in `src/lib/mentions.ts`.
 */
export function getActiveEmojiQuery(
  content: string,
  caretPosition?: number | null,
): { start: number; end: number; query: string } | null {
  const text = String(content || '');
  const caret = Number.isFinite(Number(caretPosition))
    ? Math.max(0, Math.min(Number(caretPosition), text.length))
    : text.length;

  const beforeCaret = text.slice(0, caret);
  const colonIndex = beforeCaret.lastIndexOf(':');
  if (colonIndex < 0) return null;

  // Must start a word, so `10:30` and a completed `<:name:id>` are ignored.
  if (colonIndex > 0 && !/[\s([{'"]/.test(beforeCaret[colonIndex - 1])) return null;

  const query = beforeCaret.slice(colonIndex + 1);
  if (query.length < 1 || !/^[a-zA-Z0-9_]*$/.test(query)) return null;

  let end = caret;
  while (end < text.length && /[a-zA-Z0-9_]/.test(text[end])) end += 1;

  return { start: colonIndex, end, query };
}

export function filterEmojiSuggestions(
  emojis: readonly CustomEmoji[],
  query: string,
  maxResults = 8,
): CustomEmoji[] {
  const needle = String(query || '').toLowerCase();
  if (!needle) return emojis.slice(0, maxResults);

  return emojis
    .filter((emoji) => emoji.name.toLowerCase().includes(needle))
    .sort((left, right) => {
      const leftStarts = left.name.toLowerCase().startsWith(needle) ? 0 : 1;
      const rightStarts = right.name.toLowerCase().startsWith(needle) ? 0 : 1;
      if (leftStarts !== rightStarts) return leftStarts - rightStarts;
      return left.name.localeCompare(right.name);
    })
    .slice(0, maxResults);
}

export function insertEmojiToken(
  content: string,
  range: { start: number; end: number },
  emoji: CustomEmoji,
): { value: string; caretPosition: number } {
  const text = String(content || '');
  const token = `${toEmojiToken(emoji)} `;
  const value = `${text.slice(0, range.start)}${token}${text.slice(range.end)}`;
  return { value, caretPosition: range.start + token.length };
}
