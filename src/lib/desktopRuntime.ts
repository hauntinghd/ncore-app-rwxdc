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

  let updaterState: DesktopUpdateRuntimeState = { ok: true, message: 'Ready to check for updates.' };
  let pendingUpdate: Awaited<ReturnType<typeof import('@tauri-apps/plugin-updater')['check']>> | null = null;
  const emitUpdate = () => undefined;

  window.desktopBridge = {
    async authStorageGetItem(key: string) {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke<DesktopAuthStorageResult>('secure_storage_get', { key });
    },
    async authStorageSetItem(key: string, value: string) {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke<{ ok: boolean; message?: string }>('secure_storage_set', { key, value });
    },
    async authStorageRemoveItem(key: string) {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke<{ ok: boolean; message?: string }>('secure_storage_remove', { key });
    },
    async openExternalUrl(url: string) {
      try {
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl(url);
        return { ok: true };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : 'Could not open link.' };
      }
    },
    async getUpdateRuntimeState() { return updaterState; },
    async downloadLatestUpdate() {
      try {
        updaterState = { ok: true, checking: true, message: 'Checking for a signed NCore update...' };
        const { check } = await import('@tauri-apps/plugin-updater');
        const update = await check();
        if (!update) {
          updaterState = { ok: true, message: 'NCore is up to date.' };
          return updaterState;
        }
        pendingUpdate = update;
        updaterState = { ok: true, ready: true, latestVersion: update.version, message: `NCore ${update.version} is ready to install.` };
        emitUpdate();
        return updaterState;
      } catch (error) {
        updaterState = { ok: false, message: error instanceof Error ? error.message : 'Could not check for an update.' };
        return updaterState;
      }
    },
    async installDownloadedUpdate() {
      if (!pendingUpdate) return { ok: false, message: 'Check for an update first.' };
      try {
        updaterState = { ...updaterState, ready: false, installing: true, message: 'Installing signed NCore update...' };
        await pendingUpdate.downloadAndInstall();
        return { ok: true };
      } catch (error) {
        updaterState = { ok: false, message: error instanceof Error ? error.message : 'Could not install the update.' };
        return { ok: false, message: updaterState.message };
      }
    },
  } as Window['desktopBridge'];
}
