/* =====================================================================
   Composição por clipe: chroma key, remoção de fundo, máscaras e retoque
   Tudo acontece no "espaço do clipe" (canvas do tamanho desenhado do clipe),
   então máscaras e pinceladas acompanham o clipe quando ele é movido/girado.
   ===================================================================== */
/** reduz dimensões mantendo a proporção (limite no lado maior) */
const capSize = (w, h, max) => { const s = Math.min(1, max / Math.max(w, h)); return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))]; };
const hexToRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgbToHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/** chroma key em YCbCr (cores saturadas) ou RGB (fundos neutros: branco, preto, cinza) */
function chromaKey(img, hex, strength, soft, spill, matte) {
  const d = img.data;
  const [kr, kg, kb] = hexToRgb(hex);
  const kcb = -0.168736 * kr - 0.331264 * kg + 0.5 * kb;
  const kcr = 0.5 * kr - 0.418688 * kg - 0.081312 * kb;
  const useChroma = Math.hypot(kcb, kcr) > 30;
  const th = (strength / 100) * (useChroma ? 150 : 220);
  const sf = Math.max(1, (soft / 100) * (useChroma ? 110 : 150));
  const dom = kg >= kr && kg >= kb ? 1 : kr >= kb ? 0 : 2;
  const sp = useChroma ? spill / 100 : 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    let dist;
    if (useChroma) {
      const cb = -0.168736 * r - 0.331264 * g + 0.5 * b, cr = 0.5 * r - 0.418688 * g - 0.081312 * b;
      dist = Math.hypot(cb - kcb, cr - kcr);
    } else dist = Math.hypot(r - kr, g - kg, b - kb);
    const a = dist <= th ? 0 : dist >= th + sf ? 1 : (dist - th) / sf;
    if (sp && a > 0) {
      // remove o reflexo da cor-chave nas bordas (spill)
      const c = d[i + dom], other = dom === 1 ? Math.max(r, b) : dom === 0 ? Math.max(g, b) : Math.max(r, g);
      if (c > other) d[i + dom] = c - (c - other) * sp;
    }
    d[i + 3] *= a;
    if (matte) { const v = d[i + 3]; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
  }
}

/** detecta a cor de fundo predominante olhando a borda do quadro */
function detectBackground(src) {
  const S = 64;
  const c = tmpCanvas('detect', S, S);
  const x = c.getContext('2d', { willReadFrequently: true });
  x.clearRect(0, 0, S, S);
  x.drawImage(src, 0, 0, S, S);
  const d = x.getImageData(0, 0, S, S).data;
  const buckets = new Map();
  const add = (px, py) => {
    const i = (py * S + px) * 4;
    if (d[i + 3] < 128) return;
    const key = (d[i] >> 5) * 64 + (d[i + 1] >> 5) * 8 + (d[i + 2] >> 5);
    const b = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    b.n++; b.r += d[i]; b.g += d[i + 1]; b.b += d[i + 2];
    buckets.set(key, b);
  };
  for (let i = 0; i < S; i++) { add(i, 0); add(i, 1); add(i, S - 1); add(i, S - 2); add(0, i); add(1, i); add(S - 1, i); add(S - 2, i); }
  let best = null;
  for (const b of buckets.values()) if (!best || b.n > best.n) best = b;
  if (!best) return null;
  return { color: rgbToHex(best.r / best.n, best.g / best.n, best.b / best.n), share: best.n / (S * 8) };
}

/** desenha o caminho da máscara centrado em (0,0) com tamanho w×h */
function maskShape(x, p, w, h) {
  const L = 1e5;
  x.beginPath();
  switch (p.maskType) {
    case 'linear': x.rect(-L, 0, 2 * L, L); break;
    case 'film': x.rect(-L, -h / 2, 2 * L, h); break;
    case 'circle': x.ellipse(0, 0, Math.max(1, w / 2), Math.max(1, h / 2), 0, 0, Math.PI * 2); break;
    case 'rect': x.roundRect(-w / 2, -h / 2, w, h, (p.maskRound / 100) * Math.min(Math.abs(w), Math.abs(h)) / 2); break;
    case 'star':
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 0.42 : 1;
        x.lineTo(Math.cos(a) * r * w / 2, Math.sin(a) * r * h / 2);
      }
      x.closePath();
      break;
    case 'heart': {
      const sx = w / 2, sy = h / 2;
      x.moveTo(0, 0.9 * sy);
      x.bezierCurveTo(-0.1 * sx, 0.8 * sy, -1 * sx, 0.3 * sy, -1 * sx, -0.25 * sy);
      x.bezierCurveTo(-1 * sx, -0.78 * sy, -0.42 * sx, -0.98 * sy, 0, -0.52 * sy);
      x.bezierCurveTo(0.42 * sx, -0.98 * sy, 1 * sx, -0.78 * sy, 1 * sx, -0.25 * sy);
      x.bezierCurveTo(1 * sx, 0.3 * sy, 0.1 * sx, 0.8 * sy, 0, 0.9 * sy);
      x.closePath();
      break;
    }
  }
}
function fillMask(x, p, w, h) {
  if (p.maskType === 'text') {
    const size = Math.max(4, h);
    x.font = `700 ${size}px "${p.maskFont}", sans-serif`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    const tw = Math.max(1, x.measureText(p.maskText || ' ').width);
    x.scale(w / tw, 1);
    x.fillText(p.maskText || ' ', 0, 0);
    return;
  }
  maskShape(x, p, w, h);
  x.fill();
}

/* ---------- caneta (máscara personalizada por curvas Bézier) ----------
   penPath = { closed, pts: [{ x, y, ix, iy, ox, oy }] } em coordenadas 0..1 do clipe
   penKfs  = [{ t, path }] para animar o recorte (rotoscopia)                         */
const clonePath = (p) => ({ closed: !!p?.closed, pts: (p?.pts || []).map((q) => ({ ...q })) });
function penAt(c, local) {
  const kfs = c.props.penKfs;
  if (!kfs?.length) return c.props.penPath;
  if (local <= kfs[0].t) return kfs[0].path;
  const last = kfs[kfs.length - 1];
  if (local >= last.t) return last.path;
  const i = kfs.findIndex((f, j) => local >= f.t && local < kfs[j + 1].t);
  const a = kfs[i], b = kfs[i + 1];
  if (a.path.pts.length !== b.path.pts.length) return a.path;
  const f = smooth(0, 1, (local - a.t) / (b.t - a.t));
  const L = (u, v) => u + (v - u) * f;
  return { closed: a.path.closed, pts: a.path.pts.map((q, j) => { const r = b.path.pts[j]; return { x: L(q.x, r.x), y: L(q.y, r.y), ix: L(q.ix, r.ix), iy: L(q.iy, r.iy), ox: L(q.ox, r.ox), oy: L(q.oy, r.oy) }; }) };
}
/** traça o caminho (em pixels w×h); devolve false se ainda não há forma */
function penShape(x, path, w, h) {
  const P = path?.pts || [];
  if (P.length < 2) return false;
  x.beginPath();
  x.moveTo(P[0].x * w, P[0].y * h);
  const seg = (a, b) => x.bezierCurveTo(a.ox * w, a.oy * h, b.ix * w, b.iy * h, b.x * w, b.y * h);
  for (let i = 1; i < P.length; i++) seg(P[i - 1], P[i]);
  if (path.closed || P.length > 2) seg(P[P.length - 1], P[0]);
  x.closePath();
  return true;
}
/** ponto numa curva Bézier cúbica */
const bez = (a, b, c, d, t) => { const u = 1 - t; return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d; };

/** geometria da máscara no espaço do clipe (w×h) */
const maskGeom = (p, w, h) => ({
  cx: w / 2 + (p.maskX / 100) * (w / 2),
  cy: h / 2 + (p.maskY / 100) * (h / 2),
  mw: (p.maskW / 100) * w,
  mh: (p.maskH / 100) * h,
  rot: (p.maskRot * Math.PI) / 180,
});

const needsProcessing = (p, liveErase) =>
  p.chromaOn || (p.eraseOn && p.eraseMask) || liveErase || (p.maskOn && p.maskType !== 'none') || p.smooth > 0 || p.sharpen > 0 || p.bloom > 0;

/** copia S para R (canvas auxiliar) */
function copyTo(name, S) {
  const R = tmpCanvas(name, S.width, S.height);
  const r = R.getContext('2d');
  r.clearRect(0, 0, R.width, R.height);
  r.drawImage(S, 0, 0);
  return R;
}

/**
 * Gera o clipe processado num canvas do tamanho desenhado (dw×dh).
 * src: elemento de vídeo/imagem (ou null para clipe de cor); erase: canvas de pinceladas (ou null)
 */
function processClip(p, src, dw, dh, k, erase, o = {}) {
  const w = Math.max(1, Math.round(dw)), h = Math.max(1, Math.round(dh));
  const S = tmpCanvas('clipS', w, h);
  const x = S.getContext('2d', { willReadFrequently: true });
  x.save();
  x.globalCompositeOperation = 'source-over';
  x.globalAlpha = 1;
  x.filter = 'none';
  x.clearRect(0, 0, w, h);
  if (src) x.drawImage(src, 0, 0, w, h);
  else { x.fillStyle = p.color; x.fillRect(0, 0, w, h); }

  // chroma key antes da correção de cor (a chave usa as cores originais)
  if (p.chromaOn) {
    const img = x.getImageData(0, 0, w, h);
    chromaKey(img, p.chromaColor, p.chromaStrength, p.chromaSoft, p.chromaSpill, p.chromaMatte);
    x.putImageData(img, 0, 0);
  }
  // aba Ajuste: correção de cor (GPU) + efeitos
  if (gradeActive(p) || gradeSpatial(p)) { x.restore(); gradeCanvas(S, p, k, o.local || 0); x.save(); }
  // retoque
  if (p.smooth > 0) {
    const R = copyTo('clipR', S);
    x.filter = `blur(${Math.max(0.5, p.smooth * 0.06 * k)}px)`;
    x.globalAlpha = (p.smooth / 100) * 0.8;
    x.drawImage(R, 0, 0);
  }
  if (p.sharpen > 0) {
    const R = copyTo('clipR', S);
    x.filter = 'url(#cl-sharpen)';
    x.globalAlpha = p.sharpen / 100;
    x.drawImage(R, 0, 0);
  }
  if (p.bloom > 0) {
    const R = copyTo('clipR', S);
    x.filter = `blur(${10 * k}px) brightness(1.25)`;
    x.globalCompositeOperation = 'screen';
    x.globalAlpha = (p.bloom / 100) * 0.85;
    x.drawImage(R, 0, 0);
  }
  x.filter = 'none';
  x.globalAlpha = 1;
  x.globalCompositeOperation = 'source-over';

  // efeitos de velocidade e de animação
  if (o.speedI > 0) { x.restore(); speedFx(S, p.speedFx, o.speedI, o.local || 0, k); x.save(); }
  if (o.T && (o.T.rgb > 0.01 || o.T.glitch > 0.01)) { x.restore(); animPixelFx(S, o.T, o.local || 0, k); x.save(); }
  // remoção personalizada (pinceladas)
  if (erase) {
    x.globalCompositeOperation = 'destination-out';
    x.drawImage(erase, 0, 0, w, h);
  }
  // máscara de forma
  if (p.maskOn && p.maskType === 'pen') {
    const path = o.pen || p.penPath;
    if (path?.pts?.length > 2) {
      const M = tmpCanvas('clipM', w, h);
      const m = M.getContext('2d');
      m.save();
      m.clearRect(0, 0, w, h);
      const feather = (p.maskFeather / 100) * Math.min(w, h) * 0.12;
      if (feather > 0.3) m.filter = `blur(${feather}px)`;
      m.fillStyle = '#fff';
      if (penShape(m, path, w, h)) m.fill();
      m.restore();
      x.globalCompositeOperation = p.maskInvert ? 'destination-out' : 'destination-in';
      x.drawImage(M, 0, 0);
    }
  } else if (p.maskOn && p.maskType !== 'none') {
    const M = tmpCanvas('clipM', w, h);
    const m = M.getContext('2d');
    m.save();
    m.clearRect(0, 0, w, h);
    const g = maskGeom(p, w, h);
    const feather = (p.maskFeather / 100) * Math.min(w, h) * 0.12;
    if (feather > 0.3) m.filter = `blur(${feather}px)`;
    m.fillStyle = '#fff';
    m.translate(g.cx, g.cy);
    m.rotate(g.rot);
    fillMask(m, p, g.mw, g.mh);
    m.restore();
    x.globalCompositeOperation = p.maskInvert ? 'destination-out' : 'destination-in';
    x.drawImage(M, 0, 0);
  }
  x.restore();
  return S;
}
