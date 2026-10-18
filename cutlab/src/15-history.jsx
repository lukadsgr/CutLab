/* =====================================================================
   Histórico (desfazer/refazer) com agrupamento de gestos
   ===================================================================== */
function useHistory(initial) {
  const [h, setH] = useState({ past: [], present: initial, future: [], key: null });
  const set = useCallback((updater, key = null) => setH((s) => {
    const next = typeof updater === 'function' ? updater(s.present) : updater;
    if (next === s.present) return s;
    if (key && key === s.key) return { ...s, present: next };
    return { past: [...s.past.slice(-99), s.present], present: next, future: [], key };
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
