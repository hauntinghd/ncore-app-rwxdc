import { useSyncExternalStore } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export type DeviceTier = 'low' | 'medium' | 'high';

export interface PwaRuntimeSnapshot {
  currentVersion: string;
  remoteVersion: string | null;
  updateAvailable: boolean;
  installPromptAvailable: boolean;
  installHintDismissed: boolean;
  isStandalone: boolean;
  isIOS: boolean;
  isAndroid: boolean;
  isMobile: boolean;
  isSafari: boolean;
  isOnline: boolean;
  deviceTier: DeviceTier;
}

const INSTALL_HINT_STORAGE_KEY = 'ncore:pwa-install-dismissed:v1';
const UPDATE_CHECK_INTERVAL_MS = 3 * 60 * 1000;
const IOS_RECOVERY_STORAGE_KEY_PREFIX = 'ncore:ios-recovery';

let initialized = false;
let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
let serviceWorkerRegistration: ServiceWorkerRegistration | null = null;
let reloadOnControllerChange = false;
let updateCheckTimer: number | null = null;

const listeners = new Set<() => void>();

const state: PwaRuntimeSnapshot = {
  currentVersion: __APP_VERSION__,
  remoteVersion: null,
  updateAvailable: false,
  installPromptAvailable: false,
  installHintDismissed: false,
  isStandalone: false,
  isIOS: false,
  isAndroid: false,
  isMobile: false,
  isSafari: false,
  isOnline: true,
  deviceTier: 'high',
};
let snapshot: PwaRuntimeSnapshot = { ...state };

function syncSnapshot() {
  snapshot = { ...state };
}

function notify() {
  syncSnapshot();
  listeners.forEach((listener) => listener());
}

function detectDeviceTier(): DeviceTier {
  const memory = Number((navigator as any).deviceMemory || 0);
  const cores = Number(navigator.hardwareConcurrency || 0);
  const dpr = Number(window.devicePixelRatio || 1);

  if ((memory > 0 && memory <= 4) || (cores > 0 && cores <= 4) || dpr >= 3) return 'low';
  if ((memory > 0 && memory <= 8) || (cores > 0 && cores <= 8)) return 'medium';
  return 'high';
}

function updatePlatformSnapshot() {
  const ua = navigator.userAgent.toLowerCase();
  const isIOS = /iphone|ipad|ipod/.test(ua);
  const isAndroid = /android/.test(ua);
  const isMobile = isIOS || isAndroid || /mobile/.test(ua);
  const isSafari = /safari/.test(ua) && !/crios|fxios|edgios|opr\//.test(ua);
  const standaloneViaMedia = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  const standaloneViaNavigator = Boolean((navigator as any).standalone);
  const isStandalone = standaloneViaMedia || standaloneViaNavigator;

  state.isIOS = isIOS;
  state.isAndroid = isAndroid;
  state.isMobile = isMobile;
  state.isSafari = isSafari;
  state.isStandalone = isStandalone;
  state.isOnline = navigator.onLine;
  state.deviceTier = detectDeviceTier();
}

async function maybeRunServiceWorkerReset() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('sw-reset') !== '1') return false;

  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
  } catch {
    // continue with cache cleanup
  }

  try {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith('ncore-core-') || key.startsWith('ncore-runtime-'))
        .map((key) => caches.delete(key)),
    );
  } catch {
    // ignore cache cleanup failure
  }

  params.delete('sw-reset');
  const nextSearch = params.toString();
  const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash || ''}`;
  window.location.replace(nextUrl || '/');
  return true;
}

async function maybeRunIosStandaloneRecovery() {
  if (!state.isIOS) return false;

  let recoveryKey = `${IOS_RECOVERY_STORAGE_KEY_PREFIX}:${state.currentVersion}`;
  try {
    if (localStorage.getItem(recoveryKey) === '1') return false;
    localStorage.setItem(recoveryKey, '1');
  } catch {
    // If storage is unavailable, run recovery once per session.
    recoveryKey = '';
  }

  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
  } catch {
    // continue with cache cleanup
  }

  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  } catch {
    // ignore cache cleanup failure
  }

  // Installed iOS web apps can stay pinned to stale caches; force one clean navigation.
  if (state.isStandalone) {
    const params = new URLSearchParams(window.location.search);
    params.set('ios-recovered', state.currentVersion);
    const nextSearch = params.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash || ''}`;
    window.location.replace(nextUrl || '/');
    return true;
  }

  if (recoveryKey) {
    try {
      localStorage.setItem(recoveryKey, '1');
    } catch {
      // ignore
    }
  }

  return false;
}

function applyRuntimeClasses() {
  const root = document.documentElement;
  root.dataset.deviceTier = state.deviceTier;
  root.classList.toggle('ncore-standalone', state.isStandalone);
  root.classList.toggle('ncore-mobile', state.isMobile);
}

function setInstallDismissed(value: boolean) {
  state.installHintDismissed = value;
  try {
    if (value) {
      localStorage.setItem(INSTALL_HINT_STORAGE_KEY, '1');
    } else {
      localStorage.removeItem(INSTALL_HINT_STORAGE_KEY);
    }
  } catch {
    // ignore localStorage failure
  }
  notify();
}

function markUpdateAvailable(remoteVersion?: string) {
  if (remoteVersion) state.remoteVersion = remoteVersion;
  state.updateAvailable = true;
  notify();
}

async function fetchRemoteVersion(): Promise<string | null> {
  try {
    const response = await fetch(`/version.json?ts=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return null;
    const payload = await response.json();
    const version = String(payload?.version || '').trim();
    return version || null;
  } catch {
    return null;
  }
}

function compareSemver(a: string, b: string): number {
  const parse = (value: string) =>
    value
      .replace(/^v/i, '')
      .split('.')
      .slice(0, 3)
      .map((part) => Number(part));
  const left = parse(a);
  const right = parse(b);
  if (left.some(Number.isNaN) || right.some(Number.isNaN) || left.length !== 3 || right.length !== 3) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (left[i] > right[i]) return 1;
    if (left[i] < right[i]) return -1;
  }
  return 0;
}

async function checkForUpdate() {
  const remoteVersion = await fetchRemoteVersion();
  if (!remoteVersion) return;
  state.remoteVersion = remoteVersion;
  if (compareSemver(remoteVersion, state.currentVersion) > 0) {
    await serviceWorkerRegistration?.update().catch(() => undefined);
    if (serviceWorkerRegistration?.waiting) {
      markUpdateAvailable(remoteVersion);
      return;
    }
  }
  notify();
}

function attachServiceWorkerListeners(registration: ServiceWorkerRegistration) {
  const handleWaitingWorker = () => {
    if (registration.waiting) {
      markUpdateAvailable(state.remoteVersion || undefined);
    }
  };

  if (registration.waiting) {
    handleWaitingWorker();
  }

  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        handleWaitingWorker();
      }
    });
  });
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    serviceWorkerRegistration = registration;
    attachServiceWorkerListeners(registration);
    await checkForUpdate();

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloadOnControllerChange) {
        reloadOnControllerChange = false;
        window.location.reload();
      }
    });
  } catch {
    // no-op
  }
}

function setupInstallPromptCapture() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event as BeforeInstallPromptEvent;
    state.installPromptAvailable = true;
    state.installHintDismissed = false;
    notify();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    state.installPromptAvailable = false;
    state.installHintDismissed = false;
    updatePlatformSnapshot();
    applyRuntimeClasses();
    notify();
  });
}

function setupRuntimeListeners() {
  window.addEventListener('online', () => {
    state.isOnline = true;
    notify();
    void checkForUpdate();
  });
  window.addEventListener('offline', () => {
    state.isOnline = false;
    notify();
  });
  const standaloneMql = window.matchMedia ? window.matchMedia('(display-mode: standalone)') : null;
  if (standaloneMql) {
    const onStandaloneChange = () => {
      updatePlatformSnapshot();
      applyRuntimeClasses();
      notify();
    };
    if (typeof standaloneMql.addEventListener === 'function') {
      standaloneMql.addEventListener('change', onStandaloneChange);
    } else if (typeof (standaloneMql as any).addListener === 'function') {
      (standaloneMql as any).addListener(onStandaloneChange);
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    void checkForUpdate();
  });
}

function startUpdatePolling() {
  if (updateCheckTimer !== null) {
    window.clearInterval(updateCheckTimer);
  }
  updateCheckTimer = window.setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    void checkForUpdate();
  }, UPDATE_CHECK_INTERVAL_MS);
}

export function initPwaRuntime() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  void (async () => {
    const resetTriggered = await maybeRunServiceWorkerReset();
    if (resetTriggered) return;

    updatePlatformSnapshot();
    applyRuntimeClasses();

    const iosRecoveryTriggered = await maybeRunIosStandaloneRecovery();
    if (iosRecoveryTriggered) return;

    try {
      state.installHintDismissed = localStorage.getItem(INSTALL_HINT_STORAGE_KEY) === '1';
    } catch {
      state.installHintDismissed = false;
    }
    syncSnapshot();

    setupInstallPromptCapture();
    setupRuntimeListeners();
    await registerServiceWorker();
    startUpdatePolling();
  })();
}

export async function promptPwaInstall(): Promise<{ ok: boolean; message?: string; outcome?: 'accepted' | 'dismissed' }> {
  if (!deferredInstallPrompt) {
    if (state.isIOS && state.isSafari && !state.isStandalone) {
      return {
        ok: false,
        message: 'On iPhone/iPad: open in Safari, tap Share, then Add to Home Screen.',
      };
    }
    return {
      ok: false,
      message: 'Install prompt is not available yet. Keep using NCore and try again.',
    };
  }

  try {
    await deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    state.installPromptAvailable = false;
    notify();
    return { ok: choice.outcome === 'accepted', outcome: choice.outcome };
  } catch {
    return { ok: false, message: 'Install prompt failed to open.' };
  }
}

export function applyPwaUpdate() {
  const waiting = serviceWorkerRegistration?.waiting;
  if (!waiting) return false;
  reloadOnControllerChange = true;
  waiting.postMessage({ type: 'SKIP_WAITING' });
  return true;
}

export function dismissPwaInstallHint() {
  setInstallDismissed(true);
}

export function clearPwaInstallHintDismissal() {
  setInstallDismissed(false);
}

export function getPwaRuntimeSnapshot(): PwaRuntimeSnapshot {
  return snapshot;
}

export function subscribePwaRuntime(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePwaRuntime() {
  return useSyncExternalStore(subscribePwaRuntime, getPwaRuntimeSnapshot, getPwaRuntimeSnapshot);
}
