import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Polyfill for Safari (no native requestIdleCallback)
if (typeof window !== 'undefined' && !window.requestIdleCallback) {
  (window as any).requestIdleCallback = (cb: () => void, opts?: { timeout?: number }) => setTimeout(cb, opts?.timeout ?? 50);
  (window as any).cancelIdleCallback = (id: number) => clearTimeout(id);
}

// Render FIRST, then initialize background services.
// This gets first paint on screen as fast as possible.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Defer PWA runtime init to after first paint (non-blocking).
const isElectronRuntime =
  typeof window !== 'undefined'
  && (window.location.protocol === 'file:' || navigator.userAgent.toLowerCase().includes('electron'));

if (!isElectronRuntime) {
  requestIdleCallback(() => {
    import('./lib/pwaRuntime').then(({ initPwaRuntime }) => initPwaRuntime());
  }, { timeout: 2000 });
}
