import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { installTauriDesktopBridge, isDesktopRuntime } from './lib/desktopRuntime';
import { detectWebSurface } from './lib/webSurface';

// Polyfill for Safari (no native requestIdleCallback)
if (typeof window !== 'undefined' && !window.requestIdleCallback) {
  (window as any).requestIdleCallback = (cb: () => void, opts?: { timeout?: number }) => setTimeout(cb, opts?.timeout ?? 50);
  (window as any).cancelIdleCallback = (id: number) => clearTimeout(id);
}

// Tauri exposes only the capabilities NCore needs. This runs before React so
// any early navigation or auth code sees the same desktop contract.
installTauriDesktopBridge();

// Marketing visitors should not pay the cost of the authenticated product
// shell: Supabase session restoration, E2E crypto, calls, and app routes are
// all loaded only once someone enters NCore. This keeps the landing path lean.
const isMarketingLanding = !isDesktopRuntime()
  && window.location.pathname === '/'
  && detectWebSurface(false) === 'marketing';

const root = createRoot(document.getElementById('root')!);
void (isMarketingLanding
  ? import('./pages/LandingPage').then(({ LandingPage }) => {
    root.render(<StrictMode><LandingPage /></StrictMode>);
  })
  : import('./App.tsx').then(({ default: App }) => {
    root.render(<StrictMode><App /></StrictMode>);
  }));

// Defer PWA runtime init to after first paint (non-blocking).
if (!isDesktopRuntime()) {
  requestIdleCallback(() => {
    import('./lib/pwaRuntime').then(({ initPwaRuntime }) => initPwaRuntime());
  }, { timeout: 2000 });
}
