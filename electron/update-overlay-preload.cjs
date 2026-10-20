const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('updateOverlay', {
  getInitialState: () => ipcRenderer.invoke('updateOverlay:getState'),
  getLogoDataUri: () => ipcRenderer.invoke('updateOverlay:getLogo'),
  install: () => ipcRenderer.invoke('updateOverlay:install'),
  dismiss: () => ipcRenderer.invoke('updateOverlay:dismiss'),
  retry: () => ipcRenderer.invoke('updateOverlay:retry'),
  openExternal: (url) => ipcRenderer.invoke('updateOverlay:openExternal', { url }),
  revealInFolder: (filePath) => ipcRenderer.invoke('updateOverlay:revealInFolder', { filePath }),
  onStateChange: (cb) => {
    const listener = (_event, state) => cb(state);
    ipcRenderer.on('updateOverlay:state', listener);
    return () => ipcRenderer.removeListener('updateOverlay:state', listener);
  },
});
