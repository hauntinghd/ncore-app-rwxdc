/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;

interface DesktopDownloadResult {
  ok: boolean;
  noUpdate?: boolean;
  portable?: boolean;
  ready?: boolean;
  checking?: boolean;
  downloading?: boolean;
  installing?: boolean;
  progress?: number;
  currentVersion?: string;
  latestVersion?: string;
  installerUrl?: string;
  message?: string;
}

interface DesktopCaptureSource {
  id: string;
  name: string;
  type: 'screen' | 'window';
  thumbnailDataUrl?: string;
}

interface DesktopUpdateRuntimeState {
  ok: boolean;
  portable?: boolean;
  ready?: boolean;
  checking?: boolean;
  downloading?: boolean;
  progress?: number;
  installing?: boolean;
  version?: string;
  latestVersion?: string;
  message?: string;
}

interface DesktopAuthStorageResult {
  ok: boolean;
  value?: string | null;
  message?: string;
}

interface Window {
  desktopBridge?: {
    authStorageGetItem: (key: string) => Promise<DesktopAuthStorageResult>;
    authStorageSetItem: (key: string, value: string) => Promise<{ ok: boolean; message?: string }>;
    authStorageRemoveItem: (key: string) => Promise<{ ok: boolean; message?: string }>;
    getUpdateConfig: () => Promise<{ ok: boolean; url?: string; message?: string }>;
    getUpdateRuntimeState: () => Promise<DesktopUpdateRuntimeState>;
    setUpdateConfig: (url: string) => Promise<{ ok: boolean; message?: string }>;
    downloadLatestUpdate: () => Promise<DesktopDownloadResult>;
    installDownloadedUpdate: () => Promise<{ ok: boolean; message?: string }>;
    openExternalUrl: (url: string) => Promise<{ ok: boolean; message?: string }>;
    realtimeStart: (accessToken: string) => Promise<{ ok: boolean; message?: string }>;
    realtimeStop: () => Promise<{ ok: boolean; message?: string }>;
    realtimeSetStatus: (status: string) => Promise<{ ok: boolean; message?: string }>;
    setStreamerModeConfig: (payload: {
      enabled: boolean;
      hideDmPreviews?: boolean;
      silentNotifications?: boolean;
    }) => Promise<{ ok: boolean; message?: string }>;
    listDesktopCaptureSources: () => Promise<{ ok: boolean; message?: string; sources?: DesktopCaptureSource[] }>;
    setPreferredDesktopCaptureSource: (sourceId: string) => Promise<{ ok: boolean; message?: string }>;
    onIncomingCall: (cb: (payload: any) => void) => () => void;
    onDesktopNotificationClick: (cb: (payload: any) => void) => () => void;
    onUpdateReady: (cb: (payload: DesktopUpdateRuntimeState) => void) => () => void;
  };
}
