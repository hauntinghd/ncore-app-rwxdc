const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopBridge', {
  getUpdateConfig: () => ipcRenderer.invoke('updates:getConfig'),
  setUpdateConfig: (url) => ipcRenderer.invoke('updates:setConfig', { url }),
  downloadLatestUpdate: () => ipcRenderer.invoke('updates:downloadLatest'),
  openExternalUrl: (url) => ipcRenderer.invoke('shell:openExternal', { url }),
  realtimeStart: (accessToken) => ipcRenderer.invoke('realtime:start', accessToken),
  realtimeStop: () => ipcRenderer.invoke('realtime:stop'),
  realtimeSetStatus: (status) => ipcRenderer.invoke('realtime:setStatus', { status }),
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
});
