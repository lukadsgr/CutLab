// Monta desktop/app/: a mesma página do site, mas com React e o gerador de MP4 locais
// e o JSX já compilado (abre mais rápido e sem depender da internet para iniciar).
import { mkdirSync, copyFileSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { sources, page } from '../cutlab/build.mjs';
import { releaseNotes } from './release-notes.mjs';

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

// notas da versão (vão para o latest.yml; o GitHub Actions também as põe na página da versão)
const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
writeFileSync(new URL('./build/release-notes.md', import.meta.url), releaseNotes(version));
console.log(`notas da versão ${version} geradas das Novidades`);
