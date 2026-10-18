// Gera CutLab.html: um único arquivo que abre direto no navegador (sem servidor).
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const srcDir = new URL('./src/', import.meta.url);
const css = readdirSync(srcDir).filter((f) => f.endsWith('.css')).sort().map((f) => readFileSync(new URL(f, srcDir), 'utf8')).join('\n');
// os módulos são concatenados em ordem (00-core, 10-media, …, 80-app)
const app = readdirSync(srcDir).filter((f) => f.endsWith('.jsx')).sort().map((f) => readFileSync(new URL(f, srcDir), 'utf8')).join('\n');
const html = `<!doctype html>
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
<script src="https://unpkg.com/react@18.3.1/umd/react.production.min.js"></script>
<script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js"></script>
<script src="https://unpkg.com/@babel/standalone@7.26.4/babel.min.js"></script>
<script type="text/babel" data-presets="react">
${app}</script>
</body>
</html>
`;
writeFileSync(new URL('./CutLab.html', import.meta.url), html);
console.log('CutLab.html gerado (' + (html.length / 1024).toFixed(0) + ' KB)');
