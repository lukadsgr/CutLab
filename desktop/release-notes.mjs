// Notas de uma versão do programa, montadas a partir das Novidades (cutlab/src/79-whatsnew.jsx).
// Pega a entrada marcada com `desktop: '<versão>'` e as de baixo até a próxima marca de outra versão;
// se a versão ainda não foi marcada, usa as entradas do topo até a primeira marca.
//   node desktop/release-notes.mjs 0.3.0 saida.md   → grava o arquivo (usado pelo GitHub Actions)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const LABEL = { novo: 'Novo', melhoria: 'Melhoria', correção: 'Correção', removido: 'Removido' };

export function releaseNotes(version) {
  const src = readFileSync(new URL('../cutlab/src/79-whatsnew.jsx', import.meta.url), 'utf8');
  const CHANGELOG = new Function('return ' + src.match(/const CHANGELOG = (\[[\s\S]*?\n\]);/)[1])();
  let i = CHANGELOG.findIndex((v) => v.desktop === version);
  if (i < 0) i = 0;
  const since = [CHANGELOG[i]];
  for (const v of CHANGELOG.slice(i + 1)) { if (v.desktop && v.desktop !== version) break; since.push(v); }
  return since.map((v) => `### ${v.title}\n\n${v.items.map(([k, t]) => `- **${LABEL[k] ?? k}:** ${t}`).join('\n')}`).join('\n\n') + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [version, out] = process.argv.slice(2);
  writeFileSync(out, releaseNotes(version));
  console.log(`notas da versão ${version} gravadas em ${out}`);
}
