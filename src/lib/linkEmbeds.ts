/**
 * Link embeds (Open Graph previews) — client surface.
 *
 * Schema lives in `20260730100000_link_embeds.sql`; the unfurler is the
 * `link-preview` edge function. The client never fetches third-party pages
 * itself — CORS aside, doing so would leak every reader's IP address to
 * whatever host was linked.
 *
 * Flow for a message:
 *   1. `extractEmbeddableUrls` pulls candidate links out of the text
 *   2. `resolveLinkEmbeds` checks the in-memory cache, then the `link_embeds`
 *      table, then asks the edge function for whatever is still missing
 *   3. `<LinkEmbedCard>` renders the result
 *
 * ## Not wired into DMs, on purpose
 * Direct messages are end-to-end encrypted. Unfurling a link from a DM would
 * hand that URL to our own server — the one component that is otherwise unable
 * to read the conversation — and quietly undo the guarantee. If DM previews are
 * ever wanted, they have to be fetched by the client through a proxy that does
 * not learn who asked, not by calling this path from `DirectMessagePage`.
 */
import { supabase } from './supabase';
import { analyzeExternalUrl } from './securityShield';

export type LinkEmbedStatus = 'ok' | 'error' | 'blocked' | 'unsupported';
export type LinkEmbedType = 'link' | 'image' | 'video' | 'article';

export interface LinkEmbed {
  urlHash: string;
  url: string;
  canonicalUrl: string | null;
  siteName: string | null;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  faviconUrl: string | null;
  embedType: LinkEmbedType;
  mediaWidth: number | null;
  mediaHeight: number | null;
  status: LinkEmbedStatus;
  errorReason: string | null;
}

interface LinkEmbedRow {
  url_hash: string;
  url: string;
  canonical_url: string | null;
  site_name: string | null;
  title: string | null;
  description: string | null;
  image_url: string | null;
  favicon_url: string | null;
  embed_type: string;
  media_width: number | null;
  media_height: number | null;
  status: string;
  error_reason: string | null;
}

/** Discord's convention, and a good one: `<url>` posts the link without a card. */
const SUPPRESSED_URL = /<https?:\/\/[^\s>]+>/gi;
const URL_PATTERN = /https?:\/\/[^\s<>"'`)\]]+/gi;

/** More than a few cards per message turns a chat log into a billboard. */
export const MAX_EMBEDS_PER_MESSAGE = 3;

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'utm_id', 'utm_name', 'fbclid', 'gclid', 'dclid', 'msclkid', 'mc_eid',
  'igshid', 'ref_src', 'ref_url', '_ga', 'yclid', 'twclid',
]);

/**
 * Canonicalizes a URL so the same page shares one cache entry.
 * **Must stay in sync with `normalizeUrl` in the link-preview edge function** —
 * the hash is the cache key, so a mismatch means a permanent cache miss.
 */
export function normalizeUrl(raw: string): string | null {
  try {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return null;
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/+/, '')}`;
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.hash = '';

    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) parsed.searchParams.delete(key);
    }
    parsed.search = parsed.searchParams.toString() ? `?${parsed.searchParams.toString()}` : '';

    if (parsed.pathname === '/') parsed.pathname = '';

    return parsed.toString();
  } catch {
    return null;
  }
}

export async function hashUrl(normalized: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(normalized),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Strips the parts of a message where a URL is being shown rather than linked:
 * fenced blocks, inline code, and `<...>`-suppressed links. Replacing them with
 * spaces (rather than deleting) keeps the remaining text at its original
 * offsets, which matters if a caller ever wants to correlate positions.
 */
function stripNonLinkRegions(content: string): string {
  const blank = (match: string) => ' '.repeat(match.length);
  return content
    .replace(/```[\s\S]*?```/g, blank)
    .replace(/`[^`\n]*`/g, blank)
    .replace(SUPPRESSED_URL, blank);
}

/**
 * Candidate URLs from a message, in order, deduped and capped.
 *
 * Links the security shield would block are dropped: previewing a known
 * phishing page means fetching it and putting its own chosen title and image
 * in front of the user, which is exactly the lure the shield exists to stop.
 */
export function extractEmbeddableUrls(content: string): string[] {
  const text = stripNonLinkRegions(String(content || ''));
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const match of text.matchAll(URL_PATTERN)) {
    // Trailing punctuation is nearly always sentence punctuation, not URL.
    const candidate = match[0].replace(/[.,;:!?)\]}'"]+$/, '');
    const normalized = normalizeUrl(candidate);
    if (!normalized || seen.has(normalized)) continue;

    if (analyzeExternalUrl(normalized).action === 'block') continue;

    seen.add(normalized);
    urls.push(normalized);
    if (urls.length >= MAX_EMBEDS_PER_MESSAGE) break;
  }

  return urls;
}

function rowToEmbed(row: LinkEmbedRow): LinkEmbed {
  const embedType = ['link', 'image', 'video', 'article'].includes(row.embed_type)
    ? (row.embed_type as LinkEmbedType)
    : 'link';
  const status = ['ok', 'error', 'blocked', 'unsupported'].includes(row.status)
    ? (row.status as LinkEmbedStatus)
    : 'error';

  return {
    urlHash: row.url_hash,
    url: row.url,
    canonicalUrl: row.canonical_url,
    siteName: row.site_name,
    title: row.title,
    description: row.description,
    imageUrl: row.image_url,
    faviconUrl: row.favicon_url,
    embedType,
    mediaWidth: row.media_width,
    mediaHeight: row.media_height,
    status,
    errorReason: row.error_reason,
  };
}

// ---------------------------------------------------------------------------
// Caching
// ---------------------------------------------------------------------------

/**
 * Process-lifetime memo, keyed by URL hash. Scrolling a channel re-renders the
 * same messages constantly; without this, every render is a round trip.
 */
const memoryCache = new Map<string, LinkEmbed>();
/** In-flight requests, so ten messages linking the same page make one call. */
const inFlight = new Map<string, Promise<LinkEmbed | null>>();

const MEMORY_CACHE_LIMIT = 500;

function rememberEmbed(embed: LinkEmbed) {
  if (memoryCache.size >= MEMORY_CACHE_LIMIT) {
    // Oldest-first eviction; Map preserves insertion order.
    const oldest = memoryCache.keys().next();
    if (!oldest.done) memoryCache.delete(oldest.value);
  }
  memoryCache.set(embed.urlHash, embed);
}

export function peekCachedEmbed(urlHash: string): LinkEmbed | null {
  return memoryCache.get(urlHash) ?? null;
}

/** Test/dev hook — drops the memo so a re-fetch is observable. */
export function clearEmbedCache() {
  memoryCache.clear();
  inFlight.clear();
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

async function fetchFromTable(hashes: string[]): Promise<LinkEmbed[]> {
  if (hashes.length === 0) return [];
  const { data, error } = await supabase.rpc('link_embeds_lookup', { p_hashes: hashes });
  if (error) return [];
  return ((data ?? []) as LinkEmbedRow[]).map(rowToEmbed);
}

async function unfurl(urls: string[]): Promise<LinkEmbed[]> {
  if (urls.length === 0) return [];
  const { data, error } = await supabase.functions.invoke('link-preview', {
    body: { urls },
  });
  if (error) return [];
  const embeds = (data as { embeds?: LinkEmbedRow[] } | null)?.embeds ?? [];
  return embeds.map(rowToEmbed);
}

/**
 * Resolves previews for a set of already-normalized URLs.
 *
 * Returns in the same order as the input, omitting anything that could not be
 * resolved. Non-`ok` rows are returned rather than dropped so the caller can
 * decide whether a failure is worth showing; the card component chooses not to.
 */
export async function resolveLinkEmbeds(urls: string[]): Promise<LinkEmbed[]> {
  if (urls.length === 0) return [];

  const entries = await Promise.all(
    urls.map(async (url) => ({ url, hash: await hashUrl(url) })),
  );

  const resolved = new Map<string, LinkEmbed>();
  const missing: Array<{ url: string; hash: string }> = [];

  for (const entry of entries) {
    const cached = memoryCache.get(entry.hash);
    if (cached) resolved.set(entry.hash, cached);
    else missing.push(entry);
  }

  if (missing.length > 0) {
    const fromTable = await fetchFromTable(missing.map((entry) => entry.hash));
    for (const embed of fromTable) {
      rememberEmbed(embed);
      resolved.set(embed.urlHash, embed);
    }

    const stillMissing = missing.filter((entry) => !resolved.has(entry.hash));
    if (stillMissing.length > 0) {
      // Coalesce with any identical request already in flight before starting
      // a new one, then start one shared request for the true remainder.
      const alreadyRunning = stillMissing.filter((entry) => inFlight.has(entry.hash));
      const toRequest = stillMissing.filter((entry) => !inFlight.has(entry.hash));

      if (toRequest.length > 0) {
        const request = unfurl(toRequest.map((entry) => entry.url));
        const byHash = new Map<string, Promise<LinkEmbed | null>>();
        for (const entry of toRequest) {
          const promise = request.then((embeds) => {
            const match = embeds.find((embed) => embed.urlHash === entry.hash) ?? null;
            if (match) rememberEmbed(match);
            return match;
          });
          byHash.set(entry.hash, promise);
          inFlight.set(entry.hash, promise);
        }

        await Promise.all(
          [...byHash].map(async ([hash, promise]) => {
            try {
              const embed = await promise;
              if (embed) resolved.set(hash, embed);
            } finally {
              inFlight.delete(hash);
            }
          }),
        );
      }

      await Promise.all(
        alreadyRunning.map(async (entry) => {
          const embed = await inFlight.get(entry.hash)?.catch(() => null);
          if (embed) resolved.set(entry.hash, embed);
        }),
      );
    }
  }

  return entries
    .map((entry) => resolved.get(entry.hash))
    .filter((embed): embed is LinkEmbed => Boolean(embed));
}

/** Only `ok` embeds carrying something worth rendering. */
export function isRenderable(embed: LinkEmbed): boolean {
  if (embed.status !== 'ok') return false;
  if (embed.embedType === 'image') return Boolean(embed.imageUrl);
  return Boolean(embed.title || embed.description || embed.imageUrl);
}

/** Host shown on the card, without the noise of a `www.` prefix. */
export function displayHost(embed: LinkEmbed): string {
  try {
    return new URL(embed.canonicalUrl || embed.url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
