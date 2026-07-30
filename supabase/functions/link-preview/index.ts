/**
 * Link Preview (unfurl) — Supabase Edge Function
 *
 * Fetches Open Graph / Twitter Card metadata for URLs posted in chat and caches
 * the result in `link_embeds`. Clients read the cache directly and only call
 * this function for misses.
 *
 * Request body:
 *   { urls: string[] }            // max 8 per call
 *
 * Response:
 *   { embeds: LinkEmbedRow[] }    // one row per input URL, including failures
 *
 * ## Threat model
 * This function makes outbound HTTP requests to hostnames chosen by whoever
 * typed a message. That is a server-side request forgery primitive unless it is
 * fenced in, so:
 *
 *   - only http/https, only default ports
 *   - every hostname is resolved and every resolved address is checked against
 *     private, loopback, link-local, and carrier-NAT ranges before we connect
 *   - redirects are followed manually so each hop gets the same check — a public
 *     host that 302s to 169.254.169.254 is the classic bypass
 *   - responses are capped at 512 KB and 8 seconds, and we stop reading at
 *     </head> because everything we want is above it
 *   - only metadata is ever returned; the response body never reaches a client
 *
 * Failures are cached with a short TTL so a slow or hostile host cannot be used
 * to hammer this function by reposting the same link.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const MAX_URLS_PER_REQUEST = 8;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 512 * 1024;
const OK_TTL_HOURS = 168; // 7 days
const ERROR_TTL_HOURS = 6;
const USER_AGENT = 'NCoreBot/1.0 (+https://ncore.nyptidindustries.com; link preview)';

type EmbedStatus = 'ok' | 'error' | 'blocked' | 'unsupported';

interface EmbedRow {
  url_hash: string;
  url: string;
  canonical_url: string | null;
  site_name: string | null;
  title: string | null;
  description: string | null;
  image_url: string | null;
  favicon_url: string | null;
  embed_type: 'link' | 'image' | 'video' | 'article';
  media_width: number | null;
  media_height: number | null;
  status: EmbedStatus;
  error_reason: string | null;
  fetched_at: string;
  expires_at: string;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

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
// URL normalization — must match src/lib/linkEmbeds.ts
// ---------------------------------------------------------------------------

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'utm_id', 'utm_name', 'fbclid', 'gclid', 'dclid', 'msclkid', 'mc_eid',
  'igshid', 'ref_src', 'ref_url', '_ga', 'yclid', 'twclid',
]);

function normalizeUrl(raw: string): string | null {
  try {
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`;
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.hash = '';

    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) parsed.searchParams.delete(key);
    }
    parsed.search = parsed.searchParams.toString() ? `?${parsed.searchParams.toString()}` : '';

    // A bare host and a bare host with a trailing slash are the same page.
    if (parsed.pathname === '/') parsed.pathname = '';

    return parsed.toString();
  } catch {
    return null;
  }
}

async function hashUrl(normalized: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// SSRF guards
// ---------------------------------------------------------------------------

function ipv4ToInt(address: string): number | null {
  const octets = address.split('.');
  if (octets.length !== 4) return null;
  let value = 0;
  for (const octet of octets) {
    if (!/^\d{1,3}$/.test(octet)) return null;
    const parsed = Number(octet);
    if (parsed > 255) return null;
    value = value * 256 + parsed;
  }
  return value;
}

/** CIDR blocks that must never be reachable from this function. */
const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8],        // "this network"
  ['10.0.0.0', 8],       // RFC1918
  ['100.64.0.0', 10],    // carrier NAT
  ['127.0.0.0', 8],      // loopback
  ['169.254.0.0', 16],   // link-local — cloud metadata lives here
  ['172.16.0.0', 12],    // RFC1918
  ['192.0.0.0', 24],     // IETF protocol assignments
  ['192.0.2.0', 24],     // documentation
  ['192.168.0.0', 16],   // RFC1918
  ['198.18.0.0', 15],    // benchmarking
  ['198.51.100.0', 24],  // documentation
  ['203.0.113.0', 24],   // documentation
  ['224.0.0.0', 4],      // multicast
  ['240.0.0.0', 4],      // reserved, includes broadcast
];

function isBlockedIpv4(address: string): boolean {
  const value = ipv4ToInt(address);
  if (value === null) return true; // unparseable means we do not connect
  for (const [base, bits] of BLOCKED_V4) {
    const baseValue = ipv4ToInt(base);
    if (baseValue === null) continue;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((value & mask) === (baseValue & mask)) return true;
  }
  return false;
}

function isBlockedIpv6(address: string): boolean {
  const lower = address.toLowerCase().split('%')[0];
  if (lower === '::' || lower === '::1') return true;

  // IPv4-mapped (::ffff:10.0.0.1) and NAT64 — judge by the embedded v4 address.
  const mapped = lower.match(/(?:^::ffff:|^64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIpv4(mapped[1]);

  const firstGroup = lower.split(':')[0];
  if (!firstGroup) return false;
  const leading = parseInt(firstGroup, 16);
  if (Number.isNaN(leading)) return true;

  if ((leading & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((leading & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((leading & 0xffff) === 0x2001 && lower.startsWith('2001:db8')) return true; // documentation
  return false;
}

function isIpLiteral(hostname: string): 'v4' | 'v6' | null {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return 'v4';
  if (hostname.includes(':') || (hostname.startsWith('[') && hostname.endsWith(']'))) return 'v6';
  return null;
}

/**
 * Confirms a URL is safe to connect to. Resolves DNS and rejects if *any*
 * returned address is in a blocked range — a hostname with both a public and a
 * private record is a DNS-rebinding attempt, not a legitimate site.
 */
async function assertSafeTarget(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedError('Only http and https links can be previewed.');
  }
  if (url.port && url.port !== '80' && url.port !== '443') {
    throw new BlockedError('Only standard web ports can be previewed.');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (!hostname) throw new BlockedError('Missing hostname.');

  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.internal')) {
    throw new BlockedError('Internal hostnames cannot be previewed.');
  }

  const literal = isIpLiteral(hostname);
  if (literal === 'v4') {
    if (isBlockedIpv4(hostname)) throw new BlockedError('That address range cannot be previewed.');
    return;
  }
  if (literal === 'v6') {
    if (isBlockedIpv6(hostname)) throw new BlockedError('That address range cannot be previewed.');
    return;
  }

  const addresses: string[] = [];
  for (const recordType of ['A', 'AAAA'] as const) {
    try {
      addresses.push(...(await Deno.resolveDns(hostname, recordType)));
    } catch {
      // A missing record type is normal (v4-only or v6-only hosts).
    }
  }

  if (addresses.length === 0) {
    throw new BlockedError('That hostname does not resolve.');
  }
  for (const address of addresses) {
    const blocked = address.includes(':') ? isBlockedIpv6(address) : isBlockedIpv4(address);
    if (blocked) throw new BlockedError('That hostname resolves to a private address.');
  }
}

class BlockedError extends Error {}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

interface FetchedPage {
  finalUrl: string;
  contentType: string;
  body: string;
}

/**
 * Fetches a page with redirects followed by hand, so each hop is re-validated.
 * Reading stops at `</head>` or MAX_BODY_BYTES, whichever comes first.
 */
async function fetchPage(startUrl: string): Promise<FetchedPage> {
  let current = new URL(startUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertSafeTarget(current);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(current.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
          'Accept-Language': 'en',
        },
      });
    } catch (fetchError) {
      clearTimeout(timer);
      if (controller.signal.aborted) throw new Error('That site took too long to respond.');
      throw new Error(fetchError instanceof Error ? fetchError.message : 'Request failed.');
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      clearTimeout(timer);
      if (!location) throw new Error('Redirect without a destination.');
      if (hop === MAX_REDIRECTS) throw new Error('Too many redirects.');
      current = new URL(location, current);
      continue;
    }

    try {
      if (!response.ok) {
        throw new Error(`That site returned ${response.status}.`);
      }

      const contentType = (response.headers.get('content-type') || '').toLowerCase();

      // Direct media links have no HTML to parse; the URL itself is the embed.
      if (contentType.startsWith('image/')) {
        return { finalUrl: current.toString(), contentType, body: '' };
      }
      if (!contentType.includes('html') && !contentType.includes('xml') && contentType !== '') {
        throw new UnsupportedError('That link is not a web page.');
      }

      return {
        finalUrl: current.toString(),
        contentType,
        body: await readCapped(response),
      };
    } finally {
      // `cancel()` throws synchronously on a stream that readCapped already
      // locked, so this needs a try rather than a rejection handler.
      try {
        if (response.body && !response.body.locked) await response.body.cancel();
      } catch {
        // Nothing useful to do; the connection is being dropped either way.
      }
      clearTimeout(timer);
    }
  }

  throw new Error('Too many redirects.');
}

class UnsupportedError extends Error {}

/** Reads at most MAX_BODY_BYTES, stopping early once `</head>` is in hand. */
async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';

  const decoder = new TextDecoder('utf-8', { fatal: false });
  let text = '';
  let total = 0;

  while (total < MAX_BODY_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    text += decoder.decode(value, { stream: true });
    if (/<\/head>/i.test(text)) break;
  }

  await reader.cancel().catch(() => {});
  return text;
}

// ---------------------------------------------------------------------------
// Metadata parsing
// ---------------------------------------------------------------------------

function decodeEntities(value: string): string {
  return value
    .replace(/&(?:#(\d+)|#x([0-9a-f]+));/gi, (_match, dec, hex) => {
      const code = dec ? Number(dec) : parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function clean(value: string | null | undefined, maxLength: number): string | null {
  if (!value) return null;
  const collapsed = decodeEntities(value).replace(/\s+/g, ' ').trim();
  if (!collapsed) return null;
  return collapsed.length > maxLength ? `${collapsed.slice(0, maxLength - 1)}…` : collapsed;
}

/** Pulls `<meta>` name/property → content pairs out of the document head. */
function parseMetaTags(html: string): Map<string, string> {
  const head = html.split(/<\/head>/i)[0] ?? html;
  const tags = new Map<string, string>();

  for (const match of head.matchAll(/<meta\s+([^>]+?)\/?>/gi)) {
    const attributes = match[1];
    const key =
      attributes.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1] ??
      null;
    const content = attributes.match(/content\s*=\s*["']([^"']*)["']/i)?.[1] ?? null;
    if (!key || content === null) continue;
    const normalizedKey = key.toLowerCase();
    // First occurrence wins: pages sometimes repeat og:image for a gallery.
    if (!tags.has(normalizedKey)) tags.set(normalizedKey, content);
  }

  const title = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (title && !tags.has('__title')) tags.set('__title', title);

  const canonical = head.match(
    /<link\s+[^>]*rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']+)["']/i,
  )?.[1];
  if (canonical) tags.set('__canonical', canonical);

  const icon = head.match(
    /<link\s+[^>]*rel\s*=\s*["'](?:shortcut )?icon["'][^>]*href\s*=\s*["']([^"']+)["']/i,
  )?.[1];
  if (icon) tags.set('__icon', icon);

  return tags;
}

function absolutize(value: string | null, base: string): string | null {
  if (!value) return null;
  try {
    const resolved = new URL(value, base);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
    return resolved.toString();
  } catch {
    return null;
  }
}

function parseDimension(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 20000) return null;
  return parsed;
}

function buildEmbed(page: FetchedPage, urlHash: string, requestedUrl: string): EmbedRow {
  const now = new Date();
  const base: EmbedRow = {
    url_hash: urlHash,
    url: requestedUrl,
    canonical_url: page.finalUrl,
    site_name: null,
    title: null,
    description: null,
    image_url: null,
    favicon_url: null,
    embed_type: 'link',
    media_width: null,
    media_height: null,
    status: 'ok',
    error_reason: null,
    fetched_at: now.toISOString(),
    expires_at: new Date(now.getTime() + OK_TTL_HOURS * 3600_000).toISOString(),
  };

  if (page.contentType.startsWith('image/')) {
    return { ...base, embed_type: 'image', image_url: page.finalUrl };
  }

  const tags = parseMetaTags(page.body);
  const pick = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = clean(tags.get(key), 400);
      if (value) return value;
    }
    return null;
  };

  const ogType = (tags.get('og:type') || '').toLowerCase();
  const hasVideo = Boolean(tags.get('og:video') || tags.get('og:video:url') || tags.get('twitter:player'));

  return {
    ...base,
    canonical_url: absolutize(tags.get('__canonical') ?? null, page.finalUrl) ?? page.finalUrl,
    site_name: pick('og:site_name', 'twitter:site', 'application-name'),
    title: pick('og:title', 'twitter:title', '__title'),
    description: pick('og:description', 'twitter:description', 'description'),
    image_url: absolutize(
      tags.get('og:image:secure_url') ||
        tags.get('og:image') ||
        tags.get('twitter:image') ||
        tags.get('twitter:image:src') ||
        null,
      page.finalUrl,
    ),
    favicon_url: absolutize(tags.get('__icon') ?? '/favicon.ico', page.finalUrl),
    embed_type: hasVideo ? 'video' : ogType === 'article' ? 'article' : 'link',
    media_width: parseDimension(tags.get('og:image:width')),
    media_height: parseDimension(tags.get('og:image:height')),
  };
}

function buildFailure(
  urlHash: string,
  requestedUrl: string,
  status: EmbedStatus,
  reason: string,
): EmbedRow {
  const now = new Date();
  return {
    url_hash: urlHash,
    url: requestedUrl,
    canonical_url: null,
    site_name: null,
    title: null,
    description: null,
    image_url: null,
    favicon_url: null,
    embed_type: 'link',
    media_width: null,
    media_height: null,
    status,
    error_reason: reason.slice(0, 300),
    fetched_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ERROR_TTL_HOURS * 3600_000).toISOString(),
  };
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

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
      return json({ error: 'Link previews are not configured on this server.' }, 503);
    }

    const body = await req.json().catch(() => ({}));
    const rawUrls: unknown = body?.urls;
    if (!Array.isArray(rawUrls) || rawUrls.length === 0) {
      return json({ error: 'Provide a non-empty `urls` array.' }, 400);
    }

    // Normalize and dedupe before doing any work, so a message that repeats the
    // same link ten times costs one fetch.
    const targets = new Map<string, { url: string; hash: string }>();
    for (const candidate of rawUrls.slice(0, MAX_URLS_PER_REQUEST * 4)) {
      if (typeof candidate !== 'string') continue;
      const normalized = normalizeUrl(candidate.trim());
      if (!normalized) continue;
      const hash = await hashUrl(normalized);
      if (!targets.has(hash)) targets.set(hash, { url: normalized, hash });
      if (targets.size >= MAX_URLS_PER_REQUEST) break;
    }

    if (targets.size === 0) {
      return json({ embeds: [] });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    // Re-check the cache: several clients rendering the same message will race
    // to call this function, and the first one to land makes the rest free.
    const hashes = [...targets.keys()];
    const { data: cached } = await admin
      .from('link_embeds')
      .select('*')
      .in('url_hash', hashes)
      .gt('expires_at', new Date().toISOString());

    const results: EmbedRow[] = [];
    const cachedHashes = new Set<string>();
    for (const row of (cached ?? []) as EmbedRow[]) {
      cachedHashes.add(row.url_hash);
      results.push(row);
    }

    const pending = [...targets.values()].filter((target) => !cachedHashes.has(target.hash));

    const fetched = await Promise.all(
      pending.map(async (target): Promise<EmbedRow> => {
        try {
          const page = await fetchPage(target.url);
          return buildEmbed(page, target.hash, target.url);
        } catch (error) {
          if (error instanceof BlockedError) {
            return buildFailure(target.hash, target.url, 'blocked', error.message);
          }
          if (error instanceof UnsupportedError) {
            return buildFailure(target.hash, target.url, 'unsupported', error.message);
          }
          return buildFailure(
            target.hash,
            target.url,
            'error',
            error instanceof Error ? error.message : 'Could not load a preview.',
          );
        }
      }),
    );

    if (fetched.length > 0) {
      const { error: upsertError } = await admin
        .from('link_embeds')
        .upsert(fetched, { onConflict: 'url_hash' });
      // A cache write failure is not worth failing the request over — the
      // client still gets its previews, they just cost a fetch next time.
      if (upsertError) console.error('link_embeds upsert failed:', upsertError.message);
      results.push(...fetched);
    }

    return json({ embeds: results });
  } catch (error) {
    console.error('link-preview error:', error);
    return json({ error: 'Could not build link previews.' }, 500);
  }
});
