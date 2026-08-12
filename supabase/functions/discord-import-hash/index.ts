/**
 * Discord Import Hash — Supabase Edge Function
 *
 * Request body:
 *   { ids: string[] }   // Discord snowflake IDs, max 2000 per call
 *
 * Response:
 *   { hashes: string[] }  // HMAC-SHA256 fingerprints, hex, same order
 *
 * ## Why a server-side HMAC instead of hashing in the client
 * The import feature stores fingerprints of Discord IDs so that two people
 * who both imported their packages can be matched without the server keeping
 * the raw graph. A plain client-side hash (even salted with a public value)
 * would let anyone holding a database dump test "is Discord user X in here"
 * — snowflakes are public identifiers, so membership testing is the actual
 * threat. Keying the hash with a secret pepper that only this function holds
 * means a database leak alone proves nothing.
 *
 * The trade-off, stated plainly: raw IDs transit this function in memory and
 * are discarded. Nothing here logs or stores them.
 *
 * ## Setup
 *   1. Generate a pepper: `openssl rand -hex 32`
 *   2. supabase secrets set DISCORD_IMPORT_PEPPER=<value>
 *   3. supabase functions deploy discord-import-hash --use-api --project-ref <ref>
 *
 * Rotating the pepper invalidates every stored fingerprint (identity links
 * and edges would need to be re-imported), so treat it like a signing key,
 * not like an API credential you cycle routinely.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PEPPER = Deno.env.get('DISCORD_IMPORT_PEPPER') || '';

const MAX_IDS_PER_CALL = 2000;
/** Snowflakes are 64-bit decimal strings; anything else is not a Discord ID. */
const SNOWFLAKE_PATTERN = /^\d{5,25}$/;

function extractAuthSub(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!bearer) return null;
  try {
    const parts = bearer.split('.');
    if (parts.length !== 3) return null;
    const padded = parts[1] + '='.repeat((4 - (parts[1].length % 4)) % 4);
    const payload = JSON.parse(atob(padded.replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return String(payload.sub || '').trim() || null;
  } catch {
    return null;
  }
}

let hmacKeyPromise: Promise<CryptoKey> | null = null;

function getHmacKey(): Promise<CryptoKey> {
  if (!hmacKeyPromise) {
    hmacKeyPromise = crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(PEPPER),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  }
  return hmacKeyPromise;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function fingerprint(id: string, key: CryptoKey): Promise<string> {
  // Version prefix so the input encoding can evolve without colliding with
  // fingerprints already in the database.
  const message = new TextEncoder().encode(`v1:${id}`);
  return toHex(await crypto.subtle.sign('HMAC', key, message));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });

  try {
    const userId = extractAuthSub(req.headers.get('authorization'));
    if (!userId) return json({ error: 'Unauthorized' }, 401);

    if (!PEPPER) {
      return json(
        { error: 'Discord import is not configured on this server.', code: 'not_configured' },
        503,
      );
    }

    const body = await req.json().catch(() => ({}));
    const rawIds = Array.isArray(body?.ids) ? body.ids : null;
    if (!rawIds) {
      return json({ error: 'Body must be { ids: string[] }.' }, 400);
    }
    if (rawIds.length === 0) {
      return json({ hashes: [] });
    }
    if (rawIds.length > MAX_IDS_PER_CALL) {
      return json({ error: `At most ${MAX_IDS_PER_CALL} ids per call.` }, 400);
    }

    const ids: string[] = [];
    for (const raw of rawIds) {
      const id = String(raw ?? '').trim();
      if (!SNOWFLAKE_PATTERN.test(id)) {
        return json({ error: 'One or more ids are not Discord snowflakes.' }, 400);
      }
      ids.push(id);
    }

    const key = await getHmacKey();
    const hashes = await Promise.all(ids.map((id) => fingerprint(id, key)));
    return json({ hashes });
  } catch (error) {
    console.error('discord-import-hash error:', error);
    return json({ error: 'Fingerprinting failed.' }, 500);
  }
});
