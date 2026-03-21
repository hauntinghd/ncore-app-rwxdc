import { useEffect, useState } from 'react';
import { Download, RefreshCcw, WifiOff, X } from 'lucide-react';
import {
  applyPwaUpdate,
  clearPwaInstallHintDismissal,
  dismissPwaInstallHint,
  promptPwaInstall,
  usePwaRuntime,
} from '../../lib/pwaRuntime';

interface PwaExperienceBarProps {
  isElectron: boolean;
}

export function PwaExperienceBar({ isElectron }: PwaExperienceBarProps) {
  const runtime = usePwaRuntime();
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!runtime.updateAvailable) {
      setDismissedUpdateVersion(null);
      return;
    }
    if (runtime.remoteVersion && dismissedUpdateVersion && dismissedUpdateVersion !== runtime.remoteVersion) {
      setDismissedUpdateVersion(null);
    }
  }, [runtime.updateAvailable, runtime.remoteVersion, dismissedUpdateVersion]);

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
                <div className="mt-2 flex items-center gap-2">
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
                    Install
                  </button>
                  <button
                    type="button"
                    className="nyptid-btn-secondary !px-3 !py-1.5 !text-xs"
                    onClick={() => dismissPwaInstallHint()}
                  >
                    Later
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
