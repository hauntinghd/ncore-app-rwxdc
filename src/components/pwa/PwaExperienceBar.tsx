import { useEffect, useState } from 'react';
import { Download, RefreshCcw, Share, Smartphone, WifiOff, X } from 'lucide-react';
import {
  applyPwaUpdate,
  clearPwaInstallHintDismissal,
  dismissPwaInstallHint,
  promptPwaInstall,
  usePwaRuntime,
} from '../../lib/pwaRuntime';
import { isTauriRuntime } from '../../lib/desktopRuntime';

interface PwaExperienceBarProps {
  isElectron: boolean;
}

export function PwaExperienceBar({ isElectron }: PwaExperienceBarProps) {
  const runtime = usePwaRuntime();
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState<string | null>(null);
  const [nativeUpdate, setNativeUpdate] = useState<DesktopUpdateRuntimeState | null>(null);
  const [nativeBusy, setNativeBusy] = useState(false);
  const isNativeDesktop = isTauriRuntime();

  useEffect(() => {
    if (!isNativeDesktop || !window.desktopBridge?.downloadLatestUpdate) return;
    let active = true;
    void window.desktopBridge.downloadLatestUpdate()
      .then((result) => {
        if (active) setNativeUpdate(result);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [isNativeDesktop]);

  useEffect(() => {
    if (!runtime.updateAvailable) {
      setDismissedUpdateVersion(null);
      return;
    }
    if (runtime.remoteVersion && dismissedUpdateVersion && dismissedUpdateVersion !== runtime.remoteVersion) {
      setDismissedUpdateVersion(null);
    }
  }, [runtime.updateAvailable, runtime.remoteVersion, dismissedUpdateVersion]);

  // The desktop version needs its own card because the browser service-worker
  // path cannot replace the signed native executable.
  if (isNativeDesktop) {
    if (!nativeUpdate?.ready && !nativeUpdate?.checking && !nativeBusy) return null;
    const version = nativeUpdate?.latestVersion || 'latest';
    return (
      <div className="fixed left-3 right-3 z-[80] md:left-auto md:right-4 md:w-[420px]" style={{ bottom: 'max(12px, env(safe-area-inset-bottom))' }}>
        <div className="rounded-2xl border border-nyptid-300/35 bg-surface-950/95 p-3 shadow-2xl backdrop-blur-xl">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg border border-nyptid-300/35 bg-nyptid-300/15 p-2"><Download size={15} className="text-nyptid-200" /></div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-surface-100">NCore update is ready</div>
              <div className="mt-0.5 text-xs text-surface-400">v{version} is signed and ready to download and install.</div>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  disabled={nativeBusy || !nativeUpdate?.ready}
                  onClick={() => {
                    setNativeBusy(true);
                    void window.desktopBridge?.installDownloadedUpdate().then((result) => {
                      if (!result?.ok) setNativeBusy(false);
                    }).catch(() => setNativeBusy(false));
                  }}
                  className="nyptid-btn-primary !px-3 !py-1.5 !text-xs disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {nativeBusy ? 'Installing…' : `Install v${version}`}
                </button>
              </div>
            </div>
            <button type="button" className="text-surface-500 transition-colors hover:text-surface-200" onClick={() => setNativeUpdate(null)} aria-label="Dismiss"><X size={14} /></button>
          </div>
        </div>
      </div>
    );
  }

  if (isElectron) return null;

  const shouldShowInstall =
    runtime.isMobile
    && !runtime.isStandalone
    && !runtime.installHintDismissed
    && (runtime.installPromptAvailable || runtime.isIOS || runtime.isAndroid);

  const shouldShowUpdate = runtime.updateAvailable && dismissedUpdateVersion !== (runtime.remoteVersion || runtime.currentVersion);
  const shouldShowOffline = !runtime.isOnline && runtime.isMobile;

  if (!shouldShowInstall && !shouldShowUpdate && !shouldShowOffline) return null;

  const updateLabel = runtime.remoteVersion ? `Update to v${runtime.remoteVersion}` : 'Update NCore';
  const installLabel = runtime.isIOS ? 'Install on iPhone' : 'Install App';
  const installHint = runtime.isIOS
    ? 'Safari: Share > Add to Home Screen'
    : runtime.installPromptAvailable
      ? 'Install NCore for a faster full-screen app.'
      : 'Use browser menu: Add to Home Screen';

  return (
    <div
      className="fixed left-3 right-3 z-[80] md:left-auto md:right-4 md:w-[420px]"
      style={{ bottom: 'max(12px, env(safe-area-inset-bottom))' }}
    >
      <div className="rounded-2xl border border-nyptid-300/35 bg-surface-950/95 backdrop-blur-xl shadow-2xl p-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-lg border border-nyptid-300/35 bg-nyptid-300/15 p-2">
            {shouldShowUpdate ? (
              <RefreshCcw size={15} className="text-nyptid-200" />
            ) : shouldShowOffline ? (
              <WifiOff size={15} className="text-yellow-300" />
            ) : (
              <Download size={15} className="text-nyptid-200" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            {shouldShowUpdate && (
              <>
                <div className="text-sm font-semibold text-surface-100">NCore update is ready</div>
                <div className="text-xs text-surface-400 mt-0.5">
                  New app files are downloaded. Reload once to apply the latest build.
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => applyPwaUpdate()}
                    className="nyptid-btn-primary !px-3 !py-1.5 !text-xs"
                  >
                    {updateLabel}
                  </button>
                </div>
              </>
            )}

            {!shouldShowUpdate && shouldShowInstall && (
              <>
                <div className="text-sm font-semibold text-surface-100">{installLabel}</div>
                <div className="text-xs text-surface-400 mt-0.5">{installHint}</div>
                {runtime.isIOS ? (
                  <ol className="mt-2 space-y-1.5 text-xs text-surface-300">
                    <li className="flex items-start gap-2">
                      <span className="w-5 h-5 rounded-full bg-nyptid-300/20 text-nyptid-200 text-[10px] font-bold flex items-center justify-center flex-shrink-0">1</span>
                      <span>Tap the <Share size={12} className="inline align-[-2px]" /> Share icon at the bottom of Safari.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-5 h-5 rounded-full bg-nyptid-300/20 text-nyptid-200 text-[10px] font-bold flex items-center justify-center flex-shrink-0">2</span>
                      <span>Scroll and pick <strong>Add to Home Screen</strong>.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-5 h-5 rounded-full bg-nyptid-300/20 text-nyptid-200 text-[10px] font-bold flex items-center justify-center flex-shrink-0">3</span>
                      <span>Tap <strong>Add</strong>. NCore launches full-screen, sessions stay signed in, and notifications work.</span>
                    </li>
                  </ol>
                ) : null}
                <div className="mt-2 flex items-center gap-2">
                  {!runtime.isIOS && (
                    <button
                      type="button"
                      className="nyptid-btn-primary !px-3 !py-1.5 !text-xs"
                      onClick={async () => {
                        const result = await promptPwaInstall();
                        if (result.ok) {
                          dismissPwaInstallHint();
                        }
                      }}
                    >
                      <Smartphone size={12} />
                      Install
                    </button>
                  )}
                  <button
                    type="button"
                    className="nyptid-btn-secondary !px-3 !py-1.5 !text-xs"
                    onClick={() => dismissPwaInstallHint()}
                  >
                    {runtime.isIOS ? 'Got it' : 'Later'}
                  </button>
                </div>
              </>
            )}

            {!shouldShowUpdate && !shouldShowInstall && shouldShowOffline && (
              <>
                <div className="text-sm font-semibold text-surface-100">You are offline</div>
                <div className="text-xs text-surface-400 mt-0.5">
                  NCore will sync automatically as soon as your connection is back.
                </div>
                {runtime.installHintDismissed && runtime.isStandalone && (
                  <div className="mt-2">
                    <button
                      type="button"
                      className="nyptid-btn-secondary !px-3 !py-1.5 !text-xs"
                      onClick={() => clearPwaInstallHintDismissal()}
                    >
                      Show tips again
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          <button
            type="button"
            className="text-surface-500 hover:text-surface-200 transition-colors"
            onClick={() => {
              if (shouldShowUpdate) {
                setDismissedUpdateVersion(runtime.remoteVersion || runtime.currentVersion);
                return;
              }
              dismissPwaInstallHint();
            }}
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
