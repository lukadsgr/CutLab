/* =====================================================================
   Histórico (desfazer/refazer) com agrupamento de gestos
   ===================================================================== */
/** mudanças com a mesma chave viram um passo só enquanto o gesto continua; uma pausa maior que esta
 *  começa um passo novo (ex.: mexer no mesmo slider em dois keyframes diferentes = dois passos) */
const GESTURE_GAP = 700;
/** chaves de um gesto só ('drag:' + uid()) nunca expiram: o arraste pode parar um pouco antes de soltar */
const oneShotKey = (k) => /^[a-z]+:[a-z0-9]{8}$/.test(k);
function useHistory(initial) {
  const [h, setH] = useState({ past: [], present: initial, future: [], key: null, at: 0 });
  const set = useCallback((updater, key = null) => setH((s) => {
    const next = typeof updater === 'function' ? updater(s.present) : updater;
    if (next === s.present) return s;
    const now = performance.now();
    if (key && key === s.key && (oneShotKey(key) || now - s.at < GESTURE_GAP)) return { ...s, present: next, at: now };
    return { past: [...s.past.slice(-99), s.present], present: next, future: [], key, at: now };
  }), []);
  const undo = useCallback(() => setH((s) => s.past.length
    ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future], key: null } : s), []);
  const redo = useCallback(() => setH((s) => s.future.length
    ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1), key: null } : s), []);
  /** troca todo o conteúdo sem entrar no histórico (abrir projeto) */
  const reset = useCallback((clips) => setH({ past: [], present: clips, future: [], key: null }), []);
  /** altera o conteúdo atual sem criar passo de desfazer (estado de interface guardado no projeto) */
  const replace = useCallback((fn) => setH((s) => ({ ...s, present: fn(s.present) })), []);
  return { clips: h.present, set, reset, replace, undo, redo, canUndo: h.past.length > 0, canRedo: h.future.length > 0 };
}


/** tamanho da janela, atualizado ao redimensionar (ou ao mudar o zoom do navegador) */
function useViewport() {
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return vp;
}

/**
 * Encaixa os painéis laterais e a linha do tempo na janela atual.
 * Os tamanhos salvos são o desejado; em telas menores eles encolhem
 * proporcionalmente para que o reprodutor nunca fique espremido.
 */
function fitLayout(vp, leftW, rightW, tlH) {
  const avail = vp.w - 26;                                  // margens + divisórias
  const playerMin = Math.max(360, avail * 0.38);
  const budget = Math.max(560, avail - playerMin);
  const k = Math.min(1, budget / (leftW + rightW));
  const left = Math.max(280, Math.round(leftW * k));
  const right = Math.max(250, Math.round(rightW * k));
  const tl = Math.round(Math.min(tlH, Math.max(170, vp.h * 0.42)));
  return { left, right, tl };
}

/** número salvo no navegador (tamanho dos painéis etc.) */
function useStoredNumber(key, initial) {
  const [v, setV] = useState(() => {
    try { const n = parseFloat(localStorage.getItem(key)); return isNaN(n) ? initial : n; } catch { return initial; }
  });
  const set = useCallback((n) => setV((old) => {
    const next = typeof n === 'function' ? n(old) : n;
    try { localStorage.setItem(key, String(next)); } catch { /* armazenamento indisponível */ }
    return next;
  }), [key]);
  return [v, set];
}
