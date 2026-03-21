import { supabase } from './supabase';

const AGORA_STATIC_TOKEN = (import.meta.env.VITE_AGORA_TEMP_TOKEN || '').trim();
const AGORA_TOKEN_FUNCTION = (import.meta.env.VITE_AGORA_TOKEN_FUNCTION || 'agora-token').trim();
const AGORA_ALLOW_UNAUTH_JOIN = String(import.meta.env.VITE_AGORA_ALLOW_UNAUTH_JOIN || '').toLowerCase() === 'true';

function isFunctionsMissingError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('function not found') || normalized.includes('404') || normalized.includes('failed to fetch');
}

export async function resolveAgoraJoinToken(channelName: string, uid: string): Promise<string | null> {
  if (AGORA_STATIC_TOKEN) {
    return AGORA_STATIC_TOKEN;
  }

  const { data, error } = await supabase.functions.invoke(AGORA_TOKEN_FUNCTION, {
    body: { channelName, uid },
  });

  if (!error && data) {
    if (typeof data === 'string') {
      return data;
    }
    if (typeof (data as any).token === 'string' && (data as any).token.trim()) {
      return (data as any).token.trim();
    }
  }

  const errorMessage = error?.message || '';
  const resolvedToken =
    typeof data === 'string'
      ? data.trim()
      : typeof (data as any)?.token === 'string'
        ? (data as any).token.trim()
        : '';

  if (resolvedToken) {
    return resolvedToken;
  }

  const requiresToken = !AGORA_ALLOW_UNAUTH_JOIN;
  if (requiresToken) {
    const functionReason =
      data && typeof data === 'object' && typeof (data as any).error === 'string'
        ? (data as any).error
        : '';
    const reason = errorMessage || functionReason || 'Token function returned empty payload';
    throw new Error(
      `Agora token is required but unavailable. Check Supabase Edge Function "${AGORA_TOKEN_FUNCTION}". Reason: ${reason}`.trim(),
    );
  }

  if (errorMessage && !isFunctionsMissingError(errorMessage)) {
    console.warn('Agora token fetch warning:', errorMessage);
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
