import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import {
  featuredGifs,
  gifCategories,
  gifToMessageContent,
  searchGifs,
  type Gif,
  type GifCategory,
} from '../../lib/gifs';

interface GifPickerProps {
  /** Receives the message content to send — the GIF URL. */
  onSelect: (content: string) => void;
  onClose: () => void;
}

const DEBOUNCE_MS = 350;

/**
 * Tenor-backed GIF picker.
 *
 * Opens on trending, falls back to categories when a search finds nothing, and
 * pages as you scroll. Selection sends the GIF URL as the message body, which
 * means it renders through the existing link-embed path rather than needing a
 * new attachment type.
 */
export function GifPicker({ onSelect, onClose }: GifPickerProps) {
  const [query, setQuery] = useState('');
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [categories, setCategories] = useState<GifCategory[]>([]);
  const [next, setNext] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Guards against a slow early request landing after a newer one. */
  const requestIdRef = useRef(0);

  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  const load = useCallback(async (searchTerm: string) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError('');
    try {
      const page = searchTerm ? await searchGifs(searchTerm) : await featuredGifs();
      if (requestId !== requestIdRef.current) return;
      setGifs(page.results);
      setNext(page.next);
      scrollRef.current?.scrollTo({ top: 0 });

      // Empty results are a dead end without somewhere to go next.
      if (page.results.length === 0 && categories.length === 0) {
        setCategories(await gifCategories().catch(() => []));
      }
    } catch (loadError) {
      if (requestId !== requestIdRef.current) return;
      setError(loadError instanceof Error ? loadError.message : 'Could not load GIFs.');
      setGifs([]);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [categories.length]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(query.trim()), query ? DEBOUNCE_MS : 0);
    return () => window.clearTimeout(timer);
  }, [query, load]);

  async function loadMore() {
    if (!next || loading) return;
    const requestId = requestIdRef.current;
    setLoading(true);
    try {
      const term = query.trim();
      const page = term ? await searchGifs(term, next) : await featuredGifs(next);
      if (requestId !== requestIdRef.current) return;
      setGifs((current) => [...current, ...page.results]);
      setNext(page.next);
    } catch {
      // Paging failures are silent: the user still has the results they have,
      // and an error banner on scroll is more disruptive than a short list.
      setNext('');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }

  function onScroll(event: React.UIEvent<HTMLDivElement>) {
    const element = event.currentTarget;
    if (element.scrollHeight - element.scrollTop - element.clientHeight < 240) {
      void loadMore();
    }
  }

  return (
    <div className="flex h-96 w-80 flex-col overflow-hidden rounded-xl border border-surface-700 bg-surface-800 shadow-2xl">
      <div className="flex items-center gap-2 border-b border-surface-700 px-3 py-2">
        <Search size={14} className="flex-shrink-0 text-surface-500" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            }
          }}
          placeholder="Search Tenor…"
          aria-label="Search for a GIF"
          className="w-full bg-transparent text-sm text-surface-100 placeholder-surface-600 focus:outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="text-surface-500 hover:text-surface-300"
          >
            <X size={13} />
          </button>
        )}
      </div>

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto p-2">
        {error ? (
          <div className="px-3 py-8 text-center text-sm text-surface-500">{error}</div>
        ) : gifs.length === 0 && loading ? (
          <div className="px-3 py-8 text-center text-sm text-surface-500">Loading…</div>
        ) : gifs.length === 0 ? (
          <div className="px-2 py-4">
            <div className="mb-2 text-center text-sm text-surface-500">
              {query ? `Nothing for "${query}".` : 'No GIFs right now.'}
            </div>
            {categories.length > 0 && (
              <div className="flex flex-wrap justify-center gap-1.5">
                {categories.slice(0, 12).map((category) => (
                  <button
                    key={category.term}
                    type="button"
                    onClick={() => setQuery(category.term)}
                    className="rounded-full bg-surface-700 px-2.5 py-1 text-xs text-surface-300 transition-colors hover:bg-surface-600"
                  >
                    {category.term}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          // Two columns of variable-height GIFs. A masonry column layout keeps
          // aspect ratios intact; a fixed grid would letterbox almost all of
          // them, since GIF dimensions are all over the place.
          <div className="columns-2 gap-2 [column-fill:_balance]">
            {gifs.map((gif) => (
              <button
                key={gif.id}
                type="button"
                onClick={() => {
                  onSelect(gifToMessageContent(gif));
                  onClose();
                }}
                className="mb-2 block w-full overflow-hidden rounded-lg border border-transparent transition-colors hover:border-nyptid-300"
              >
                <img
                  src={gif.previewUrl}
                  alt={gif.description}
                  loading="lazy"
                  className="w-full bg-surface-900 object-cover"
                />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-surface-700 px-3 py-1.5 text-center text-[10px] text-surface-600">
        Powered by Tenor
      </div>
    </div>
  );
}
