import { isTauri } from '@tauri-apps/api/core';

/**
 * The web client deliberately knows as little as possible about its desktop
 * container.  That keeps the app portable across the browser, mobile,
 * Electron during the transition, and the new native Tauri host.
 */
export function isElectronRuntime(): boolean {
  return typeof window !== 'undefined'
    && (window.location.protocol === 'file:' || navigator.userAgent.toLowerCase().includes('electron'));
}

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && isTauri();
}

export function isDesktopRuntime(): boolean {
  return isElectronRuntime() || isTauriRuntime();
}

/**
 * Supplies the small part of the legacy desktop bridge that a Tauri window
 * needs today.  Electron remains available for features that still need a
 * parity port (secure native auth storage, custom source picker, and signed
 * updater); it is never overwritten here.
 */
export function installTauriDesktopBridge(): void {
  if (!isTauriRuntime() || typeof window === 'undefined' || window.desktopBridge) return;

  window.desktopBridge = {
    async openExternalUrl(url: string) {
      try {
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl(url);
        return { ok: true };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : 'Could not open link.' };
      }
    },
  } as Window['desktopBridge'];
}
