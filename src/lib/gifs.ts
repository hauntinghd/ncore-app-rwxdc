/**
 * GIF picker — client surface.
 *
 * Backed by the `gif-search` edge function, which proxies Tenor. The API key
 * is a server secret, not a `VITE_` variable: anything in the bundle is
 * extracted and reused within a day, and rotating it would otherwise mean
 * rebuilding and redeploying every client.
 *
 * If the function is not deployed or `TENOR_API_KEY` is unset, everything here
 * reports unavailable and the picker hides itself rather than showing a broken
 * panel.
 */
import { supabase } from './supabase';

export interface Gif {
  id: string;
  description: string;
  /** Full-size animation — what gets sent. */
  url: string;
  /** Small looping preview for the grid. */
  previewUrl: string;
  width: number;
  height: number;
}

export interface GifCategory {
  term: string;
  image: string;
}

export interface GifPage {
  results: Gif[];
  /** Opaque cursor for the next page; empty when exhausted. */
  next: string;
}

export class GifUnavailableError extends Error {}

interface InvokeResult {
  results?: Gif[];
  next?: string;
  categories?: GifCategory[];
  error?: string;
  code?: string;
}

async function invoke(body: Record<string, unknown>): Promise<InvokeResult> {
  const { data, error } = await supabase.functions.invoke('gif-search', { body });

  if (error) {
    // A missing function and a missing key are the same thing to a caller:
    // GIFs are not available here.
    throw new GifUnavailableError('GIF search is not available.');
  }

  const result = (data ?? {}) as InvokeResult;
  if (result.code === 'not_configured') {
    throw new GifUnavailableError('GIF search is not configured on this server.');
  }
  if (result.error) throw new Error(result.error);
  return result;
}

export async function searchGifs(query: string, pos = ''): Promise<GifPage> {
  const result = await invoke({ action: 'search', query, pos, limit: 24 });
  return { results: result.results ?? [], next: result.next ?? '' };
}

export async function featuredGifs(pos = ''): Promise<GifPage> {
  const result = await invoke({ action: 'featured', pos, limit: 24 });
  return { results: result.results ?? [], next: result.next ?? '' };
}

export async function gifCategories(): Promise<GifCategory[]> {
  const result = await invoke({ action: 'categories' });
  return result.categories ?? [];
}

/**
 * Whether GIF search works on this deployment.
 *
 * Cached for the session: the answer depends on server configuration, which
 * does not change while the app is open, and re-asking on every picker open
 * would add a round trip to something that must feel instant.
 */
let availability: boolean | null = null;

export async function isGifSearchAvailable(): Promise<boolean> {
  if (availability !== null) return availability;
  try {
    await featuredGifs();
    availability = true;
  } catch (error) {
    availability = !(error instanceof GifUnavailableError);
  }
  return availability;
}

/** Test/dev hook — forces the next availability check to re-run. */
export function resetGifAvailability() {
  availability = null;
}

/**
 * A GIF is sent as its URL in the message body.
 *
 * That means it unfurls through the existing link-embed path, gets the same
 * security-shield treatment as any other link, and needs no new column or
 * attachment row. Tenor URLs are direct media, so `link-preview` classifies
 * them as `embed_type: 'image'` and renders the picture with no card chrome.
 */
export function gifToMessageContent(gif: Gif): string {
  return gif.url;
}
