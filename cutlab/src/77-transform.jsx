/* =====================================================================
   Transformação direta no reprodutor
   - 8 alças (cantos + laterais) e alça de rotação
   - Shift: mantém a proporção (escala) · trava o eixo (mover) · gira de 15 em 15°
   - Alt: cresce por igual para todos os lados (a partir do centro)
   - Ctrl/⌘: desliga o encaixe magnético temporariamente
   - Encaixe inteligente: bordas e centro do quadro, guias das réguas e outros clipes
   ===================================================================== */
const HANDLE_R = 9;      // raio de captura das alças, em px de tela
const ROT_OFFSET = 26;   // distância da alça de rotação acima da caixa, em px de tela
const SNAP_PX = 6;       // distância do encaixe magnético, em px de tela
const SNAP_COLOR = '#ff4fd8';

/** ponto do canvas → coordenadas locais (sem rotação) da caixa */
const boxLocal = (b, px, py) => {
  const dx = px - b.cx, dy = py - b.cy, c = Math.cos(b.rot), s = Math.sin(b.rot);
  return [dx * c + dy * s, -dx * s + dy * c];
};
/** alça sob o ponteiro: { hx, hy } (−1/0/1), { rot: true } ou null. k = px de canvas por px de tela */
function hitHandle(b, px, py, k) {
  if (!b || !b.w) return null;
  const [lx, ly] = boxLocal(b, px, py);
  const r = HANDLE_R * k, hw = b.w / 2, hh = b.h / 2;
  if (Math.hypot(lx, ly + hh + ROT_OFFSET * k) <= r) return { rot: true };
  for (const hy of [-1, 1]) for (const hx of [-1, 1]) if (Math.hypot(lx - hx * hw, ly - hy * hh) <= r) return { hx, hy };
  // laterais: qualquer ponto ao longo da borda
  const edge = r * 0.6;
  if (Math.abs(ly) <= hh && Math.abs(Math.abs(lx) - hw) <= edge) return { hx: Math.sign(lx) || 1, hy: 0 };
  if (Math.abs(lx) <= hw && Math.abs(Math.abs(ly) - hh) <= edge) return { hx: 0, hy: Math.sign(ly) || 1 };
  return null;
}
/** cursor do CSS para uma alça considerando a rotação da caixa */
function handleCursor(h, rot) {
  if (!h) return null;
  if (h.rot) return 'grab';
  const a = (Math.atan2(h.hy, h.hx) + rot) * 180 / Math.PI;
  const oct = ((Math.round(a / 45) % 4) + 4) % 4;
  return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][oct];
}
/** meia-largura/altura da caixa alinhada aos eixos que envolve a caixa girada */
const boxExtent = (b) => {
  const c = Math.abs(Math.cos(b.rot)), s = Math.abs(Math.sin(b.rot));
  return [(b.w * c + b.h * s) / 2, (b.w * s + b.h * c) / 2];
};
/** linhas de encaixe: quadro, guias e outros clipes visíveis */
function snapTargets(W, H, guides, boxes) {
  // guias guardadas em fração do quadro (sobrevivem à troca de proporção)
  const xs = [0, W / 2, W, ...(guides?.v || []).map((f) => f * W)], ys = [0, H / 2, H, ...(guides?.h || []).map((f) => f * H)];
  for (const b of boxes) {
    if (!b.w) continue;
    const [ex, ey] = boxExtent(b);
    xs.push(b.cx - ex, b.cx, b.cx + ex);
    ys.push(b.cy - ey, b.cy, b.cy + ey);
  }
  return { xs, ys };
}
/** melhor encaixe entre valores do objeto e linhas-alvo; devolve { d, at } ou null */
function snap1D(vals, targets, th) {
  let best = null;
  for (const v of vals) for (const t of targets) {
    const d = t - v;
    if (Math.abs(d) <= th && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: t };
  }
  return best;
}
/** todas as linhas-alvo que coincidem com os valores após o encaixe (para desenhar) */
const snapLinesAt = (vals, targets) => [...new Set(targets.filter((t) => vals.some((v) => Math.abs(t - v) < 0.5)))];

/** desenha linhas de encaixe e o rótulo de medida na sobreposição */
function drawSnapGuides(ctx, snap, s, dpr, W, H) {
  if (!snap) return;
  ctx.save();
  ctx.strokeStyle = SNAP_COLOR;
  ctx.lineWidth = 1 * dpr;
  ctx.shadowColor = 'rgba(255,79,216,0.6)';
  ctx.shadowBlur = 4 * dpr;
  for (const x of snap.xs || []) { ctx.beginPath(); ctx.moveTo(x * s + 0.5, 0); ctx.lineTo(x * s + 0.5, H * s); ctx.stroke(); }
  for (const y of snap.ys || []) { ctx.beginPath(); ctx.moveTo(0, y * s + 0.5); ctx.lineTo(W * s, y * s + 0.5); ctx.stroke(); }
  ctx.restore();
  if (snap.label) {
    const { x, y, text } = snap.label;
    ctx.save();
    ctx.font = `600 ${11 * dpr}px 'Geist Mono', monospace`;
    const tw = ctx.measureText(text).width, pw = tw + 14 * dpr, ph = 20 * dpr;
    const lx = clamp(x * s - pw / 2, 4 * dpr, W * s - pw - 4 * dpr), ly = clamp(y * s, 4 * dpr, H * s - ph - 4 * dpr);
    ctx.fillStyle = 'rgba(10,10,12,0.88)';
    ctx.beginPath(); ctx.roundRect(lx, ly, pw, ph, 6 * dpr); ctx.fill();
    ctx.strokeStyle = 'rgba(255,45,70,0.6)'; ctx.lineWidth = 1 * dpr; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle';
    ctx.fillText(text, lx + 7 * dpr, ly + ph / 2);
    ctx.restore();
  }
}
/** alças da caixa selecionada (cantos, laterais e rotação) — em coordenadas já transladadas/giradas */
function drawHandles(ctx, bw, bh, dpr, hover) {
  ctx.save();
  // rotação
  const ry = -bh / 2 - ROT_OFFSET * dpr;
  ctx.strokeStyle = '#ff2d46'; ctx.lineWidth = 1.2 * dpr;
  ctx.beginPath(); ctx.moveTo(0, -bh / 2); ctx.lineTo(0, ry + 6 * dpr); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, ry, (hover?.rot ? 7 : 6) * dpr, 0, Math.PI * 2);
  ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#ff2d46'; ctx.lineWidth = 1.5 * dpr; ctx.stroke();
  ctx.beginPath(); ctx.arc(0, ry, 2.6 * dpr, -Math.PI * 0.9, Math.PI * 0.4); ctx.strokeStyle = '#ff2d46'; ctx.lineWidth = 1.2 * dpr; ctx.stroke();
  // laterais (pílulas) e cantos (quadrados)
  const pill = (x, y, horiz, on) => {
    const L = (on ? 16 : 13) * dpr, T = 5 * dpr;
    const [w, h] = horiz ? [L, T] : [T, L];
    ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, T / 2);
    ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#ff2d46'; ctx.lineWidth = 1 * dpr; ctx.stroke();
  };
  if (bw > 40 * dpr) { pill(0, -bh / 2, true, hover && !hover.hx && hover.hy === -1); pill(0, bh / 2, true, hover && !hover.hx && hover.hy === 1); }
  if (bh > 40 * dpr) { pill(-bw / 2, 0, false, hover && !hover.hy && hover.hx === -1); pill(bw / 2, 0, false, hover && !hover.hy && hover.hx === 1); }
  for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const on = hover && hover.hx === x && hover.hy === y, hs = (on ? 10 : 8) * dpr;
    ctx.fillStyle = '#fff'; ctx.fillRect((x * bw) / 2 - hs / 2, (y * bh) / 2 - hs / 2, hs, hs);
    ctx.strokeStyle = '#ff2d46'; ctx.lineWidth = 1.2 * dpr; ctx.strokeRect((x * bw) / 2 - hs / 2, (y * bh) / 2 - hs / 2, hs, hs);
  }
  ctx.restore();
}

/**
 * Calcula o novo estado ao arrastar uma alça de escala.
 * b0: caixa no início; rp: props no início; (lx, ly): ponteiro em coordenadas locais da caixa.
 * Devolve { patch, w, h, edges } onde edges são as bordas móveis (para encaixe/rótulo).
 */
function resizeFromHandle(b0, rp, h, lx, ly, { shift, alt, W, H, minPx, toChild }) {
  const { hx, hy } = h, w0 = b0.w, h0 = b0.h;
  const ax = alt ? 0 : -hx * w0 / 2, ay = alt ? 0 : -hy * h0 / 2, m = alt ? 2 : 1;
  let nw = hx ? (lx - ax) * hx * m : w0;
  let nh = hy ? (ly - ay) * hy * m : h0;
  const patch = {};
  if (shift) {
    // proporção travada: projeta o arraste na diagonal da caixa
    let f = hx && hy ? (nw * w0 + nh * h0) / (w0 * w0 + h0 * h0) : hx ? nw / w0 : nh / h0;
    f = Math.max(f, minPx / Math.min(w0, h0));
    nw = w0 * f; nh = h0 * f;
    patch.scale = Math.round(rp.scale * f * 10) / 10;
  } else {
    nw = Math.max(nw, minPx); nh = Math.max(nh, minPx);
    if (hx) patch.scaleX = Math.round((rp.scaleX ?? 100) * (nw / w0) * 10) / 10;
    if (hy) patch.scaleY = Math.round((rp.scaleY ?? 100) * (nh / h0) * 10) / 10;
  }
  // novo centro: a borda oposta fica parada (ou o centro, com Alt)
  const cxl = alt || !hx ? 0 : ax + hx * nw / 2;
  const cyl = alt || !hy ? 0 : ay + hy * nh / 2;
  const c = Math.cos(b0.rot), s = Math.sin(b0.rot);
  // deslocamento do centro no quadro → no espaço do clipe (quando há camada-pai)
  const [ox, oy] = (toChild || ((a, b) => [a, b]))(cxl * c - cyl * s, cxl * s + cyl * c);
  patch.x = Math.round((rp.x + (ox / (W / 2)) * 100) * 100) / 100;
  patch.y = Math.round((rp.y + (oy / (H / 2)) * 100) * 100) / 100;
  return { patch, w: nw, h: nh };
}
/** encaixa a borda arrastada (posição local l a partir do centro c); com Alt a borda espelhada também conta */
function snapEdge(c, l, targets, th, alt) {
  const a = snap1D([c + l], targets, th), b = alt ? snap1D([c - l], targets, th) : null;
  if (b && (!a || Math.abs(b.d) < Math.abs(a.d))) return l - b.d;
  return a ? l + a.d : l;
}

/**
 * Caixa de edição de texto sobre o reprodutor (clique duplo num texto).
 * Fica alinhada à caixa do clipe a cada quadro (posição, rotação, tamanho) e usa a mesma fonte.
 * Esc ou Ctrl+Enter termina; clicar fora também.
 */
function TextEditor({ clip, getBox, onChange, onDone, W, H }) {
  const ref = useRef();
  const p = { ...TEXT_BASE, ...clip.props };
  useEffect(() => {
    const el = ref.current;
    el.focus();
    el.select();
    let raf;
    const follow = () => {
      raf = requestAnimationFrame(follow);
      const b = getBox(), wrap = el.parentElement;
      if (!b || !wrap) return;
      const ratio = wrap.clientWidth / W; // px de CSS por px do quadro (antes do zoom do reprodutor)
      const k = Math.min(W, H) / 720;
      const fs = p.fontSize * k * ((p.scale ?? 100) / 100) * ((p.scaleY ?? 100) / 100);
      el.style.left = `${(b.cx / W) * 100}%`;
      el.style.top = `${(b.cy / H) * 100}%`;
      el.style.width = `${Math.max(b.w, fs * 2) * ratio + 4}px`;
      el.style.height = `${b.h * ratio + 2}px`;
      el.style.fontSize = `${fs * ratio}px`;
      el.style.padding = `${fs * ((p.bgPadY ?? 22) / 100) * ratio}px ${fs * ((p.bgPadX ?? 40) / 100) * ratio}px`;
      el.style.transform = `translate(-50%, -50%) rotate(${b.rot}rad)`;
    };
    follow();
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <textarea ref={ref} className="text-editor" value={p.text} spellCheck={false}
      style={{ fontFamily: `"${p.fontFamily}", sans-serif`, fontWeight: p.bold ? 700 : 400, fontStyle: p.italic ? 'italic' : 'normal', color: p.color, textAlign: p.align,
        WebkitTextStroke: p.stroke > 0 ? `${Math.max(0.5, p.stroke * 0.3)}px ${p.strokeColor}` : undefined,
        textShadow: p.glow ? `0 0 10px ${p.glow}` : p.shadow ? `0 2px 6px ${rgbaOf(p.shadowColor || '#000', 0.6)}` : 'none',
        background: p.bg ? rgbaOf(p.bg.startsWith('#') ? p.bg : '#000000', 0.35) : 'rgba(0,0,0,0.25)' }}
      onChange={(e) => onChange(e.target.value)} onBlur={onDone} onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); onDone(); } }} />
  );
}
