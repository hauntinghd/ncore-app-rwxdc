import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Profile } from '../lib/types';
import { registerDeviceToken } from '../lib/push';
import { queueRuntimeEvent } from '../lib/runtimeTelemetry';

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
const SIGNIN_THROTTLE_KEY = 'ncore.auth.signinThrottle';
const SIGNIN_FAILURE_WINDOW_MS = 10 * 60 * 1000;
const SIGNIN_THROTTLE_MS = 60 * 1000;
const SIGNIN_FAILURE_LIMIT = 5;

interface SignInThrottleState {
  failures: number;
  firstFailureAt: number;
  blockedUntil: number;
}

function readSignInThrottleState(): SignInThrottleState {
  if (typeof window === 'undefined') {
    return { failures: 0, firstFailureAt: 0, blockedUntil: 0 };
  }
  try {
    const raw = localStorage.getItem(SIGNIN_THROTTLE_KEY);
    if (!raw) return { failures: 0, firstFailureAt: 0, blockedUntil: 0 };
    const parsed = JSON.parse(raw) as Partial<SignInThrottleState>;
    return {
      failures: Number(parsed.failures || 0),
      firstFailureAt: Number(parsed.firstFailureAt || 0),
      blockedUntil: Number(parsed.blockedUntil || 0),
    };
  } catch {
    return { failures: 0, firstFailureAt: 0, blockedUntil: 0 };
  }
}

function writeSignInThrottleState(nextState: SignInThrottleState) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SIGNIN_THROTTLE_KEY, JSON.stringify(nextState));
  } catch {
    // noop
  }
}

function resetSignInThrottleState() {
  writeSignInThrottleState({ failures: 0, firstFailureAt: 0, blockedUntil: 0 });
}

function getRemainingThrottleMs(state: SignInThrottleState): number {
  return Math.max(0, Number(state.blockedUntil || 0) - Date.now());
}

function registerSignInFailure(): SignInThrottleState {
  const now = Date.now();
  const current = readSignInThrottleState();
  const withinWindow = current.firstFailureAt > 0 && (now - current.firstFailureAt) <= SIGNIN_FAILURE_WINDOW_MS;
  const failures = withinWindow ? current.failures + 1 : 1;
  const firstFailureAt = withinWindow ? current.firstFailureAt : now;
  const blockedUntil = failures >= SIGNIN_FAILURE_LIMIT ? now + SIGNIN_THROTTLE_MS : 0;
  const nextState = { failures, firstFailureAt, blockedUntil };
  writeSignInThrottleState(nextState);
  return nextState;
}

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
        resetSignInThrottleState();
        queueRuntimeEvent('auth_signin_succeeded', {
          user_id: session.user.id,
          provider: String(session.user.app_metadata?.provider || 'password'),
        }, { userId: session.user.id, sampleRate: 1 });
        const hasCachedProfile = primeProfileFromCache(session.user.id);
        setProfileLoading(!hasCachedProfile);
        setLoading(false);
        void touchLastSeen(session.user.id);
        fetchProfile(session.user.id).finally(() => {
          setProfileLoading(false);
        });
        void registerDefaultDeviceTokenOnce();
      } else if (event === 'TOKEN_REFRESHED' && session?.user) {
        queueRuntimeEvent('auth_session_recovered', {
          user_id: session.user.id,
        }, { userId: session.user.id, sampleRate: 0.5 });
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
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const throttleState = readSignInThrottleState();
    const remainingThrottleMs = getRemainingThrottleMs(throttleState);
    if (remainingThrottleMs > 0) {
      queueRuntimeEvent('auth_signin_throttled', {
        email_hash_hint: normalizedEmail.slice(0, 3),
        remaining_ms: remainingThrottleMs,
      }, { sampleRate: 1 });
      return {
        error: new Error(`Too many failed sign-in attempts. Try again in ${Math.ceil(remainingThrottleMs / 1000)}s.`),
      };
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      const nextState = registerSignInFailure();
      queueRuntimeEvent('auth_signin_failed', {
        email_hash_hint: normalizedEmail.slice(0, 3),
        failures: nextState.failures,
        blocked_until: nextState.blockedUntil || null,
        message: String(error.message || 'Unknown sign-in error'),
      }, { sampleRate: 1 });
    } else {
      resetSignInThrottleState();
    }
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
      setProfile((prev) => {
        if (!prev) return null;
        const nextProfile = { ...prev, ...updates };
        writeCachedProfile(nextProfile);
        return nextProfile;
      });
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
