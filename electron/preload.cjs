const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopBridge', {
  authStorageGetItem: (key) => ipcRenderer.invoke('authStorage:getItem', { key }),
  authStorageSetItem: (key, value) => ipcRenderer.invoke('authStorage:setItem', { key, value }),
  authStorageRemoveItem: (key) => ipcRenderer.invoke('authStorage:removeItem', { key }),
  getUpdateConfig: () => ipcRenderer.invoke('updates:getConfig'),
  getUpdateRuntimeState: () => ipcRenderer.invoke('updates:getRuntimeState'),
  setUpdateConfig: (url) => ipcRenderer.invoke('updates:setConfig', { url }),
  downloadLatestUpdate: () => ipcRenderer.invoke('updates:downloadLatest'),
  installDownloadedUpdate: () => ipcRenderer.invoke('updates:installNow'),
  openExternalUrl: (url) => ipcRenderer.invoke('shell:openExternal', { url }),
  realtimeStart: (accessToken) => ipcRenderer.invoke('realtime:start', accessToken),
  realtimeStop: () => ipcRenderer.invoke('realtime:stop'),
  realtimeSetStatus: (status) => ipcRenderer.invoke('realtime:setStatus', { status }),
  setStreamerModeConfig: (payload) => ipcRenderer.invoke('settings:setStreamerMode', payload || {}),
  listDesktopCaptureSources: () => ipcRenderer.invoke('desktopCapture:listSources'),
  setPreferredDesktopCaptureSource: (sourceId) => ipcRenderer.invoke('desktopCapture:setPreferredSource', { sourceId }),
  onIncomingCall: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('incoming-call', listener);
    return () => ipcRenderer.removeListener('incoming-call', listener);
  },
  onDesktopNotificationClick: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('desktop-notification-click', listener);
    return () => ipcRenderer.removeListener('desktop-notification-click', listener);
  },
  onUpdateReady: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('updates:ready', listener);
    return () => ipcRenderer.removeListener('updates:ready', listener);
  },
});
