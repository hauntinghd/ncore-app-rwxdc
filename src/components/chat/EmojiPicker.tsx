import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useCustomEmojis } from '../../contexts/CustomEmojiContext';
import { parseEmojiToken, toEmojiToken, type CustomEmoji } from '../../lib/customEmoji';
import { EMOJI_LIST } from '../../lib/utils';

interface EmojiPickerProps {
  /** Receives either a unicode emoji or a `<:name:id>` custom-emoji token. */
  onSelect: (emoji: string) => void;
  /** Custom emoji from this community sort first. */
  communityId?: string | null;
  className?: string;
}

/**
 * Unicode quick-picks plus every custom emoji the user can reach.
 *
 * Custom emoji are emitted as `<:name:id>` tokens so a later rename does not
 * orphan the reaction or message that used them.
 */
export function EmojiPicker({ onSelect, communityId = null, className = '' }: EmojiPickerProps) {
  const { emojis } = useCustomEmojis();
  const [query, setQuery] = useState('');

  const grouped = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? emojis.filter((emoji) => emoji.name.toLowerCase().includes(needle))
      : emojis;

    // The community you are currently in goes first — that is the set you
    // reach for most.
    const groups = new Map<string, { name: string; emojis: CustomEmoji[] }>();
    for (const emoji of filtered) {
      const existing = groups.get(emoji.communityId);
      if (existing) existing.emojis.push(emoji);
      else groups.set(emoji.communityId, { name: emoji.communityName, emojis: [emoji] });
    }

    return Array.from(groups.entries())
      .sort(([leftId], [rightId]) => {
        if (leftId === communityId) return -1;
        if (rightId === communityId) return 1;
        return 0;
      })
      .map(([id, group]) => ({ id, ...group }));
  }, [emojis, query, communityId]);

  const unicodeMatches = useMemo(() => {
    // The unicode quick-pick row has no names attached, so a text query only
    // makes sense against custom emoji. Hide the row while searching.
    return query.trim() ? [] : EMOJI_LIST;
  }, [query]);

  return (
    <div
      className={`w-72 rounded-xl border border-surface-700 bg-surface-800 p-2 shadow-xl ${className}`}
    >
      {emojis.length > 0 && (
        <div className="relative mb-2">
          <Search size={13} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-surface-500" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search custom emoji"
            aria-label="Search custom emoji"
            className="w-full rounded-lg border border-surface-700 bg-surface-950 py-1.5 pr-2 pl-8 text-xs text-surface-200 placeholder-surface-600 focus:border-nyptid-300 focus:outline-none"
          />
        </div>
      )}

      <div className="max-h-64 overflow-y-auto scrollbar-thin">
        {unicodeMatches.length > 0 && (
          <div className="mb-2">
            <div className="px-1 pb-1 text-[10px] font-semibold tracking-wide text-surface-500 uppercase">
              Quick reactions
            </div>
            <div className="flex flex-wrap gap-1">
              {unicodeMatches.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onSelect(emoji)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-lg transition-colors hover:bg-surface-700"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}

        {grouped.map((group) => (
          <div key={group.id} className="mb-2">
            <div className="px-1 pb-1 text-[10px] font-semibold tracking-wide text-surface-500 uppercase">
              {group.name || 'Community'}
            </div>
            <div className="flex flex-wrap gap-1">
              {group.emojis.map((emoji) => (
                <button
                  key={emoji.id}
                  type="button"
                  onClick={() => onSelect(toEmojiToken(emoji))}
                  title={`:${emoji.name}:`}
                  className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-surface-700"
                >
                  <img
                    src={emoji.imageUrl}
                    alt={`:${emoji.name}:`}
                    loading="lazy"
                    className="h-6 w-6 object-contain"
                  />
                </button>
              ))}
            </div>
          </div>
        ))}

        {query.trim() && grouped.length === 0 && (
          <div className="py-6 text-center text-xs text-surface-500">No custom emoji matched.</div>
        )}
      </div>
    </div>
  );
}

/**
 * Renders one reaction value, which may be a unicode emoji or a
 * `<:name:id>` custom-emoji token.
 */
export function ReactionEmoji({ value, className = '' }: { value: string; className?: string }) {
  const { byId } = useCustomEmojis();
  const parsed = parseEmojiToken(value);

  if (!parsed) return <span className={className}>{value}</span>;

  const emoji = byId.get(parsed.id);
  if (!emoji) {
    return (
      <span className={`text-surface-400 ${className}`} title="Emoji from another community">
        :{parsed.name}:
      </span>
    );
  }

  return (
    <img
      src={emoji.imageUrl}
      alt={`:${emoji.name}:`}
      title={`:${emoji.name}:`}
      loading="lazy"
      className={`inline-block h-4 w-4 object-contain align-text-bottom ${className}`}
    />
  );
}
