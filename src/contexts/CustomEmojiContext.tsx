import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { fetchUsableEmojis, type CustomEmoji } from '../lib/customEmoji';
import { useAuth } from './AuthContext';

interface CustomEmojiContextValue {
  /** Every custom emoji the signed-in user can use, across their communities. */
  emojis: CustomEmoji[];
  /** Lookup by id, for rendering `<:name:id>` tokens back into images. */
  byId: Map<string, CustomEmoji>;
  loading: boolean;
  refresh: () => Promise<void>;
}

const CustomEmojiContext = createContext<CustomEmojiContextValue>({
  emojis: [],
  byId: new Map(),
  loading: false,
  refresh: async () => {},
});

export function CustomEmojiProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const [emojis, setEmojis] = useState<CustomEmoji[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!profile?.id) {
      setEmojis([]);
      return;
    }
    setLoading(true);
    try {
      setEmojis(await fetchUsableEmojis());
    } catch {
      // Custom emoji are decorative. A failure leaves tokens rendering as
      // `:name:` text rather than breaking the message list.
    } finally {
      setLoading(false);
    }
  }, [profile?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const byId = useMemo(() => {
    const map = new Map<string, CustomEmoji>();
    for (const emoji of emojis) map.set(emoji.id, emoji);
    return map;
  }, [emojis]);

  const value = useMemo(
    () => ({ emojis, byId, loading, refresh }),
    [emojis, byId, loading, refresh],
  );

  return <CustomEmojiContext.Provider value={value}>{children}</CustomEmojiContext.Provider>;
}

export function useCustomEmojis(): CustomEmojiContextValue {
  return useContext(CustomEmojiContext);
}
