import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AtSign, Hash, Megaphone } from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import { Modal } from '../ui/Modal';
import { MarkdownContent } from '../ui/MarkdownContent';
import {
  fetchMentionFeed,
  mentionAuthorName,
  mentionPath,
  type MentionEntry,
} from '../../lib/mentionInbox';
import { formatRelativeTime } from '../../lib/utils';

interface MentionInboxPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const PAGE_SIZE = 30;

/**
 * "Where was I mentioned?" across every server, newest first.
 *
 * The question this answers is what makes it possible to stop reading every
 * channel — without it, catching up means opening every server you are in.
 */
export function MentionInboxPanel({ isOpen, onClose }: MentionInboxPanelProps) {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<MentionEntry[]>([]);
  const [includeBroadcast, setIncludeBroadcast] = useState(true);
  const [loading, setLoading] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const feed = await fetchMentionFeed({ limit: PAGE_SIZE, includeBroadcast });
      setEntries(feed);
      setExhausted(feed.length < PAGE_SIZE);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load mentions.');
    } finally {
      setLoading(false);
    }
  }, [includeBroadcast]);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  async function loadMore() {
    const oldest = entries[entries.length - 1];
    if (!oldest) return;
    setLoading(true);
    try {
      const older = await fetchMentionFeed({
        limit: PAGE_SIZE,
        before: oldest.createdAt,
        includeBroadcast,
      });
      setEntries((current) => [...current, ...older]);
      if (older.length < PAGE_SIZE) setExhausted(true);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load more.');
    } finally {
      setLoading(false);
    }
  }

  function jump(entry: MentionEntry) {
    onClose();
    navigate(mentionPath(entry));
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Mentions" size="lg">
      <div className="space-y-3">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-surface-400">
          <input
            type="checkbox"
            checked={includeBroadcast}
            onChange={(event) => setIncludeBroadcast(event.target.checked)}
            className="rounded border-surface-600 bg-surface-800"
          />
          Include @everyone and @here
        </label>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="max-h-[60vh] space-y-1 overflow-y-auto">
          {loading && entries.length === 0 ? (
            <div className="py-8 text-center text-sm text-surface-500">Loading mentions…</div>
          ) : entries.length === 0 ? (
            <div className="py-8 text-center text-sm text-surface-500">
              <AtSign size={22} className="mx-auto mb-2 text-surface-700" />
              Nobody has mentioned you recently.
            </div>
          ) : (
            entries.map((entry) => (
              <button
                key={`${entry.messageId}-${entry.isBroadcast ? 'all' : 'me'}`}
                type="button"
                onClick={() => jump(entry)}
                className="w-full rounded-lg border border-surface-700/60 bg-surface-900/40 px-3 py-2.5 text-left transition-colors hover:border-surface-600 hover:bg-surface-800/60"
              >
                <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-surface-500">
                  {entry.communityName && (
                    <span className="truncate font-medium text-surface-400">
                      {entry.communityName}
                    </span>
                  )}
                  <span className="flex items-center gap-0.5">
                    <Hash size={10} />
                    {entry.channelName}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{formatRelativeTime(entry.createdAt)}</span>
                  {entry.isBroadcast && (
                    <span className="flex items-center gap-1 rounded bg-surface-700/70 px-1.5 py-0.5 text-[10px] font-semibold text-surface-300">
                      <Megaphone size={9} /> EVERYONE
                    </span>
                  )}
                </div>

                <div className="flex gap-2.5">
                  <Avatar
                    src={entry.authorAvatarUrl}
                    name={mentionAuthorName(entry)}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-surface-200">
                      {mentionAuthorName(entry)}
                    </div>
                    <div className="line-clamp-3 text-sm break-words text-surface-400">
                      <MarkdownContent content={entry.content} />
                    </div>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        {entries.length > 0 && !exhausted && (
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loading}
            className="nyptid-btn-secondary w-full py-1.5 text-xs"
          >
            {loading ? 'Loading…' : 'Load older mentions'}
          </button>
        )}

        <p className="border-t border-surface-700 pt-3 text-xs text-surface-600">
          A mention clears from the unread count when you read the channel it is in — there is no
          separate "seen" state to fall out of sync.
        </p>
      </div>
    </Modal>
  );
}
