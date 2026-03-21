import { supabase } from './supabase';

const AGORA_STATIC_TOKEN = (import.meta.env.VITE_AGORA_TEMP_TOKEN || '').trim();
const AGORA_TOKEN_FUNCTION = (import.meta.env.VITE_AGORA_TOKEN_FUNCTION || 'agora-token').trim();
const AGORA_ALLOW_UNAUTH_JOIN = String(import.meta.env.VITE_AGORA_ALLOW_UNAUTH_JOIN || '').toLowerCase() === 'true';
const AGORA_TOKEN_FALLBACK_FUNCTIONS = ['agora-token-relaxed', 'agora-token-debug'];

function isFunctionsMissingError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('function not found') || normalized.includes('404') || normalized.includes('failed to fetch');
}

export async function resolveAgoraJoinToken(channelName: string, uid: string): Promise<string | null> {
  if (AGORA_STATIC_TOKEN) {
    return AGORA_STATIC_TOKEN;
  }

  const candidateFunctions = Array.from(
    new Set([AGORA_TOKEN_FUNCTION, ...AGORA_TOKEN_FALLBACK_FUNCTIONS].map((name) => String(name || '').trim()).filter(Boolean)),
  );
  const errors: string[] = [];

  for (const functionName of candidateFunctions) {
    const { data, error } = await supabase.functions.invoke(functionName, {
      body: { channelName, uid },
    });

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
    const reason = String(error?.message || functionReason || '').trim();
    if (reason) {
      errors.push(`${functionName}: ${reason}`);
    } else {
      errors.push(`${functionName}: empty token payload`);
    }
  }

  const requiresToken = !AGORA_ALLOW_UNAUTH_JOIN;
  if (requiresToken) {
    const reason = errors.join(' | ') || 'Token function returned empty payload';
    throw new Error(
      `Agora token is required but unavailable. Tried ${candidateFunctions.join(', ')}. Reason: ${reason}`.trim(),
    );
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
