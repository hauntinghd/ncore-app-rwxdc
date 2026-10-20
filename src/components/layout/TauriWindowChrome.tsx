import { Minus, Square, X } from 'lucide-react';
import type { CSSProperties } from 'react';

/**
 * A minimal frameless-window title strip for Tauri.
 *
 * The Tauri window is `decorations: false`, so there is no OS title bar to
 * drag or close by. Post-login, `TopBar` provides its own drag region and
 * controls — but the auth/login screen renders no TopBar, which left the
 * window completely immovable while signed out (the state users are in most
 * often on a fresh install). This is that missing chrome, meant for screens
 * that sit outside the app shell.
 *
 * Rendered only under Tauri. On Electron the caption buttons are drawn
 * natively via `titleBarOverlay`, and in the browser there is no window to
 * manage, so callers gate on the Tauri runtime.
 *
 * `data-tauri-drag-region` needs `core:window:allow-start-dragging`, and the
 * buttons need the matching `allow-minimize/maximize/close` permissions, all
 * granted in `src-tauri/capabilities/default.json`.
 */
export function TauriWindowChrome() {
  const noDrag: CSSProperties = { ['WebkitAppRegion' as keyof CSSProperties]: 'no-drag' } as CSSProperties;

  const runWindow = (action: 'minimize' | 'toggleMaximize' | 'close') => {
    void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      const win = getCurrentWindow();
      if (action === 'minimize') return win.minimize();
      if (action === 'toggleMaximize') return win.toggleMaximize();
      return win.close();
    });
  };

  return (
    <div
      data-tauri-drag-region
      className="fixed inset-x-0 top-0 z-[100] flex h-9 items-stretch justify-end bg-transparent"
    >
      <div className="flex items-stretch" style={noDrag}>
        <button
          type="button"
          aria-label="Minimize"
          title="Minimize"
          onClick={() => runWindow('minimize')}
          className="flex w-11 items-center justify-center text-surface-400 transition-colors hover:bg-surface-700/70 hover:text-surface-100"
        >
          <Minus size={15} />
        </button>
        <button
          type="button"
          aria-label="Maximize"
          title="Maximize"
          onClick={() => runWindow('toggleMaximize')}
          className="flex w-11 items-center justify-center text-surface-400 transition-colors hover:bg-surface-700/70 hover:text-surface-100"
        >
          <Square size={12} />
        </button>
        <button
          type="button"
          aria-label="Close"
          title="Close"
          onClick={() => runWindow('close')}
          className="flex w-11 items-center justify-center text-surface-400 transition-colors hover:bg-red-600 hover:text-white"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
