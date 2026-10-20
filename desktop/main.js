// Processo principal do CutLab para Windows: abre a janela do editor e cuida das atualizações.
const { app, BrowserWindow, protocol, net, ipcMain, shell, Menu, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('node:path');
const fs = require('node:fs');
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
    // sem freio em segundo plano: com a janela minimizada ou atrás de outra, o Chromium segurava os
    // timers em 1 s — os proxies e a exportação praticamente paravam
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
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
  // o GitHub entrega as notas em HTML (com entidades); linhas de assinatura de commit não interessam ao usuário
  const ent = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };
  return s.replace(/<\/(p|li|h\d)>|<br\s*\/?>/gi, '\n').replace(/<li>/gi, '• ').replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, k) => ent[k])
    .split('\n').filter((l) => !/^\s*(Co-Authored-By|Signed-off-by):/i.test(l)).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
}
const check = () => { if (app.isPackaged) autoUpdater.checkForUpdates().catch(() => {}); else send({ state: 'dev' }); };

ipcMain.handle('update:check', () => check());
ipcMain.handle('update:download', () => autoUpdater.downloadUpdate().catch(() => {}));
ipcMain.handle('update:install', () => setImmediate(() => autoUpdater.quitAndInstall(false, true)));
ipcMain.on('app:version', (e) => { e.returnValue = app.getVersion(); });

/* ---------- salvar a exportação (como no CapCut: escolhe a pasta antes, o vídeo vai direto para lá) ----------
   A página só grava em pastas que o próprio usuário escolheu (ou na pasta Vídeos) e só abre no
   Explorador arquivos que ela mesma salvou. A última pasta usada fica guardada para a próxima vez. */
const prefsFile = () => path.join(app.getPath('userData'), 'export.json');
const allowedDirs = new Set();
const savedFiles = new Set();
function exportDir() {
  let dir = null;
  try { dir = JSON.parse(fs.readFileSync(prefsFile(), 'utf8')).dir; } catch { /* primeira vez */ }
  if (!dir || !fs.existsSync(dir)) dir = app.getPath('videos');
  allowedDirs.add(dir);
  return dir;
}
const rememberDir = (dir) => { allowedDirs.add(dir); fs.promises.writeFile(prefsFile(), JSON.stringify({ dir })).catch(() => {}); };
/** nome livre na pasta: "video.mp4", "video (2).mp4"… (nunca sobrescreve) */
function freePath(dir, name) {
  const ext = path.extname(name), base = path.basename(name, ext);
  for (let n = 1; ; n++) {
    const p = path.join(dir, n === 1 ? name : `${base} (${n})${ext}`);
    if (!fs.existsSync(p)) return p;
  }
}
const cleanName = (name) => path.basename(String(name || 'video.mp4')).replace(/[\\/:*?"<>|]+/g, '-');
ipcMain.handle('export:dir', () => exportDir());
ipcMain.handle('export:pickDir', async (_e, current) => {
  const r = await dialog.showOpenDialog(win, { title: 'Pasta para salvar os vídeos', defaultPath: current || exportDir(), properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  rememberDir(r.filePaths[0]);
  return r.filePaths[0];
});
ipcMain.handle('export:write', async (_e, { dir, name, data }) => {
  if (!allowedDirs.has(dir)) throw new Error('pasta não autorizada');
  const file = freePath(dir, cleanName(name));
  await fs.promises.writeFile(file, Buffer.from(data));
  savedFiles.add(file);
  return file;
});
ipcMain.handle('export:saveAs', async (_e, { name, data }) => {
  const ext = path.extname(cleanName(name)).slice(1) || 'mp4';
  const r = await dialog.showSaveDialog(win, { title: 'Salvar vídeo', defaultPath: path.join(exportDir(), cleanName(name)), filters: [{ name: 'Vídeo', extensions: [ext] }] });
  if (r.canceled || !r.filePath) return null;
  await fs.promises.writeFile(r.filePath, Buffer.from(data));
  savedFiles.add(r.filePath);
  rememberDir(path.dirname(r.filePath));
  return r.filePath;
});
ipcMain.handle('export:show', (_e, file) => { if (savedFiles.has(file)) shell.showItemInFolder(file); });

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
