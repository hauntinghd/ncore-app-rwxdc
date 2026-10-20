/**
 * GIF Search (Tenor proxy) — Supabase Edge Function
 *
 * Request body:
 *   { action: 'search' | 'featured' | 'categories', query?: string,
 *     limit?: number, pos?: string }
 *
 * Response:
 *   { results: GifResult[], next: string } | { categories: Category[] }
 *
 * ## Why proxy instead of calling Tenor from the client
 * Tenor's key is nominally client-safe, but shipping it in the bundle means:
 * it is extracted and used by anyone within a day, the quota is then someone
 * else's problem, and rotating it needs a rebuild and redeploy of every
 * client. Behind this function the key is a server secret, set once with
 * `supabase secrets set TENOR_API_KEY=...`, and rotating it is instant.
 *
 * It also means every user's search terms go to Tenor from one address rather
 * than from each person's home IP.
 *
 * ## Setup
 *   1. Get a key: https://developers.google.com/tenor/guides/quickstart
 *   2. supabase secrets set TENOR_API_KEY=<key>
 *   3. supabase functions deploy gif-search
 *
 * Without the secret the function returns 503 and the picker hides itself
 * rather than showing a broken panel.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TENOR_API_KEY = Deno.env.get('TENOR_API_KEY') || '';
// Tenor asks for a stable client identifier so quota is attributed per app.
const TENOR_CLIENT_KEY = Deno.env.get('TENOR_CLIENT_KEY') || 'ncore';
const TENOR_BASE = 'https://tenor.googleapis.com/v2';

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 50;
const FETCH_TIMEOUT_MS = 8000;
/** Trending and categories change slowly; searches are cached briefly. */
const FEATURED_CACHE_MS = 10 * 60_000;
const SEARCH_CACHE_MS = 60_000;

interface GifResult {
  id: string;
  description: string;
  /** Full-size animated URL, for sending. */
  url: string;
  /** Small looping preview, for the grid. */
  previewUrl: string;
  width: number;
  height: number;
}

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

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  body: unknown;
  expiresAt: number;
}

/*
  Per-instance memo. Edge functions are short-lived and there may be several
  instances, so this is opportunistic — it exists to stop one person scrolling
  the picker from firing a request per keystroke, not to be a real cache tier.
*/
const cache = new Map<string, CacheEntry>();
const CACHE_LIMIT = 200;

function readCache(key: string): unknown | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.body;
}

function writeCache(key: string, body: unknown, ttlMs: number) {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { body, expiresAt: Date.now() + ttlMs });
}

// ---------------------------------------------------------------------------
// Tenor
// ---------------------------------------------------------------------------

interface TenorMediaFormat {
  url?: string;
  dims?: number[];
}

interface TenorResult {
  id?: string;
  content_description?: string;
  media_formats?: Record<string, TenorMediaFormat>;
}

/**
 * Picks the URLs to use from Tenor's format list.
 *
 * `gif` is the full-size animation to send. For the grid we want the smallest
 * thing that still animates — `tinygif` — because a grid of full-size GIFs is
 * tens of megabytes and janks the scroll on anything but a fast connection.
 */
function toGifResult(result: TenorResult): GifResult | null {
  const formats = result.media_formats ?? {};
  const full = formats.gif ?? formats.mediumgif ?? formats.tinygif;
  const preview = formats.tinygif ?? formats.nanogif ?? full;
  if (!full?.url || !preview?.url) return null;

  const dims = full.dims ?? [];
  return {
    id: String(result.id || full.url),
    description: String(result.content_description || 'GIF'),
    url: full.url,
    previewUrl: preview.url,
    width: Number(dims[0]) || 0,
    height: Number(dims[1]) || 0,
  };
}

async function callTenor(path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${TENOR_BASE}/${path}`);
  url.searchParams.set('key', TENOR_API_KEY);
  url.searchParams.set('client_key', TENOR_CLIENT_KEY);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Tenor returned ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

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

    if (!TENOR_API_KEY) {
      return json(
        { error: 'GIF search is not configured on this server.', code: 'not_configured' },
        503,
      );
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || 'featured');
    const limit = Math.min(Math.max(Number(body?.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const pos = String(body?.pos || '').slice(0, 200);
    const query = String(body?.query || '').trim().slice(0, 100);

    if (action === 'categories') {
      const cacheKey = 'categories';
      const cached = readCache(cacheKey);
      if (cached) return json(cached);

      const raw = (await callTenor('categories', { contentfilter: 'medium' })) as {
        tags?: Array<{ searchterm?: string; name?: string; image?: string }>;
      };
      const payload = {
        categories: (raw.tags ?? [])
          .map((tag) => ({
            term: String(tag.searchterm || tag.name || '').replace(/^#/, ''),
            image: String(tag.image || ''),
          }))
          .filter((tag) => tag.term),
      };
      writeCache(cacheKey, payload, FEATURED_CACHE_MS);
      return json(payload);
    }

    if (action !== 'search' && action !== 'featured') {
      return json({ error: 'Unknown action.' }, 400);
    }
    if (action === 'search' && !query) {
      return json({ error: 'A search needs a query.' }, 400);
    }

    const cacheKey = `${action}:${query}:${limit}:${pos}`;
    const cached = readCache(cacheKey);
    if (cached) return json(cached);

    const raw = (await callTenor(action, {
      q: query,
      limit: String(limit),
      pos,
      // 'medium' excludes explicit content. This is a chat app people use with
      // friends and coworkers; unfiltered is not a sensible default.
      contentfilter: 'medium',
      media_filter: 'gif,tinygif,nanogif,mediumgif',
    })) as { results?: TenorResult[]; next?: string };

    const payload = {
      results: (raw.results ?? [])
        .map(toGifResult)
        .filter((result): result is GifResult => result !== null),
      next: String(raw.next || ''),
    };

    writeCache(cacheKey, payload, action === 'featured' ? FEATURED_CACHE_MS : SEARCH_CACHE_MS);
    return json(payload);
  } catch (error) {
    console.error('gif-search error:', error);
    return json({ error: 'Could not reach the GIF service.' }, 502);
  }
});
