/* =====================================================================
   Efeitos (pós-processamento do quadro) e transições
   ===================================================================== */
const _tmp = {};
let TMP_DEPTH = 0; // > 0 dentro de um clipe composto: cada nível usa seus próprios canvases temporários
function tmpCanvas(name, W, H) {
  if (TMP_DEPTH) name += '#' + TMP_DEPTH;
  let c = _tmp[name];
  if (!c) { c = document.createElement('canvas'); _tmp[name] = c; }
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  return c;
}
let _noise;
function noiseCanvas() {
  if (_noise) return _noise;
  _noise = document.createElement('canvas');
  _noise.width = _noise.height = 256;
  const c = _noise.getContext('2d');
  const img = c.createImageData(256, 256);
  for (let i = 0; i < 256 * 256; i++) {
    const v = Math.random() * 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  return _noise;
}
const easeOut3 = (p) => 1 - Math.pow(1 - p, 3);
const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

/** desenha src cobrindo o quadro com escala/deslocamento em torno do centro */
function drawScaled(ctx, src, W, H, s = 1, dx = 0, dy = 0, rot = 0) {
  ctx.save();
  ctx.translate(W / 2 + dx, H / 2 + dy);
  if (rot) ctx.rotate(rot);
  ctx.scale(s, s);
  ctx.drawImage(src, -W / 2, -H / 2, W, H);
  ctx.restore();
}
function clearBlack(ctx, W, H) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}
function rgbSplit(ctx, src, W, H, off) {
  const r = tmpCanvas('rgbR', W, H), c = tmpCanvas('rgbC', W, H);
  for (const [cv, col] of [[r, '#ff0000'], [c, '#00ffff']]) {
    const x = cv.getContext('2d');
    x.globalCompositeOperation = 'source-over';
    x.drawImage(src, 0, 0, W, H);
    x.globalCompositeOperation = 'multiply';
    x.fillStyle = col;
    x.fillRect(0, 0, W, H);
  }
  clearBlack(ctx, W, H);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(r, -off, 0);
  ctx.drawImage(c, off, 0);
  ctx.restore();
}
function vignette(ctx, W, H, a) {
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) * 0.55);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${a})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}
function grain(ctx, W, H, a, seed) {
  const n = noiseCanvas();
  ctx.save();
  ctx.globalAlpha = a;
  ctx.globalCompositeOperation = 'overlay';
  const ox = Math.floor(rand(seed) * 256), oy = Math.floor(rand(seed + 1) * 256);
  for (let x = -ox; x < W; x += 256) for (let y = -oy; y < H; y += 256) ctx.drawImage(n, x, y);
  ctx.restore();
}
function star(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4, rr = i % 2 ? r * 0.25 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

/* fn(ctx, src, W, H, t, I, k) — ctx já contém o quadro; src é uma cópia; I = intensidade 0..1; k = escala */
const EFFECTS = [
  { id: 'shake', name: 'Tremor', cat: 'Básico', fn: (ctx, src, W, H, t, I) => {
    const f = Math.floor(t * 24), a = I * 0.035 * Math.min(W, H);
    clearBlack(ctx, W, H);
    drawScaled(ctx, src, W, H, 1 + I * 0.08, (rand(f) - 0.5) * 2 * a, (rand(f + 7) - 0.5) * 2 * a, (rand(f + 3) - 0.5) * I * 0.03);
  } },
  { id: 'pulse', name: 'Zoom pulsante', cat: 'Básico', fn: (ctx, src, W, H, t, I) => {
    const p = Math.pow(Math.abs(Math.sin(t * Math.PI * 1.6)), 3);
    clearBlack(ctx, W, H);
    drawScaled(ctx, src, W, H, 1 + I * 0.15 * p);
  } },
  { id: 'flash', name: 'Flash', cat: 'Básico', fn: (ctx, src, W, H, t, I) => {
    const p = Math.pow(Math.max(0, Math.sin(t * Math.PI * 1.4)), 10);
    ctx.fillStyle = `rgba(255,255,255,${p * I})`;
    ctx.fillRect(0, 0, W, H);
  } },
  { id: 'blur', name: 'Desfoque', cat: 'Básico', fn: (ctx, src, W, H, t, I, k) => {
    ctx.save(); ctx.filter = `blur(${I * 14 * k}px)`; drawScaled(ctx, src, W, H, 1.05); ctx.restore();
  } },
  { id: 'zoomblur', name: 'Zoom borrado', cat: 'Básico', fn: (ctx, src, W, H, t, I) => {
    for (let i = 1; i <= 6; i++) { ctx.globalAlpha = 0.18; drawScaled(ctx, src, W, H, 1 + i * 0.025 * I); }
    ctx.globalAlpha = 1;
  } },
  { id: 'vhs', name: 'VHS', cat: 'Retrô', fn: (ctx, src, W, H, t, I, k) => {
    const f = Math.floor(t * 30);
    rgbSplit(ctx, src, W, H, (2 + rand(f) * 3) * k * I * 1.5);
    const band = ((t * 0.35) % 1.3) * H - H * 0.15;
    ctx.drawImage(src, 0, band, W, H * 0.06, (rand(f + 2) - 0.5) * 30 * k * I, band, W, H * 0.06);
    ctx.fillStyle = `rgba(0,0,0,${0.18 * I})`;
    for (let y = 0; y < H; y += 4 * k) ctx.fillRect(0, y, W, 1.5 * k);
    grain(ctx, W, H, 0.25 * I, f);
  } },
  { id: 'grain', name: 'Granulado', cat: 'Retrô', fn: (ctx, src, W, H, t, I) => grain(ctx, W, H, 0.6 * I, Math.floor(t * 24)) },
  { id: 'oldfilm', name: 'Filme antigo', cat: 'Retrô', fn: (ctx, src, W, H, t, I, k) => {
    const f = Math.floor(t * 18);
    ctx.save();
    ctx.filter = `sepia(${80 * I}%) contrast(110%) brightness(${100 - rand(f) * 18 * I}%)`;
    drawScaled(ctx, src, W, H, 1, (rand(f + 9) - 0.5) * 4 * k * I, (rand(f + 4) - 0.5) * 4 * k * I);
    ctx.restore();
    ctx.strokeStyle = `rgba(255,255,240,${0.35 * I})`;
    ctx.lineWidth = 1.2 * k;
    for (let i = 0; i < 3; i++) if (rand(f * 3 + i) > 0.5) { const x = rand(f * 7 + i) * W; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + (rand(i + f) - 0.5) * 20, H); ctx.stroke(); }
    grain(ctx, W, H, 0.35 * I, f);
    vignette(ctx, W, H, 0.7 * I);
  } },
  { id: 'pixel', name: 'Pixelado', cat: 'Retrô', fn: (ctx, src, W, H, t, I, k) => {
    const size = Math.max(1, I * 36 * k);
    const sw = Math.max(1, Math.round(W / size)), sh = Math.max(1, Math.round(H / size));
    const small = tmpCanvas('pix', sw, sh);
    small.getContext('2d').drawImage(src, 0, 0, sw, sh);
    ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(small, 0, 0, W, H); ctx.restore();
  } },
  { id: 'rgb', name: 'Separação RGB', cat: 'Glitch', fn: (ctx, src, W, H, t, I, k) => rgbSplit(ctx, src, W, H, I * 16 * k * (0.6 + 0.4 * Math.sin(t * 6))) },
  { id: 'glitch', name: 'Glitch', cat: 'Glitch', fn: (ctx, src, W, H, t, I, k) => {
    const f = Math.floor(t * 12);
    const strong = rand(f * 1.3) < 0.35;
    if (strong) rgbSplit(ctx, src, W, H, 10 * k * I);
    const n = strong ? 8 : 3;
    for (let i = 0; i < n; i++) {
      const y = rand(f * 11 + i) * H, h = (0.02 + rand(f * 5 + i) * 0.08) * H;
      ctx.drawImage(src, 0, y, W, h, (rand(f * 17 + i) - 0.5) * W * 0.12 * I, y, W, h);
    }
  } },
  { id: 'rainbow', name: 'Arco-íris', cat: 'Glitch', fn: (ctx, src, W, H, t, I) => {
    ctx.save(); ctx.filter = `hue-rotate(${(t * 140 * I) % 360}deg) saturate(${100 + 60 * I}%)`; ctx.drawImage(src, 0, 0); ctx.restore();
  } },
  { id: 'leak', name: 'Vazamento de luz', cat: 'Luz', fn: (ctx, src, W, H, t, I) => {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const spots = [[255, 120, 40], [255, 60, 120], [255, 200, 80]];
    spots.forEach(([r, g, b], i) => {
      const x = W * (0.5 + 0.6 * Math.sin(t * 0.7 + i * 2.1)), y = H * (0.5 + 0.5 * Math.cos(t * 0.5 + i * 1.7));
      const rad = Math.max(W, H) * (0.45 + 0.15 * Math.sin(t + i));
      const gr = ctx.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, `rgba(${r},${g},${b},${0.75 * I})`);
      gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, W, H);
    });
    ctx.restore();
  } },
  { id: 'bokeh', name: 'Bokeh', cat: 'Luz', fn: (ctx, src, W, H, t, I, k) => {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const cols = ['255,200,120', '120,230,255', '255,140,200', '255,255,200'];
    for (let i = 0; i < 22; i++) {
      const r = (14 + rand(i + 0.3) * 40) * k;
      const x = (rand(i) * W + Math.sin(t * 0.4 + i) * 30 * k + W) % W;
      const y = (((rand(i + 0.5) * H - t * (12 + rand(i) * 25) * k) % (H + 2 * r)) + H + 2 * r) % (H + 2 * r) - r;
      const a = (0.25 + 0.25 * Math.sin(t * 1.5 + i)) * I;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${cols[i % 4]},${a})`);
      g.addColorStop(0.8, `rgba(${cols[i % 4]},${a * 0.8})`);
      g.addColorStop(1, `rgba(${cols[i % 4]},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  } },
  { id: 'sparkle', name: 'Brilhos', cat: 'Luz', fn: (ctx, src, W, H, t, I, k) => {
    ctx.save();
    ctx.fillStyle = '#fffbe6';
    ctx.shadowColor = '#fff3b0';
    ctx.shadowBlur = 10 * k;
    for (let i = 0; i < 30; i++) {
      const tw = Math.max(0, Math.sin(t * (2 + rand(i) * 3) + i * 4));
      if (tw < 0.05) continue;
      ctx.globalAlpha = tw * I;
      star(ctx, rand(i + 0.1) * W, rand(i + 0.9) * H, (5 + rand(i + 0.4) * 12) * k * tw);
    }
    ctx.restore();
  } },
  { id: 'vignette', name: 'Vinheta', cat: 'Moldura', fn: (ctx, src, W, H, t, I) => vignette(ctx, W, H, 0.9 * I) },
  { id: 'bars', name: 'Barras de cinema', cat: 'Moldura', fn: (ctx, src, W, H, t, I) => {
    const h = H * 0.13 * I * easeOut3(clamp(t / 0.6, 0, 1));
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, h);
    ctx.fillRect(0, H - h, W, h);
  } },
  { id: 'mirror', name: 'Espelho', cat: 'Moldura', fn: (ctx, src, W, H) => {
    ctx.save();
    ctx.drawImage(src, 0, 0, W / 2, H, 0, 0, W / 2, H);
    ctx.translate(W, 0); ctx.scale(-1, 1);
    ctx.drawImage(src, 0, 0, W / 2, H, 0, 0, W / 2, H);
    ctx.restore();
  } },
  { id: 'grid', name: 'Tela dividida', cat: 'Moldura', fn: (ctx, src, W, H) => {
    clearBlack(ctx, W, H);
    for (let i = 0; i < 4; i++) ctx.drawImage(src, (i % 2) * W / 2, Math.floor(i / 2) * H / 2, W / 2, H / 2);
  } },
  { id: 'snow', name: 'Neve', cat: 'Clima', fn: (ctx, src, W, H, t, I, k) => {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    const n = Math.round(110 * I);
    for (let i = 0; i < n; i++) {
      const sp = (30 + rand(i + 0.3) * 60) * k;
      const x = (rand(i) * W + Math.sin(t * 0.8 + i) * 22 * k + W) % W;
      const y = (rand(i + 0.5) * H + t * sp) % (H + 10) - 5;
      ctx.beginPath(); ctx.arc(x, y, (1 + rand(i + 0.7) * 3) * k, 0, Math.PI * 2); ctx.fill();
    }
  } },
  { id: 'rain', name: 'Chuva', cat: 'Clima', fn: (ctx, src, W, H, t, I, k) => {
    ctx.fillStyle = `rgba(10,20,40,${0.2 * I})`;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(190,210,255,0.5)';
    ctx.lineWidth = 1.2 * k;
    ctx.beginPath();
    const n = Math.round(160 * I);
    for (let i = 0; i < n; i++) {
      const sp = (700 + rand(i) * 500) * k, len = (14 + rand(i + 0.2) * 18) * k;
      const x = (rand(i + 0.6) * (W + 100) - t * sp * 0.15) % (W + 100);
      const y = (rand(i + 0.1) * H + t * sp) % (H + len) - len;
      ctx.moveTo(x, y); ctx.lineTo(x - len * 0.15, y + len);
    }
    ctx.stroke();
  } },
  { id: 'confetti', name: 'Confete', cat: 'Clima', fn: (ctx, src, W, H, t, I, k) => {
    const cols = ['#ff4d8d', '#ffd23f', '#1fd6cb', '#4f8cff', '#7b5cff', '#2bd47d'];
    const n = Math.round(90 * I);
    for (let i = 0; i < n; i++) {
      const sp = (80 + rand(i) * 120) * k;
      const x = (rand(i + 0.4) * W + Math.sin(t * 2 + i) * 30 * k + W) % W;
      const y = (rand(i + 0.8) * H + t * sp) % (H + 20) - 10;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(t * (2 + rand(i) * 4) + i);
      ctx.scale(1, Math.cos(t * 5 + i));
      ctx.fillStyle = cols[i % cols.length];
      ctx.fillRect(-5 * k, -3 * k, 10 * k, 6 * k);
      ctx.restore();
    }
  } },
];
const EFFECT_MAP = Object.fromEntries(EFFECTS.map((e) => [e.id, e]));

/** camada de ajuste: filtros de cor + temperatura + vinheta aplicados ao quadro inteiro */
function applyAdjust(ctx, src, W, H, p, k, I = 1) {
  ctx.save();
  ctx.globalAlpha = I;
  ctx.filter = filterCss(p, k);
  ctx.drawImage(src, 0, 0);
  ctx.restore();
  if (p.temperature) {
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = p.temperature > 0 ? `rgba(255,140,0,${(p.temperature / 100) * 0.6 * I})` : `rgba(0,120,255,${(-p.temperature / 100) * 0.6 * I})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  if (p.vignette) vignette(ctx, W, H, (p.vignette / 100) * 0.9 * I);
}

/* transições: fn(ctx, A, B, p, W, H) — A sai, B entra, p 0..1 */
const TRANSITIONS = [
  { id: 'mix', name: 'Mistura', cat: 'Básico', fn: (c, A, B, p) => { c.drawImage(A, 0, 0); c.globalAlpha = p; c.drawImage(B, 0, 0); } },
  { id: 'black', name: 'Mergulho preto', cat: 'Básico', fn: (c, A, B, p, W, H) => {
    c.drawImage(p < 0.5 ? A : B, 0, 0); c.fillStyle = `rgba(0,0,0,${p < 0.5 ? p * 2 : (1 - p) * 2})`; c.fillRect(0, 0, W, H);
  } },
  { id: 'white', name: 'Flash branco', cat: 'Básico', fn: (c, A, B, p, W, H) => {
    c.drawImage(p < 0.5 ? A : B, 0, 0); c.fillStyle = `rgba(255,255,255,${p < 0.5 ? p * 2 : (1 - p) * 2})`; c.fillRect(0, 0, W, H);
  } },
  { id: 'blur', name: 'Desfoque', cat: 'Básico', fn: (c, A, B, p, W, H) => {
    const k = Math.min(W, H) / 720;
    c.save(); c.filter = `blur(${Math.sin(p * Math.PI) * 26 * k}px)`;
    c.drawImage(A, 0, 0); c.globalAlpha = clamp((p - 0.3) / 0.4, 0, 1); c.drawImage(B, 0, 0); c.restore();
  } },
  { id: 'push-l', name: 'Empurrar ←', cat: 'Movimento', fn: (c, A, B, p, W) => { const e = easeInOut(p); c.drawImage(A, -e * W, 0); c.drawImage(B, (1 - e) * W, 0); } },
  { id: 'push-r', name: 'Empurrar →', cat: 'Movimento', fn: (c, A, B, p, W) => { const e = easeInOut(p); c.drawImage(A, e * W, 0); c.drawImage(B, -(1 - e) * W, 0); } },
  { id: 'push-u', name: 'Empurrar ↑', cat: 'Movimento', fn: (c, A, B, p, W, H) => { const e = easeInOut(p); c.drawImage(A, 0, -e * H); c.drawImage(B, 0, (1 - e) * H); } },
  { id: 'push-d', name: 'Empurrar ↓', cat: 'Movimento', fn: (c, A, B, p, W, H) => { const e = easeInOut(p); c.drawImage(A, 0, e * H); c.drawImage(B, 0, -(1 - e) * H); } },
  { id: 'cover', name: 'Cobrir', cat: 'Movimento', fn: (c, A, B, p, W) => { c.drawImage(A, 0, 0); c.drawImage(B, (1 - easeOut3(p)) * W, 0); } },
  { id: 'wipe', name: 'Limpar', cat: 'Máscara', fn: (c, A, B, p, W, H) => {
    c.drawImage(A, 0, 0); c.save(); c.beginPath(); c.rect(0, 0, easeInOut(p) * W, H); c.clip(); c.drawImage(B, 0, 0); c.restore();
  } },
  { id: 'iris', name: 'Íris', cat: 'Máscara', fn: (c, A, B, p, W, H) => {
    c.drawImage(A, 0, 0); c.save(); c.beginPath(); c.arc(W / 2, H / 2, easeInOut(p) * Math.hypot(W, H) / 2, 0, Math.PI * 2); c.clip(); c.drawImage(B, 0, 0); c.restore();
  } },
  { id: 'blinds', name: 'Persiana', cat: 'Máscara', fn: (c, A, B, p, W, H) => {
    c.drawImage(A, 0, 0); c.save(); c.beginPath();
    const n = 8, sh = H / n;
    for (let i = 0; i < n; i++) c.rect(0, i * sh, W, sh * easeInOut(p));
    c.clip(); c.drawImage(B, 0, 0); c.restore();
  } },
  { id: 'diag', name: 'Diagonal', cat: 'Máscara', fn: (c, A, B, p, W, H) => {
    c.drawImage(A, 0, 0); c.save(); const x = easeInOut(p) * (W + H);
    c.beginPath(); c.moveTo(0, 0); c.lineTo(x, 0); c.lineTo(x - H, H); c.lineTo(0, H); c.closePath(); c.clip(); c.drawImage(B, 0, 0); c.restore();
  } },
  { id: 'zoomin', name: 'Zoom in', cat: 'Câmera', fn: (c, A, B, p, W, H) => {
    c.drawImage(B, 0, 0); c.globalAlpha = 1 - easeInOut(p); drawScaled(c, A, W, H, 1 + easeInOut(p) * 1.2);
  } },
  { id: 'zoomout', name: 'Zoom out', cat: 'Câmera', fn: (c, A, B, p, W, H) => {
    c.drawImage(A, 0, 0); c.globalAlpha = easeInOut(p); drawScaled(c, B, W, H, 1.8 - 0.8 * easeOut3(p));
  } },
  { id: 'spin', name: 'Girar', cat: 'Câmera', fn: (c, A, B, p, W, H) => {
    const e = easeInOut(p);
    if (p < 0.5) drawScaled(c, A, W, H, 1 + e * 0.6, 0, 0, e * Math.PI);
    else drawScaled(c, B, W, H, 1 + (1 - e) * 0.6, 0, 0, -(1 - e) * Math.PI);
  } },
  { id: 'shake', name: 'Tremor', cat: 'Câmera', fn: (c, A, B, p, W, H) => {
    const a = Math.sin(p * Math.PI) * Math.min(W, H) * 0.05, f = Math.floor(p * 30);
    drawScaled(c, p < 0.5 ? A : B, W, H, 1.1, (rand(f) - 0.5) * 2 * a, (rand(f + 3) - 0.5) * 2 * a);
  } },
  { id: 'glitch', name: 'Glitch', cat: 'Glitch', fn: (c, A, B, p, W, H) => {
    const f = Math.floor(p * 24), main = p < 0.5 ? A : B, other = p < 0.5 ? B : A;
    c.drawImage(main, 0, 0);
    const amt = Math.sin(p * Math.PI);
    for (let i = 0; i < 10; i++) {
      const y = rand(f * 13 + i) * H, h = (0.02 + rand(f * 7 + i) * 0.1) * H;
      c.drawImage(rand(f + i) < amt * 0.6 ? other : main, 0, y, W, h, (rand(f * 3 + i) - 0.5) * W * 0.2 * amt, y, W, h);
    }
  } },
  { id: 'rgb', name: 'RGB', cat: 'Glitch', fn: (c, A, B, p, W, H) => {
    const src = tmpCanvas('trRgb', W, H), x = src.getContext('2d');
    x.globalAlpha = 1; x.drawImage(A, 0, 0); x.globalAlpha = easeInOut(p); x.drawImage(B, 0, 0); x.globalAlpha = 1;
    rgbSplit(c, src, W, H, Math.sin(p * Math.PI) * Math.min(W, H) * 0.04);
  } },
];
const TRANSITION_MAP = Object.fromEntries(TRANSITIONS.map((t) => [t.id, t]));

/* imagens de exemplo para as miniaturas animadas */
let _samples;
function sampleImages(S = 120) {
  if (_samples) return _samples;
  const mk = (draw) => { const c = document.createElement('canvas'); c.width = c.height = S; draw(c.getContext('2d'), S); return c; };
  const a = mk((x, s) => {
    const g = x.createLinearGradient(0, 0, 0, s); g.addColorStop(0, '#ff9a5a'); g.addColorStop(0.55, '#e2557d'); g.addColorStop(1, '#3a62d8');
    x.fillStyle = g; x.fillRect(0, 0, s, s);
    x.fillStyle = '#ffe7a8'; x.beginPath(); x.arc(s * 0.68, s * 0.32, s * 0.13, 0, 7); x.fill();
    x.fillStyle = '#20283e'; x.beginPath(); x.moveTo(0, s * 0.82); x.lineTo(s * 0.35, s * 0.48); x.lineTo(s * 0.58, s * 0.7); x.lineTo(s * 0.78, s * 0.56); x.lineTo(s, s * 0.74); x.lineTo(s, s); x.lineTo(0, s); x.fill();
    x.fillStyle = '#eef'; x.beginPath(); x.moveTo(s * 0.35, s * 0.48); x.lineTo(s * 0.29, s * 0.55); x.lineTo(s * 0.41, s * 0.55); x.fill();
  });
  const b = mk((x, s) => {
    const g = x.createLinearGradient(0, 0, 0, s); g.addColorStop(0, '#9fe8ff'); g.addColorStop(0.6, '#1fb5c9'); g.addColorStop(1, '#0b4f6c');
    x.fillStyle = g; x.fillRect(0, 0, s, s);
    x.fillStyle = '#f4f1e8'; x.fillRect(s * 0.18, s * 0.3, s * 0.38, s * 0.5); x.fillRect(s * 0.6, s * 0.45, s * 0.22, s * 0.35);
    x.fillStyle = '#1d5fd1'; x.fillRect(s * 0.3, s * 0.52, s * 0.1, s * 0.28);
    x.fillStyle = '#0b4f6c'; x.fillRect(0, s * 0.8, s, s * 0.2);
  });
  _samples = { a, b, S };
  return _samples;
}

/** miniatura que anima um efeito ou transição quando o mouse passa por cima */
function FxThumb({ kind, id }) {
  const ref = useRef();
  const hover = useRef(false);
  useEffect(() => {
    const cv = ref.current, ctx = cv.getContext('2d');
    const { a, b, S } = sampleImages();
    cv.width = cv.height = S;
    let raf, t0 = performance.now();
    const draw = (t) => {
      ctx.save();
      clearBlack(ctx, S, S);
      if (kind === 'transition') {
        const p = hover.current ? clamp(((t % 1.8) - 0.3) / 1.2, 0, 1) : 0.45;
        TRANSITION_MAP[id].fn(ctx, a, b, p, S, S);
      } else {
        ctx.drawImage(a, 0, 0);
        const src = tmpCanvas('thumbSrc', S, S);
        src.getContext('2d').drawImage(a, 0, 0);
        EFFECT_MAP[id].fn(ctx, src, S, S, hover.current ? t : 0.9, 0.9, S / 360);
      }
      ctx.restore();
    };
    const loop = () => {
      draw((performance.now() - t0) / 1000);
      if (hover.current) raf = requestAnimationFrame(loop);
    };
    draw(0.9);
    const el = cv.parentElement;
    const enter = () => { hover.current = true; t0 = performance.now(); cancelAnimationFrame(raf); loop(); };
    const leave = () => { hover.current = false; cancelAnimationFrame(raf); draw(0.9); };
    el.addEventListener('mouseenter', enter);
    el.addEventListener('mouseleave', leave);
    return () => { cancelAnimationFrame(raf); el.removeEventListener('mouseenter', enter); el.removeEventListener('mouseleave', leave); };
  }, [kind, id]);
  return <canvas ref={ref} className="fx-thumb" />;
}
