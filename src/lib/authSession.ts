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

function isDefinitiveReauthError(error: unknown): boolean {
  const message = String((error as any)?.message || error || '').toLowerCase();
  const code = String((error as any)?.code || '').toLowerCase();
  const status = Number((error as any)?.status || (error as any)?.statusCode || 0);
  if (isInvalidJwtMessage(message)) return true;
  if (status === 401 || status === 403) return true;
  return (
    code.includes('invalid_grant')
    || message.includes('invalid_grant')
    || message.includes('refresh token') && (
      message.includes('invalid')
      || message.includes('expired')
      || message.includes('revoked')
      || message.includes('not found')
      || message.includes('session not found')
    )
    || message.includes('user not found')
    || message.includes('token has expired')
  );
}

function isTransientAuthError(error: unknown): boolean {
  const message = String((error as any)?.message || error || '').toLowerCase();
  const status = Number((error as any)?.status || (error as any)?.statusCode || 0);
  if (status >= 500 || status === 408 || status === 429 || status === 0) return true;
  return (
    message.includes('network')
    || message.includes('fetch failed')
    || message.includes('failed to fetch')
    || message.includes('timeout')
    || message.includes('temporar')
    || message.includes('service unavailable')
    || message.includes('gateway')
    || message.includes('connection')
    || message.includes('offline')
  );
}

async function refreshAndReturnToken(): Promise<{ token?: string; error?: string; requiresReauth?: boolean }> {
  const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError || !refreshed.session?.access_token) {
    const defaultMessage = 'Session refresh failed. NCore will retry automatically.';
    return {
      error: refreshError?.message || defaultMessage,
      requiresReauth: isDefinitiveReauthError(refreshError),
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
      // Keep the user signed in on transient refresh failures; only require
      // re-login for definitive invalid/revoked token conditions.
      if (!refreshed.requiresReauth) {
        return {
          ok: true,
          accessToken,
          message: refreshed.error || 'Session refresh was skipped. Continuing with current session.',
        };
      }
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

  if (isTransientAuthError(verification.error)) {
    return {
      ok: true,
      accessToken,
      message: verification.error || 'Auth verification was skipped due a temporary network issue.',
    };
  }

  return {
    ok: false,
    message: verification.error || 'Authentication validation failed.',
  };
}
