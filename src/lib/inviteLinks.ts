const SHORT_INVITE_BASE_URL = String(import.meta.env.VITE_SHORT_INVITE_BASE_URL || 'https://ncore.gg').trim().replace(/\/+$/, '');
const PENDING_INVITE_STORAGE_KEY = 'ncore.pendingInviteCode';

export function buildCommunityInviteLink(code: string): string {
  const normalizedCode = String(code || '').trim();
  if (!normalizedCode) return '';
  return `${SHORT_INVITE_BASE_URL}/${encodeURIComponent(normalizedCode)}`;
}

export function storePendingInviteCode(code: string) {
  if (typeof window === 'undefined') return;
  const normalizedCode = String(code || '').trim();
  if (!normalizedCode) return;
  window.sessionStorage.setItem(PENDING_INVITE_STORAGE_KEY, normalizedCode);
}

export function readPendingInviteCode(): string {
  if (typeof window === 'undefined') return '';
  return String(window.sessionStorage.getItem(PENDING_INVITE_STORAGE_KEY) || '').trim();
}

export function consumePendingInviteCode(): string {
  if (typeof window === 'undefined') return '';
  const code = readPendingInviteCode();
  if (code) {
    window.sessionStorage.removeItem(PENDING_INVITE_STORAGE_KEY);
  }
  return code;
}

export function clearPendingInviteCode() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(PENDING_INVITE_STORAGE_KEY);
}
