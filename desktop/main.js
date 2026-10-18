// Processo principal do CutLab para Windows: abre a janela do editor e cuida das atualizações.
const { app, BrowserWindow, protocol, net, ipcMain, shell, Menu } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// o editor roda em cutlab://app/ (e não em file://) para ter uma origem fixa:
// projeto salvo, preferências e proxies (IndexedDB/localStorage) continuam entre uma abertura e outra
protocol.registerSchemesAsPrivileged([
  { scheme: 'cutlab', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);
const APP_DIR = path.join(__dirname, 'app');

let win = null;
const send = (status) => win && !win.isDestroyed() && win.webContents.send('update-status', status);

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 960, minHeight: 600,
    backgroundColor: '#060607', show: false, autoHideMenuBar: true, title: 'CutLab',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  // links externos (ex.: notas da versão) abrem no navegador do sistema
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
  });
  win.loadURL('cutlab://app/index.html');
}

/* ---------- atualizações (GitHub Releases) ----------
   Nada é baixado sem o usuário pedir: o editor mostra o aviso e o botão "Baixar e instalar". */
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.on('checking-for-update', () => send({ state: 'checking' }));
autoUpdater.on('update-available', (i) => send({ state: 'available', version: i.version, notes: notesText(i.releaseNotes), date: i.releaseDate }));
autoUpdater.on('update-not-available', () => send({ state: 'none' }));
autoUpdater.on('download-progress', (p) => send({ state: 'downloading', percent: p.percent, bps: p.bytesPerSecond, total: p.total }));
autoUpdater.on('update-downloaded', (i) => send({ state: 'ready', version: i.version }));
autoUpdater.on('error', (err) => {
  const message = String(err?.message || err).split('\n')[0];
  // ainda não existe nenhuma versão publicada: não é erro, só não há o que atualizar
  send(/No published versions/i.test(message) ? { state: 'none' } : { state: 'error', message });
});

function notesText(n) {
  if (!n) return '';
  const s = Array.isArray(n) ? n.map((x) => x.note || '').join('\n') : String(n);
  return s.replace(/<[^>]+>/g, '').trim();   // o GitHub entrega as notas em HTML
}
const check = () => { if (app.isPackaged) autoUpdater.checkForUpdates().catch(() => {}); else send({ state: 'dev' }); };

ipcMain.handle('update:check', () => check());
ipcMain.handle('update:download', () => autoUpdater.downloadUpdate().catch(() => {}));
ipcMain.handle('update:install', () => setImmediate(() => autoUpdater.quitAndInstall(false, true)));
ipcMain.on('app:version', (e) => { e.returnValue = app.getVersion(); });

// uma janela só: abrir o CutLab de novo traz a janela existente para frente
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    protocol.handle('cutlab', (req) => {
      const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '') || 'index.html';
      const file = path.normalize(path.join(APP_DIR, rel));
      if (!file.startsWith(APP_DIR + path.sep)) return new Response('not found', { status: 404 });
      return net.fetch(pathToFileURL(file).toString());
    });
    createWindow();
    // procura ao abrir (depois de o editor carregar) e a cada 4 horas
    win.webContents.once('did-finish-load', () => setTimeout(check, 4000));
    setInterval(check, 4 * 60 * 60 * 1000);
  });
  app.on('window-all-closed', () => app.quit());
}
