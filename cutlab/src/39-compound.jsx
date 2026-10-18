/* =====================================================================
   Clipes compostos: vários clipes agrupados num só, com linha do tempo própria
   compound = { type: 'compound', children: [clipes com tempos relativos ao início interno],
                in: deslocamento dentro da linha interna, trackState: estado das linhas internas }
   ===================================================================== */
const isCompound = (c) => c?.type === 'compound';
/** duração da linha do tempo interna */
const innerLength = (children) => children.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
/** novos ids para o clipe e tudo o que há dentro (cópias não podem dividir elementos de mídia) */
function reid(c) {
  return isCompound(c) ? { ...c, id: uid(), children: c.children.map(reid) } : { ...c, id: uid() };
}
/** todos os ids, inclusive dos clipes aninhados */
function allClipIds(clips, out = new Set()) {
  for (const c of clips) { out.add(c.id); if (isCompound(c)) allClipIds(c.children, out); }
  return out;
}
/** filhos do composto no caminho `path` (lista de ids, da raiz para dentro); null se o caminho sumiu */
function clipsAtPath(root, path) {
  let cs = root;
  for (const id of path) {
    const c = cs.find((x) => x.id === id);
    if (!isCompound(c)) return null;
    cs = c.children;
  }
  return cs;
}
/**
 * aplica `fn` aos filhos no caminho e ajusta os compostos acima:
 * se o composto mostrava até o fim do conteúdo, continua mostrando até o novo fim.
 */
function updateAtPath(root, path, fn, magnet) {
  if (!path.length) return fn(root);
  const [id, ...rest] = path;
  let changed = false;
  const out = root.map((c) => {
    if (c.id !== id || !isCompound(c)) return c;
    const children = updateAtPath(c.children, rest, fn, magnet);
    if (children === c.children) return c;
    changed = true;
    const oldLen = innerLength(c.children), len = Math.max(0.1, innerLength(children));
    const toEnd = c.in + c.duration >= oldLen - 1e-3;
    const inn = Math.min(c.in, Math.max(0, len - 0.1));
    const duration = toEnd ? len - inn : Math.min(c.duration, len - inn);
    return { ...c, children, in: inn, duration: Math.max(0.1, duration) };
  });
  return changed ? (magnet ? packMain(out) : out) : root;
}
/**
 * clipes de mídia de toda a árvore em tempo absoluto, para sincronizar áudio/vídeo.
 * Os de dentro de compostos levam a janela visível (_win), mudo, ganho e fades de áudio (_fades) herdados.
 */
function expandMedia(clips, ts, off = 0, win = null, muted = false, gain = 1, nested = false, fades = []) {
  const out = [];
  for (const c of clips) {
    if (isCompound(c)) {
      const s = off + c.start, w = [Math.max(s, win ? win[0] : -Infinity), Math.min(s + c.duration, win ? win[1] : Infinity)];
      const m = muted || !!(ts[c.track]?.muted || ts[clipRow(c)]?.muted);
      const fd = c.props.fadeIn > 0 || c.props.fadeOut > 0 ? [...fades, { start: s, duration: c.duration, props: c.props }] : fades;
      out.push(...expandMedia(c.children, c.trackState || {}, s - c.in, w, m, gain * ((c.props.volume ?? 100) / 100), true, fd));
    } else if (isMedia(c) || !nested) {
      out.push(nested ? { ...c, start: c.start + off, _sub: true, _win: win, _muted: muted || !!(ts[c.track]?.muted || ts[clipRow(c)]?.muted), _gain: gain, _fades: fades } : c);
    }
  }
  return out;
}
/** fade de áudio do clipe no instante t, junto com os fades dos compostos em que ele está */
const audioFade = (c, t) => (c._fades || []).reduce((f, p) => f * fadeFactor(p, t), fadeFactor(c, t));
