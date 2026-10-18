/* =====================================================================
   Correção de cor (aba Ajuste)
   Todas as operações de cor (básico, HSL, curvas, rodas, automático,
   combinação de cores) são "assadas" numa LUT 3D de 33³ e aplicadas na
   GPU por um shader WebGL2 — uma única amostragem por pixel, em tempo real.
   Efeitos espaciais (nitidez, brilho, granulado, vinheta) ficam no canvas 2D.
   ===================================================================== */
const HSL_RANGES = [
  { id: 'red', name: 'Vermelho', hue: 0, color: '#ff3b3b' },
  { id: 'orange', name: 'Laranja', hue: 30, color: '#ff8a2b' },
  { id: 'yellow', name: 'Amarelo', hue: 58, color: '#ffe02b' },
  { id: 'green', name: 'Verde', hue: 120, color: '#35d655' },
  { id: 'cyan', name: 'Ciano', hue: 180, color: '#2be0e0' },
  { id: 'blue', name: 'Azul', hue: 220, color: '#3b7bff' },
  { id: 'purple', name: 'Roxo', hue: 275, color: '#9b4dff' },
  { id: 'magenta', name: 'Magenta', hue: 315, color: '#ff3bd2' },
];
const WHEELS = [
  { id: 'shadow', name: 'Sombras' },
  { id: 'mid', name: 'Meios-tons' },
  { id: 'high', name: 'Realces' },
  { id: 'off', name: 'Compensação' },
];
const ID_CURVE = [[0, 0], [1, 1]];

/* props de cor (todas numéricas e animáveis, exceto curvas e listas) */
const GRADE_BASIC = ['gTemp', 'gTint', 'gSat', 'gExposure', 'gContrast', 'gHighlights', 'gShadows', 'gWhites', 'gBlacks', 'gBrightness', 'gFade'];
const GRADE_FX = ['sharpen', 'bloom', 'gGrain', 'gVignette'];
const HSL_KEYS = HSL_RANGES.flatMap((r) => ['h', 's', 'l'].map((k) => `hsl_${r.id}_${k}`));
const WHEEL_KEYS = WHEELS.flatMap((w) => ['x', 'y', 'l'].map((k) => `wh_${w.id}_${k}`));
const GRADE_DEFAULTS = {
  gradeOn: true, hslOn: true, curvesOn: true, wheelsOn: true,
  autoOn: false, autoAmt: 80, autoLo: [0, 0, 0], autoHi: [1, 1, 1],
  matchOn: false, matchAmt: 80, matchGain: [1, 1, 1], matchOff: [0, 0, 0], matchRef: '',
  wbOn: false, wbAmt: 80, wbGain: [1, 1, 1],
  wheelAmt: 100,
  curveL: ID_CURVE, curveR: ID_CURVE, curveG: ID_CURVE, curveB: ID_CURVE,
  ...Object.fromEntries([...GRADE_BASIC, 'gGrain', 'gVignette', ...HSL_KEYS, ...WHEEL_KEYS].map((k) => [k, 0])),
};
/** todas as chaves copiadas por "Aplicar a tudo" e pelas predefinições */
const GRADE_KEYS = Object.keys(GRADE_DEFAULTS).concat(['sharpen', 'bloom']);

const isIdCurve = (c) => !c || (c.length === 2 && c[0][0] === 0 && c[0][1] === 0 && c[1][0] === 1 && c[1][1] === 1);
function gradeActive(p) {
  if (p.autoOn || p.matchOn || p.wbOn) return true;
  if (p.gradeOn && GRADE_BASIC.some((k) => p[k])) return true;
  if (p.hslOn && HSL_KEYS.some((k) => p[k])) return true;
  if (p.curvesOn && !(isIdCurve(p.curveL) && isIdCurve(p.curveR) && isIdCurve(p.curveG) && isIdCurve(p.curveB))) return true;
  if (p.wheelsOn && p.wheelAmt && WHEEL_KEYS.some((k) => p[k])) return true;
  return false;
}
const gradeSpatial = (p) => p.gradeOn && (p.gGrain > 0 || p.gVignette);

/* ---------- curvas: interpolação cúbica monotônica (Fritsch–Carlson) ---------- */
const _curveCache = new Map();
function curveTable(points) {
  const key = JSON.stringify(points);
  let t = _curveCache.get(key);
  if (t) return t;
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  const n = pts.length;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
  m[0] = d[0] ?? 0; m[n - 1] = d[n - 2] ?? 0;
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const tt = 3 / Math.sqrt(s); m[i] = tt * a * d[i]; m[i + 1] = tt * b * d[i]; }
  }
  t = new Float32Array(256);
  for (let k = 0; k < 256; k++) {
    const x = k / 255;
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    if (x <= xs[0]) { t[k] = ys[0]; continue; }
    if (x >= xs[n - 1]) { t[k] = ys[n - 1]; continue; }
    const h = xs[i + 1] - xs[i], u = (x - xs[i]) / h;
    const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
    t[k] = clamp(h00 * ys[i] + h10 * h * m[i] + h01 * ys[i + 1] + h11 * h * m[i + 1], 0, 1);
  }
  if (_curveCache.size > 64) _curveCache.clear();
  _curveCache.set(key, t);
  return t;
}
const sampleCurve = (t, v) => { const x = clamp(v, 0, 1) * 255, i = Math.floor(x), f = x - i; return i >= 255 ? t[255] : t[i] + (t[i + 1] - t[i]) * f; };

/* ---------- conversões ---------- */
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
function rgb2hsl(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hsl2rgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  if (!s) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}
/** cor de uma roda (x,y no disco unitário) → deslocamento RGB de média zero */
function wheelRGB(x, y) {
  const r = Math.min(1, Math.hypot(x, y));
  if (!r) return [0, 0, 0];
  const [cr, cg, cb] = hsl2rgb((Math.atan2(-y, x) * 180) / Math.PI, 1, 0.5);
  const m = (cr + cg + cb) / 3;
  return [(cr - m) * r, (cg - m) * r, (cb - m) * r];
}

/** aplica toda a correção a uma cor (0..1) */
function gradePixel(r, g, b, p, ctx) {
  // correções automáticas
  if (p.autoOn) {
    const a = p.autoAmt / 100;
    r += ((r - p.autoLo[0]) / Math.max(0.05, p.autoHi[0] - p.autoLo[0]) - r) * a;
    g += ((g - p.autoLo[1]) / Math.max(0.05, p.autoHi[1] - p.autoLo[1]) - g) * a;
    b += ((b - p.autoLo[2]) / Math.max(0.05, p.autoHi[2] - p.autoLo[2]) - b) * a;
  }
  if (p.wbOn) {
    const a = p.wbAmt / 100;
    r *= 1 + (p.wbGain[0] - 1) * a; g *= 1 + (p.wbGain[1] - 1) * a; b *= 1 + (p.wbGain[2] - 1) * a;
  }
  if (p.matchOn) {
    const a = p.matchAmt / 100;
    r += (r * p.matchGain[0] + p.matchOff[0] - r) * a;
    g += (g * p.matchGain[1] + p.matchOff[1] - g) * a;
    b += (b * p.matchGain[2] + p.matchOff[2] - b) * a;
  }
  if (p.gradeOn) {
    const ex = Math.pow(2, (p.gExposure / 100) * 1.6);
    r *= ex; g *= ex; b *= ex;
    const tp = p.gTemp / 100, tn = p.gTint / 100;
    r *= 1 + tp * 0.22 + tn * 0.06; g *= 1 - tn * 0.16; b *= 1 - tp * 0.22 + tn * 0.06;
    const cf = p.gContrast >= 0 ? 1 + (p.gContrast / 100) * 0.9 : 1 + (p.gContrast / 100) * 0.65;
    r = (r - 0.5) * cf + 0.5; g = (g - 0.5) * cf + 0.5; b = (b - 0.5) * cf + 0.5;
    const L = clamp(luma(r, g, b), 0, 1);
    const tone = (p.gHighlights / 100) * 0.35 * smooth(0.45, 1, L) + (p.gShadows / 100) * 0.35 * (1 - smooth(0, 0.55, L))
      + (p.gWhites / 100) * 0.25 * smooth(0.7, 1, L) + (p.gBlacks / 100) * 0.22 * (1 - smooth(0, 0.3, L));
    r += tone; g += tone; b += tone;
    if (p.gBrightness) {
      const e = 1 - (p.gBrightness / 100) * 0.45;
      r = Math.pow(clamp(r, 0, 1), e); g = Math.pow(clamp(g, 0, 1), e); b = Math.pow(clamp(b, 0, 1), e);
    }
  }
  // rodas de cores: lift / gamma / gain / offset
  if (p.wheelsOn && p.wheelAmt) {
    const a = p.wheelAmt / 100, W = ctx.wheels;
    const lift = W.shadow, gam = W.mid, gain = W.high, off = W.off;
    const ch = [r, g, b].map((v, i) => {
      v = clamp(v, 0, 1);
      v = v + (lift.c[i] * 0.5 + lift.l * 0.3) * a * (1 - v);
      v = Math.pow(clamp(v, 0, 1), 1 / Math.max(0.2, 1 + (gam.c[i] * 0.8 + gam.l * 0.5) * a));
      v = v * (1 + (gain.c[i] * 0.6 + gain.l * 0.5) * a);
      return v + (off.c[i] * 0.3 + off.l * 0.25) * a;
    });
    [r, g, b] = ch;
  }
  // curvas
  if (p.curvesOn) {
    const T = ctx.curves;
    if (T.L) { r = sampleCurve(T.L, r); g = sampleCurve(T.L, g); b = sampleCurve(T.L, b); }
    if (T.R) r = sampleCurve(T.R, r);
    if (T.G) g = sampleCurve(T.G, g);
    if (T.B) b = sampleCurve(T.B, b);
  }
  // HSL por faixa de cor + saturação global
  if ((p.hslOn && ctx.hslActive) || (p.gradeOn && p.gSat)) {
    let [h, s, l] = rgb2hsl(clamp(r, 0, 1), clamp(g, 0, 1), clamp(b, 0, 1));
    if (p.hslOn && ctx.hslActive) {
      let dh = 0, ds = 0, dl = 0, wsum = 0;
      for (const R of HSL_RANGES) {
        const adj = ctx.hsl[R.id];
        if (!adj) continue;
        let dist = Math.abs(h - R.hue); dist = Math.min(dist, 360 - dist);
        const w = Math.max(0, 1 - dist / 38);
        if (!w) continue;
        const ww = w * w * (3 - 2 * w);
        dh += adj[0] * ww; ds += adj[1] * ww; dl += adj[2] * ww; wsum += ww;
      }
      if (wsum) {
        const sw = smooth(0.02, 0.25, s);
        h += dh * 30 * sw;
        s = clamp(s * (1 + ds * sw), 0, 1);
        l = clamp(l + dl * 0.25 * sw * (1 - Math.abs(2 * l - 1) * 0.5), 0, 1);
      }
    }
    if (p.gradeOn && p.gSat) s = clamp(s * (1 + p.gSat / 100), 0, 1);
    [r, g, b] = hsl2rgb(h, s, l);
  }
  if (p.gradeOn && p.gFade) {
    const f = p.gFade / 100;
    r += (r * 0.78 + 0.13 - r) * f; g += (g * 0.78 + 0.13 - g) * f; b += (b * 0.78 + 0.14 - b) * f;
  }
  return [clamp(r, 0, 1), clamp(g, 0, 1), clamp(b, 0, 1)];
}

/* ---------- construção da LUT 3D ---------- */
const LUT_N = 33;
const _lutCache = new Map();
function gradeKey(p) {
  const o = {};
  for (const k of GRADE_KEYS) if (!GRADE_FX.includes(k)) o[k] = p[k];
  return JSON.stringify(o);
}
function buildLUT(p) {
  const key = gradeKey(p);
  let hit = _lutCache.get(key);
  if (hit) return hit;
  const ctx = {
    curves: {
      L: isIdCurve(p.curveL) ? null : curveTable(p.curveL), R: isIdCurve(p.curveR) ? null : curveTable(p.curveR),
      G: isIdCurve(p.curveG) ? null : curveTable(p.curveG), B: isIdCurve(p.curveB) ? null : curveTable(p.curveB),
    },
    hsl: {}, hslActive: false,
    wheels: Object.fromEntries(WHEELS.map((w) => [w.id, { c: wheelRGB(p[`wh_${w.id}_x`] / 100, p[`wh_${w.id}_y`] / 100), l: p[`wh_${w.id}_l`] / 100 }])),
  };
  for (const R of HSL_RANGES) {
    const v = [p[`hsl_${R.id}_h`] / 100, p[`hsl_${R.id}_s`] / 100, p[`hsl_${R.id}_l`] / 100];
    if (v.some(Boolean)) { ctx.hsl[R.id] = v; ctx.hslActive = true; }
  }
  const N = LUT_N, data = new Uint8Array(N * N * N * 4);
  let i = 0;
  for (let bz = 0; bz < N; bz++) for (let gy = 0; gy < N; gy++) for (let rx = 0; rx < N; rx++) {
    const [r, g, b] = gradePixel(rx / (N - 1), gy / (N - 1), bz / (N - 1), p, ctx);
    data[i++] = r * 255 + 0.5; data[i++] = g * 255 + 0.5; data[i++] = b * 255 + 0.5; data[i++] = 255;
  }
  hit = { key, data };
  if (_lutCache.size > 24) _lutCache.delete(_lutCache.keys().next().value);
  _lutCache.set(key, hit);
  return hit;
}

/* ---------- aplicação na GPU (WebGL2) com alternativa na CPU ---------- */
class LutGL {
  constructor() {
    this.canvas = document.createElement('canvas');
    const gl = this.canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    this.gl = gl;
    if (!gl) return;
    const vs = `#version 300 es
      in vec2 p; out vec2 uv;
      void main(){ uv = p * 0.5 + 0.5; uv.y = 1.0 - uv.y; gl_Position = vec4(p, 0.0, 1.0); }`;
    const fs = `#version 300 es
      precision highp float; precision highp sampler3D;
      uniform sampler2D img; uniform sampler3D lut; uniform float n;
      in vec2 uv; out vec4 o;
      void main(){
        vec4 c = texture(img, uv);
        vec3 s = (clamp(c.rgb, 0.0, 1.0) * (n - 1.0) + 0.5) / n;
        o = vec4(texture(lut, s).rgb, c.a);
      }`;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { this.gl = null; return; }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.imgTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.imgTex);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    this.lutTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_3D, k, v);
    gl.uniform1i(gl.getUniformLocation(prog, 'img'), 0);
    gl.uniform1i(gl.getUniformLocation(prog, 'lut'), 1);
    gl.uniform1f(gl.getUniformLocation(prog, 'n'), LUT_N);
    this.lutKey = null;
  }
  /** aplica a LUT sobre o canvas S (in-place) */
  apply(S, lut) {
    const gl = this.gl;
    if (!gl || gl.isContextLost()) return this.cpu(S, lut);
    const w = S.width, h = S.height;
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    gl.viewport(0, 0, w, h);
    if (this.lutKey !== lut.key) {
      gl.activeTexture(gl.TEXTURE1);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, LUT_N, LUT_N, LUT_N, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut.data);
      this.lutKey = lut.key;
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, S);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    const x = S.getContext('2d');
    x.save();
    x.globalCompositeOperation = 'copy';
    x.drawImage(this.canvas, 0, 0);
    x.restore();
  }
  cpu(S, lut) {
    const x = S.getContext('2d', { willReadFrequently: true });
    const img = x.getImageData(0, 0, S.width, S.height), d = img.data, L = lut.data, N = LUT_N, f = (N - 1) / 255;
    for (let i = 0; i < d.length; i += 4) {
      const j = (Math.round(d[i + 2] * f) * N * N + Math.round(d[i + 1] * f) * N + Math.round(d[i] * f)) * 4;
      d[i] = L[j]; d[i + 1] = L[j + 1]; d[i + 2] = L[j + 2];
    }
    x.putImageData(img, 0, 0);
  }
}
let _lutGL;
const lutGL = () => (_lutGL ||= new LutGL());

/** aplica correção de cor + efeitos espaciais da aba Ajuste num canvas (in-place) */
function gradeCanvas(S, p, k, t = 0) {
  if (gradeActive(p)) lutGL().apply(S, buildLUT(p));
  if (gradeSpatial(p)) {
    const x = S.getContext('2d');
    const w = S.width, h = S.height;
    x.save();
    x.globalCompositeOperation = 'source-atop';
    if (p.gVignette) {
      const g = x.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.28, w / 2, h / 2, Math.hypot(w, h) * 0.55);
      const a = Math.abs(p.gVignette) / 100 * 0.85, col = p.gVignette > 0 ? '0,0,0' : '255,255,255';
      g.addColorStop(0, `rgba(${col},0)`);
      g.addColorStop(1, `rgba(${col},${a})`);
      x.fillStyle = g;
      x.fillRect(0, 0, w, h);
    }
    x.restore();
    if (p.gGrain > 0) grain(x, w, h, (p.gGrain / 100) * 0.55, Math.floor(t * 24));
  }
}

/* ---------- análise de quadro: automático, balanço de branco, combinação, histograma ---------- */
function frameStats(src, S = 96) {
  const c = tmpCanvas('stats', S, S), x = c.getContext('2d', { willReadFrequently: true });
  x.clearRect(0, 0, S, S);
  x.drawImage(src, 0, 0, S, S);
  const d = x.getImageData(0, 0, S, S).data;
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  const sum = [0, 0, 0], sq = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    n++;
    for (let c2 = 0; c2 < 3; c2++) { const v = d[i + c2]; hist[c2 + 1][v]++; sum[c2] += v / 255; sq[c2] += (v / 255) ** 2; }
    hist[0][Math.round(luma(d[i], d[i + 1], d[i + 2]))]++;
  }
  n = Math.max(1, n);
  const mean = sum.map((s) => s / n);
  const std = sq.map((s, i) => Math.sqrt(Math.max(1e-6, s / n - mean[i] ** 2)));
  const pct = (h, q) => { let acc = 0; const target = q * n; for (let i = 0; i < 256; i++) { acc += h[i]; if (acc >= target) return i / 255; } return 1; };
  return { hist, mean, std, n, lo: [1, 2, 3].map((i) => pct(hist[i], 0.005)), hi: [1, 2, 3].map((i) => pct(hist[i], 0.995)) };
}
function autoLevels(src) {
  const s = frameStats(src);
  return { autoLo: s.lo, autoHi: s.hi.map((h, i) => Math.max(h, s.lo[i] + 0.1)) };
}
function whiteBalance(src) {
  const s = frameStats(src);
  const gray = (s.mean[0] + s.mean[1] + s.mean[2]) / 3;
  return { wbGain: s.mean.map((m) => clamp(gray / Math.max(0.02, m), 0.6, 1.6)) };
}
function colorMatch(src, ref) {
  const a = frameStats(src), b = frameStats(ref);
  const gain = a.std.map((sd, i) => clamp(b.std[i] / sd, 0.4, 2.5));
  return { matchGain: gain, matchOff: gain.map((g, i) => b.mean[i] - a.mean[i] * g) };
}

Object.assign(BASE_PROPS, GRADE_DEFAULTS);
