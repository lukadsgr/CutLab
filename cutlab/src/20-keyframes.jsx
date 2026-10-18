/* =====================================================================
   Keyframes
   clip.keyframes = { [prop]: [{ t, v, ease }] }  — t é o tempo local do clipe (s)
   ===================================================================== */
const KF_PROPS = ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotation', 'opacity', 'volume', 'brightness', 'contrast', 'saturation', 'hue', 'sepia', 'blur', 'temperature', 'vignette', 'intensity', 'fontSize', 'shadowOpacity', 'shadowBlur', 'shadowDist', 'shadowAngle', 'glowStrength', 'glowSpread', 'bgOpacity', 'bgRadius', 'bgPadX', 'bgPadY', 'stroke',
  'maskX', 'maskY', 'maskW', 'maskH', 'maskRot', 'maskFeather', 'maskRound', 'chromaStrength', 'chromaSoft', 'chromaSpill', 'smooth', 'sharpen', 'bloom'];
const KF_EPS = FRAME * 0.5;
const EASES = {
  linear: { name: 'Linear', fn: (p) => p },
  smooth: { name: 'Suave', fn: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2) },
  in: { name: 'Acelerar', fn: (p) => p * p * p },
  out: { name: 'Desacelerar', fn: (p) => 1 - Math.pow(1 - p, 3) },
  hold: { name: 'Congelar', fn: () => 0 },
};

/* curvas livres (editor de curvas): ease 'bezier' com bz = [x1, y1, x2, y2], como cubic-bezier() do CSS */
const _bzCache = new Map();
function bezierFn(bz) {
  const key = bz.join(',');
  let f = _bzCache.get(key);
  if (f) return f;
  const [x1, y1, x2, y2] = bz;
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (s) => ((ax * s + bx) * s + cx) * s, Y = (s) => ((ay * s + by) * s + cy) * s, dX = (s) => (3 * ax * s + 2 * bx) * s + cx;
  f = (p) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    // acha s com X(s) = p: Newton e, se não convergir, bisseção
    let s = p;
    for (let i = 0; i < 8; i++) { const e = X(s) - p, d = dX(s); if (Math.abs(e) < 1e-6) return Y(s); if (Math.abs(d) < 1e-6) break; s -= e / d; }
    let lo = 0, hi = 1;
    s = p;
    for (let i = 0; i < 40; i++) { const x = X(s); if (Math.abs(x - p) < 1e-6) break; if (x < p) lo = s; else hi = s; s = (lo + hi) / 2; }
    return Y(s);
  };
  if (_bzCache.size > 200) _bzCache.clear();
  _bzCache.set(key, f);
  return f;
}
/** curva de um keyframe como função 0..1 → 0..1 */
const easeFn = (f) => (f.ease === 'bezier' && f.bz ? bezierFn(f.bz) : (EASES[f.ease] || EASES.linear).fn);

function kfValueAt(list, local) {
  if (local <= list[0].t) return list[0].v;
  const last = list[list.length - 1];
  if (local >= last.t) return last.v;
  for (let i = 0; i < list.length - 1; i++) {
    const a = list[i], b = list[i + 1];
    if (local >= a.t && local < b.t) {
      const p = (local - a.t) / Math.max(1e-6, b.t - a.t);
      return a.v + (b.v - a.v) * easeFn(a)(p);
    }
  }
  return last.v;
}
const hasKf = (c, prop) => !!c.keyframes?.[prop]?.length;
const propAt = (c, prop, local) => (hasKf(c, prop) ? kfValueAt(c.keyframes[prop], local) : c.props[prop]);

/** props do clipe com os keyframes aplicados no tempo local informado */
function resolveProps(c, local) {
  const kfs = c.keyframes;
  if (!kfs) return c.props;
  let out = c.props;
  for (const k in kfs) {
    if (!kfs[k].length) continue;
    if (out === c.props) out = { ...c.props };
    out[k] = kfValueAt(kfs[k], local);
  }
  return out;
}

/** todos os tempos (locais) com keyframe, sem repetição */
function kfTimes(c) {
  const ts = [];
  for (const k in c.keyframes || {}) for (const f of c.keyframes[k]) if (!ts.some((t) => Math.abs(t - f.t) < KF_EPS)) ts.push(f.t);
  return ts.sort((a, b) => a - b);
}
const kfCount = (c) => Object.values(c.keyframes || {}).reduce((n, l) => n + l.length, 0);
const kfAtTime = (c, prop, local) => c.keyframes?.[prop]?.find((f) => Math.abs(f.t - local) < KF_EPS);

/** aplica um patch de props respeitando keyframes: props animadas ganham/atualizam keyframe no tempo local */
function applyPatch(c, patch, local) {
  let props = c.props, keyframes = c.keyframes;
  for (const k in patch) {
    const v = patch[k];
    if (typeof v === 'number' && hasKf(c, k)) {
      const list = keyframes[k];
      const i = list.findIndex((f) => Math.abs(f.t - local) < KF_EPS);
      const next = i >= 0 ? list.map((f, j) => (j === i ? { ...f, v } : f)) : [...list, { t: local, v, ease: 'smooth' }].sort((a, b) => a.t - b.t);
      keyframes = { ...keyframes, [k]: next };
    } else {
      if (props === c.props) props = { ...props };
      props[k] = v;
    }
  }
  return props === c.props && keyframes === c.keyframes ? c : { ...c, props, keyframes };
}

/** liga/desliga o keyframe de uma propriedade no tempo local */
function toggleKf(c, prop, local) {
  const list = c.keyframes?.[prop] || [];
  const existing = list.findIndex((f) => Math.abs(f.t - local) < KF_EPS);
  if (existing >= 0) {
    const next = list.filter((_, i) => i !== existing);
    const keyframes = { ...c.keyframes };
    if (next.length) keyframes[prop] = next;
    else delete keyframes[prop];
    // ao remover o último keyframe, o valor naquele ponto vira o valor fixo
    const props = next.length ? c.props : { ...c.props, [prop]: list[existing].v };
    return { ...c, keyframes, props };
  }
  const v = propAt(c, prop, local);
  return { ...c, keyframes: { ...(c.keyframes || {}), [prop]: [...list, { t: local, v, ease: 'smooth' }].sort((a, b) => a.t - b.t) } };
}

/** adiciona keyframes de várias propriedades de uma vez */
function addKfs(c, props, local) {
  let out = c;
  for (const p of props) if (!kfAtTime(out, p, local)) out = toggleKf(out, p, local);
  return out;
}

const mapKf = (c, fn) => {
  if (!c.keyframes) return c;
  const keyframes = {};
  for (const k in c.keyframes) {
    const l = fn(c.keyframes[k], k);
    if (l.length) keyframes[k] = l;
  }
  return { ...c, keyframes };
};
/** desloca todos os keyframes (usado ao aparar o início do clipe) */
const shiftKf = (c, dt) => mapKf(c, (l) => l.map((f) => ({ ...f, t: f.t + dt })));
/** escala tempos (usado ao mudar a velocidade) */
const scaleKf = (c, s) => mapKf(c, (l) => l.map((f) => ({ ...f, t: f.t * s })));
/** move os keyframes que estão em `from` para `to` */
const moveKfTime = (c, from, to) => mapKf(c, (l) => l.map((f) => (Math.abs(f.t - from) < KF_EPS ? { ...f, t: to } : f)).sort((a, b) => a.t - b.t));
const removeKfTime = (c, at) => mapKf(c, (l) => l.filter((f) => Math.abs(f.t - at) >= KF_EPS));
const setKfEase = (c, at, ease) => mapKf(c, (l) => l.map((f) => (Math.abs(f.t - at) < KF_EPS ? { ...f, ease } : f)));

/** divide keyframes no ponto s (tempo local): retorna [esquerda, direita] */
function splitKf(c, s) {
  if (!c.keyframes) return [c.keyframes, c.keyframes];
  const L = {}, R = {};
  for (const k in c.keyframes) {
    const l = c.keyframes[k];
    const v = kfValueAt(l, s);
    const left = l.filter((f) => f.t < s - KF_EPS);
    const right = l.filter((f) => f.t > s + KF_EPS).map((f) => ({ ...f, t: f.t - s }));
    L[k] = [...left, { t: s, v, ease: 'smooth' }];
    const prev = l.filter((f) => f.t <= s).pop();   // a curva do trecho cortado continua na metade direita
    R[k] = [{ t: 0, v, ease: prev?.ease || 'smooth', ...(prev?.bz ? { bz: prev.bz } : {}) }, ...right];
  }
  return [L, R];
}
