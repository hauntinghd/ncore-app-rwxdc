import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

const DESKTOP_AUTH_STORAGE_KEY = 'ncore-auth';

function hasDesktopAuthStorageBridge(): boolean {
  return Boolean(
    typeof window !== 'undefined'
      && window.desktopBridge?.authStorageGetItem
      && window.desktopBridge?.authStorageSetItem
      && window.desktopBridge?.authStorageRemoveItem,
  );
}

const desktopAuthStorage = {
  async getItem(key: string): Promise<string | null> {
    if (typeof window === 'undefined') return null;
    const bridge = window.desktopBridge;
    if (!bridge?.authStorageGetItem || !bridge?.authStorageSetItem) return null;
    try {
      const result = await bridge.authStorageGetItem(key);
      const persistedValue = result?.ok ? result.value : null;
      if (typeof persistedValue === 'string' && persistedValue.length > 0) {
        return persistedValue;
      }
    } catch {
      // fallback to legacy localStorage read below
    }

    // One-time migration fallback: if previous builds stored auth in localStorage,
    // copy into desktop userData-backed storage so future updates keep the session.
    try {
      const legacyValue = window.localStorage.getItem(key);
      if (typeof legacyValue === 'string' && legacyValue.length > 0) {
        await bridge.authStorageSetItem(key, legacyValue);
        return legacyValue;
      }
    } catch {
      // ignore migration fallback failures
    }
    return null;
  },
  async setItem(key: string, value: string): Promise<void> {
    if (typeof window === 'undefined') return;
    const bridge = window.desktopBridge;
    try {
      if (bridge?.authStorageSetItem) {
        await bridge.authStorageSetItem(key, value);
      }
    } catch {
      // best effort persistence
    }
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // ignore localStorage fallback failures
    }
  },
  async removeItem(key: string): Promise<void> {
    if (typeof window === 'undefined') return;
    const bridge = window.desktopBridge;
    try {
      if (bridge?.authStorageRemoveItem) {
        await bridge.authStorageRemoveItem(key);
      }
    } catch {
      // best effort removal
    }
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore localStorage fallback failures
    }
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storageKey: DESKTOP_AUTH_STORAGE_KEY,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    ...(hasDesktopAuthStorageBridge() ? { storage: desktopAuthStorage } : {}),
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
}) as any;
