export const ROLLOUT_SETTINGS_STORAGE_KEY = 'ncore.settings.rollout.v1';

export interface StreamerModeSettings {
  enabled: boolean;
  hideDmPreviews: boolean;
  silentNotifications: boolean;
}

function readStoredRolloutSettings(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(ROLLOUT_SETTINGS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return {};
    const next: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed)) {
      next[key] = Boolean(value);
    }
    return next;
  } catch {
    return {};
  }
}

export function getStreamerModeSettings(): StreamerModeSettings {
  const rollout = readStoredRolloutSettings();
  const enabled = Boolean(rollout.streamer_mode_enabled);
  return {
    enabled,
    hideDmPreviews: enabled && Boolean(rollout.streamer_hide_dm_previews),
    silentNotifications: enabled && Boolean(rollout.streamer_silent_notifs),
  };
}

export function shouldHideNotificationPreview(type: string): boolean {
  const streamer = getStreamerModeSettings();
  if (!streamer.enabled || !streamer.hideDmPreviews) return false;
  const normalizedType = String(type || '').trim().toLowerCase();
  return normalizedType === 'direct_message'
    || normalizedType === 'mention'
    || normalizedType === 'incoming_call';
}

export function sanitizeNotificationTitle(title: string, type: string): string {
  if (!shouldHideNotificationPreview(type)) return String(title || 'NCore');
  const normalizedType = String(type || '').trim().toLowerCase();
  if (normalizedType === 'incoming_call') return 'Incoming call';
  if (normalizedType === 'mention') return 'New mention';
  return 'New notification';
}

export function sanitizeNotificationBody(body: string, type: string): string {
  if (!shouldHideNotificationPreview(type)) return String(body || '');
  const normalizedType = String(type || '').trim().toLowerCase();
  if (normalizedType === 'incoming_call') return 'Call details hidden in Streamer Mode.';
  return 'Message preview hidden in Streamer Mode.';
}
