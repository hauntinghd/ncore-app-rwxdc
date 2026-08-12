/**
 * Mobile + web push registration.
 *
 * The actual notifications are dispatched by the `notify-mobile` Supabase
 * Edge Function (see `supabase/functions/notify-mobile`). This file is
 * concerned only with *getting a token onto* the `user_devices` table.
 *
 * Token sources, in order of preference:
 *  1. `@capacitor/push-notifications` plugin (when running inside the
 *     Capacitor Android/iOS shell). FCM token on Android, APNs token on iOS.
 *  2. Browser FCM web-push (Service Worker + VAPID).
 *  3. `VITE_DEFAULT_DEVICE_TOKEN` env override (development only).
 *
 * On every successful token retrieval we upsert into `user_devices` with
 * `(user_id, token)` as the conflict key, refreshing `last_seen` and
 * `app_version`.
 */
import { supabase } from './supabase';

interface RegisterOptions {
  userVisibleOnly?: boolean;
  appVersion?: string | null;
}

interface RegisterResult {
  ok: boolean;
  token?: string;
  platform?: string;
  error?: string;
}

const APP_VERSION = String(import.meta.env.VITE_APP_VERSION || '').trim() || null;

export async function registerDeviceToken(token: string, platform: string | null = null): Promise<{ data?: unknown; error?: Error | null }> {
  if (!token) return { error: new Error('Missing token') };
  try {
    const userRes = await supabase.auth.getUser();
    const userId = userRes.data.user?.id;
    if (!userId) return { error: new Error('Not authenticated') };

    const payload = {
      user_id: userId,
      token,
      platform,
      push_enabled: true,
      app_version: APP_VERSION,
      last_seen: new Date().toISOString(),
    } as Record<string, unknown>;

    const { data, error } = await supabase
      .from('user_devices')
      .upsert(payload, { onConflict: 'user_id,token' });
    return { data, error };
  } catch (err) {
    return { error: err as Error };
  }
}

export async function unregisterDeviceToken(token: string) {
  if (!token) return { error: new Error('Missing token') };
  try {
    const { error } = await supabase.from('user_devices').delete().eq('token', token);
    return { error };
  } catch (err) {
    return { error: err as Error };
  }
}

/**
 * Try every push-token source in order. Resolves with `{ ok: true }` on
 * the first one that successfully registers. Resolves with `{ ok: false }`
 * if no source succeeds — caller should treat this as informational, not
 * fatal.
 */
export async function autoRegisterPushToken(opts: RegisterOptions = {}): Promise<RegisterResult> {
  // 1. Capacitor native plugin (Android / iOS)
  const native = await tryCapacitorRegistration(opts);
  if (native.ok) return native;

  // 2. Browser FCM web-push
  const web = await tryWebPushRegistration(opts);
  if (web.ok) return web;

  // 3. Dev-mode env-injected token (preserves existing behavior)
  const fallback = await tryEnvFallback();
  if (fallback.ok) return fallback;

  return { ok: false, error: native.error || web.error || fallback.error || 'no push source available' };
}

// ---------------------------------------------------------------------------
// Capacitor native plugin
// ---------------------------------------------------------------------------

interface CapacitorPushBridge {
  isPluginAvailable: (name: string) => boolean;
}

async function tryCapacitorRegistration(_opts: RegisterOptions): Promise<RegisterResult> {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  const cap = (window as unknown as { Capacitor?: CapacitorPushBridge }).Capacitor;
  if (!cap || typeof cap.isPluginAvailable !== 'function') {
    return { ok: false, error: 'capacitor not present' };
  }
  if (!cap.isPluginAvailable('PushNotifications')) {
    return { ok: false, error: 'PushNotifications plugin not installed' };
  }

  try {
    // Lazy import so the plugin isn't bundled into the web build.
    const mod: unknown = await import(
      /* @vite-ignore */ '@capacitor/push-notifications' as string
    ).catch(() => null);
    if (!mod) return { ok: false, error: 'plugin not bundled' };

    const PushNotifications = (mod as { PushNotifications?: CapacitorPushApi }).PushNotifications;
    if (!PushNotifications) return { ok: false, error: 'plugin missing PushNotifications' };

    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== 'granted') return { ok: false, error: `permission ${perm.receive}` };

    const platform = inferCapacitorPlatform();
    return await new Promise<RegisterResult>((resolve) => {
      let settled = false;
      const finish = (result: RegisterResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      PushNotifications.addListener('registration', async (token) => {
        const value = String(token?.value || '').trim();
        if (!value) {
          finish({ ok: false, error: 'empty token' });
          return;
        }
        const { error } = await registerDeviceToken(value, platform);
        if (error) finish({ ok: false, error: String(error.message || error) });
        else finish({ ok: true, token: value, platform });
      });
      PushNotifications.addListener('registrationError', (err: { error?: string } | null) => {
        finish({ ok: false, error: String(err?.error || err || 'registrationError') });
      });
      PushNotifications.register().catch((err) => finish({ ok: false, error: String(err) }));
      // Timeout safety net: native plugin can hang on misconfigured FCM.
      setTimeout(() => finish({ ok: false, error: 'capacitor register timeout' }), 8000);
    });
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

interface CapacitorPushApi {
  checkPermissions: () => Promise<{ receive: string }>;
  requestPermissions: () => Promise<{ receive: string }>;
  register: () => Promise<void>;
  addListener: (
    event: 'registration' | 'registrationError',
    cb: ((token: { value: string }) => void) | ((err: { error?: string } | null) => void),
  ) => Promise<{ remove?: () => void }> | { remove?: () => void };
}

function inferCapacitorPlatform(): string {
  if (typeof window === 'undefined') return 'unknown';
  const ua = String(window.navigator.userAgent || '').toLowerCase();
  if (ua.includes('android')) return 'android';
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios')) return 'ios';
  return 'native';
}

// ---------------------------------------------------------------------------
// Browser FCM web-push (best effort - requires a separate Firebase setup)
// ---------------------------------------------------------------------------

async function tryWebPushRegistration(_opts: RegisterOptions): Promise<RegisterResult> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, error: 'web push not supported' };
  }
  const vapidPublic = String(import.meta.env.VITE_FCM_VAPID_PUBLIC_KEY || '').trim();
  if (!vapidPublic) return { ok: false, error: 'VITE_FCM_VAPID_PUBLIC_KEY not set' };

  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return { ok: false, error: `notification permission ${perm}` };

    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    const applicationServerKey = urlBase64ToUint8Array(vapidPublic).buffer as ArrayBuffer;
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      }));

    const token = JSON.stringify(sub.toJSON());
    const { error } = await registerDeviceToken(token, 'web');
    if (error) return { ok: false, error: String(error.message || error) };
    return { ok: true, token, platform: 'web' };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------------------
// Dev fallback
// ---------------------------------------------------------------------------

async function tryEnvFallback(): Promise<RegisterResult> {
  const token = String(import.meta.env.VITE_DEFAULT_DEVICE_TOKEN || '').trim();
  const platform = String(import.meta.env.VITE_DEFAULT_DEVICE_PLATFORM || '').trim() || null;
  if (!token) return { ok: false, error: 'no env token' };
  const { error } = await registerDeviceToken(token, platform);
  if (error) return { ok: false, error: String(error.message || error) };
  return { ok: true, token, platform: platform ?? undefined };
}
