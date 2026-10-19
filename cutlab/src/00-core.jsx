const { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } = React;

/** relógio da reprodução: avisado a cada quadro sem passar pelo React (que recebe o tempo
 *  só ~10×/s durante a reprodução). Cursor e timecodes leem daqui para andar suaves. */
const playClock = { t: 0, subs: new Set(), set(t) { if (t === this.t) return; this.t = t; for (const f of this.subs) f(t); } };
/** chama fn(t) a cada mudança do relógio enquanto o componente estiver montado */
function useClock(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => { const f = (t) => ref.current(t); playClock.subs.add(f); return () => { playClock.subs.delete(f); }; }, []);
}
/** texto que acompanha o relógio (ex.: timecode) sem re-renderizar o componente */
function ClockText({ format, className }) {
  const ref = useRef();
  useClock((t) => { if (ref.current) ref.current.textContent = format(t); });
  return <span ref={ref} className={className}>{format(playClock.t)}</span>;
}

/** o elemento recebe texto digitado? (campo de texto, número, área de texto, conteúdo editável).
 *  Controles como sliders, caixas de seleção e botões não contam: neles o Espaço ainda toca o vídeo */
const TEXT_INPUTS = new Set(['', 'text', 'search', 'number', 'email', 'url', 'password', 'tel']);
function isTypingTarget(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
  return el.tagName === 'INPUT' && TEXT_INPUTS.has((el.getAttribute('type') || '').toLowerCase());
}
/** tira o foco do controle atual e limpa a seleção de texto (o Espaço não "clica" no botão focado) */
function releaseFocus() {
  const a = document.activeElement;
  if (a && a !== document.body) a.blur();
  window.getSelection?.()?.removeAllRanges();
}

/** troca de estado com View Transitions (quando o navegador suporta) */
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
function vt(fn) {
  if (!document.startViewTransition || reduceMotion()) return fn();
  // a transição só roda quando há quadros de renderização; se não houver (aba oculta), aplica direto
  let done = false;
  const run = () => { if (done) return; done = true; ReactDOM.flushSync(fn); };
  try {
    const tr = document.startViewTransition(run);
    // transições puladas (aba oculta, cliques rápidos) rejeitam as promessas — é esperado
    for (const p of [tr.ready, tr.finished, tr.updateCallbackDone]) p?.catch(() => {});
  } catch { run(); }
  setTimeout(run, 120);
}

/* =====================================================================
   Utilitários e constantes
   ===================================================================== */
const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const pad = (n) => String(n).padStart(2, '0');
const FPS = 30;
const FRAME = 1 / FPS;
const fmt = (t) => {
  t = Math.max(0, t);
  return `${pad(Math.floor(t / 60))}:${pad(Math.floor(t % 60))}:${pad(Math.floor((t % 1) * FPS + 1e-6))}`;
};
const fmtShort = (t) => `${Math.floor(t / 60)}:${pad(Math.floor(t % 60))}${t % 1 ? '.5' : ''}`;
const fmtDur = (t) => (t >= 60 ? `${Math.floor(t / 60)}:${pad(Math.floor(t % 60))}` : `${t.toFixed(1)}s`);
const rand = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

const RATIOS = { '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [960, 960], '4:3': [960, 720], '3:4': [720, 960] };
const RESOLUTIONS = { '720p': 1, '1080p': 1.5 };

const TRACKS = [
  { id: 'effect', label: 'Efeitos', icon: 'sparkles', accepts: ['effect', 'adjust'], h: 32 },
  { id: 'caption', label: 'Legendas', icon: 'captions', accepts: ['text'], h: 32 },
  { id: 'text', label: 'Texto', icon: 'type', accepts: ['text'], h: 34 },
  { id: 'overlay', label: 'Sobreposição', icon: 'layers', accepts: ['video', 'image', 'color', 'compound', 'text'], h: 50 },
  { id: 'main', label: 'Principal', icon: 'film', accepts: ['video', 'image', 'color', 'compound'], h: 66 },
  { id: 'audio', label: 'Áudio', icon: 'music', accepts: ['audio'], h: 46 },
];
const LAYER_ORDER = ['overlay', 'text', 'caption'];
const defaultTrack = (type) =>
  type === 'audio' ? 'audio' : type === 'text' ? 'text' : type === 'effect' || type === 'adjust' ? 'effect' : 'main';
/* ---------- camadas: cada faixa (exceto a Principal) pode ter várias linhas empilhadas ---------- */
const laneOf = (c) => c.lane || 0;
const rowKey = (track, lane) => (lane ? `${track}:${lane}` : track);
const clipRow = (c) => rowKey(c.track, laneOf(c));
const overlaps = (a, b) => a.start < b.start + b.duration - 1e-3 && b.start < a.start + a.duration - 1e-3;
/** primeira camada sem sobreposição a partir de `from` */
const freeLane = (cs, clip, from = 0) => {
  if (clip.track === 'main') return 0;
  for (let l = Math.max(0, from); ; l++) if (!cs.some((c) => c.id !== clip.id && c.track === clip.track && laneOf(c) === l && overlaps(c, clip))) return l;
};
/** renumera as camadas de cada faixa sem buracos (mantendo a ordem) */
const compactLanes = (cs) => {
  const map = {};
  for (const c of cs) (map[c.track] ||= new Set()).add(laneOf(c));
  const idx = {};
  for (const [t, set] of Object.entries(map)) idx[t] = new Map([...set].sort((a, b) => a - b).map((l, i) => [l, i]));
  return cs.map((c) => { const n = idx[c.track].get(laneOf(c)); return n === laneOf(c) ? c : { ...c, lane: n }; });
};
/** faixas que aparecem sempre; as outras só quando têm algum clipe (ou, em `show`, as que servem de destino de um arraste) */
const ALWAYS_TRACKS = ['main', 'audio'];
/** linhas da linha do tempo, de cima para baixo (camadas mais altas ficam acima, como no CapCut) */
const timelineRows = (cs, extra = [], show = null) => {
  const rows = [];
  for (const tr of TRACKS) {
    if (tr.id === 'main') { rows.push({ tr, lane: 0 }); continue; }
    if (!show?.includes(tr.id) && !ALWAYS_TRACKS.includes(tr.id) && !cs.some((c) => c.track === tr.id) && !extra.some((e) => e.track === tr.id)) continue;
    const set = new Set([0, ...cs.filter((c) => c.track === tr.id).map(laneOf), ...extra.filter((e) => e.track === tr.id).map((e) => e.lane)]);
    const lanes = [...set].sort((a, b) => b - a);
    for (const lane of lanes) rows.push({ tr, lane, ghost: extra.some((e) => e.ghost && e.track === tr.id && e.lane === lane) && !cs.some((c) => c.track === tr.id && laneOf(c) === lane) });
  }
  return rows;
};
const isMedia = (c) => c.type === 'video' || c.type === 'audio';
const isDrawable = (c) => c && c.type !== 'audio' && c.type !== 'effect' && c.type !== 'adjust';

const BASE_PROPS = {
  x: 0, y: 0, scale: 100, scaleX: 100, scaleY: 100, rotation: 0, opacity: 100,
  brightness: 100, contrast: 100, saturation: 100, blur: 0, hue: 0, sepia: 0, grayscale: 0, temperature: 0, vignette: 0,
  volume: 100, fadeIn: 0, fadeOut: 0, animIn: 'none', filter: 'none', color: '#1fd6cb',
  effect: 'shake', intensity: 60, fxSpeed: 1,
  // mistura
  blendOn: true, blend: 'normal',
  // remover plano de fundo
  autoBg: false, chromaOn: false, chromaColor: '#00ff00', chromaStrength: 40, chromaSoft: 20, chromaSpill: 50, chromaMatte: false,
  eraseOn: false, eraseMask: '',
  // máscara
  maskOn: false, maskType: 'none', maskX: 0, maskY: 0, maskW: 60, maskH: 60, maskRot: 0, maskFeather: 0, maskRound: 0,
  maskInvert: false, maskText: 'TEXTO', maskFont: 'Anton',
  penPath: { closed: false, pts: [] }, penKfs: [],
  // retoque
  smooth: 0, sharpen: 0, bloom: 0,
};

/* modos de mistura (nome → globalCompositeOperation do canvas) */
const BLEND_MODES = [
  { id: 'normal', name: 'Padrão', op: 'source-over' },
  { id: 'lighten', name: 'Iluminar', op: 'lighten' },
  { id: 'screen', name: 'Tela', op: 'screen' },
  { id: 'darken', name: 'Escurecer', op: 'darken' },
  { id: 'overlay', name: 'Camada', op: 'overlay' },
  { id: 'hard', name: 'Luz dura', op: 'hard-light' },
  { id: 'soft', name: 'Luz suave', op: 'soft-light' },
  { id: 'dodge', name: 'Superexposição de cores', op: 'color-dodge' },
  { id: 'add', name: 'Superexposição linear', op: 'lighter' },
  { id: 'burn', name: 'Dissolver cor', op: 'color-burn' },
  { id: 'multiply', name: 'Multiplicar', op: 'multiply' },
  { id: 'difference', name: 'Diferença', op: 'difference', extra: true },
  { id: 'exclusion', name: 'Exclusão', op: 'exclusion', extra: true },
  { id: 'hue', name: 'Matiz', op: 'hue', extra: true },
  { id: 'saturation', name: 'Saturação', op: 'saturation', extra: true },
  { id: 'color', name: 'Cor', op: 'color', extra: true },
  { id: 'luminosity', name: 'Luminosidade', op: 'luminosity', extra: true },
];
const BLEND_OP = Object.fromEntries(BLEND_MODES.map((b) => [b.id, b.op]));

const MASK_TYPES = [
  { id: 'linear', name: 'Dividir', icon: 'mLinear' },
  { id: 'film', name: 'Película', icon: 'mFilm' },
  { id: 'circle', name: 'Círculo', icon: 'mCircle', square: true },
  { id: 'rect', name: 'Retângulo', icon: 'mRect' },
  { id: 'star', name: 'Estrela', icon: 'mStar', square: true },
  { id: 'heart', name: 'Coração', icon: 'mHeart', square: true },
  { id: 'text', name: 'Texto', icon: 'mText' },
  { id: 'pen', name: 'Caneta', icon: 'pen' },
];
const TEXT_BASE = {
  text: 'Seu texto aqui', fontFamily: 'Inter', fontSize: 48, color: '#ffffff', bold: true, italic: false,
  align: 'center', stroke: 0, strokeColor: '#000000', bg: '', glow: '', shadow: true,
  // sombra: cor, opacidade %, desfoque e distância (% do tamanho da fonte), ângulo (° na tela; 90 = para baixo)
  shadowColor: '#000000', shadowOpacity: 60, shadowBlur: 16, shadowDist: 5, shadowAngle: 90,
  // neon: força (100 = padrão) e dispersão (% do tamanho)
  glowStrength: 100, glowSpread: 60,
  // caixa de fundo: opacidade %, arredondamento (0 = quadrada, 100 = pílula), margens (% do tamanho)
  bgOpacity: 100, bgRadius: 26, bgPadX: 40, bgPadY: 22,
};
/** "#rrggbb" (ou rgba existente) com opacidade */
const rgbaOf = (c, a) => {
  if (!c?.startsWith('#')) return c || 'rgba(0,0,0,' + a + ')';
  const n = parseInt(c.length === 4 ? c.slice(1).split('').map((x) => x + x).join('') : c.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};
/** "#rrggbb" → [r, g, b] */
const rgbOf = (c) => {
  if (!c?.startsWith('#')) return [255, 255, 255];
  const n = parseInt(c.length === 4 ? c.slice(1).split('').map((x) => x + x).join('') : c.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const FONTS = ['Inter', 'Montserrat', 'Bebas Neue', 'Anton', 'Playfair Display', 'Pacifico', 'Roboto Mono'];

const ADJ_RESET = { brightness: 100, contrast: 100, saturation: 100, sepia: 0, grayscale: 0, hue: 0, blur: 0 };
const FILTERS = [
  { id: 'none', name: 'Original', cat: 'Cor', v: {} },
  { id: 'vivid', name: 'Vívido', cat: 'Cor', v: { saturation: 150, contrast: 112 } },
  { id: 'pop', name: 'Pop', cat: 'Cor', v: { saturation: 190, contrast: 115, brightness: 104 } },
  { id: 'warm', name: 'Quente', cat: 'Cor', v: { sepia: 30, saturation: 125, brightness: 104 } },
  { id: 'cold', name: 'Frio', cat: 'Cor', v: { hue: -14, saturation: 85, brightness: 104, contrast: 105 } },
  { id: 'cyber', name: 'Cyber', cat: 'Cor', v: { hue: 160, saturation: 160, contrast: 120 } },
  { id: 'dream', name: 'Sonho', cat: 'Cor', v: { brightness: 115, contrast: 85, saturation: 125, blur: 1 } },
  { id: 'vintage', name: 'Vintage', cat: 'Retrô', v: { sepia: 45, contrast: 90, brightness: 108, saturation: 80 } },
  { id: 'faded', name: 'Desbotado', cat: 'Retrô', v: { contrast: 78, saturation: 60, brightness: 112 } },
  { id: 'kodak', name: 'Filme 35mm', cat: 'Retrô', v: { sepia: 22, contrast: 118, saturation: 110, hue: -6 } },
  { id: 'drama', name: 'Drama', cat: 'Retrô', v: { contrast: 145, brightness: 90, saturation: 75 } },
  { id: 'bw', name: 'P&B', cat: 'P&B', v: { grayscale: 100, contrast: 115 } },
  { id: 'noir', name: 'Noir', cat: 'P&B', v: { grayscale: 100, contrast: 165, brightness: 85 } },
  { id: 'silver', name: 'Prata', cat: 'P&B', v: { grayscale: 100, contrast: 90, brightness: 115 } },
];
const filterCss = (p, k = 1) =>
  `brightness(${p.brightness}%) contrast(${p.contrast}%) saturate(${p.saturation}%) sepia(${p.sepia}%) grayscale(${p.grayscale}%) hue-rotate(${p.hue}deg)` +
  (p.blur ? ` blur(${p.blur * k}px)` : '');

const TEXT_PRESETS = [
  { id: 'default', name: 'Padrão', sample: 'Seu texto aqui', style: {} },
  { id: 'title', name: 'Título', sample: 'GRANDE TÍTULO', style: { fontFamily: 'Bebas Neue', fontSize: 110, bold: false } },
  { id: 'subtitle', name: 'Legenda', sample: 'Legenda do vídeo', style: { fontSize: 34, bold: false, bg: 'rgba(0,0,0,0.6)', shadow: false, y: 75 } },
  { id: 'neon', name: 'Neon', sample: 'NEON', style: { fontFamily: 'Montserrat', fontSize: 80, color: '#c9fffb', glow: '#1fd6cb', shadow: false } },
  { id: 'highlight', name: 'Destaque', sample: 'Destaque!', style: { fontSize: 56, color: '#111111', bg: '#ffe14d', shadow: false } },
  { id: 'elegant', name: 'Elegante', sample: 'Elegante', style: { fontFamily: 'Playfair Display', fontSize: 72, italic: true, bold: false } },
  { id: 'retro', name: 'Retrô', sample: 'RETRÔ', style: { fontFamily: 'Anton', fontSize: 96, color: '#ff4d8d', stroke: 5, strokeColor: '#ffe14d', bold: false } },
  { id: 'hand', name: 'Manuscrito', sample: 'Bom dia', style: { fontFamily: 'Pacifico', fontSize: 70, bold: false } },
  { id: 'outline', name: 'Contorno', sample: 'CONTORNO', style: { fontFamily: 'Montserrat', fontSize: 72, stroke: 4, strokeColor: '#000000', shadow: false } },
  { id: 'mono', name: 'Código', sample: '> hello_world', style: { fontFamily: 'Roboto Mono', fontSize: 44, color: '#7dff9a', bg: 'rgba(0,0,0,0.75)', shadow: false } },
];
const CAPTION_STYLES = [
  { id: 'classic', name: 'Clássico', style: { fontFamily: 'Inter', fontSize: 36, bold: true, color: '#ffffff', bg: '', stroke: 3, strokeColor: '#000000', glow: '', shadow: true } },
  { id: 'box', name: 'Caixa', style: { fontFamily: 'Inter', fontSize: 34, bold: false, color: '#ffffff', bg: 'rgba(0,0,0,0.65)', stroke: 0, glow: '', shadow: false } },
  { id: 'yellow', name: 'Amarelo', style: { fontFamily: 'Montserrat', fontSize: 40, bold: true, color: '#ffe14d', bg: '', stroke: 4, strokeColor: '#000000', glow: '', shadow: true } },
  { id: 'neon', name: 'Neon', style: { fontFamily: 'Montserrat', fontSize: 40, bold: true, color: '#e9fffd', bg: '', stroke: 0, glow: '#1fd6cb', shadow: false } },
  { id: 'bold', name: 'Impacto', style: { fontFamily: 'Anton', fontSize: 52, bold: false, color: '#ffffff', bg: '', stroke: 5, strokeColor: '#000000', glow: '', shadow: true } },
  { id: 'hl', name: 'Marca-texto', style: { fontFamily: 'Inter', fontSize: 36, bold: true, color: '#111111', bg: '#1fd6cb', stroke: 0, glow: '', shadow: false } },
];
/** posição e tamanho compartilhados pelas legendas vinculadas */
const CAP_LAYOUT_KEYS = ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotation', 'fontSize'];
const pickCapLayout = (o) => {
  const out = {};
  for (const k of CAP_LAYOUT_KEYS) if (typeof o[k] === 'number') out[k] = o[k];
  return Object.keys(out).length ? out : null;
};
/** aplica o layout como valor fixo; propriedades animadas por keyframes na legenda ficam como estão */
const setCapLayout = (c, lay) => {
  let props = c.props;
  for (const k in lay) if (!c.keyframes?.[k]?.length && props[k] !== lay[k]) { if (props === c.props) props = { ...props }; props[k] = lay[k]; }
  return props === c.props ? c : { ...c, props };
};
const STICKER_CATS = {
  Rostos: ['😀','😂','🤣','😍','🥰','😎','🤩','🥳','🤯','😱','😭','😡','🤔','😴','🙄','😇','🤡','👻'],
  Gestos: ['👍','👎','👏','🙌','👌','✌️','🤞','🤘','👉','👈','👆','👇','💪','🙏','✋','👋','🫶','🤙'],
  Símbolos: ['❤️','💔','💯','🔥','✨','💥','⭐','⚡','✅','❌','❗','❓','➡️','⬅️','📍','💬','🔔','♻️'],
  Objetos: ['🎬','🎵','🎧','📸','🎮','💡','💰','🎁','🏆','📱','💻','🚀','⏰','📌','🎉','🎈','🍕','☕'],
  Natureza: ['☀️','🌙','🌈','⛅','❄️','🌊','🌸','🌻','🍀','🌴','🔥','🌍','🐶','🐱','🦋','🐝','🌵','🍁'],
};
const BG_COLORS = ['#000000', '#ffffff', '#1fd6cb', '#4f8cff', '#7b5cff', '#ff4d8d', '#ff6b3d', '#ffd23f', '#2bd47d', '#0f2a44', '#3b1c4a', '#2d2d2d'];
const ANIMS = [
  { id: 'none', name: 'Nenhuma' }, { id: 'fade', name: 'Fade' }, { id: 'slide', name: 'Subir' },
  { id: 'zoom', name: 'Zoom' }, { id: 'pop', name: 'Pop' }, { id: 'spin', name: 'Girar' }, { id: 'type', name: 'Digitar', textOnly: true },
];
const ADJUST_PRESETS = [
  { id: 'custom', name: 'Personalizado', v: {} },
  { id: 'teal', name: 'Cinema', v: { gContrast: 18, gSat: 10, wh_shadow_x: -30, wh_shadow_y: 5, wh_high_x: 22, wh_high_y: -13, gVignette: 30 } },
  { id: 'golden', name: 'Hora dourada', v: { gTemp: 45, gExposure: 6, gSat: 15, gHighlights: -10, gVignette: 20 } },
  { id: 'night', name: 'Noite', v: { gExposure: -25, gContrast: 20, gSat: -30, gTemp: -55, gVignette: 45 } },
  { id: 'matte', name: 'Fosco', v: { gFade: 45, gContrast: -15, gSat: -10 } },
  { id: 'punch', name: 'Contraste alto', v: { gContrast: 40, gSat: 25, gBlacks: -20 } },
  { id: 'arctic', name: 'Ártico', v: { gTemp: -40, gSat: -25, gExposure: 8, gHighlights: 10 } },
  { id: 'mono', name: 'Mono suave', v: { gSat: -100, gContrast: 12, gVignette: 30 } },
  { id: 'film', name: 'Filme', v: { gFade: 30, gGrain: 35, gTemp: 15, gContrast: 8 } },
];

/* =====================================================================
   Ícones (traçados no estilo lucide)
   ===================================================================== */
const circ = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
const rrect = (x, y, w, h, r) => `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;
const ICONS = {
  play: { fill: true, d: ['M7 4.5v15l12.5-7.5z'] },
  pause: { fill: true, d: [rrect(6, 4.5, 4, 15, 1), rrect(14, 4.5, 4, 15, 1)] },
  scissors: { d: [circ(6, 6, 3), circ(6, 18, 3), 'M8.12 8.12 12 12', 'M20 4 8.12 15.88', 'M14.8 14.8 20 20'] },
  splitL: { d: ['M12 3v18', 'M8 7 4 12l4 5', 'M16 7v10'] },
  splitR: { d: ['M12 3v18', 'M16 7l4 5-4 5', 'M8 7v10'] },
  check: { d: ['M20 6 9 17l-5-5'] },
  trash: { d: ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'] },
  copy: { d: [rrect(8, 8, 14, 14, 2), 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'] },
  undo: { d: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'] },
  redo: { d: ['m15 14 5-5-5-5', 'M20 9H9.5a5.5 5.5 0 0 0 0 11H13'] },
  zoomIn: { d: [circ(11, 11, 8), 'm21 21-4.3-4.3', 'M11 8v6', 'M8 11h6'] },
  zoomOut: { d: [circ(11, 11, 8), 'm21 21-4.3-4.3', 'M8 11h6'] },
  magnet: { d: ['m6 15-4-4 6.75-6.77a7.79 7.79 0 0 1 11 11L13 22l-4-4 6.39-6.36a2.14 2.14 0 0 0-3-3L6 15', 'm5 8 4 4', 'm12 15 4 4'] },
  upload: { d: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M17 8l-5-5-5 5', 'M12 3v12'] },
  download: { d: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'] },
  film: { d: [rrect(2, 2, 20, 20, 2.5), 'M7 2v20', 'M17 2v20', 'M2 12h20', 'M2 7h5', 'M2 17h5', 'M17 17h5', 'M17 7h5'] },
  media: { d: [rrect(3, 5, 18, 14, 2), 'M10 9.5v5l4.5-2.5z'] },
  music: { d: ['M9 18V5l12-2v13', circ(6, 18, 3), circ(18, 16, 3)] },
  disc: { d: [circ(12, 12, 10), circ(12, 12, 3), 'M12 2a10 10 0 0 1 7 3'] },
  type: { d: ['M4 7V4h16v3', 'M9 20h6', 'M12 4v16'] },
  textT: { d: ['M3 6V4h11v2', 'M8.5 4v15', 'M6 19h5', 'M15 11v-1h7v1', 'M18.5 10v9', 'M17 19h3'] },
  smile: { d: [circ(12, 12, 10), 'M8 14s1.5 2 4 2 4-2 4-2', 'M9 9h.01', 'M15 9h.01'] },
  sticker: { d: ['M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5z', 'M15 3v4a2 2 0 0 0 2 2h4', 'M8 13s1.5 2 4 2 4-2 4-2'] },
  sparkles: { d: ['M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z', 'M19 2v4', 'M21 4h-4', 'M5 17v4', 'M7 19H3'] },
  star: { d: ['M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z'] },
  starFill: { fill: true, d: ['M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z'] },
  transition: { d: ['M3 4l8 8-8 8z', 'M21 4l-8 8 8 8z'] },
  captions: { d: [rrect(3, 5, 18, 14, 2), 'M7 15h4', 'M13 15h4', 'M7 11h2', 'M11 11h6'] },
  filter: { d: [circ(9, 9, 6), circ(15, 9, 6), circ(12, 15, 6)] },
  sliders: { d: ['M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M1 14h6', 'M9 8h6', 'M17 16h6'] },
  template: { d: [rrect(3, 3, 18, 18, 2), 'M3 9h18', 'M9 21V9'] },
  eye: { d: ['M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z', circ(12, 12, 3)] },
  eyeOff: { d: ['M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z', circ(12, 12, 3), 'M3 3l18 18'] },
  volume: { d: ['M11 5 6 9H2v6h4l5 4V5z', 'M15.54 8.46a5 5 0 0 1 0 7.07', 'M19.07 4.93a10 10 0 0 1 0 14.14'] },
  volumeX: { d: ['M11 5 6 9H2v6h4l5 4V5z', 'M22 9l-6 6', 'M16 9l6 6'] },
  maximize: { d: ['M8 3H5a2 2 0 0 0-2 2v3', 'M21 8V5a2 2 0 0 0-2-2h-3', 'M3 16v3a2 2 0 0 0 2 2h3', 'M16 21h3a2 2 0 0 0 2-2v-3'] },
  ruler: { d: ['M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z', 'm14.5 12.5 2-2', 'm11.5 9.5 2-2', 'm8.5 6.5 2-2', 'm17.5 15.5 2-2'] },
  plus: { d: ['M12 5v14', 'M5 12h14'] },
  x: { d: ['M18 6 6 18', 'M6 6l12 12'] },
  search: { d: [circ(11, 11, 7), 'm21 21-4.3-4.3'] },
  tag: { d: ["M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z", "M7.5 7.5h.01"] },
  blade: { d: [rrect(3, 7, 7, 10, 1.5), rrect(14, 7, 7, 10, 1.5), 'M12 3v18'] },
  ripple: { d: ['M3 8h5v8H3z', 'M16 8h5v8h-5z', 'M14 12H9', 'm11 10-2 2 2 2'] },
  freeze: { d: ['M12 2v20', 'M2 12h20', 'm4.9 4.9 14.2 14.2', 'm19.1 4.9-14.2 14.2', 'M9 3l3 3 3-3', 'M9 21l3-3 3 3'] },
  paste: { d: [rrect(5, 4, 14, 18, 2), rrect(9, 2, 6, 4, 1)] },
  curve: { d: ['M3 20C9 20 8 4 21 4', 'M3 20h.01', 'M21 4h.01'] },
  group: { d: ['M3 7V5a2 2 0 0 1 2-2h2', 'M17 3h2a2 2 0 0 1 2 2v2', 'M21 17v2a2 2 0 0 1-2 2h-2', 'M7 21H5a2 2 0 0 1-2-2v-2', 'M7 7h6v6H7z', 'M11 13v4h6v-6h-4'] },
  layerUp: { d: ['M5 21h14', 'M12 17V4', 'm7 9 5-5 5 5'] },
  layerDown: { d: ['M5 3h14', 'M12 7v13', 'm7 15 5 5 5-5'] },
  ungroup: { d: ['m12 2 10 5-10 5L2 7z', 'm2 12 4 2', 'm22 12-4 2', 'm2 17 10 5 10-5', 'M9 14.5l6-3'] },
  mainMagnet: { d: ["M3 9h6v6H3z", "M15 9h6v6h-6z", "M9 12h6", "M11 10l2 2-2 2"] },
  autoSnap: { d: ["M12 3v4", "M12 17v4", "M5 8h6v8H5z", "M13 8h6v8h-6z"] },
  linkage: { d: ["M9 17H7A5 5 0 0 1 7 7h2", "M15 7h2a5 5 0 1 1 0 10h-2", "M8 12h8"] },
  previewAxis: { d: ["M12 2v20", "M4 6h5v12H4z", "M15 6h5v12h-5z"] },
  lock: { d: ["M5 11h14v10H5z", "M8 11V7a4 4 0 0 1 8 0v4"] },
  unlock: { d: ["M5 11h14v10H5z", "M8 11V7a4 4 0 0 1 7.8-1.2"] },
  whip: { d: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", "M12 12h.01"] },
  stopwatch: { d: ["M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "M12 10v4l2 2", "M10 2h4", "M12 2v4", "M19 6l1.5-1.5"] },
  chevronR: { d: ['m9 18 6-6-6-6'] },
  chevronL: { d: ['m15 18-6-6 6-6'] },
  chevronD: { d: ['m6 9 6 6 6-6'] },
  image: { d: [rrect(3, 3, 18, 18, 2), circ(9, 9, 2), 'm21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21'] },
  skipBack: { d: ['M19 20 9 12l10-8v16z', 'M5 19V5'] },
  skipFwd: { d: ['M5 4l10 8-10 8V4z', 'M19 5v14'] },
  layers: { d: ['m12 2 10 5-10 5L2 7z', 'm2 17 10 5 10-5', 'm2 12 10 5 10-5'] },
  logo: { d: ['M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z', 'M4 8l1.5-4 14 1.5L19 8', 'M10 11.5v5l4-2.5z'] },
  wand: { d: ['M15 4V2', 'M15 16v-2', 'M8 9h2', 'M20 9h2', 'M17.8 11.8 19 13', 'M15 9h.01', 'M17.8 6.2 19 5', 'm3 21 9-9', 'M12.2 6.2 11 5'] },
  diamond: { d: ['M12 3l9 9-9 9-9-9z'] },
  diamondFill: { fill: true, d: ['M12 3l9 9-9 9-9-9z'] },
  marker: { d: ['M5 3h14v13l-7 5-7-5z'] },
  file: { d: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6'] },
  keyboard: { d: [rrect(2, 6, 20, 12, 2), 'M6 10h.01', 'M10 10h.01', 'M14 10h.01', 'M18 10h.01', 'M7 14h10'] },
  mic: { d: [rrect(9, 2, 6, 12, 3), 'M19 10v1a7 7 0 0 1-14 0v-1', 'M12 18v4'] },
  pen: { d: ['M15.7 21.3a1 1 0 0 1-1.4 0l-1.6-1.6a1 1 0 0 1 0-1.4l5.6-5.6a1 1 0 0 1 1.4 0l1.6 1.6a1 1 0 0 1 0 1.4z', 'm18 13-1.4-6.9a1 1 0 0 0-.7-.8L3.2 2a1 1 0 0 0-1.2 1.2l3.3 12.7a1 1 0 0 0 .8.7L13 18', 'm2.3 2.3 7.3 7.3', circ(11, 11, 2)] },
  hand: { d: ['M18 11V6a2 2 0 0 0-4 0v5', 'M14 10V4a2 2 0 0 0-4 0v2', 'M10 10.5V6a2 2 0 0 0-4 0v8', 'M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15'] },
  extract: { d: ['M4 14h6v6', 'M20 10h-6V4', 'm14 10 7-7', 'm3 21 7-7'] },
  png: { d: [rrect(3, 3, 18, 18, 2), 'M8 12l2.5 3L14 10l4 6H6z'] },
  reset: { d: ['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5'] },
  brush: { d: ['m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08', 'M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z'] },
  eraser: { d: ['m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21', 'M22 21H7', 'm5 11 9 9'] },
  pipette: { d: ['m2 22 1-1h3l9-9', 'M3 21v-3l9-9', 'm15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4z'] },
  wandAuto: { d: ['m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72', 'm14 7 3 3', 'M5 6v4', 'M19 14v4', 'M10 2v2', 'M7 8H3', 'M21 16h-4', 'M11 3H9'] },
  invert: { d: [circ(12, 12, 9), 'M12 3v18', 'M12 3a9 9 0 0 1 0 18z'] },
  mNone: { d: [circ(12, 12, 9), 'M5.6 5.6l12.8 12.8'] },
  mLinear: { d: [rrect(3, 3, 18, 18, 2), 'M3 12h18'] },
  mFilm: { d: [rrect(3, 3, 18, 18, 2), 'M3 9h18', 'M3 15h18'] },
  mCircle: { d: [circ(12, 12, 8)] },
  mRect: { d: [rrect(4, 4, 16, 16, 1)] },
  mStar: { d: ['M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z'] },
  mHeart: { d: ['M12 20s-8-4.6-8-10.2A4.3 4.3 0 0 1 12 7.5a4.3 4.3 0 0 1 8 2.3C20 15.4 12 20 12 20z'] },
  mText: { d: ['M5 6h14', 'M12 6v13', 'M9 19h6'] },
};
function Icon({ name, size = 18, stroke = 1.8 }) {
  const ic = ICONS[name];
  if (!ic) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={ic.fill ? 'currentColor' : 'none'} stroke={ic.fill ? 'none' : 'currentColor'}
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ic.d.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}
