/* =====================================================================
   Camadas no estilo After Effects
   - Parentesco (Pai e vínculo): uma linha herda posição/escala/rotação do
     clipe ativo da linha-pai, compensado pelo estado no momento do vínculo
     (como o After Effects: o filho não pula ao ser vinculado)
   - Fosco de trilha (TrkMat): a linha usa a linha imediatamente acima como
     fosco alfa/luma (normal ou invertido); a linha do fosco deixa de aparecer
   - Solo: com alguma linha em solo, só as linhas em solo aparecem/tocam
   ===================================================================== */
const VISUAL_TRACKS = ['overlay', 'text', 'caption'];
const MATTES = [
  { id: 'none', name: 'Nenhum', short: '—' },
  { id: 'alpha', name: 'Fosco alfa', short: 'Alfa' },
  { id: 'alphaInv', name: 'Fosco alfa invertido', short: 'Alfa inv.' },
  { id: 'luma', name: 'Fosco luma', short: 'Luma' },
  { id: 'lumaInv', name: 'Fosco luma invertido', short: 'Luma inv.' },
];
// cores de rótulo do After Effects
const LABELS = [
  { name: 'Nenhum', c: '#5b5b63' }, { name: 'Vermelho', c: '#e0483f' }, { name: 'Amarelo', c: '#d8c442' }, { name: 'Água', c: '#7ec2c5' },
  { name: 'Rosa', c: '#e594c2' }, { name: 'Lavanda', c: '#a99ad9' }, { name: 'Pêssego', c: '#e5b78f' }, { name: 'Espuma do mar', c: '#a5d1a5' },
  { name: 'Azul', c: '#4f6fe0' }, { name: 'Verde', c: '#4aa84a' }, { name: 'Roxo', c: '#8e3ea8' }, { name: 'Laranja', c: '#e58a2e' },
  { name: 'Marrom', c: '#8d5e3a' }, { name: 'Fúcsia', c: '#e44fe0' }, { name: 'Ciano', c: '#3ab3d6' }, { name: 'Arenito', c: '#a8927a' },
];
const DEFAULT_LABEL = { main: 8, overlay: 5, text: 1, caption: 2, effect: 13, audio: 9 };
const rowLabel = (ts, track, lane) => LABELS[ts[rowKey(track, lane)]?.label ?? DEFAULT_LABEL[track] ?? 0].c;
const rowTrack = (rk) => rk.split(':')[0];
const canParentRow = (rk) => ['main', ...VISUAL_TRACKS].includes(rowTrack(rk));
/** algum solo ligado? */
const soloOn = (ts) => Object.values(ts).some((s) => s?.solo);
/** clipe ativo de uma linha no instante t (o que começa por último) */
const activeInRow = (clips, rk, t) => {
  let best = null;
  for (const c of clips) if (clipRow(c) === rk && t >= c.start && t < c.start + c.duration && (!best || c.start >= best.start)) best = c;
  return best;
};
/** transformação de um clipe em "unidades de altura" (independe da resolução/proporção) */
function clipMatrixU(c, t, W, H) {
  const local = clamp(t - c.start, 0, c.duration);
  const p = resolveProps(c, local);
  const T = animTransform(c, p, local, W / H);
  const s = ((p.scale ?? 100) / 100) * T.s;
  const cx = W / 2 + (p.x / 100) * (W / 2) + T.x * W;
  const cy = H / 2 + (p.y / 100) * (H / 2) + T.y * H;
  return new DOMMatrix().translate(cx / H, cy / H).rotate((p.rotation ?? 0) + T.r)
    .scale(s * T.sx * ((p.scaleX ?? 100) / 100), s * T.sy * ((p.scaleY ?? 100) / 100));
}
const toArr = (m) => [m.a, m.b, m.c, m.d, m.e, m.f];

Object.assign(Engine.prototype, {
  /** matriz "mundo" da linha (cadeia de pais + clipe ativo), em unidades de altura. fallback: usa o clipe mais próximo */
  worldU(rk, t, clips, ts, W, H, depth = 0, fallback = false) {
    let c = activeInRow(clips, rk, t), tt = t;
    if (!c && fallback) {
      c = clips.filter((x) => clipRow(x) === rk).sort((a, b) => Math.abs(a.start - t) - Math.abs(b.start - t))[0];
      tt = c ? clamp(t, c.start, c.start + c.duration - 1e-3) : t;
    }
    if (!c) return null;
    const own = clipMatrixU(c, tt, W, H);
    const pm = this.parentU(rk, t, clips, ts, W, H, depth + 1);
    return pm ? pm.multiply(own) : own;
  },
  /** transformação herdada do pai (relativa ao estado no momento do vínculo), em unidades de altura */
  parentU(rk, t, clips, ts, W, H, depth = 0) {
    const st = ts[rk];
    if (!st?.parent || !st.rest || depth > 8) return null;
    const now = this.worldU(st.parent, t, clips, ts, W, H, depth);
    if (!now) return null;
    return now.multiply(new DOMMatrix(st.rest).inverse());
  },
  /** matriz do pai em px do canvas (ou null) */
  parentPx(rk, t, clips, ts, W, H) {
    const u = this.parentU(rk, t, clips, ts, W, H);
    if (!u) return null;
    return new DOMMatrix().scale(H).multiply(u).multiply(new DOMMatrix().scale(1 / H));
  },
  /** linhas de sobreposição/texto/legenda, com parentesco, fosco de trilha e solo */
  renderLayers(ctx, W, H, t, clips, assetMap, ts, k, boxes) {
    // de baixo para cima, na ordem das camadas da linha do tempo
    const rows = [];
    for (const tid of UPPER_TRACKS) for (const l of new Set(clips.filter((c) => c.track === tid).map(laneOf))) rows.push({ rk: rowKey(tid, l), z: rowZ(ts, tid, l) });
    rows.sort((a, b) => a.z - b.z);
    for (let i = 0; i < rows.length; i++) rows[i] = rows[i].rk;
    const isFx = (rk) => rowTrack(rk) === 'effect';
    const solo = soloOn(ts);
    const visible = (rk) => !ts[rk]?.hidden && !ts[rowTrack(rk)]?.hidden && (!solo || ts[rk]?.solo);
    const pairs = this.pairs(clips);
    const draw = (target, rk) => {
      let list = clips.filter((c) => clipRow(c) === rk && t >= c.start && t < c.start + c.duration).sort((a, b) => a.start - b.start);
      const tr = pairs.find((p) => p.row === rk && t >= p.from && t < p.to);
      if (!list.length && !tr) return;
      const pm = this.parentPx(rk, t, clips, ts, W, H);
      if (tr) {
        // transição entre dois clipes desta linha (fundo transparente)
        const A = tmpCanvas('ltrA', W, H), B = tmpCanvas('ltrB', W, H), O = tmpCanvas('ltrO', W, H);
        for (const [cv, clip, tc] of [[A, tr.A, Math.min(t, tr.A.start + tr.A.duration - 1e-3)], [B, tr.B, Math.max(t, tr.B.start)]]) {
          const x = cv.getContext('2d');
          x.clearRect(0, 0, W, H);
          boxes.push(this.drawClip(x, clip, assetMap[clip.assetId], tc, W, H, k, pm));
        }
        const o = O.getContext('2d');
        o.clearRect(0, 0, W, H);
        o.save();
        (TRANSITION_MAP[tr.type] || TRANSITIONS[0]).fn(o, A, B, (t - tr.from) / (tr.to - tr.from), W, H, tr.d);
        o.restore();
        target.drawImage(O, 0, 0);
        list = list.filter((c) => c !== tr.A && c !== tr.B);
      }
      for (const c of list) boxes.push(this.drawClip(target, c, assetMap[c.assetId], t, W, H, k, pm));
    };
    for (let i = 0; i < rows.length; i++) {
      const rk = rows[i], m = ts[rk]?.matte, above = rows[i + 1];
      if (isFx(rk)) {
        // efeito/ajuste: vale para tudo o que já foi desenhado (as camadas abaixo dele)
        if (visible(rk)) for (const c of clips.filter((x) => clipRow(x) === rk && t >= x.start && t < x.start + x.duration).sort((a, b) => a.start - b.start)) this.applyEffect(ctx, c, t, W, H, k);
        continue;
      }
      if (m && m !== 'none' && above && !isFx(above)) {
        if (visible(rk)) {
          const L = tmpCanvas('matteL', W, H), M = tmpCanvas('matteM', W, H);
          const lx = L.getContext('2d'), mx = M.getContext('2d');
          lx.clearRect(0, 0, W, H);
          mx.clearRect(0, 0, W, H);
          draw(lx, rk);
          draw(mx, above);
          if (m.startsWith('luma')) lumaToAlpha(M);
          lx.save();
          lx.globalCompositeOperation = m.endsWith('Inv') ? 'destination-out' : 'destination-in';
          lx.drawImage(M, 0, 0);
          lx.restore();
          ctx.drawImage(L, 0, 0);
        }
        i++; // a linha de cima virou fosco: não aparece sozinha
        continue;
      }
      if (visible(rk)) draw(ctx, rk);
    }
  },
});

/** fosco luma: luminância vira transparência */
function lumaToAlpha(cv) {
  const x = cv.getContext('2d', { willReadFrequently: true });
  const img = x.getImageData(0, 0, cv.width, cv.height), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i + 3] = ((d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) * d[i + 3]) / 255;
    d[i] = d[i + 1] = d[i + 2] = 255;
  }
  x.putImageData(img, 0, 0);
}

/** renumera chaves de linha (estado, pai) depois que as camadas foram compactadas */
function laneRemap(before, after) {
  const map = {};
  const byId = new Map(after.map((c) => [c.id, c]));
  for (const c of before) {
    const n = byId.get(c.id);
    if (n && n.track === c.track) map[clipRow(c)] = clipRow(n);
  }
  return map;
}
function remapTrackState(ts, map) {
  if (!Object.keys(map).some((k) => map[k] !== k)) return ts;
  const out = {};
  const fix = (v) => (v?.parent && map[v.parent] ? { ...v, parent: map[v.parent] } : v);
  // linhas sem clipes mapeados (faixa inteira, camada 0 vazia) primeiro; as mapeadas têm prioridade
  for (const [k, v] of Object.entries(ts)) if (!(k in map) && !k.includes(':')) out[k] = fix(v);
  for (const [k, v] of Object.entries(ts)) if (k in map) out[map[k]] = fix(v);
  return out;
}
