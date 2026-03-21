import { supabase } from './supabase';

interface EnsureSessionResult {
  ok: boolean;
  message?: string;
  accessToken?: string;
  requiresReauth?: boolean;
}

interface EnsureSessionOptions {
  forceRefresh?: boolean;
  verifyOnServer?: boolean;
}

function isSessionNearExpiry(expiresAtSeconds?: number | null, minTtlSeconds = 120): boolean {
  if (!expiresAtSeconds || !Number.isFinite(expiresAtSeconds)) return true;
  const nowSeconds = Math.floor(Date.now() / 1000);
  return (expiresAtSeconds - nowSeconds) <= minTtlSeconds;
}

function isInvalidJwtMessage(value: unknown): boolean {
  const normalized = String(value || '').toLowerCase();
  return normalized.includes('invalid jwt')
    || normalized.includes('jwt malformed')
    || normalized.includes('jwt expired')
    || normalized.includes('token is expired')
    || normalized.includes('session_not_found')
    || normalized.includes('invalid token');
}

async function refreshAndReturnToken(): Promise<{ token?: string; error?: string }> {
  const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError || !refreshed.session?.access_token) {
    return {
      error: refreshError?.message || 'Your session is no longer valid. Please sign in again.',
    };
  }
  return { token: refreshed.session.access_token };
}

async function verifyAccessToken(accessToken: string): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data?.user) {
    return {
      ok: false,
      error: error?.message || 'Authentication validation failed.',
    };
  }
  return { ok: true };
}

export async function ensureFreshAuthSession(
  minTtlSeconds = 120,
  options: EnsureSessionOptions = {},
): Promise<EnsureSessionResult> {
  const { forceRefresh = false, verifyOnServer = true } = options;
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    return {
      ok: false,
      message: sessionError.message || 'Authentication session lookup failed.',
    };
  }

  const session = sessionData.session;
  if (!session) {
    return {
      ok: false,
      message: 'Your session has expired. Please sign in again.',
      requiresReauth: true,
    };
  }

  let accessToken = String(session.access_token || '');
  if (!accessToken) {
    return {
      ok: false,
      message: 'Your session has expired. Please sign in again.',
      requiresReauth: true,
    };
  }

  const shouldRefresh = forceRefresh || isSessionNearExpiry(session.expires_at ?? null, minTtlSeconds);
  if (shouldRefresh) {
    const refreshed = await refreshAndReturnToken();
    if (!refreshed.token) {
      return {
        ok: false,
        message: refreshed.error || 'Your session is no longer valid. Please sign in again.',
        requiresReauth: true,
      };
    }
    accessToken = refreshed.token;
  }

  if (!verifyOnServer) {
    return { ok: true, accessToken };
  }

  let verification = await verifyAccessToken(accessToken);
  if (verification.ok) {
    return { ok: true, accessToken };
  }

  // Handle server-side JWT rejection even when local expiry says token is valid.
  const needsJwtRecovery = isInvalidJwtMessage(verification.error);
  if (needsJwtRecovery) {
    const refreshed = await refreshAndReturnToken();
    if (refreshed.token) {
      accessToken = refreshed.token;
      verification = await verifyAccessToken(accessToken);
      if (verification.ok) {
        return { ok: true, accessToken };
      }
    }
  }

  if (isInvalidJwtMessage(verification.error)) {
    return {
      ok: false,
      message: 'Your login session expired and was rejected by Supabase. Please sign in again.',
      requiresReauth: true,
    };
  }

  return {
    ok: false,
    message: verification.error || 'Authentication validation failed.',
  };
}
