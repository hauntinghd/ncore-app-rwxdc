import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initPwaRuntime } from './lib/pwaRuntime';

const isElectronRuntime =
  typeof window !== 'undefined'
  && (window.location.protocol === 'file:' || navigator.userAgent.toLowerCase().includes('electron'));

if (!isElectronRuntime) {
  initPwaRuntime();
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
