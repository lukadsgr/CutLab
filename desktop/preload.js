// Ponte entre o editor (página) e o processo principal: só o necessário para as atualizações.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cutlabDesktop', {
  version: ipcRenderer.sendSync('app:version'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  /** cb({ state: 'checking'|'available'|'none'|'downloading'|'ready'|'error'|'dev', ... }); devolve a função que cancela */
  onUpdateStatus: (cb) => {
    const h = (_e, s) => cb(s);
    ipcRenderer.on('update-status', h);
    return () => ipcRenderer.removeListener('update-status', h);
  },
});
