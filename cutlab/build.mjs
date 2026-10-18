// Gera CutLab.html: um único arquivo que abre direto no navegador (sem servidor).
// O programa de desktop (desktop/build.mjs) reaproveita sources() e page() com as bibliotecas locais.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const srcDir = new URL('./src/', import.meta.url);
const read = (ext) => readdirSync(srcDir).filter((f) => f.endsWith(ext)).sort().map((f) => readFileSync(new URL(f, srcDir), 'utf8')).join('\n');
// os módulos são concatenados em ordem (00-core, 10-media, …, 80-app)
export const sources = () => ({ css: read('.css'), app: read('.jsx') });

const CDN = [
  'https://unpkg.com/react@18.3.1/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone@7.26.4/babel.min.js',
];

/** monta a página; `compiled` = o JSX já foi transformado (sem Babel no navegador) */
export function page({ css, app, scripts = CDN, compiled = false }) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>CutLab — Editor de Vídeo</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&family=Inter:wght@400;500;600;700&family=Montserrat:ital,wght@0,400;0,700;1,400;1,700&family=Bebas+Neue&family=Anton&family=Playfair+Display:ital,wght@0,400;0,700;1,400;1,700&family=Pacifico&family=Roboto+Mono:wght@400;700&display=swap" rel="stylesheet" />
<style>
${css}</style>
</head>
<body>
<div id="root"><div class="boot"><div class="boot-logo"></div><div class="boot-bar"><i></i></div><span>CutLab</span></div></div>
${scripts.map((s) => `<script src="${s}"></script>`).join('\n')}
<script${compiled ? '' : ' type="text/babel" data-presets="react"'}>
${app}</script>
</body>
</html>
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const html = page(sources());
  writeFileSync(new URL('./CutLab.html', import.meta.url), html);
  console.log('CutLab.html gerado (' + (html.length / 1024).toFixed(0) + ' KB)');
}
