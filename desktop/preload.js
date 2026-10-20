// Ponte entre o editor (página) e o processo principal: atualizações e salvar a exportação.
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
  /** pasta onde a exportação é salva (a última usada, ou Vídeos) */
  exportDir: () => ipcRenderer.invoke('export:dir'),
  /** escolhe outra pasta; null se cancelar */
  pickExportDir: (current) => ipcRenderer.invoke('export:pickDir', current),
  /** grava o vídeo na pasta (sem sobrescrever: "nome (2).mp4"…); devolve o caminho */
  writeExport: (dir, name, data) => ipcRenderer.invoke('export:write', { dir, name, data }),
  /** "Salvar como…" do Windows; devolve o caminho ou null */
  saveExportAs: (name, data) => ipcRenderer.invoke('export:saveAs', { name, data }),
  /** abre o Explorador com o arquivo selecionado */
  showInFolder: (file) => ipcRenderer.invoke('export:show', file),
});
