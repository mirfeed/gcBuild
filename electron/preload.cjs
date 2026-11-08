// Bridge for the desktop app: the page only gets these actions (sandboxed, no Node access).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gcbuild', {
  isDesktop: true,
  version: () => ipcRenderer.invoke('app-version'),
  setTheme: (theme) => ipcRenderer.invoke('set-theme', theme),
  importOld: () => ipcRenderer.invoke('import-old'),
  openDataFolder: () => ipcRenderer.invoke('open-data'),
  updateStatus: () => ipcRenderer.invoke('update-status'),
  checkUpdates: () => ipcRenderer.invoke('update-check'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  betaGet: () => ipcRenderer.invoke('beta-get'),
  betaSet: (enabled, key) => ipcRenderer.invoke('beta-set', enabled, key),
  onUpdate: (cb) => {
    const fn = (_e, s) => cb(s);
    ipcRenderer.on('update-status', fn);
    return () => ipcRenderer.removeListener('update-status', fn);
  },
});
