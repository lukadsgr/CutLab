// Gera build/icon.png (512×512) a partir de build/icon.svg: npx electron build/make-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path');
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } });
  const svg = fs.readFileSync(path.join(__dirname, 'icon.svg'), 'utf8');
  await w.loadURL('data:text/html,' + encodeURIComponent(`<body style="margin:0;background:transparent">${svg}</body>`));
  await new Promise((r) => setTimeout(r, 300));
  const img = await w.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  fs.writeFileSync(path.join(__dirname, 'icon.png'), img.resize({ width: 512, height: 512 }).toPNG());
  app.quit();
});
