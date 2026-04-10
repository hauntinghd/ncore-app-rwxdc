/**
 * LiveKit Token Generator - Supabase Edge Function
 *
 * Generates LiveKit JWTs for authenticated users to join rooms.
 * Mirrors the pattern from agora-token but uses LiveKit's AccessToken.
 *
 * Environment variables:
 *   LIVEKIT_API_KEY    - LiveKit API key
 *   LIVEKIT_API_SECRET - LiveKit API secret
 *
 * Request body:
 *   { channelName: string, uid: string }
 *
 * Response:
 *   { token: string, uid: string, expiresAt: number }
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const CHANNEL_NAME_REGEX = /^[a-zA-Z0-9:_-]{1,64}$/;
const TOKEN_EXPIRY_SECONDS = 3600; // 1 hour

function base64UrlEncode(data: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...data));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): string {
  const padded = str + '='.repeat((4 - (str.length % 4)) % 4);
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  return atob(base64);
}

/**
 * Generate a LiveKit-compatible JWT access token.
 * This avoids a dependency on the LiveKit server SDK by manually
 * constructing the JWT with the Web Crypto API.
 */
async function generateLiveKitToken(
  apiKey: string,
  apiSecret: string,
  roomName: string,
  identity: string,
  expirySeconds: number,
): Promise<{ token: string; expiresAt: number }> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + expirySeconds;

  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };

  const payload = {
    iss: apiKey,
    sub: identity,
    iat: now,
    nbf: now,
    exp,
    jti: `${identity}-${now}-${Math.random().toString(36).slice(2, 10)}`,
    video: {
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
  };

  const encoder = new TextEncoder();
  const headerB64 = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(apiSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput));
  const signatureB64 = base64UrlEncode(new Uint8Array(signature));

  return {
    token: `${signingInput}.${signatureB64}`,
    expiresAt: exp,
  };
}

/**
 * Decode and validate the Supabase auth JWT from the Authorization header.
 * Returns the user's `sub` claim or null if no valid token.
 */
function extractAuthSub(authHeader: string | null): { sub: string | null; error: string | null } {
  if (!authHeader) return { sub: null, error: null };

  const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!bearer) return { sub: null, error: null };

  try {
    const parts = bearer.split('.');
    if (parts.length !== 3) return { sub: null, error: 'Malformed JWT' };

    const payloadJson = base64UrlDecode(parts[1]);
    const payload = JSON.parse(payloadJson);

    if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) {
      return { sub: null, error: 'Token expired' };
    }

    return { sub: String(payload.sub || '').trim() || null, error: null };
  } catch {
    return { sub: null, error: 'Invalid JWT' };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const apiKey = Deno.env.get('LIVEKIT_API_KEY') || '';
    const apiSecret = Deno.env.get('LIVEKIT_API_SECRET') || '';

    if (!apiKey || !apiSecret) {
      return new Response(JSON.stringify({ error: 'LiveKit API credentials not configured' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const channelName = String(body?.channelName || '').trim();
    const uid = String(body?.uid || '').trim();

    if (!channelName) {
      return new Response(JSON.stringify({ error: 'Missing channelName' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    if (!CHANNEL_NAME_REGEX.test(channelName)) {
      return new Response(JSON.stringify({ error: 'Invalid channelName format' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    if (!uid) {
      return new Response(JSON.stringify({ error: 'Missing uid' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Validate auth token if provided.
    const authHeader = req.headers.get('authorization');
    const { sub, error: authError } = extractAuthSub(authHeader);

    if (authError) {
      return new Response(JSON.stringify({ error: authError }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Enforce UID matching: authenticated user can only join as themselves or ::screen variant.
    if (sub) {
      const isOwnUid = uid === sub;
      const isScreenUid = uid.startsWith(`${sub}::screen`);
      if (!isOwnUid && !isScreenUid) {
        return new Response(JSON.stringify({ error: 'UID does not match authenticated user' }), {
          status: 403,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }
    }

    const { token, expiresAt } = await generateLiveKitToken(
      apiKey,
      apiSecret,
      channelName,
      uid,
      TOKEN_EXPIRY_SECONDS,
    );

    return new Response(JSON.stringify({ token, uid, expiresAt }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('LiveKit token generation error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
