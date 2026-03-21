import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Profile } from '../lib/types';
import { registerDeviceToken } from '../lib/push';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  profileLoading: boolean;
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<Profile>) => Promise<{ error: Error | null }>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(true);
  const DEFAULT_DEVICE_TOKEN_KEY = '__ncore_default_device_token_registered';

  function getProfileCacheKey(userId: string): string {
    return `ncore.profile.cache.${userId}`;
  }

  function readCachedProfile(userId: string): Profile | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem(getProfileCacheKey(userId));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Profile;
      if (!parsed || typeof parsed !== 'object') return null;
      if (String(parsed.id || '') !== String(userId)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function writeCachedProfile(nextProfile: Profile) {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(getProfileCacheKey(String(nextProfile.id)), JSON.stringify(nextProfile));
    } catch {
      // cache best-effort
    }
  }

  function clearCachedProfile(userId: string | null | undefined) {
    if (typeof window === 'undefined') return;
    if (!userId) return;
    try {
      localStorage.removeItem(getProfileCacheKey(String(userId)));
    } catch {
      // noop
    }
  }

  async function touchLastSeen(userId: string) {
    await supabase
      .from('profiles')
      .update({ last_seen: new Date().toISOString() })
      .eq('id', userId);
  }

  async function fetchProfile(userId: string) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (!error && data) {
      const nextProfile = data as Profile;
      setProfile(nextProfile);
      writeCachedProfile(nextProfile);
    }
    return data as Profile | null;
  }

  async function refreshProfile() {
    if (user) {
      await fetchProfile(user.id);
    }
  }

  useEffect(() => {
    async function registerDefaultDeviceTokenOnce() {
      try {
        const defaultToken = (import.meta.env.VITE_DEFAULT_DEVICE_TOKEN || '').trim();
        const platform = (import.meta.env.VITE_DEFAULT_DEVICE_PLATFORM || '').trim() || null;
        if (!defaultToken) return;
        if (typeof window !== 'undefined') {
          const alreadyRegistered = localStorage.getItem(DEFAULT_DEVICE_TOKEN_KEY);
          if (alreadyRegistered === '1') return;
        }
        await registerDeviceToken(defaultToken, platform);
        if (typeof window !== 'undefined') {
          localStorage.setItem(DEFAULT_DEVICE_TOKEN_KEY, '1');
        }
      } catch (err) {
        // ignore registration errors
        console.warn('Default device token registration failed', err);
      }
    }

    function primeProfileFromCache(userId: string): boolean {
      const cached = readCachedProfile(userId);
      if (!cached) return false;
      setProfile(cached);
      return Boolean(cached.username);
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        const hasCachedProfile = primeProfileFromCache(session.user.id);
        setProfileLoading(!hasCachedProfile);
        setLoading(false);
        void touchLastSeen(session.user.id);
        fetchProfile(session.user.id).finally(() => {
          setProfileLoading(false);
        });
        void registerDefaultDeviceTokenOnce();
      } else {
        setProfile(null);
        setProfileLoading(false);
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);

      if (event === 'SIGNED_IN' && session?.user) {
        const hasCachedProfile = primeProfileFromCache(session.user.id);
        setProfileLoading(!hasCachedProfile);
        setLoading(false);
        void touchLastSeen(session.user.id);
        fetchProfile(session.user.id).finally(() => {
          setProfileLoading(false);
        });
        void registerDefaultDeviceTokenOnce();
      } else if (event === 'TOKEN_REFRESHED' && session?.user) {
        // Keep profile fresh after token refresh without blocking navigation.
        void fetchProfile(session.user.id);
      } else if (event === 'SIGNED_OUT') {
        clearCachedProfile(user?.id);
        setProfile(null);
        setProfileLoading(false);
        setLoading(false);
      } else if (!session) {
        clearCachedProfile(user?.id);
        setProfile(null);
        setProfileLoading(false);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const updateLastSeenOnUnload = async () => {
      const uid = (await supabase.auth.getUser()).data.user?.id;
      if (!uid) return;
      await touchLastSeen(uid);
    };

    const handleBeforeUnload = () => {
      void updateLastSeenOnUnload();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  async function signUp(email: string, password: string) {
    const { error } = await supabase.auth.signUp({ email, password });
    return { error: error as Error | null };
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  }

  async function signOut() {
    if (user) {
      await touchLastSeen(user.id);
    }
    await supabase.auth.signOut();
  }

  async function updateProfile(updates: Partial<Profile>) {
    if (!user) return { error: new Error('Not authenticated') };

    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', user.id);

    if (!error) {
      setProfile(prev => prev ? { ...prev, ...updates } : null);
    }

    return { error: error as Error | null };
  }

  return (
    <AuthContext.Provider value={{
      user, session, profile, loading, profileLoading,
      signUp, signIn, signOut, updateProfile, refreshProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
