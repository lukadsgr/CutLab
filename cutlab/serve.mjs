// Servidor estático mínimo: node serve.mjs  → http://localhost:5173
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.jsx': 'text/javascript' };
createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  try {
    const body = await readFile(join(root, path === '/' ? 'CutLab.html' : path));
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'text/html; charset=utf-8' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(5173, () => console.log('CutLab em http://localhost:5173'));
