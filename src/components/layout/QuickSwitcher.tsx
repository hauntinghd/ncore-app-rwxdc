import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Hash, MessageSquare, Search, Settings, Users, Volume2 } from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import { useAuth } from '../../contexts/AuthContext';
import {
  buildQuickSwitcherIndex,
  pushRecent,
  readRecents,
  searchQuickTargets,
  type QuickTarget,
} from '../../lib/quickSwitcher';
import { getRolloutFlag } from '../../lib/streamerMode';

const RESULT_LIMIT = 12;

/**
 * Ctrl+K / Cmd+K jump-to-anything.
 *
 * Mounted once in AppShell. The index is loaded on first open rather than at
 * mount — the switcher is not worth four queries on every page load for
 * something the user may never press.
 */
export function QuickSwitcher() {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [targets, setTargets] = useState<QuickTarget[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const recents = useMemo(() => (open ? readRecents() : []), [open]);

  const results = useMemo(
    () => searchQuickTargets(targets, query, recents, RESULT_LIMIT),
    [targets, query, recents],
  );

  // Keep the highlight in range as results shrink under a longer query.
  useEffect(() => {
    setSelectedIndex((current) => (current >= results.length ? 0 : current));
  }, [results.length]);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      setTargets(await buildQuickSwitcherIndex(profile.id));
    } catch {
      // An empty index still shows the static pages, which is better than an
      // error dialog over a navigation shortcut.
      setTargets([]);
    } finally {
      setLoading(false);
    }
  }, [profile?.id]);

  // Global hotkey.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const isSwitcherKey = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
      if (!isSwitcherKey) return;
      if (!getRolloutFlag('keybind_quick_switcher', true)) return;

      event.preventDefault();
      setOpen((wasOpen) => {
        if (wasOpen) return false;
        setQuery('');
        setSelectedIndex(0);
        void load();
        return true;
      });
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [load]);

  useEffect(() => {
    if (open) {
      // The input mounts with the dialog, so focus has to wait a frame.
      const frame = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(frame);
    }
  }, [open]);

  // Keep the highlighted row visible while arrowing past the fold.
  useEffect(() => {
    const active = listRef.current?.querySelector('[data-selected="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  function choose(target: QuickTarget | undefined) {
    if (!target) return;
    pushRecent(target.id);
    setOpen(false);
    setQuery('');
    navigate(target.path);
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey)) {
      event.preventDefault();
      setSelectedIndex((current) => (results.length === 0 ? 0 : (current + 1) % results.length));
      return;
    }
    if (event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey)) {
      event.preventDefault();
      setSelectedIndex((current) =>
        results.length === 0 ? 0 : (current - 1 + results.length) % results.length,
      );
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      choose(results[selectedIndex]);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-sm"
      onClick={() => setOpen(false)}
      role="presentation"
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-surface-700 bg-surface-900 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Quick switcher"
      >
        <div className="flex items-center gap-2.5 border-b border-surface-700 px-4 py-3">
          <Search size={16} className="flex-shrink-0 text-surface-500" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={onInputKeyDown}
            placeholder="Jump to a channel, server, or conversation…"
            aria-label="Search for somewhere to jump to"
            className="w-full bg-transparent text-sm text-surface-100 placeholder-surface-600 focus:outline-none"
          />
        </div>

        <div ref={listRef} className="max-h-80 overflow-y-auto py-1.5">
          {loading && results.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-surface-500">Loading…</div>
          ) : results.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-surface-500">
              {query ? `Nothing matches "${query}".` : 'Nowhere to jump to yet.'}
            </div>
          ) : (
            results.map((target, index) => (
              <button
                key={target.id}
                type="button"
                data-selected={index === selectedIndex}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => choose(target)}
                className={`flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors ${
                  index === selectedIndex ? 'bg-surface-700/70' : 'hover:bg-surface-800/60'
                }`}
              >
                <TargetIcon target={target} />
                <span className="min-w-0 flex-1 truncate text-sm text-surface-200">
                  {target.label}
                </span>
                {target.context && (
                  <span className="flex-shrink-0 truncate text-xs text-surface-600">
                    {target.context}
                  </span>
                )}
              </button>
            ))
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-surface-700 px-4 py-2 text-[11px] text-surface-600">
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">enter</kbd> jump</span>
          <span><kbd className="font-mono">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

function TargetIcon({ target }: { target: QuickTarget }) {
  if ((target.kind === 'dm' || target.kind === 'community') && target.avatarUrl !== undefined) {
    return <Avatar src={target.avatarUrl} name={target.label} size="xs" />;
  }
  const className = 'flex-shrink-0 text-surface-500';
  if (target.kind === 'voice') return <Volume2 size={15} className={className} />;
  if (target.kind === 'forum') return <MessageSquare size={15} className={className} />;
  if (target.kind === 'page') return <Settings size={15} className={className} />;
  if (target.kind === 'community') return <Users size={15} className={className} />;
  return <Hash size={15} className={className} />;
}
