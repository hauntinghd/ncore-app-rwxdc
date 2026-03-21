/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;

interface DesktopDownloadResult {
  ok: boolean;
  noUpdate?: boolean;
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

interface Window {
  desktopBridge?: {
    getUpdateConfig: () => Promise<{ ok: boolean; url?: string; message?: string }>;
    setUpdateConfig: (url: string) => Promise<{ ok: boolean; message?: string }>;
    downloadLatestUpdate: () => Promise<DesktopDownloadResult>;
    openExternalUrl: (url: string) => Promise<{ ok: boolean; message?: string }>;
    realtimeStart: (accessToken: string) => Promise<{ ok: boolean; message?: string }>;
    realtimeStop: () => Promise<{ ok: boolean; message?: string }>;
    realtimeSetStatus: (status: string) => Promise<{ ok: boolean; message?: string }>;
    listDesktopCaptureSources: () => Promise<{ ok: boolean; message?: string; sources?: DesktopCaptureSource[] }>;
    setPreferredDesktopCaptureSource: (sourceId: string) => Promise<{ ok: boolean; message?: string }>;
    onIncomingCall: (cb: (payload: any) => void) => () => void;
    onDesktopNotificationClick: (cb: (payload: any) => void) => () => void;
  };
}
