import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Hash, Loader2, MessageSquare, Send, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Avatar } from '../ui/Avatar';
import { EmptyState, EmptyIllustrations } from '../ui/EmptyState';
import { useFocusTrap } from '../ui/useFocusTrap';
import { formatRelativeTime } from '../../lib/utils';

interface ThreadsPanelProps {
  open: boolean;
  onClose: () => void;
  channelId: string;
  channelName: string;
  authorId: string | null;
}

interface ThreadAuthor {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface ThreadMessage {
  id: string;
  content: string;
  author_id: string;
  parent_message_id: string | null;
  created_at: string;
  author: ThreadAuthor | null;
}

interface ThreadRoot extends ThreadMessage {
  reply_count: number;
  last_activity: string;
}

export function ThreadsPanel({ open, onClose, channelId, channelName, authorId }: ThreadsPanelProps) {
  const panelRef = useFocusTrap(open, onClose);
  const [roots, setRoots] = useState<ThreadRoot[] | null>(null);
  const [rootsError, setRootsError] = useState('');
  const [selectedRootId, setSelectedRootId] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadMessage[] | null>(null);
  const [threadError, setThreadError] = useState('');
  const [sending, setSending] = useState(false);
  const [composer, setComposer] = useState('');
  const threadBottomRef = useRef<HTMLDivElement | null>(null);

  // --- load thread roots for this channel ------------------------------------
  useEffect(() => {
    if (!open || !channelId) return;
    let cancelled = false;
    setRoots(null);
    setRootsError('');
    (async () => {
      try {
        // Messages in this channel that have at least one reply pointing at
        // them. Two cheap queries + a dedupe in JS beats a joined query on
        // hot paths.
        const { data: replies, error: repliesErr } = await supabase
          .from('messages')
          .select('parent_message_id, created_at')
          .eq('channel_id', channelId)
          .not('parent_message_id', 'is', null)
          .order('created_at', { ascending: false })
          .limit(500);
        if (repliesErr) throw repliesErr;
        if (cancelled) return;

        const rootMeta = new Map<string, { count: number; lastAt: string }>();
        for (const row of replies || []) {
          const parentId = String((row as any).parent_message_id || '');
          if (!parentId) continue;
          const existing = rootMeta.get(parentId);
          const ts = String((row as any).created_at || '');
          if (existing) {
            existing.count += 1;
            if (ts > existing.lastAt) existing.lastAt = ts;
          } else {
            rootMeta.set(parentId, { count: 1, lastAt: ts });
          }
        }
        const rootIds = Array.from(rootMeta.keys());
        if (rootIds.length === 0) {
          setRoots([]);
          return;
        }

        const { data: rootRows, error: rootErr } = await supabase
          .from('messages')
          .select('id, content, author_id, parent_message_id, created_at')
          .in('id', rootIds);
        if (rootErr) throw rootErr;
        if (cancelled) return;

        const authorIds: string[] = Array.from(
          new Set<string>((rootRows || []).map((r: any) => String(r.author_id || '')).filter(Boolean))
        );
        const authors = await hydrateAuthors(authorIds);
        if (cancelled) return;

        const mapped: ThreadRoot[] = (rootRows || [])
          .map((row: any) => {
            const meta = rootMeta.get(String(row.id)) || { count: 0, lastAt: String(row.created_at) };
            return {
              id: String(row.id),
              content: String(row.content || ''),
              author_id: String(row.author_id || ''),
              parent_message_id: row.parent_message_id ? String(row.parent_message_id) : null,
              created_at: String(row.created_at || ''),
              author: authors.get(String(row.author_id)) || null,
              reply_count: meta.count,
              last_activity: meta.lastAt,
            };
          })
          .sort((a, b) => (a.last_activity < b.last_activity ? 1 : -1));
        setRoots(mapped);
      } catch (error) {
        if (cancelled) return;
        setRootsError(String((error as any)?.message || error));
      }
    })();
    return () => { cancelled = true; };
  }, [open, channelId]);

  // --- load the selected thread (root + replies) ----------------------------
  useEffect(() => {
    if (!open || !selectedRootId) {
      setThread(null);
      return;
    }
    let cancelled = false;
    setThread(null);
    setThreadError('');
    (async () => {
      try {
        const { data: rows, error } = await supabase
          .from('messages')
          .select('id, content, author_id, parent_message_id, created_at')
          .or(`id.eq.${selectedRootId},parent_message_id.eq.${selectedRootId}`)
          .order('created_at', { ascending: true });
        if (error) throw error;
        if (cancelled) return;

        const authorIds: string[] = Array.from(
          new Set<string>((rows || []).map((r: any) => String(r.author_id || '')).filter(Boolean))
        );
        const authors = await hydrateAuthors(authorIds);
        if (cancelled) return;

        setThread((rows || []).map((row: any) => ({
          id: String(row.id),
          content: String(row.content || ''),
          author_id: String(row.author_id || ''),
          parent_message_id: row.parent_message_id ? String(row.parent_message_id) : null,
          created_at: String(row.created_at || ''),
          author: authors.get(String(row.author_id)) || null,
        })));
      } catch (error) {
        if (cancelled) return;
        setThreadError(String((error as any)?.message || error));
      }
    })();
    return () => { cancelled = true; };
  }, [open, selectedRootId]);

  // Scroll thread view to bottom on update.
  useEffect(() => {
    if (thread && threadBottomRef.current) {
      threadBottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [thread?.length]);

  // --- realtime subscription: pick up new replies for the open thread --------
  useEffect(() => {
    if (!open || !selectedRootId) return;
    const channel = supabase
      .channel(`thread:${selectedRootId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `parent_message_id=eq.${selectedRootId}`,
      }, async (payload) => {
        const row: any = payload.new;
        const authors = await hydrateAuthors([String(row.author_id || '')]);
        setThread((prev) => {
          if (!prev) return prev;
          if (prev.some((m) => m.id === String(row.id))) return prev;
          return [...prev, {
            id: String(row.id),
            content: String(row.content || ''),
            author_id: String(row.author_id || ''),
            parent_message_id: row.parent_message_id ? String(row.parent_message_id) : null,
            created_at: String(row.created_at || ''),
            author: authors.get(String(row.author_id)) || null,
          }];
        });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [open, selectedRootId]);

  async function handleSend() {
    if (!composer.trim() || !authorId || !selectedRootId) return;
    setSending(true);
    const text = composer.trim();
    setComposer('');
    try {
      const { error } = await supabase
        .from('messages')
        .insert({
          channel_id: channelId,
          author_id: authorId,
          content: text,
          parent_message_id: selectedRootId,
        });
      if (error) {
        setThreadError(error.message);
        setComposer(text);
      }
    } catch (error) {
      setThreadError(String((error as any)?.message || error));
      setComposer(text);
    } finally {
      setSending(false);
    }
  }

  const selectedRoot = useMemo(
    () => roots?.find((r) => r.id === selectedRootId) || null,
    [roots, selectedRootId],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-label={selectedRootId ? 'Thread' : 'Threads'}
        className="relative ml-auto h-full w-full max-w-md bg-surface-900 border-l border-surface-700 flex flex-col animate-slide-right"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-800">
          <div className="flex items-center gap-2 min-w-0">
            {selectedRootId && (
              <button
                type="button"
                className="p-1 rounded-md text-surface-400 hover:bg-surface-700 hover:text-surface-100"
                onClick={() => setSelectedRootId(null)}
                aria-label="Back to thread list"
              >
                <ArrowLeft size={16} />
              </button>
            )}
            <MessageSquare size={16} className="text-nyptid-200 flex-shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-surface-100 truncate">
                {selectedRootId ? 'Thread' : 'Threads'}
              </div>
              <div className="text-[11px] text-surface-400 truncate flex items-center gap-1">
                <Hash size={10} />
                {channelName}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="p-1 rounded-md text-surface-400 hover:bg-surface-700 hover:text-surface-100"
            onClick={onClose}
            aria-label="Close threads panel"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {!selectedRootId ? (
            <ThreadList
              roots={roots}
              error={rootsError}
              onSelect={setSelectedRootId}
            />
          ) : (
            <ThreadDetail
              root={selectedRoot}
              thread={thread}
              error={threadError}
            />
          )}
          <div ref={threadBottomRef} />
        </div>

        {selectedRootId && (
          <div className="border-t border-surface-800 p-3">
            <form
              onSubmit={(e) => { e.preventDefault(); void handleSend(); }}
              className="flex items-end gap-2"
            >
              <textarea
                value={composer}
                onChange={(e) => setComposer(e.target.value)}
                placeholder="Reply in thread..."
                rows={2}
                className="nyptid-input flex-1 resize-none !py-2"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                disabled={sending || !authorId}
              />
              <button
                type="submit"
                disabled={!composer.trim() || sending || !authorId}
                className="nyptid-btn-primary !py-2 !px-3"
                title="Send reply"
              >
                {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

function ThreadList({
  roots,
  error,
  onSelect,
}: {
  roots: ThreadRoot[] | null;
  error: string;
  onSelect: (id: string) => void;
}) {
  if (error) {
    return (
      <div className="p-6">
        <EmptyState
          illustration={EmptyIllustrations.NoResults}
          title="Couldn't load threads"
          description={error}
        />
      </div>
    );
  }
  if (roots === null) {
    return (
      <div className="p-6 flex items-center justify-center text-surface-300">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }
  if (roots.length === 0) {
    return (
      <EmptyState
        illustration={EmptyIllustrations.EmptyChannel}
        title="No threads yet"
        description="When someone replies to a message, the conversation branches off into a thread. Threads show up here so you can keep side-topics tidy."
      />
    );
  }
  return (
    <ul className="divide-y divide-surface-800">
      {roots.map((root) => (
        <li key={root.id}>
          <button
            type="button"
            onClick={() => onSelect(root.id)}
            className="w-full text-left px-4 py-3 hover:bg-surface-800/60 transition-colors"
          >
            <div className="flex items-start gap-3">
              <Avatar
                src={root.author?.avatar_url || undefined}
                name={root.author?.display_name || root.author?.username || 'Unknown'}
                size="sm"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs text-surface-400">
                  <span className="font-semibold text-surface-200 truncate">
                    {root.author?.display_name || root.author?.username || 'Unknown'}
                  </span>
                  <span className="text-surface-500">·</span>
                  <span className="truncate">{formatRelativeTime(root.created_at)}</span>
                </div>
                <div className="mt-0.5 text-sm text-surface-200 line-clamp-2 break-words">
                  {root.content || <span className="italic text-surface-500">(no content)</span>}
                </div>
                <div className="mt-1 flex items-center gap-3 text-[11px] text-surface-500">
                  <span className="inline-flex items-center gap-1">
                    <MessageSquare size={10} />
                    {root.reply_count} {root.reply_count === 1 ? 'reply' : 'replies'}
                  </span>
                  <span className="text-surface-500">Last {formatRelativeTime(root.last_activity)}</span>
                </div>
              </div>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ThreadDetail({
  root,
  thread,
  error,
}: {
  root: ThreadRoot | null;
  thread: ThreadMessage[] | null;
  error: string;
}) {
  if (error) {
    return (
      <div className="p-6">
        <EmptyState
          illustration={EmptyIllustrations.NoResults}
          title="Couldn't load thread"
          description={error}
        />
      </div>
    );
  }
  if (thread === null) {
    return (
      <div className="p-6 flex items-center justify-center text-surface-300">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }
  return (
    <div className="py-2">
      {thread.map((msg, idx) => (
        <div
          key={msg.id}
          className={`px-4 py-2 ${msg.id === root?.id ? 'bg-surface-800/40 border-l-2 border-nyptid-300' : ''}`}
        >
          <div className="flex items-start gap-3">
            <Avatar
              src={msg.author?.avatar_url || undefined}
              name={msg.author?.display_name || msg.author?.username || 'Unknown'}
              size="sm"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-xs text-surface-400">
                <span className="font-semibold text-surface-200">
                  {msg.author?.display_name || msg.author?.username || 'Unknown'}
                </span>
                <span className="text-surface-500">{formatRelativeTime(msg.created_at)}</span>
                {idx === 0 && <span className="text-[10px] uppercase tracking-wide text-nyptid-300">Root</span>}
              </div>
              <div className="mt-1 text-sm text-surface-100 whitespace-pre-wrap break-words">
                {msg.content || <span className="italic text-surface-500">(no content)</span>}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

async function hydrateAuthors(ids: string[]): Promise<Map<string, ThreadAuthor>> {
  const map = new Map<string, ThreadAuthor>();
  if (ids.length === 0) return map;
  const { data } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url')
    .in('id', ids);
  for (const row of (data || [])) {
    const profile: ThreadAuthor = {
      id: String((row as any).id),
      username: String((row as any).username || 'unknown'),
      display_name: (row as any).display_name ? String((row as any).display_name) : null,
      avatar_url: (row as any).avatar_url ? String((row as any).avatar_url) : null,
    };
    map.set(profile.id, profile);
  }
  return map;
}
