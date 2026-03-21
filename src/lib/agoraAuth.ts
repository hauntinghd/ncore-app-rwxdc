import { supabase } from './supabase';

const AGORA_STATIC_TOKEN = (import.meta.env.VITE_AGORA_TEMP_TOKEN || '').trim();
const AGORA_TOKEN_FUNCTION = (import.meta.env.VITE_AGORA_TOKEN_FUNCTION || 'agora-token').trim();
const AGORA_ALLOW_UNAUTH_JOIN = String(import.meta.env.VITE_AGORA_ALLOW_UNAUTH_JOIN || 'true').toLowerCase() === 'true';
const AGORA_REQUIRE_TOKEN = String(import.meta.env.VITE_AGORA_REQUIRE_TOKEN || '').toLowerCase() === 'true';
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();
const AGORA_TOKEN_FALLBACK_FUNCTIONS = ['agora-token-relaxed', 'agora-token-debug'];

function isFunctionsMissingError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('function not found')
    || normalized.includes('404')
    || normalized.includes('failed to fetch')
    || normalized.includes('non-2xx')
    || normalized.includes('network')
    || normalized.includes('fetch');
}

function isLikelyTransientFunctionsError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('non-2xx')
    || normalized.includes('failed to fetch')
    || normalized.includes('network')
    || normalized.includes('timeout')
    || normalized.includes('internal server error')
    || normalized.includes('service unavailable')
    || normalized.includes('function not found')
    || normalized.includes('404')
    || normalized.includes('500')
    || normalized.includes('502')
    || normalized.includes('503')
    || normalized.includes('504');
}

function isLikelyAuthFailure(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('status 401')
    || normalized.includes('status 403')
    || normalized.includes('unauthorized')
    || normalized.includes('forbidden')
    || normalized.includes('invalid bearer')
    || normalized.includes('invalid jwt')
    || normalized.includes('expired token')
    || normalized.includes('jwt')
    || normalized.includes('missing authorization');
}

async function resolveSessionAuthBearer(): Promise<string> {
  try {
    const { data } = await supabase.auth.getSession();
    const accessToken = String(data?.session?.access_token || '').trim();
    if (accessToken) return accessToken;
  } catch {
    // ignore auth session read failures and continue fallback.
  }
  return '';
}

async function resolveInvokeBearerCandidates(): Promise<Array<{ label: string; token: string }>> {
  const sessionToken = await resolveSessionAuthBearer();
  const candidates: Array<{ label: string; token: string }> = [];

  if (sessionToken) {
    candidates.push({ label: 'session', token: sessionToken });
  }
  if (SUPABASE_ANON_KEY) {
    candidates.push({ label: 'anon', token: SUPABASE_ANON_KEY });
  }
  if (!candidates.length && sessionToken) {
    candidates.push({ label: 'fallback', token: sessionToken });
  }

  return candidates.filter((candidate, index, all) =>
    all.findIndex((other) => other.token === candidate.token) === index,
  );
}

async function buildInvokeErrorReason(error: any, functionReason: string): Promise<string> {
  const baseReason = String(error?.message || functionReason || '').trim();
  const response = (error as any)?.context;
  if (!response || typeof response !== 'object') {
    return baseReason;
  }

  const status = Number((response as any)?.status || 0);
  let parsedMessage = '';
  try {
    const bodyText = String(await (response as Response).clone().text()).trim();
    if (bodyText) {
      try {
        const parsed = JSON.parse(bodyText) as any;
        parsedMessage = String(parsed?.error || parsed?.message || bodyText).trim();
      } catch {
        parsedMessage = bodyText;
      }
    }
  } catch {
    // ignore response parse failures
  }

  return [
    Number.isFinite(status) && status > 0 ? `status ${status}` : '',
    baseReason,
    parsedMessage,
  ].filter(Boolean).join(' | ');
}

export async function resolveAgoraJoinToken(channelName: string, uid: string): Promise<string | null> {
  if (AGORA_STATIC_TOKEN) {
    return AGORA_STATIC_TOKEN;
  }

  const candidateFunctions = Array.from(
    new Set([AGORA_TOKEN_FUNCTION, ...AGORA_TOKEN_FALLBACK_FUNCTIONS].map((name) => String(name || '').trim()).filter(Boolean)),
  );
  const bearerCandidates = await resolveInvokeBearerCandidates();
  const errors: string[] = [];

  for (const functionName of candidateFunctions) {
    const attempts = bearerCandidates.length ? bearerCandidates : [{ label: 'none', token: '' }];
    for (let i = 0; i < attempts.length; i += 1) {
      const attempt = attempts[i];
      const invokeHeaders: Record<string, string> = {};
      if (attempt.token) {
        invokeHeaders.Authorization = `Bearer ${attempt.token}`;
      }
      if (SUPABASE_ANON_KEY) {
        invokeHeaders.apikey = SUPABASE_ANON_KEY;
      }

      let data: any = null;
      let error: any = null;
      try {
        const response = await supabase.functions.invoke(functionName, {
          body: { channelName, uid },
          headers: invokeHeaders,
        });
        data = response?.data;
        error = response?.error;
      } catch (invokeError) {
        error = invokeError;
      }

      const resolvedToken =
        typeof data === 'string'
          ? data.trim()
          : typeof (data as any)?.token === 'string'
            ? (data as any).token.trim()
            : '';
      if (resolvedToken) {
        return resolvedToken;
      }

      const functionReason =
        data && typeof data === 'object' && typeof (data as any).error === 'string'
          ? (data as any).error
          : '';
      const reason = await buildInvokeErrorReason(error, functionReason);
      if (reason) {
        errors.push(`${functionName}/${attempt.label}: ${reason}`);
      } else {
        errors.push(`${functionName}/${attempt.label}: empty token payload`);
      }

      // Keep trying alternate bearer candidates (e.g. anon) when the current
      // session bearer is stale/invalid.
      if (!isLikelyAuthFailure(reason) && i < attempts.length - 1) {
        continue;
      }
    }
  }

  const requiresToken = AGORA_REQUIRE_TOKEN || !AGORA_ALLOW_UNAUTH_JOIN;
  if (requiresToken) {
    const reason = errors.join(' | ') || 'Token function returned empty payload';
    throw new Error(
      `Agora token is required but unavailable. Tried ${candidateFunctions.join(', ')}. Reason: ${reason}`.trim(),
    );
  }

  const reasonBlob = errors.join(' | ').trim();
  if (reasonBlob && !errors.every((reason) => isLikelyTransientFunctionsError(reason))) {
    console.warn('Agora token fetch returned non-transient response; proceeding with unauthenticated join fallback.', reasonBlob);
  } else if (reasonBlob) {
    console.warn('Agora token fetch unavailable; proceeding with unauthenticated join fallback.', reasonBlob);
  }

  for (const reason of errors) {
    if (!isFunctionsMissingError(reason)) {
      console.warn('Agora token fetch warning:', reason);
    }
  }
  return null;
}

export function describeAgoraJoinFailure(error: unknown): string {
  const e = error as any;
  const message = String(e?.message || '');
  const code = String(e?.code || '');
  const normalized = `${code} ${message}`.toUpperCase();

  if (normalized.includes('CAN_NOT_GET_GATEWAY_SERVER') || normalized.includes('DYNAMIC USE STATIC KEY')) {
    return 'Agora project requires token-based join. Owner must configure the `agora-token` Supabase function once; all users will work after that.';
  }

  return message || String(error);
}
