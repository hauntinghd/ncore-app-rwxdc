import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { installTauriDesktopBridge, isDesktopRuntime } from './lib/desktopRuntime';

// Polyfill for Safari (no native requestIdleCallback)
if (typeof window !== 'undefined' && !window.requestIdleCallback) {
  (window as any).requestIdleCallback = (cb: () => void, opts?: { timeout?: number }) => setTimeout(cb, opts?.timeout ?? 50);
  (window as any).cancelIdleCallback = (id: number) => clearTimeout(id);
}

// Tauri exposes only the capabilities NCore needs. This runs before React so
// any early navigation or auth code sees the same desktop contract.
installTauriDesktopBridge();

// Render FIRST, then initialize background services.
// This gets first paint on screen as fast as possible.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Defer PWA runtime init to after first paint (non-blocking).
if (!isDesktopRuntime()) {
  requestIdleCallback(() => {
    import('./lib/pwaRuntime').then(({ initPwaRuntime }) => initPwaRuntime());
  }, { timeout: 2000 });
}
