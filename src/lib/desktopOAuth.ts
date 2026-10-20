/**
 * Google sign-in for the Tauri desktop client.
 *
 * Google refuses OAuth inside embedded webviews (`disallowed_useragent`), so
 * the desktop app cannot just navigate its own window to Google like the
 * website does. Instead:
 *
 *   1. Ask Supabase for the provider URL without redirecting, with
 *      `redirectTo: ncore://auth/callback`.
 *   2. Open that URL in the user's real browser.
 *   3. Supabase sends the browser back to `ncore://auth/callback?...`. Windows
 *      hands the link to NCore; the single-instance plugin forwards it to the
 *      already-running window, and `onOpenUrl` delivers it here.
 *   4. Turn the callback into a session — a PKCE `code`, or (implicit flow)
 *      tokens in the fragment — and the normal auth listeners take over.
 *
 * `ncore://auth/callback` must be on the Supabase redirect allow list.
 */

import { supabase } from './supabase';
import { isTauriRuntime } from './desktopRuntime';

export const DESKTOP_OAUTH_REDIRECT = 'ncore://auth/callback';

type Listener = (result: { ok: boolean; error?: string }) => void;
const listeners = new Set<Listener>();

export function onDesktopOAuthResult(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(result: { ok: boolean; error?: string }) {
  for (const listener of listeners) listener(result);
}

export async function startDesktopGoogleSignIn(): Promise<void> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: DESKTOP_OAUTH_REDIRECT, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data?.url) throw new Error('Google sign-in is unavailable right now.');
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(data.url);
}

async function handleCallbackUrl(raw: string): Promise<void> {
  if (!raw.startsWith(DESKTOP_OAUTH_REDIRECT)) return;
  try {
    const url = new URL(raw);
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
    const providerError =
      url.searchParams.get('error_description') || fragment.get('error_description');
    if (providerError) throw new Error(providerError);

    const code = url.searchParams.get('code');
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
    } else {
      const accessToken = fragment.get('access_token');
      const refreshToken = fragment.get('refresh_token');
      if (!accessToken || !refreshToken) throw new Error('Google sign-in did not return a session.');
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) throw error;
    }
    emit({ ok: true });
  } catch (error) {
    emit({ ok: false, error: String((error as Error)?.message || error) });
  }
}

let installed = false;

/** Call once at startup on the desktop client. Safe to call elsewhere (no-op). */
export function installDesktopOAuthHandler(): void {
  if (installed || !isTauriRuntime()) return;
  installed = true;
  void import('@tauri-apps/plugin-deep-link').then(async ({ onOpenUrl, getCurrent }) => {
    // A link that launched the app cold arrives via getCurrent(), not the event.
    const initial = await getCurrent().catch(() => null);
    for (const url of initial ?? []) await handleCallbackUrl(url);
    await onOpenUrl((urls) => {
      for (const url of urls) void handleCallbackUrl(url);
    });
  });
}
