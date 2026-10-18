/* =====================================================================
   Transições personalizadas: a transição é um arquivo de dados, e um
   interpretador o transforma na mesma fn(ctx, A, B, p, W, H, d) das prontas.
   def = {
     id, name, duration,
     A: { [prop]: [{ t, v, ease }] }, B: { … },   — t vai de 0 a 1 (progresso da transição)
     over: { flash: […], shake: […] }, flashColor, shakeFreq,
     order: 'B' (B por cima) | 'A',
     reveal: 'none' | 'linear' | 'iris', revealAngle, revealFeather,   — B.reveal anima de 0 a 100
     motionBlur: 0..100,
   }
   ===================================================================== */
const TR_LAYER_PROPS = [
  { id: 'x', label: 'Posição X', def: 0, min: -200, max: 200, step: 1, unit: '%' },
  { id: 'y', label: 'Posição Y', def: 0, min: -200, max: 200, step: 1, unit: '%' },
  { id: 'scale', label: 'Escala', def: 100, min: 0, max: 500, step: 1, unit: '%' },
  { id: 'rotation', label: 'Rotação', def: 0, min: -720, max: 720, step: 1, unit: '°' },
  { id: 'opacity', label: 'Opacidade', def: 100, min: 0, max: 100, step: 1, unit: '%' },
  { id: 'blur', label: 'Desfoque', def: 0, min: 0, max: 80, step: 1, unit: '' },
  { id: 'brightness', label: 'Brilho', def: 100, min: 0, max: 400, step: 1, unit: '%' },
];
const TR_REVEAL_PROP = { id: 'reveal', label: 'Revelação', def: 100, min: 0, max: 100, step: 1, unit: '%' };
const TR_OVER_PROPS = [
  { id: 'flash', label: 'Flash', def: 0, min: 0, max: 100, step: 1, unit: '%' },
  { id: 'shake', label: 'Tremor', def: 0, min: 0, max: 100, step: 1, unit: '' },
];
const TR_PROP_DEFS = Object.fromEntries([...TR_LAYER_PROPS, TR_REVEAL_PROP, ...TR_OVER_PROPS].map((p) => [p.id, p]));
const TR_EASES = ['linear', 'smooth', 'in', 'out', 'spring', 'hold'];
const TR_DEFAULTS = { duration: 0.6, order: 'B', reveal: 'none', revealAngle: 0, revealFeather: 20, motionBlur: 50, flashColor: '#ffffff', shakeFreq: 12 };

/** valor de uma propriedade no progresso u (sem keyframes: o valor padrão) */
const trValue = (group, prop, u) => (group?.[prop]?.length ? kfValueAt(group[prop], u) : TR_PROP_DEFS[prop].def);

/** aceita só o que o interpretador entende (arquivos importados podem vir de qualquer lugar) */
function normalizeTransition(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Arquivo de transição inválido');
  const num = (v, d, lo, hi) => (Number.isFinite(+v) ? clamp(+v, lo, hi) : d);
  const tracks = (g, allowed) => {
    const out = {};
    for (const id of allowed) {
      const list = Array.isArray(g?.[id]) ? g[id] : null;
      if (!list) continue;
      const P = TR_PROP_DEFS[id];
      const keys = list.filter((k) => k && Number.isFinite(+k.t) && Number.isFinite(+k.v))
        .map((k) => ({ t: clamp(+k.t, 0, 1), v: clamp(+k.v, P.min, P.max), ease: TR_EASES.includes(k.ease) ? k.ease : 'linear' }))
        .sort((a, b) => a.t - b.t);
      if (keys.length) out[id] = keys;
    }
    return out;
  };
  const layer = TR_LAYER_PROPS.map((p) => p.id);
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 60) : 'u:' + uid(),
    name: String(raw.name || 'Minha transição').slice(0, 60),
    duration: num(raw.duration, TR_DEFAULTS.duration, 0.1, 5),
    A: tracks(raw.A, layer),
    B: tracks(raw.B, [...layer, 'reveal']),
    over: tracks(raw.over, TR_OVER_PROPS.map((p) => p.id)),
    order: raw.order === 'A' ? 'A' : 'B',
    reveal: ['linear', 'iris'].includes(raw.reveal) ? raw.reveal : 'none',
    revealAngle: num(raw.revealAngle, 0, -360, 360),
    revealFeather: num(raw.revealFeather, TR_DEFAULTS.revealFeather, 0, 100),
    motionBlur: num(raw.motionBlur, TR_DEFAULTS.motionBlur, 0, 100),
    flashColor: /^#[0-9a-f]{6}$/i.test(raw.flashColor) ? raw.flashColor : TR_DEFAULTS.flashColor,
    shakeFreq: num(raw.shakeFreq, TR_DEFAULTS.shakeFreq, 1, 40),
  };
}

/* ---------- interpretador ---------- */
function trLayerState(g, u) {
  const s = {};
  for (const P of TR_LAYER_PROPS) s[P.id] = trValue(g, P.id, u);
  return s;
}
function drawTrLayer(c, src, s, W, H, k) {
  if (s.opacity <= 0 || s.scale <= 0) return;
  c.save();
  c.globalAlpha *= s.opacity / 100;
  const f = [];
  if (s.blur > 0) f.push(`blur(${s.blur * k}px)`);
  if (s.brightness !== 100) f.push(`brightness(${s.brightness}%)`);
  if (f.length) c.filter = f.join(' ');
  c.translate(W / 2 + (s.x / 100) * W, H / 2 + (s.y / 100) * H);
  c.rotate((s.rotation * Math.PI) / 180);
  c.scale(s.scale / 100, s.scale / 100);
  c.drawImage(src, -W / 2, -H / 2, W, H);
  c.restore();
}
/** B recortado pela revelação (linear ou íris, com borda suave) */
function trRevealed(B, def, r, W, H) {
  if (r >= 100) return B;
  const cv = tmpCanvas('ctrRev', W, H), x = cv.getContext('2d');
  x.save();
  x.globalCompositeOperation = 'copy';
  x.drawImage(B, 0, 0, W, H);
  x.globalCompositeOperation = 'destination-in';
  const fw = Math.max(0.002, def.revealFeather / 100), total = 1 + fw, e1 = (r / 100) * total, e0 = e1 - fw;
  const stops = (g, a, b) => { g.addColorStop(clamp(a, 0, 1), 'rgba(0,0,0,1)'); g.addColorStop(clamp(b, 0, 1), 'rgba(0,0,0,0)'); };
  let g;
  if (def.reveal === 'iris') {
    const R = Math.hypot(W, H) / 2, end = Math.max(1e-3, e1 * R);
    g = x.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, end);
    stops(g, (e0 * R) / end, 1);
  } else {
    const a = (def.revealAngle * Math.PI) / 180, dx = Math.cos(a), dy = Math.sin(a);
    const L = Math.abs(W * dx) + Math.abs(H * dy);
    const x0 = W / 2 - (dx * L) / 2, y0 = H / 2 - (dy * L) / 2;
    g = x.createLinearGradient(x0, y0, x0 + dx * L * total, y0 + dy * L * total);
    stops(g, e0 / total, e1 / total);
  }
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  x.restore();
  return cv;
}
function trFrame(c, def, A, B, u, W, H, d) {
  const k = Math.min(W, H) / 720;
  const sa = trLayerState(def.A, u), sb = trLayerState(def.B, u);
  const Bs = def.reveal !== 'none' ? trRevealed(B, def, trValue(def.B, 'reveal', u), W, H) : B;
  c.save();
  const shake = trValue(def.over, 'shake', u);
  if (shake > 0) {
    // tremor de câmera suave (o mesmo ruído do wiggle), em segundos reais da transição
    const a = (shake / 100) * 0.06 * H, ts = u * d;
    c.translate(W / 2 + wiggleAt(7, def.shakeFreq, ts) * a, H / 2 + wiggleAt(19, def.shakeFreq, ts) * a);
    c.rotate((wiggleAt(31, def.shakeFreq, ts) * shake * 0.04 * Math.PI) / 180);
    c.scale(1 + shake / 1000, 1 + shake / 1000);
    c.translate(-W / 2, -H / 2);
  }
  for (const [src, s] of def.order === 'A' ? [[Bs, sb], [A, sa]] : [[A, sa], [Bs, sb]]) drawTrLayer(c, src, s, W, H, k);
  c.restore();
  const flash = trValue(def.over, 'flash', u);
  if (flash > 0) { c.save(); c.globalAlpha *= flash / 100; c.fillStyle = def.flashColor; c.fillRect(0, 0, W, H); c.restore(); }
}
/** transforma o arquivo de dados numa função de transição */
function makeTransitionFn(def) {
  return (c, A, B, p, W, H, d = def.duration) => {
    const mb = def.motionBlur / 100;
    // desfoque de movimento: média de vários instantes dentro de um quadro (soma 'lighter' = média exata)
    const span = (mb * (1 / 30)) / Math.max(0.05, d);
    const n = mb > 0 ? Math.min(7, 2 + Math.round(mb * 5)) : 1;
    if (n === 1) { trFrame(c, def, A, B, p, W, H, d); return; }
    const S = tmpCanvas('ctrS', W, H), sx = S.getContext('2d');
    const acc = tmpCanvas('ctrAcc', W, H), ax = acc.getContext('2d');
    ax.save(); ax.setTransform(1, 0, 0, 1, 0, 0); ax.globalCompositeOperation = 'copy'; ax.clearRect(0, 0, W, H); ax.restore();
    for (let i = 0; i < n; i++) {
      const u = clamp(p + span * (i / (n - 1) - 0.5), 0, 1);
      sx.save(); sx.setTransform(1, 0, 0, 1, 0, 0); sx.clearRect(0, 0, W, H); sx.restore();
      trFrame(sx, def, A, B, u, W, H, d);
      ax.save(); ax.globalCompositeOperation = 'lighter'; ax.globalAlpha = 1 / n; ax.drawImage(S, 0, 0); ax.restore();
    }
    c.drawImage(acc, 0, 0);
  };
}

/* ---------- prontas em dados (dá para editar uma cópia) ---------- */
const trKey = (t, v, ease = 'linear') => ({ t, v, ease });
const DATA_TRANSITIONS = [
  { id: 'd:whip', name: 'Chicote com zoom', duration: 0.5, motionBlur: 85,
    A: { scale: [trKey(0, 100, 'in'), trKey(0.5, 190)], rotation: [trKey(0, 0, 'in'), trKey(0.5, 14)] },
    B: { opacity: [trKey(0, 0, 'hold'), trKey(0.5, 100)], scale: [trKey(0.5, 190, 'out'), trKey(1, 100)], rotation: [trKey(0.5, -14, 'out'), trKey(1, 0)] },
    over: { flash: [trKey(0.38, 0, 'out'), trKey(0.5, 35, 'in'), trKey(0.7, 0)] } },
  { id: 'd:slide', name: 'Deslizar com desfoque', duration: 0.5, motionBlur: 100,
    A: { x: [trKey(0, 0, 'smooth'), trKey(1, -100)] }, B: { x: [trKey(0, 100, 'smooth'), trKey(1, 0)] } },
  { id: 'd:punch', name: 'Zoom com impacto', duration: 0.6, motionBlur: 60,
    A: { scale: [trKey(0, 100, 'in'), trKey(0.45, 150)], brightness: [trKey(0, 100, 'in'), trKey(0.45, 160)] },
    B: { opacity: [trKey(0, 0, 'hold'), trKey(0.45, 100)], scale: [trKey(0.45, 75, 'spring'), trKey(1, 100)] },
    over: { shake: [trKey(0.4, 0, 'out'), trKey(0.5, 70, 'smooth'), trKey(0.95, 0)] } },
  { id: 'd:spin', name: 'Giro 360', duration: 0.7, motionBlur: 90,
    A: { rotation: [trKey(0, 0, 'in'), trKey(0.5, 180)], scale: [trKey(0, 100, 'in'), trKey(0.5, 55)] },
    B: { opacity: [trKey(0, 0, 'hold'), trKey(0.5, 100)], rotation: [trKey(0.5, -180, 'out'), trKey(1, 0)], scale: [trKey(0.5, 55, 'out'), trKey(1, 100)] } },
  { id: 'd:softwipe', name: 'Revelação suave', duration: 0.8, motionBlur: 0, reveal: 'linear', revealAngle: 20, revealFeather: 35,
    A: { scale: [trKey(0, 100, 'smooth'), trKey(1, 110)] }, B: { reveal: [trKey(0, 0, 'smooth'), trKey(1, 100)], scale: [trKey(0, 115, 'smooth'), trKey(1, 100)] } },
  { id: 'd:iris', name: 'Íris com mola', duration: 0.7, motionBlur: 0, reveal: 'iris', revealFeather: 8,
    B: { reveal: [trKey(0, 0, 'spring'), trKey(1, 100)] } },
  { id: 'd:drop', name: 'Queda com tremor', duration: 0.6, motionBlur: 70,
    A: { y: [trKey(0, 0, 'in'), trKey(0.5, 100)] },
    B: { y: [trKey(0, -100, 'hold'), trKey(0.5, -100, 'spring'), trKey(1, 0)] },
    over: { shake: [trKey(0.55, 0, 'out'), trKey(0.65, 50, 'smooth'), trKey(1, 0)] } },
];

/* ---------- biblioteca (as do usuário ficam neste navegador) ---------- */
const USER_TR_KEY = 'cutlab-transitions';
const USER_TR_CAT = 'Minhas';
const trListeners = new Set();
let trVersion = 0;
const isUserTransition = (id) => TRANSITION_MAP[id]?.cat === USER_TR_CAT;
function registerTransition(def, cat) {
  const t = { id: def.id, name: def.name, cat, def, fn: makeTransitionFn(def) };
  const i = TRANSITIONS.findIndex((x) => x.id === def.id);
  if (i >= 0) TRANSITIONS[i] = t; else TRANSITIONS.push(t);
  TRANSITION_MAP[def.id] = t;
}
function persistUserTransitions() {
  try { localStorage.setItem(USER_TR_KEY, JSON.stringify(TRANSITIONS.filter((t) => t.cat === USER_TR_CAT).map((t) => t.def))); } catch { /* sem armazenamento */ }
}
const bumpTransitions = () => { trVersion++; trListeners.forEach((f) => f(trVersion)); };
function saveUserTransition(raw) {
  const def = normalizeTransition(raw);
  if (!def.id.startsWith('u:')) def.id = 'u:' + uid();
  registerTransition(def, USER_TR_CAT);
  persistUserTransitions();
  bumpTransitions();
  return def;
}
function deleteUserTransition(id) {
  const i = TRANSITIONS.findIndex((t) => t.id === id);
  if (i < 0 || TRANSITIONS[i].cat !== USER_TR_CAT) return;
  TRANSITIONS.splice(i, 1);
  delete TRANSITION_MAP[id];
  persistUserTransitions();
  bumpTransitions();
}
/** re-renderiza quando a biblioteca muda */
function useTransitionsVersion() {
  const [v, setV] = useState(trVersion);
  useEffect(() => { trListeners.add(setV); return () => trListeners.delete(setV); }, []);
  return v;
}
/** transições do usuário usadas nestes clipes (vão junto no arquivo do projeto) */
function usedUserTransitions(clips) {
  const ids = new Set();
  const walk = (cs) => cs.forEach((c) => { if (c.transition && isUserTransition(c.transition.type)) ids.add(c.transition.type); if (c.children) walk(c.children); });
  walk(clips || []);
  return [...ids].map((id) => TRANSITION_MAP[id].def);
}
/** ao abrir um projeto: guarda as transições dele que este navegador ainda não tem */
function adoptProjectTransitions(defs) {
  let n = 0;
  for (const raw of defs || []) {
    try {
      const def = normalizeTransition(raw);
      if (!def.id.startsWith('u:') || TRANSITION_MAP[def.id]) continue;
      registerTransition(def, USER_TR_CAT);
      n++;
    } catch { /* ignora a inválida */ }
  }
  if (n) { persistUserTransitions(); bumpTransitions(); }
}
/** baixa as transições como arquivo .json (para compartilhar) */
function exportTransitions(defs, name) {
  const blob = new Blob([JSON.stringify(defs.length === 1 ? defs[0] : defs, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(name || 'transicoes').replace(/[\\/:*?"<>|]+/g, '_')}.transicao.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
/** lê um .json com uma transição ou uma lista; cada uma vira uma nova na biblioteca */
async function importTransitionsFile(file) {
  const data = JSON.parse(await file.text());
  return (Array.isArray(data) ? data : [data]).map((raw) => saveUserTransition({ ...normalizeTransition(raw), id: 'u:' + uid() }));
}

DATA_TRANSITIONS.forEach((raw) => registerTransition(normalizeTransition(raw), 'Dinâmicas'));
try {
  for (const raw of JSON.parse(localStorage.getItem(USER_TR_KEY) || '[]')) {
    try { registerTransition(normalizeTransition(raw), USER_TR_CAT); } catch { /* ignora a inválida */ }
  }
} catch { /* armazenamento indisponível */ }
