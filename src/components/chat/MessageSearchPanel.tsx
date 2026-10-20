import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Hash, Loader2, Paperclip, Search, X } from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import { Modal } from '../ui/Modal';
import {
  SEARCH_PAGE_SIZE,
  highlightSegments,
  parseSearchQuery,
  searchMessages,
  type MessageSearchHit,
} from '../../lib/messageSearch';

interface MessageSearchPanelProps {
  isOpen: boolean;
  onClose: () => void;
  /** Scopes the search. Omit to search every community the user belongs to. */
  communityId?: string | null;
  /** Pre-fills the input, e.g. from the top bar search box. */
  initialQuery?: string;
}

const DEBOUNCE_MS = 300;

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function ResultRow({
  hit,
  query,
  onJump,
}: {
  hit: MessageSearchHit;
  query: string;
  onJump: (hit: MessageSearchHit) => void;
}) {
  const segments = useMemo(() => highlightSegments(hit.content, query), [hit.content, query]);
  const authorName = hit.authorDisplayName || hit.authorUsername || 'Unknown user';

  return (
    <button
      type="button"
      onClick={() => onJump(hit)}
      className="w-full rounded-xl border border-surface-700 bg-surface-900/60 p-3 text-left transition-colors hover:border-nyptid-300/50 hover:bg-surface-900"
    >
      <div className="mb-1.5 flex items-center gap-2 text-xs text-surface-400">
        <Hash size={12} className="flex-shrink-0" />
        <span className="truncate font-medium text-surface-300">{hit.channelName}</span>
        <span aria-hidden="true">·</span>
        <span className="flex-shrink-0">{formatTimestamp(hit.createdAt)}</span>
      </div>
      <div className="flex items-start gap-2.5">
        <Avatar src={hit.authorAvatarUrl} name={authorName} size="xs" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-surface-200">{authorName}</div>
          <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words text-sm text-surface-400">
            {segments.map((segment, index) =>
              segment.match ? (
                <mark key={index} className="rounded bg-nyptid-300/25 px-0.5 text-nyptid-100">
                  {segment.text}
                </mark>
              ) : (
                <span key={index}>{segment.text}</span>
              ),
            )}
          </p>
        </div>
      </div>
    </button>
  );
}

/**
 * Full-text search over channel messages.
 *
 * Direct messages are absent by design: they are end-to-end encrypted, so the
 * server holds ciphertext it cannot index. The panel says so rather than
 * letting the omission read as a bug.
 */
export function MessageSearchPanel({
  isOpen,
  onClose,
  communityId = null,
  initialQuery = '',
}: MessageSearchPanelProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState(initialQuery);
  const [hits, setHits] = useState<MessageSearchHit[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [scopeToCommunity, setScopeToCommunity] = useState(Boolean(communityId));
  const inputRef = useRef<HTMLInputElement>(null);
  const requestIdRef = useRef(0);

  const parsed = useMemo(() => parseSearchQuery(query), [query]);
  const effectiveCommunityId = scopeToCommunity ? communityId : null;

  useEffect(() => {
    if (isOpen) {
      setQuery(initialQuery);
      setScopeToCommunity(Boolean(communityId));
      // Focus after the modal's own focus trap has settled.
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
    setHits([]);
    setTotalCount(0);
    setHasMore(false);
    setError('');
  }, [isOpen, initialQuery, communityId]);

  const runSearch = useCallback(
    async (offset: number) => {
      const trimmed = parsed.text.trim();
      if (!trimmed) {
        setHits([]);
        setTotalCount(0);
        setHasMore(false);
        setError('');
        return;
      }

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      if (offset === 0) setLoading(true);
      else setLoadingMore(true);

      try {
        const result = await searchMessages(trimmed, {
          communityId: effectiveCommunityId,
          authorId: null,
          hasAttachment: parsed.hasAttachment,
          before: parsed.before,
          after: parsed.after,
          limit: SEARCH_PAGE_SIZE,
          offset,
        });

        // A slower earlier request must not overwrite a newer result set.
        if (requestId !== requestIdRef.current) return;

        setHits((prev) => (offset === 0 ? result.hits : [...prev, ...result.hits]));
        setTotalCount(result.totalCount);
        setHasMore(result.hasMore);
        setError('');
      } catch (searchError) {
        if (requestId !== requestIdRef.current) return;
        setError(searchError instanceof Error ? searchError.message : 'Search failed');
        if (offset === 0) setHits([]);
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [parsed.text, parsed.hasAttachment, parsed.before, parsed.after, effectiveCommunityId],
  );

  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => void runSearch(0), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [isOpen, runSearch]);

  const handleJump = useCallback(
    (hit: MessageSearchHit) => {
      onClose();
      navigate(`/app/community/${hit.communityId}/channel/${hit.channelId}?message=${hit.id}`);
    },
    [navigate, onClose],
  );

  const showEmpty = !loading && !error && parsed.text.trim().length > 0 && hits.length === 0;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Search messages" size="xl">
      <div className="space-y-4">
        <div className="relative">
          <Search size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-surface-500" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search messages…  try  has:attachment  before:2026-07-01"
            className="w-full rounded-lg border border-surface-700 bg-surface-950 py-2.5 pr-9 pl-9 text-sm text-surface-200 placeholder-surface-600 focus:border-nyptid-300 focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute top-1/2 right-3 -translate-y-1/2 text-surface-500 hover:text-surface-300"
            >
              <X size={15} />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-surface-500">
          {communityId && (
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={scopeToCommunity}
                onChange={(event) => setScopeToCommunity(event.target.checked)}
                className="accent-nyptid-300"
              />
              <span>This community only</span>
            </label>
          )}
          {parsed.hasAttachment && (
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-700 px-2 py-0.5 text-surface-300">
              <Paperclip size={11} /> has attachment
            </span>
          )}
          {totalCount > 0 && (
            <span className="ml-auto">
              {totalCount.toLocaleString()} {totalCount === 1 ? 'result' : 'results'}
            </span>
          )}
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="max-h-[52vh] space-y-2 overflow-y-auto pr-1">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-surface-500">
              <Loader2 size={16} className="animate-spin" />
              Searching…
            </div>
          )}

          {!loading &&
            hits.map((hit) => (
              <ResultRow key={hit.id} hit={hit} query={parsed.text} onJump={handleJump} />
            ))}

          {showEmpty && (
            <div className="py-10 text-center text-sm text-surface-500">
              No messages matched that search.
            </div>
          )}

          {!loading && hasMore && (
            <button
              type="button"
              onClick={() => void runSearch(hits.length)}
              disabled={loadingMore}
              className="nyptid-btn-secondary w-full text-sm"
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>

        <p className="border-t border-surface-700 pt-3 text-xs text-surface-600">
          Direct messages are end-to-end encrypted, so the server cannot search them. Use the
          search inside a DM conversation to search your own decrypted copy.
        </p>
      </div>
    </Modal>
  );
}
