// Monta desktop/app/: a mesma página do site, mas com React e o gerador de MP4 locais
// e o JSX já compilado (abre mais rápido e sem depender da internet para iniciar).
import { mkdirSync, copyFileSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { sources, page } from '../cutlab/build.mjs';

const require = createRequire(import.meta.url);
const out = new URL('./app/', import.meta.url);
rmSync(out, { recursive: true, force: true });
mkdirSync(new URL('./vendor/', out), { recursive: true });

const vendor = {
  'react.production.min.js': 'react/umd/react.production.min.js',
  'react-dom.production.min.js': 'react-dom/umd/react-dom.production.min.js',
  'mp4-muxer.js': 'mp4-muxer/build/mp4-muxer.js',
};
for (const [name, mod] of Object.entries(vendor)) copyFileSync(new URL(`./node_modules/${mod}`, import.meta.url), new URL(`./vendor/${name}`, out));

const { css, app } = sources();
const local = app.replace('https://unpkg.com/mp4-muxer@5.1.3/build/mp4-muxer.js', 'vendor/mp4-muxer.js');
if (local === app) throw new Error('URL do mp4-muxer não encontrada em 76-offline-export.jsx');
const Babel = require('@babel/standalone');
const { code } = Babel.transform(local, { presets: ['react'], sourceType: 'script', compact: false });

const html = page({ css, app: code, compiled: true, scripts: ['vendor/react.production.min.js', 'vendor/react-dom.production.min.js'] });
writeFileSync(new URL('./index.html', out), html);
console.log('desktop/app/index.html gerado (' + (html.length / 1024).toFixed(0) + ' KB)');

// notas da versão no GitHub (o programa instalado mostra no aviso de atualização): as entradas das Novidades
// desde a versão anterior — do topo até a primeira entrada marcada com `desktop` de outra versão
const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
const src = readFileSync(new URL('../cutlab/src/79-whatsnew.jsx', import.meta.url), 'utf8');
const CHANGELOG = new Function(src.match(/const CHANGELOG = (\[[\s\S]*?\n\]);/)[1].replace(/^/, 'return '))();
const since = [];
for (const v of CHANGELOG) { if (v.desktop && v.desktop !== version) break; since.push(v); }
const LABEL = { novo: 'Novo', melhoria: 'Melhoria', correção: 'Correção', removido: 'Removido' };
const notes = since.map((v) => `### ${v.title}\n\n${v.items.map(([k, t]) => `- **${LABEL[k] ?? k}:** ${t}`).join('\n')}`).join('\n\n');
writeFileSync(new URL('./build/release-notes.md', import.meta.url), notes + '\n');
console.log(`notas da versão ${version}: ${since.length} entrada(s) das Novidades`);
