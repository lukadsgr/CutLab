/* =====================================================================
   Animações de clipe (Entrada / Saída / Combinação)
   Cada animação devolve uma transformação parcial; elas se combinam.
   ===================================================================== */
const ID_TR = () => ({ x: 0, y: 0, s: 1, sx: 1, sy: 1, r: 0, a: 1, blur: 0, bright: 1, flash: 0, rgb: 0, glitch: 0, wipe: null, iris: null, blinds: null });
const eOut = (p) => 1 - Math.pow(1 - p, 3);
const eInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const eBack = (p) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); };
const eBounce = (p) => {
  const n = 7.5625, d = 2.75;
  if (p < 1 / d) return n * p * p;
  if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75;
  if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375;
  return n * (p -= 2.625 / d) * p + 0.984375;
};
const eElastic = (p) => (p === 0 || p === 1 ? p : Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1);
const jit = (seed, amt) => (rand(seed) - 0.5) * 2 * amt;

/* q: progresso 0 → 1 (1 = clipe em repouso). Para Saída usamos q invertido. */
const ANIM_LIB = [
  // Básico
  { id: 'fade', name: 'Fade', cat: 'Básico', hot: true, fn: (q) => ({ a: q }) },
  { id: 'zoomIn', name: 'Zoom in', cat: 'Básico', hot: true, fn: (q) => ({ s: 0.45 + 0.55 * eOut(q), a: q }) },
  { id: 'zoomOut', name: 'Zoom out', cat: 'Básico', fn: (q) => ({ s: 1.7 - 0.7 * eOut(q), a: q }) },
  { id: 'slideL', name: 'Deslizar ←', cat: 'Básico', hot: true, fn: (q) => ({ x: (1 - eOut(q)) * 0.9, a: Math.min(1, q * 2) }) },
  { id: 'slideR', name: 'Deslizar →', cat: 'Básico', fn: (q) => ({ x: -(1 - eOut(q)) * 0.9, a: Math.min(1, q * 2) }) },
  { id: 'slideU', name: 'Subir', cat: 'Básico', hot: true, fn: (q) => ({ y: (1 - eOut(q)) * 0.35, a: q }) },
  { id: 'slideD', name: 'Descer', cat: 'Básico', fn: (q) => ({ y: -(1 - eOut(q)) * 0.35, a: q }) },
  { id: 'pop', name: 'Pop', cat: 'Básico', hot: true, fn: (q) => ({ s: Math.max(0.01, eBack(q)) }) },
  { id: 'spin', name: 'Girar', cat: 'Básico', fn: (q) => ({ r: (1 - eOut(q)) * -200, s: 0.3 + 0.7 * eOut(q), a: q }) },
  { id: 'blurIn', name: 'Desfocar', cat: 'Básico', fn: (q) => ({ blur: (1 - q) * 22, a: q, s: 1.08 - 0.08 * eOut(q) }) },
  { id: 'type', name: 'Digitar', cat: 'Básico', textOnly: true, fn: () => ({}) },
  // Luz
  { id: 'flashIn', name: 'Flash', cat: 'Luz', hot: true, fn: (q) => ({ flash: Math.pow(1 - q, 1.5) }) },
  { id: 'glowIn', name: 'Brilho', cat: 'Luz', fn: (q) => ({ bright: 1 + (1 - eOut(q)) * 1.8, blur: (1 - q) * 6, a: Math.min(1, q * 1.6) }) },
  { id: 'expo', name: 'Superexposição', cat: 'Luz', fn: (q) => ({ bright: 1 + (1 - eOut(q)) * 4 }) },
  { id: 'lightZoom', name: 'Zoom de luz', cat: 'Luz', fn: (q) => ({ bright: 1 + (1 - q) * 2, s: 1.25 - 0.25 * eOut(q), flash: (1 - q) * 0.5 }) },
  // Falha
  { id: 'glitch', name: 'Glitch', cat: 'Falha', hot: true, fn: (q, t) => ({ glitch: 1 - q, x: jit(Math.floor(t * 30), (1 - q) * 0.03) }) },
  { id: 'rgbIn', name: 'Separação RGB', cat: 'Falha', fn: (q) => ({ rgb: 1 - eOut(q), s: 1.05 - 0.05 * q }) },
  { id: 'shakeIn', name: 'Tremor', cat: 'Falha', fn: (q, t) => { const f = Math.floor(t * 30), a = (1 - q) * 0.04; return { x: jit(f, a), y: jit(f + 9, a), r: jit(f + 3, (1 - q) * 4) }; } },
  // Máscara
  { id: 'wipeL', name: 'Limpar →', cat: 'Máscara', fn: (q) => ({ wipe: { dir: 'l', p: eInOut(q) } }) },
  { id: 'wipeR', name: 'Limpar ←', cat: 'Máscara', fn: (q) => ({ wipe: { dir: 'r', p: eInOut(q) } }) },
  { id: 'wipeU', name: 'Revelar ↑', cat: 'Máscara', fn: (q) => ({ wipe: { dir: 'u', p: eInOut(q) } }) },
  { id: 'iris', name: 'Íris', cat: 'Máscara', hot: true, fn: (q) => ({ iris: eInOut(q) }) },
  { id: 'blinds', name: 'Persiana', cat: 'Máscara', fn: (q) => ({ blinds: eInOut(q) }) },
  // 3D
  { id: 'flipY', name: 'Virar', cat: '3D', hot: true, fn: (q) => ({ sx: Math.max(0.001, Math.cos((1 - eOut(q)) * Math.PI / 2)), a: Math.min(1, q * 3) }) },
  { id: 'flipX', name: 'Virar vertical', cat: '3D', fn: (q) => ({ sy: Math.max(0.001, Math.cos((1 - eOut(q)) * Math.PI / 2)), a: Math.min(1, q * 3) }) },
  { id: 'cube', name: 'Cubo', cat: '3D', fn: (q) => ({ sx: Math.max(0.001, Math.cos((1 - eInOut(q)) * Math.PI / 2)), x: (1 - eInOut(q)) * 0.5, bright: 0.6 + 0.4 * q }) },
  { id: 'tilt', name: 'Inclinação', cat: '3D', fn: (q) => ({ r: (1 - eOut(q)) * 28, y: (1 - eOut(q)) * 0.25, s: 0.85 + 0.15 * eOut(q), a: q }) },
  { id: 'swingIn', name: 'Porta', cat: '3D', fn: (q) => ({ sx: Math.max(0.001, eElastic(q)), x: -(1 - eOut(q)) * 0.2 }) },
  // Vibração
  { id: 'bounce', name: 'Quique', cat: 'Vibração', hot: true, fn: (q) => ({ y: -(1 - eBounce(q)) * 0.45 }) },
  { id: 'elastic', name: 'Elástico', cat: 'Vibração', fn: (q) => ({ s: Math.max(0.01, eElastic(q)) }) },
  { id: 'wobbleIn', name: 'Balançar', cat: 'Vibração', fn: (q) => ({ r: Math.sin(q * Math.PI * 4) * (1 - q) * 18, a: Math.min(1, q * 3) }) },
  { id: 'jelly', name: 'Gelatina', cat: 'Vibração', fn: (q) => { const w = Math.sin(q * Math.PI * 5) * (1 - q) * 0.35; return { sx: 1 + w, sy: 1 - w, a: Math.min(1, q * 4) }; } },
];
/* combinações: rodam durante o clipe inteiro (t em segundos × velocidade) */
const COMBO_LIB = [
  { id: 'breathe', name: 'Respirar', cat: 'Básico', hot: true, fn: (t) => ({ s: 1 + 0.045 * Math.sin(t * Math.PI) }) },
  { id: 'float', name: 'Flutuar', cat: 'Básico', hot: true, fn: (t) => ({ y: 0.025 * Math.sin(t * Math.PI * 0.8), r: 1.5 * Math.sin(t * Math.PI * 0.5) }) },
  { id: 'swing', name: 'Pêndulo', cat: 'Vibração', fn: (t) => ({ r: 7 * Math.sin(t * Math.PI * 1.4) }) },
  { id: 'pulse', name: 'Pulso', cat: 'Luz', hot: true, fn: (t) => { const b = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2)), 6); return { s: 1 + 0.08 * b, bright: 1 + 0.25 * b }; } },
  { id: 'heartbeat', name: 'Batimento', cat: 'Vibração', fn: (t) => { const ph = t % 1; const b = Math.exp(-((ph - 0.1) ** 2) / 0.002) + 0.6 * Math.exp(-((ph - 0.3) ** 2) / 0.002); return { s: 1 + 0.1 * b }; } },
  { id: 'spinLoop', name: 'Girar contínuo', cat: 'Básico', fn: (t) => ({ r: (t * 90) % 360 }) },
  { id: 'shakeLoop', name: 'Tremor', cat: 'Falha', hot: true, fn: (t) => { const f = Math.floor(t * 24); return { x: jit(f, 0.008), y: jit(f + 5, 0.008) }; } },
  { id: 'glitchLoop', name: 'Falha intermitente', cat: 'Falha', fn: (t) => { const f = Math.floor(t * 12); return rand(f * 1.7) > 0.82 ? { glitch: 1, rgb: 0.7 } : {}; } },
  { id: 'jellyLoop', name: 'Gelatina', cat: 'Vibração', fn: (t) => { const w = Math.sin(t * Math.PI * 3) * 0.05; return { sx: 1 + w, sy: 1 - w }; } },
  { id: 'flicker', name: 'Cintilar', cat: 'Luz', fn: (t) => ({ a: 0.75 + 0.25 * rand(Math.floor(t * 15)) }) },
  { id: 'rock3d', name: 'Balanço 3D', cat: '3D', fn: (t) => ({ sx: 0.88 + 0.12 * Math.abs(Math.cos(t * Math.PI * 0.6)), r: 2 * Math.sin(t * Math.PI * 0.6) }) },
];
const ANIM_MAP = Object.fromEntries(ANIM_LIB.map((a) => [a.id, a]));
const COMBO_MAP = Object.fromEntries(COMBO_LIB.map((a) => [a.id, a]));
/* nomes antigos → novos */
const ANIM_ALIAS = { slide: 'slideU', zoom: 'zoomIn' };
const ANIM_CATS = ['Em alta', 'Básico', 'Luz', 'Falha', 'Máscara', '3D', 'Vibração'];

function mergeTr(T, o) {
  if (!o) return T;
  if (o.x) T.x += o.x; if (o.y) T.y += o.y; if (o.r) T.r += o.r;
  if (o.s != null) T.s *= o.s; if (o.sx != null) T.sx *= o.sx; if (o.sy != null) T.sy *= o.sy;
  if (o.a != null) T.a *= clamp(o.a, 0, 1); if (o.bright != null) T.bright *= o.bright;
  if (o.blur) T.blur += o.blur; if (o.flash) T.flash = Math.max(T.flash, o.flash);
  if (o.rgb) T.rgb = Math.max(T.rgb, o.rgb); if (o.glitch) T.glitch = Math.max(T.glitch, o.glitch);
  if (o.wipe) T.wipe = o.wipe; if (o.iris != null) T.iris = o.iris; if (o.blinds != null) T.blinds = o.blinds;
  return T;
}
/** transformação de animação de um clipe no tempo local */
function animTransform(c, p, local) {
  const T = ID_TR();
  const inId = ANIM_ALIAS[p.animIn] || p.animIn;
  if (inId && inId !== 'none' && inId !== 'type') {
    const d = Math.max(0.05, Math.min(p.animInDur ?? 0.5, c.duration));
    if (local < d) mergeTr(T, ANIM_MAP[inId]?.fn(clamp(local / d, 0, 1), local));
  }
  if (p.animOut && p.animOut !== 'none') {
    const d = Math.max(0.05, Math.min(p.animOutDur ?? 0.5, c.duration));
    const rem = c.duration - local;
    if (rem < d) mergeTr(T, ANIM_MAP[p.animOut]?.fn(clamp(rem / d, 0, 1), local));
  }
  if (p.animCombo && p.animCombo !== 'none') mergeTr(T, COMBO_MAP[p.animCombo]?.fn(local * (p.animComboSpeed ?? 1)));
  return T;
}
const animIsId = (T) => !T.x && !T.y && !T.r && T.s === 1 && T.sx === 1 && T.sy === 1 && T.a === 1 && !T.blur && T.bright === 1 && !T.flash && !T.rgb && !T.glitch && !T.wipe && T.iris == null && T.blinds == null;

/** recorte da animação (limpar/íris/persiana) no espaço local do clipe */
function animClip(ctx, T, w, h) {
  if (!T.wipe && T.iris == null && T.blinds == null) return;
  ctx.beginPath();
  if (T.wipe) {
    const { dir, p } = T.wipe;
    if (dir === 'l') ctx.rect(-w / 2, -h / 2, w * p, h);
    else if (dir === 'r') ctx.rect(w / 2 - w * p, -h / 2, w * p, h);
    else ctx.rect(-w / 2, h / 2 - h * p, w, h * p);
  } else if (T.iris != null) ctx.arc(0, 0, Math.max(0.1, T.iris * Math.hypot(w, h) / 2), 0, Math.PI * 2);
  else {
    const n = 8, sh = h / n;
    for (let i = 0; i < n; i++) ctx.rect(-w / 2, -h / 2 + i * sh, w, sh * T.blinds);
  }
  ctx.clip();
}

/* =====================================================================
   Velocidade: curvas (rampas) e efeitos de velocidade
   speedCurve = [[u, v], …] — u: posição 0..1 no clipe, v: multiplicador (0.1..10)
   ===================================================================== */
const SPEED_PRESETS = [
  { id: 'montage', name: 'Montagem', pts: [[0, 3], [0.28, 3], [0.42, 0.35], [0.58, 0.35], [0.72, 2.2], [1, 2.2]] },
  { id: 'hero', name: 'Herói', pts: [[0, 1], [0.18, 1], [0.3, 0.2], [0.42, 1], [0.58, 1], [0.7, 0.2], [0.82, 1], [1, 1]] },
  { id: 'bullet', name: 'Bala', pts: [[0, 2.5], [0.3, 2.5], [0.42, 0.18], [0.58, 0.18], [0.7, 2.5], [1, 2.5]] },
  { id: 'jump', name: 'Corte de salto', pts: [[0, 1], [0.38, 1], [0.46, 6], [0.54, 6], [0.62, 1], [1, 1]] },
  { id: 'flashIn', name: 'Flash ativado', pts: [[0, 4], [0.3, 4], [0.55, 0.5], [1, 0.5]] },
  { id: 'flashOut', name: 'Flash desativado', pts: [[0, 0.5], [0.45, 0.5], [0.7, 4], [1, 4]] },
];
const SPEED_FX = [
  { id: 'flash', name: 'Flash' },
  { id: 'motion', name: 'Movimento' },
  { id: 'blur', name: 'Desfoque' },
  { id: 'retro', name: 'Zoom retrô' },
  { id: 'rainbow', name: 'Arco-íris' },
];

/** velocidade no ponto u (interpolação suave em escala logarítmica) */
/* Spline cúbica monotônica (Fritsch–Carlson) em escala log₂: a velocidade e a sua
   derivada são contínuas, então a rampa acelera e desacelera sem "degraus" nos pontos
   (o smoothstep anterior zerava a inclinação em cada ponto e concentrava a mudança no meio). */
const _spline = new Map();
function speedSpline(pts) {
  const key = JSON.stringify(pts);
  let s = _spline.get(key);
  if (s) return s;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => Math.log2(clamp(p[1], 0.05, 20)));
  const n = xs.length, d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i]);
  // pontas: inclinação plana (a rampa começa e termina "assentada", como no CapCut)
  m[0] = 0; m[n - 1] = 0;
  s = { xs, ys, m };
  if (_spline.size > 64) _spline.clear();
  _spline.set(key, s);
  return s;
}
function speedAt(pts, u) {
  const { xs, ys, m } = speedSpline(pts);
  const n = xs.length;
  if (u <= xs[0]) return Math.pow(2, ys[0]);
  if (u >= xs[n - 1]) return Math.pow(2, ys[n - 1]);
  let i = 0;
  while (i < n - 2 && u > xs[i + 1]) i++;
  const h = xs[i + 1] - xs[i], t = (u - xs[i]) / h;
  const t2 = t * t, t3 = t2 * t;
  const y = (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  return Math.pow(2, y);
}
const _integral = new Map();
/** integral acumulada F(u) = ∫₀ᵘ v du em 512 amostras */
function speedIntegral(pts) {
  const key = JSON.stringify(pts);
  let F = _integral.get(key);
  if (F) return F;
  const N = 512;
  F = new Float32Array(N + 1);
  for (let i = 1; i <= N; i++) F[i] = F[i - 1] + (speedAt(pts, (i - 0.5) / N) / N);
  if (_integral.size > 32) _integral.clear();
  _integral.set(key, F);
  return F;
}
const integralAt = (F, u) => { const N = F.length - 1, x = clamp(u, 0, 1) * N, i = Math.floor(x); return i >= N ? F[N] : F[i] + (F[i + 1] - F[i]) * (x - i); };
/** tempo na mídia de origem para um tempo local do clipe */
function srcTimeAt(c, local) {
  if (!c.speedCurve) return c.in + local * c.speed;
  const D = c.duration, F = speedIntegral(c.speedCurve);
  return c.in + c.speed * D * integralAt(F, local / D);
}
/** velocidade instantânea */
const rateAt = (c, local) => c.speed * (c.speedCurve ? speedAt(c.speedCurve, clamp(local / c.duration, 0, 1)) : 1);
/** trecho da mídia de origem coberto pelo clipe */
const srcSpan = (c) => (c.speedCurve ? c.speed * c.duration * integralAt(speedIntegral(c.speedCurve), 1) : c.speed * c.duration);

/** efeitos de velocidade aplicados no espaço do clipe (preservando transparência) */
function speedFx(S, id, I, t, k) {
  if (I <= 0.01) return;
  const x = S.getContext('2d'), w = S.width, h = S.height;
  const R = copyTo('speedR', S);
  x.save();
  if (id === 'flash') {
    x.globalCompositeOperation = 'source-atop';
    x.fillStyle = `rgba(255,255,255,${I * 0.65})`;
    x.fillRect(0, 0, w, h);
  } else if (id === 'motion') {
    for (let i = 1; i <= 6; i++) { x.globalAlpha = 0.16 * I; x.drawImage(R, -i * 6 * k * I, 0); x.drawImage(R, i * 6 * k * I, 0); }
  } else if (id === 'blur') {
    x.clearRect(0, 0, w, h);
    x.filter = `blur(${I * 14 * k}px)`;
    x.drawImage(R, 0, 0);
  } else if (id === 'retro') {
    x.clearRect(0, 0, w, h);
    x.filter = `sepia(${I * 70}%) contrast(${100 + I * 25}%)`;
    const s = 1 + I * 0.08, f = Math.floor(t * 24);
    x.translate(w / 2 + jit(f, 3 * k * I), h / 2 + jit(f + 3, 3 * k * I)); x.scale(s, s);
    x.drawImage(R, -w / 2, -h / 2);
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.filter = 'none';
    x.globalCompositeOperation = 'source-atop';
    x.fillStyle = `rgba(0,0,0,${0.18 * I})`;
    for (let y = 0; y < h; y += 4 * k) x.fillRect(0, y, w, 1.5 * k);
  } else if (id === 'rainbow') {
    x.clearRect(0, 0, w, h);
    x.filter = `hue-rotate(${(t * 220 * I) % 360}deg) saturate(${100 + 80 * I}%)`;
    x.drawImage(R, 0, 0);
  }
  x.restore();
}
/** intensidade do efeito de velocidade: cresce quanto mais longe de 1× */
const speedFxAmount = (c, p, local) => (p.speedFx && p.speedFx !== 'none' ? clamp(Math.abs(Math.log2(rateAt(c, local))) / 2.2, 0, 1) * (p.speedFxAmt / 100) : 0);

/** efeitos de animação que precisam de pixels (RGB, glitch) */
function animPixelFx(S, T, t, k) {
  if (T.rgb > 0.01) {
    const w = S.width, h = S.height, R = copyTo('animR', S), x = S.getContext('2d');
    const r = tmpCanvas('animRr', w, h), cc = tmpCanvas('animRc', w, h);
    for (const [cv, col] of [[r, '#ff0000'], [cc, '#00ffff']]) {
      const y = cv.getContext('2d');
      y.globalCompositeOperation = 'source-over'; y.clearRect(0, 0, w, h); y.drawImage(R, 0, 0);
      y.globalCompositeOperation = 'multiply'; y.fillStyle = col; y.fillRect(0, 0, w, h);
      y.globalCompositeOperation = 'destination-in'; y.drawImage(R, 0, 0);
    }
    const off = T.rgb * 18 * k;
    x.save(); x.clearRect(0, 0, w, h); x.globalCompositeOperation = 'lighter';
    x.drawImage(r, -off, 0); x.drawImage(cc, off, 0); x.restore();
  }
  if (T.glitch > 0.01) {
    const w = S.width, h = S.height, R = copyTo('animG', S), x = S.getContext('2d'), f = Math.floor(t * 20);
    for (let i = 0; i < 7; i++) {
      const y = rand(f * 13 + i) * h, hh = (0.02 + rand(f * 7 + i) * 0.08) * h, dx = jit(f * 3 + i, w * 0.1 * T.glitch);
      x.clearRect(0, y, w, hh);
      x.drawImage(R, 0, y, w, hh, dx, y, w, hh);
    }
  }
}

Object.assign(BASE_PROPS, { animOut: 'none', animInDur: 0.5, animOutDur: 0.5, animCombo: 'none', animComboSpeed: 1, speedFx: 'none', speedFxAmt: 80, frameBlend: true, frameInterp: 'flow', motionBlur: 45, precise: true });
