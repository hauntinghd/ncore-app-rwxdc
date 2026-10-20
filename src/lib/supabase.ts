import { createClient } from '@supabase/supabase-js';
import { isTauri } from '@tauri-apps/api/core';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

const DESKTOP_AUTH_STORAGE_KEY = 'ncore-auth';

function hasDesktopAuthStorageBridge(): boolean {
  if (typeof window === 'undefined') return false;
  const bridge = window.desktopBridge;
  return (
    typeof bridge?.authStorageGetItem === 'function'
    && typeof bridge?.authStorageSetItem === 'function'
    && typeof bridge?.authStorageRemoveItem === 'function'
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

    /*
      The bridge had nothing. Fall back to localStorage and re-seed the file
      from it — but never delete the localStorage copy, since it is the only
      thing that keeps the session alive on a launch where the bridge is not
      ready in time.
    */
    try {
      const mirrored = window.localStorage.getItem(key);
      if (typeof mirrored === 'string' && mirrored.length > 0) {
        try {
          await bridge.authStorageSetItem(key, mirrored);
        } catch {
          // Re-seeding is opportunistic; returning the session matters more.
        }
        return mirrored;
      }
    } catch {
      // ignore fallback read failures
    }
    return null;
  },
  async setItem(key: string, value: string): Promise<void> {
    if (typeof window === 'undefined') return;
    const bridge = window.desktopBridge;

    /*
      Written to BOTH the desktop file and localStorage, on purpose.

      This previously deleted the localStorage copy, with a comment claiming
      desktop sessions belong in "the OS credential vault". They do not:
      `authStorage:setItem` writes plain JSON to
      %APPDATA%/NCore/auth-storage.json with no encryption. So removing the
      localStorage copy bought no security at all, and cost a single point of
      failure — if the bridge was unavailable when `supabase.ts` first
      evaluated, or the file read failed, the session existed in neither place
      and the user landed on the login screen.

      That is what "why do I have to keep logging in" was: sessions in
      auth.sessions show created_at == updated_at, i.e. created and never once
      refreshed, because there was nothing persisted to refresh from.

      Both stores are equally reachable by anything running as this user, so
      mirroring costs nothing and removes the failure mode.
    */
    let wroteToBridge = false;
    try {
      if (bridge?.authStorageSetItem) {
        const result = await bridge.authStorageSetItem(key, value);
        wroteToBridge = Boolean(result?.ok);
      }
    } catch {
      // Fall through to localStorage; a failed bridge write must not lose the
      // session.
    }

    try {
      window.localStorage.setItem(key, value);
    } catch {
      // If localStorage is full or blocked and the bridge write also failed,
      // there is nowhere left to persist — the user will have to sign in again
      // next launch, which is the behaviour this whole block exists to avoid.
      if (!wroteToBridge && import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn('[auth] session could not be persisted to either store');
      }
    }
  },
  async removeItem(key: string): Promise<void> {
    if (typeof window === 'undefined') return;
    const bridge = window.desktopBridge;
    // Sign-out must clear both stores unconditionally. An early return on a
    // successful bridge delete would leave a stale mirrored session behind,
    // and the next launch would silently sign the user back in.
    try {
      if (bridge?.authStorageRemoveItem) await bridge.authStorageRemoveItem(key);
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

/*
  Tauri has no `window.desktopBridge` — that object is injected by Electron's
  preload script and does not exist in a WebView2 window. So on the Tauri
  client `hasDesktopAuthStorageBridge()` is false and Supabase would fall back
  to plain localStorage, which is exactly the single-point-of-failure the
  Electron file store was built to avoid: sessions in `auth.sessions` show
  `updated_at == created_at` (created, never refreshed) because nothing durable
  was persisted to refresh from. That is the "why do I keep getting logged out"
  on the new desktop build.

  This restores the same file-backed guarantee Electron had, using the Tauri
  Store plugin. `store.get`/`set` persist to
  `%LOCALAPPDATA%\com.nyptid.ncore\ncore-auth.json`, which survives restarts
  regardless of how the embedded WebView2 treats localStorage. localStorage is
  still mirrored so a launch that reads it before the store is ready keeps the
  session, matching the Electron adapter's belt-and-braces behaviour.
*/
function createTauriAuthStorage() {
  type TauriStore = {
    get<T>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<boolean>;
    save(): Promise<void>;
  };
  let storePromise: Promise<TauriStore> | null = null;
  const getStore = (): Promise<TauriStore> => {
    if (!storePromise) {
      storePromise = import('@tauri-apps/plugin-store').then(({ load }) =>
        load('ncore-auth.json', { defaults: {}, autoSave: true }) as unknown as Promise<TauriStore>,
      );
    }
    return storePromise;
  };

  return {
    async getItem(key: string): Promise<string | null> {
      try {
        const store = await getStore();
        const value = await store.get<string>(key);
        if (typeof value === 'string' && value.length > 0) return value;
      } catch {
        // fall back to the localStorage mirror below
      }
      try {
        const mirrored = window.localStorage.getItem(key);
        if (typeof mirrored === 'string' && mirrored.length > 0) return mirrored;
      } catch {
        // ignore
      }
      return null;
    },
    async setItem(key: string, value: string): Promise<void> {
      try {
        const store = await getStore();
        await store.set(key, value);
        await store.save();
      } catch {
        // localStorage mirror is the fallback
      }
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // nowhere left to persist
      }
    },
    async removeItem(key: string): Promise<void> {
      try {
        const store = await getStore();
        await store.delete(key);
        await store.save();
      } catch {
        // best-effort
      }
      try {
        window.localStorage.removeItem(key);
      } catch {
        // ignore
      }
    },
  };
}

function resolveDesktopAuthStorage() {
  if (hasDesktopAuthStorageBridge()) return desktopAuthStorage;
  if (typeof window !== 'undefined' && isTauri()) return createTauriAuthStorage();
  return null;
}

const desktopAuthStorageAdapter = resolveDesktopAuthStorage();

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storageKey: DESKTOP_AUTH_STORAGE_KEY,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    ...(desktopAuthStorageAdapter ? { storage: desktopAuthStorageAdapter } : {}),
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
}) as any;
