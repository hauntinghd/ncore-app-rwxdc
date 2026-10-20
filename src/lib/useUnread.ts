/**
 * Unread state hooks.
 *
 * Counts are computed server-side (see `community_unread_summary` /
 * `user_unread_summary`) so they stay correct across devices. Realtime message
 * inserts trigger a debounced refetch rather than incrementing locally —
 * a local counter drifts as soon as one event is missed or replayed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';
import {
  fetchCommunityUnread,
  fetchUserUnread,
  markChannelRead,
  rollUpChannelUnread,
  type ChannelUnread,
  type CommunityUnread,
} from './readState';

const REFRESH_DEBOUNCE_MS = 750;

function useDebouncedRefresh(refresh: () => void, delayMs = REFRESH_DEBOUNCE_MS) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => refreshRef.current(), delayMs);
  }, [delayMs]);
}

/**
 * Per-channel unread for the active community, keyed by channel id.
 *
 * `activeChannelId` is marked read on entry and kept read while the tab has
 * focus, so an open channel never accumulates a badge behind the user.
 */
export function useCommunityUnread(communityId: string | null | undefined, activeChannelId?: string | null) {
  const [unread, setUnread] = useState<Record<string, ChannelUnread>>({});
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    if (!communityId) {
      setUnread({});
      setLoaded(true);
      return;
    }
    try {
      const rows = await fetchCommunityUnread(communityId);
      const next: Record<string, ChannelUnread> = {};
      for (const row of rows) next[row.channelId] = row;
      setUnread(next);
    } catch {
      // Unread counts are decorative; a failure must never block the channel
      // list from rendering. Leave the previous counts in place.
    } finally {
      setLoaded(true);
    }
  }, [communityId]);

  const scheduleRefresh = useDebouncedRefresh(() => void refresh());

  useEffect(() => {
    setLoaded(false);
    void refresh();
  }, [refresh]);

  // Refetch when new channel messages land anywhere in this community.
  useEffect(() => {
    if (!communityId) return;
    const channel = supabase
      .channel(`unread:${communityId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, scheduleRefresh)
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [communityId, scheduleRefresh]);

  // Keep the open channel read.
  useEffect(() => {
    if (!activeChannelId) return;

    let cancelled = false;
    const mark = async () => {
      try {
        await markChannelRead(activeChannelId);
        if (!cancelled) {
          setUnread((prev) => {
            if (!prev[activeChannelId]) return prev;
            const next = { ...prev };
            next[activeChannelId] = {
              ...next[activeChannelId],
              unreadCount: 0,
              mentionCount: 0,
            };
            return next;
          });
        }
      } catch {
        // A failed mark-read just means the badge lingers until next refresh.
      }
    };

    void mark();

    const onFocus = () => void mark();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
    };
  }, [activeChannelId]);

  const totals = useMemo(() => rollUpChannelUnread(Object.values(unread)), [unread]);

  return { unread, totals, loaded, refresh };
}

/** Rolled-up unread per community, for the server rail. */
export function useUserUnread(enabled = true) {
  const [unread, setUnread] = useState<Record<string, CommunityUnread>>({});

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const rows = await fetchUserUnread();
      const next: Record<string, CommunityUnread> = {};
      for (const row of rows) next[row.communityId] = row;
      setUnread(next);
    } catch {
      // Non-fatal: the rail renders without badges.
    }
  }, [enabled]);

  const scheduleRefresh = useDebouncedRefresh(() => void refresh());

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel('unread:rail')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, scheduleRefresh)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'channel_read_state' }, scheduleRefresh)
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, scheduleRefresh]);

  return { unread, refresh };
}
