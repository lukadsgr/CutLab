/* =====================================================================
   Editor de keyframes (estilo After Effects)
   - Folha de keyframes: uma linha por propriedade animada + linha "Todas"
     · clique seleciona (Shift/Ctrl soma), arraste move (encaixa em quadros), caixa de seleção no vazio
     · clique duplo numa linha cria keyframe ali; clique no vazio leva a agulha
     · o desenho do diamante mostra a interpolação de cada lado: ◆ linear, ● suave, ■ congelar
   - Atalhos: F9 Easy Ease · Shift+F9 suavizar entrada · Ctrl+Shift+F9 suavizar saída · Delete apaga
     Ctrl+C / Ctrl+V copia e cola no cursor · Ctrl+A seleciona tudo · Alt+←/→ empurra um quadro
   - Gráfico: o editor de curvas (valor × tempo, alças Bézier) da propriedade escolhida
   Tudo passa pelo histórico: Ctrl+Z desfaz cada mudança.
   ===================================================================== */
const openKeyframes = () => window.dispatchEvent(new Event('cutlab-keyframes'));

/* lado de saída (out) de um keyframe = começo do trecho dele; lado de entrada (in) = fim do trecho anterior */
const EASE_OUT = { ease: [0.333, 0], linear: [0.333, 0.333] };
const EASE_IN = { ease: [0.667, 1], linear: [0.667, 0.667] };
/** tipo de cada lado para o desenho: 'linear' | 'ease' | 'hold' */
function kfSides(list, i) {
  const side = (f, which) => {
    if (!f) return null;
    if (f.ease === 'hold') return which === 'out' ? 'hold' : 'linear';
    if (f.ease === 'spring') return 'ease';
    const bz = bzOf(f);
    return which === 'out' ? (Math.abs(bz[1] - bz[0]) < 0.06 ? 'linear' : 'ease') : (Math.abs(bz[3] - bz[2]) < 0.06 ? 'linear' : 'ease');
  };
  const out = i < list.length - 1 ? side(list[i], 'out') : null;
  const inn = i > 0 ? side(list[i - 1], 'in') : null;
  return { in: inn || out || 'linear', out: out || inn || 'linear' };
}
const KF_HALF = {
  l: { linear: 'M6 0 L0 6 L6 12 Z', ease: 'M6 0 A6 6 0 0 0 6 12 Z', hold: 'M6 1 L1 1 L1 11 L6 11 Z' },
  r: { linear: 'M6 0 L12 6 L6 12 Z', ease: 'M6 0 A6 6 0 0 1 6 12 Z', hold: 'M6 1 L11 1 L11 11 L6 11 Z' },
};
/** troca um lado da curva de um trecho (converte curvas com nome em Bézier quando precisa) */
function setSide(f, which, kind) {
  const bz = f.ease === 'hold' || f.ease === 'spring' ? [0.333, 0.333, 0.667, 0.667] : [...bzOf(f)];
  if (which === 'out') [bz[0], bz[1]] = EASE_OUT[kind]; else [bz[2], bz[3]] = EASE_IN[kind];
  const lin = bz.join() === '0.333,0.333,0.667,0.667';
  const { bz: _b, sp: _s, ...rest } = f;
  return lin ? { ...rest, ease: 'linear' } : { ...rest, ease: 'bezier', bz };
}
/** aplica uma interpolação aos keyframes selecionados de uma lista (índices em `sel`) */
function applyInterp(list, sel, mode) {
  const out = list.map((f) => ({ ...f }));
  for (const i of sel) {
    if (mode === 'hold' || mode === 'spring') { if (i < out.length - 1) { const { bz, ...r } = out[i]; out[i] = { ...r, ease: mode }; } continue; }
    const kind = mode === 'linear' ? 'linear' : 'ease';
    const doIn = mode === 'easy' || mode === 'in' || mode === 'linear', doOut = mode === 'easy' || mode === 'out' || mode === 'linear';
    if (doOut && i < out.length - 1) out[i] = setSide(out[i], 'out', kind);
    if (doIn && i > 0) out[i - 1] = setSide(out[i - 1], 'in', kind);
  }
  return out;
}

/** propriedades que dá para animar em cada tipo de clipe (para "Animar propriedade") */
function animatableProps(c) {
  if (c.type === 'audio') return ['volume'];
  if (c.type === 'effect') return ['intensity'];
  if (c.type === 'adjust') return ['brightness', 'contrast', 'saturation', 'hue', 'blur'];
  const base = ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotation', 'opacity', 'blur', 'brightness', 'contrast', 'saturation', 'hue'];
  if (c.type === 'text') base.push('fontSize');
  if (c.type === 'video') base.push('volume');
  if (c.props.maskOn) base.push('maskX', 'maskY', 'maskW', 'maskH', 'maskRot', 'maskFeather');
  return base;
}
const kfKey = (prop, t) => `${prop}|${t.toFixed(4)}`;
let kfClipboard = null;   // { items: [{ prop, dt, f }] } — keyframes copiados (entre clipes também)

function KeyframeEditor({ clip, local, onPatch, onSeek, onAddDefault, onClose }) {
  const kfs = clip.keyframes || {};
  const props = Object.keys(kfs).filter((k) => kfs[k]?.length);
  const [view, setView] = useState('sheet');
  const [graphProp, setGraphProp] = useState(null);
  const gp = props.includes(graphProp) ? graphProp : props[0];
  const [sel, setSel] = useState(() => new Set());
  const [marq, setMarq] = useState(null);
  const [menu, setMenu] = useState(null);   // menu de interpolação (botão direito)
  const [addOpen, setAddOpen] = useState(false);
  const areaRef = useRef();
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, [view, props.length > 0]);
  // seleção só com o que ainda existe
  const valid = useMemo(() => new Set(props.flatMap((p) => kfs[p].map((f) => kfKey(p, f.t)))), [kfs]);
  const selNow = useMemo(() => new Set([...sel].filter((k) => valid.has(k))), [sel, valid]);
  const selRef = useRef(selNow);
  selRef.current = selNow;
  const clipRef = useRef(clip);
  clipRef.current = clip;
  const localRef = useRef(local);
  localRef.current = local;

  const T1 = Math.max(clip.duration, 0.1), PAD = 12, iw = Math.max(40, w - PAD * 2);
  const X = (t) => PAD + (t / T1) * iw;
  const tOf = (px) => clamp(((px - PAD) / iw) * T1, 0, T1);
  const ROW = 26, RULER_H = 22;   // altura das linhas e da régua da folha
  const rows = ['*', ...props];

  /* ----- operações (todas viram um passo do histórico) ----- */
  const selIdx = (keys, p) => kfs[p].map((f, i) => (keys.has(kfKey(p, f.t)) ? i : -1)).filter((i) => i >= 0);
  const interp = (mode) => {
    const keys = selRef.current;
    if (!keys.size) return;
    const next = { ...kfs };
    for (const p of props) { const ix = selIdx(keys, p); if (ix.length) next[p] = applyInterp(kfs[p], ix, mode); }
    onPatch({ keyframes: next });
    setMenu(null);
  };
  const removeSel = () => {
    const keys = selRef.current, c = clipRef.current;
    if (!keys.size) return;
    const next = { ...c.keyframes }, propsOut = { ...c.props };
    for (const p of Object.keys(next)) {
      const rest = next[p].filter((f) => !keys.has(kfKey(p, f.t)));
      if (rest.length === next[p].length) continue;
      // sem keyframes sobrando, o valor no cursor vira o valor fixo
      if (!rest.length) { propsOut[p] = kfValueAt(next[p], localRef.current); delete next[p]; } else next[p] = rest;
    }
    onPatch({ keyframes: next, props: propsOut });
    setSel(new Set());
  };
  const copySel = () => {
    const keys = selRef.current, c = clipRef.current;
    const items = [];
    for (const p of Object.keys(c.keyframes || {})) for (const f of c.keyframes[p]) if (keys.has(kfKey(p, f.t))) items.push({ prop: p, f });
    if (!items.length) return false;
    const t0 = Math.min(...items.map((x) => x.f.t));
    kfClipboard = { items: items.map((x) => ({ prop: x.prop, dt: x.f.t - t0, f: x.f })) };
    return true;
  };
  const paste = () => {
    if (!kfClipboard) return false;
    const c = clipRef.current, at = localRef.current;
    const next = { ...(c.keyframes || {}) }, keys = new Set();
    for (const { prop, dt, f } of kfClipboard.items) {
      const t = roundFrame(at + dt);
      if (t > c.duration + KF_EPS) continue;
      next[prop] = [...(next[prop] || []).filter((x) => Math.abs(x.t - t) >= KF_EPS), { ...f, t }].sort((a, b) => a.t - b.t);
      keys.add(kfKey(prop, t));
    }
    onPatch({ keyframes: next });
    setSel(keys);
    return true;
  };
  const nudge = (d) => {
    const keys = selRef.current;
    if (!keys.size) return;
    moveSel(kfs, keys, d * FRAME);
  };
  /** move os keyframes `keys` em dt a partir de `base` (quem estiver no destino é substituído) */
  const moveSel = (base, keys, dt, key) => {
    const ts = props.flatMap((p) => (base[p] || []).filter((f) => keys.has(kfKey(p, f.t))).map((f) => f.t));
    if (!ts.length) return keys;
    dt = clamp(dt, -Math.min(...ts), T1 - Math.max(...ts));
    dt = Math.round(dt * FPS) / FPS;
    const next = { ...base }, moved = new Set();
    for (const p of Object.keys(base)) {
      const mv = base[p].filter((f) => keys.has(kfKey(p, f.t))).map((f) => ({ ...f, t: roundFrame(f.t + dt) }));
      if (!mv.length) continue;
      const stay = base[p].filter((f) => !keys.has(kfKey(p, f.t)) && !mv.some((m) => Math.abs(m.t - f.t) < KF_EPS));
      next[p] = [...stay, ...mv].sort((a, b) => a.t - b.t);
      for (const m of mv) moved.add(kfKey(p, m.t));
    }
    onPatch({ keyframes: next }, key);
    setSel(moved);
    return moved;
  };
  const addAt = (prop, t) => {
    const c = clipRef.current;
    t = roundFrame(clamp(t, 0, c.duration));
    if (prop === '*') {
      let out = c;
      for (const p of props) if (!kfAtTime(out, p, t)) out = toggleKf(out, p, t);
      onPatch({ keyframes: out.keyframes });
      setSel(new Set(props.map((p) => kfKey(p, t))));
      return;
    }
    if (kfAtTime(c, prop, t)) return;
    onPatch({ keyframes: toggleKf(c, prop, t).keyframes });
    setSel(new Set([kfKey(prop, t)]));
  };
  const animate = (prop) => {
    setAddOpen(false);
    const c = clipRef.current;
    onPatch({ keyframes: toggleKf(c, prop, roundFrame(localRef.current)).keyframes });
  };
  /** valor ou tempo do único keyframe selecionado */
  const one = selNow.size === 1 ? (() => { const [k] = selNow; const [p, ts] = k.split('|'); const i = (kfs[p] || []).findIndex((f) => kfKey(p, f.t) === k); return i >= 0 ? { p, i, f: kfs[p][i] } : null; })() : null;
  const editOne = (patch) => {
    if (!one) return;
    const list = kfs[one.p];
    if (patch.t != null) {
      const t = roundFrame(clamp(patch.t, 0, clip.duration));
      if (list.some((f, j) => j !== one.i && Math.abs(f.t - t) < KF_EPS)) return;
      onPatch({ keyframes: { ...kfs, [one.p]: list.map((f, j) => (j === one.i ? { ...f, t } : f)).sort((a, b) => a.t - b.t) } });
      setSel(new Set([kfKey(one.p, t)]));
      return;
    }
    onPatch({ keyframes: { ...kfs, [one.p]: list.map((f, j) => (j === one.i ? { ...f, ...patch } : f)) } }, `kfv:${clip.id}:${one.p}`);
  };

  /* ----- teclado: fase de captura para Delete/Ctrl+C/V não chegarem à linha do tempo ----- */
  useEffect(() => {
    const k = (e) => {
      if (isTypingTarget(e.target) || document.querySelector('.modal-back, .tour-back')) return;
      const mod = e.ctrlKey || e.metaKey, has = selRef.current.size > 0;
      const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
      if (e.key === 'F9') { stop(); interp(e.shiftKey && mod ? 'out' : e.shiftKey ? 'in' : 'easy'); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && has) { stop(); removeSel(); }
      else if (mod && e.key.toLowerCase() === 'c' && has) { if (copySel()) stop(); }
      else if (mod && e.key.toLowerCase() === 'v' && kfClipboard) { stop(); paste(); }
      else if (mod && e.key.toLowerCase() === 'a') { stop(); setSel(new Set(valid)); }
      else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && has) { stop(); nudge(e.key === 'ArrowLeft' ? -1 : 1); }
      else if (e.key === 'Escape' && (menu || addOpen)) { stop(); setMenu(null); setAddOpen(false); }
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  });

  /* ----- ponteiro na folha ----- */
  const keysAtRow = (p, t) => (p === '*' ? props.filter((q) => kfAtTime(clip, q, t)).map((q) => kfKey(q, t)) : [kfKey(p, t)]);
  const downKf = (e, p, t) => {
    if (e.button === 2) return;
    e.preventDefault();
    e.stopPropagation();
    const mine = keysAtRow(p, t), add = e.shiftKey || e.ctrlKey || e.metaKey;
    let keys = selNow;
    const already = mine.every((k) => selNow.has(k));
    if (add) { keys = new Set(selNow); if (already && e.ctrlKey) mine.forEach((k) => keys.delete(k)); else mine.forEach((k) => keys.add(k)); }
    else if (!already) keys = new Set(mine);
    setSel(keys);
    const sx = e.clientX, base = kfs, key = 'kfe:' + uid();
    let moved = false;
    const move = (ev) => {
      if (!moved && Math.abs(ev.clientX - sx) < 3) return;
      moved = true;
      moveSel(base, keys, ((ev.clientX - sx) / iw) * T1, key);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!moved && !add) { setSel(new Set(mine)); onSeek(t); }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const downArea = (e) => {
    if (e.button !== 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    const ax = e.clientX - r.left, ay = e.clientY - r.top + e.currentTarget.scrollTop;
    const add = e.shiftKey || e.ctrlKey || e.metaKey, base = add ? new Set(selNow) : new Set();
    let moved = false;
    const move = (ev) => {
      const bx = ev.clientX - r.left, by = ev.clientY - r.top + e.currentTarget.scrollTop;
      if (!moved && Math.hypot(bx - ax, by - ay) < 4) return;
      moved = true;
      const box = { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
      setMarq(box);
      const keys = new Set(base);
      rows.forEach((p, ri) => {
        const cy = RULER_H + ri * ROW + ROW / 2;
        if (cy < box.y || cy > box.y + box.h) return;
        const ts = p === '*' ? kfTimes(clip) : kfs[p].map((f) => f.t);
        for (const t of ts) { const x = X(t); if (x >= box.x && x <= box.x + box.w) keysAtRow(p, t).forEach((k) => keys.add(k)); }
      });
      setSel(keys);
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setMarq(null);
      if (!moved) { if (!add) setSel(new Set()); onSeek(tOf(ev.clientX - r.left)); }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const dblArea = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const ri = Math.floor((e.clientY - r.top + e.currentTarget.scrollTop - RULER_H) / ROW);
    if (rows[ri]) addAt(rows[ri], tOf(e.clientX - r.left));
  };

  /* ----- desenho ----- */
  const Diamond = ({ p, list, i, t }) => {
    const s = p === '*' ? { in: 'linear', out: 'linear' } : kfSides(list, i);
    const on = keysAtRow(p, t).every((k) => selNow.has(k));
    return (
      <svg className={`kfe-kf ${on ? 'on' : ''} ${p === '*' ? 'sum' : ''}`} width="12" height="12" viewBox="0 0 12 12" style={{ left: X(t) - 6 }}
        onPointerDown={(e) => downKf(e, p, t)} onDoubleClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (!on) setSel(new Set(keysAtRow(p, t))); setMenu({ x: e.clientX, y: e.clientY }); }}>
        <title>{p === '*' ? `Keyframes em ${fmt(clip.start + t)}` : `${PROP_LABELS[p] || p}: ${+list[i].v.toFixed(2)} em ${fmt(clip.start + t)}`}</title>
        <path d={KF_HALF.l[s.in]} /><path d={KF_HALF.r[s.out]} />
      </svg>
    );
  };
  const valueAt = (p) => +propAt(clip, p, local).toFixed(2);
  const navTo = (p, dir) => {
    const ts = (p === '*' ? kfTimes(clip) : kfs[p].map((f) => f.t));
    const t = dir > 0 ? ts.find((x) => x > local + KF_EPS) : [...ts].reverse().find((x) => x < local - KF_EPS);
    if (t != null) onSeek(t);
  };
  const canAdd = animatableProps(clip).filter((p) => !props.includes(p));
  const interpBtns = [
    ['easy', 'Easy Ease', 'Suaviza a entrada e a saída (F9)', [0.333, 0, 0.667, 1]],
    ['in', 'Suavizar entrada', 'Chega devagar no keyframe (Shift+F9)', [0.333, 0.333, 0.667, 1]],
    ['out', 'Suavizar saída', 'Sai devagar do keyframe (Ctrl+Shift+F9)', [0.333, 0, 0.667, 0.667]],
    ['linear', 'Linear', 'Velocidade constante', [0, 0, 1, 1]],
    ['hold', 'Congelar', 'Mantém o valor até o próximo keyframe', null],
    ['spring', 'Mola', 'Passa do ponto e volta balançando', 'spring'],
  ];

  return (
    <div className="kf-editor" role="dialog" aria-label="Editor de keyframes">
      <div className="ce-head">
        <Icon name="diamond" size={14} stroke={2} />
        <b>Keyframes</b>
        <span className="ce-clip">{clip.name || clip.props.text?.slice(0, 24) || ''}</span>
        <div className="seg kfe-views">
          <button className={view === 'sheet' ? 'on' : ''} onClick={() => setView('sheet')}>Folha</button>
          <button className={view === 'graph' ? 'on' : ''} disabled={!props.length} onClick={() => setView('graph')}>Gráfico</button>
        </div>
        {view === 'sheet' && props.length > 0 && (
          <div className="kfe-tools">
            {interpBtns.map(([id, name, tip, bz]) => (
              <button key={id} className="chip" disabled={!selNow.size} title={tip} onClick={() => interp(id)}>
                <EaseIcon bz={Array.isArray(bz) ? bz : null} fn={bz === 'spring' ? springFn() : null} /> {name}
              </button>
            ))}
            <span className="tl-sep" />
            <button className="icon-btn" title="Copiar keyframes (Ctrl+C)" disabled={!selNow.size} onClick={copySel}><Icon name="copy" size={14} /></button>
            <button className="icon-btn" title="Colar no cursor (Ctrl+V)" disabled={!kfClipboard} onClick={paste}><Icon name="clipboard" size={14} /></button>
            <button className="icon-btn" title="Excluir selecionados (Delete)" disabled={!selNow.size} onClick={removeSel}><Icon name="trash" size={14} /></button>
          </div>
        )}
        <button className="icon-btn" title="Fechar (Esc ou G)" onClick={onClose}><Icon name="x" size={14} /></button>
      </div>

      {!props.length ? (
        <div className="kfe-empty">
          <p>Este clipe ainda não tem keyframes. Crie o primeiro no cursor e depois mude a agulha de lugar e altere um valor: o CutLab cria os próximos sozinho.</p>
          <div className="row">
            <button className="btn btn-primary" onClick={onAddDefault}><Icon name="diamond" size={13} stroke={2} /> Keyframe de transformação no cursor</button>
            <AnimateMenu open={addOpen} setOpen={setAddOpen} list={canAdd} onPick={animate} />
          </div>
        </div>
      ) : view === 'graph' ? (
        <div className="kfe-graph">
          <div className="ce-props">
            {props.map((k) => <button key={k} className={`chip ${k === gp ? 'on' : ''}`} onClick={() => setGraphProp(k)}>{PROP_LABELS[k] || k}</button>)}
          </div>
          <KeyframeCurves embedded propName={gp} clip={clip} local={local} onChange={(next, key) => onPatch({ keyframes: next }, key)} onSeek={onSeek} onClose={onClose} />
        </div>
      ) : (
        <div className="kfe-body">
          <div className="kfe-names">
            <div className="kfe-ruler-pad"><AnimateMenu open={addOpen} setOpen={setAddOpen} list={canAdd} onPick={animate} small /></div>
            {rows.map((p) => (
              <div key={p} className={`kfe-name ${p === '*' ? 'sum' : ''}`}>
                <span className="nm" title={p === '*' ? 'Todas as propriedades: mover aqui move tudo junto' : PROP_LABELS[p] || p}>{p === '*' ? 'Todas' : PROP_LABELS[p] || p}</span>
                {p !== '*' && <span className="val"><Scrub value={valueAt(p)} step={p === 'x' || p === 'y' ? 0.2 : 0.5} digits={2}
                  onChange={(v) => onPatch({ keyframes: applyPatch(clipRef.current, { [p]: v }, roundFrame(localRef.current)).keyframes }, `kfs:${clip.id}:${p}`)} /></span>}
                <span className="nav">
                  <button onClick={() => navTo(p, -1)} title="Keyframe anterior">◀</button>
                  <button className={(p === '*' ? props.some((q) => kfAtTime(clip, q, local)) : kfAtTime(clip, p, local)) ? 'on' : ''}
                    onClick={() => { if (p === '*') { addAt('*', local); return; } const r = toggleKf(clipRef.current, p, roundFrame(local)); onPatch({ keyframes: r.keyframes, props: r.props }); }}
                    title="Criar/remover keyframe no cursor">◆</button>
                  <button onClick={() => navTo(p, 1)} title="Próximo keyframe">▶</button>
                </span>
              </div>
            ))}
          </div>
          <div className="kfe-area" ref={areaRef} onPointerDown={downArea} onDoubleClick={dblArea}>
            <div className="kfe-ruler">
              {Array.from({ length: Math.floor(T1 / niceStep(T1 / 8)) + 1 }, (_, i) => i * niceStep(T1 / 8)).map((t) => (
                <span key={t} style={{ left: X(t) }}>{fmtDur(t)}</span>
              ))}
            </div>
            <div className="kfe-rows" style={{ height: rows.length * ROW }}>
              {rows.map((p, ri) => (
                <div key={p} className={`kfe-row ${p === '*' ? 'sum' : ''}`} style={{ top: ri * ROW, height: ROW }}>
                  {p === '*' ? kfTimes(clip).map((t) => <Diamond key={t} p="*" t={t} />)
                    : kfs[p].map((f, i) => <Diamond key={f.t} p={p} list={kfs[p]} i={i} t={f.t} />)}
                  {/* trechos entre keyframes: cor indica a curva */}
                  {p !== '*' && kfs[p].slice(0, -1).map((f, i) => <i key={'s' + i} className={`kfe-span ${f.ease === 'hold' ? 'hold' : ''}`} style={{ left: X(f.t), width: X(kfs[p][i + 1].t) - X(f.t) }} />)}
                </div>
              ))}
              {marq && <div className="kfe-marq" style={{ left: marq.x, top: marq.y - RULER_H, width: marq.w, height: marq.h }} />}
            </div>
            <div className="kfe-head" style={{ left: X(local) }} />
          </div>
        </div>
      )}

      {view === 'sheet' && props.length > 0 && (
        <div className="ce-foot kfe-foot">
          {one ? (<>
            <span className="ce-seg-lbl">{PROP_LABELS[one.p] || one.p}</span>
            <label className="kfe-field">Tempo <NumField value={+(one.f.t).toFixed(3)} step={FRAME} suffix="s" onCommit={(v) => editOne({ t: v })} /></label>
            <label className="kfe-field">Valor <NumField value={+one.f.v.toFixed(3)} step={1} onCommit={(v) => editOne({ v })} /></label>
            {one.i < kfs[one.p].length - 1 && <span className="kbd">curva: {one.f.ease === 'bezier' ? `cubic-bezier(${one.f.bz.join(', ')})` : (EASES[one.f.ease]?.name || one.f.ease)}</span>}
          </>) : (
            <span className="hint">{selNow.size ? `${selNow.size} keyframes selecionados — arraste para mover, F9 suaviza, Delete apaga` : 'Clique num keyframe para selecionar (Shift soma, arraste no vazio para uma caixa) · clique duplo numa linha cria um keyframe'}</span>
          )}
        </div>
      )}
      {menu && ReactDOM.createPortal(<>
        <div className="kfe-menu-back" onPointerDown={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
        <div className="kfe-menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
          {interpBtns.map(([id, name, tip]) => <button key={id} onClick={() => interp(id)} title={tip}>{name}</button>)}
          <div className="menu-sep" />
          <button onClick={() => { copySel(); setMenu(null); }}>Copiar</button>
          <button onClick={() => { removeSel(); setMenu(null); }}>Excluir</button>
        </div>
      </>, document.body)}
    </div>
  );
}

/** botão "Animar propriedade": cria o primeiro keyframe de uma propriedade no cursor */
function AnimateMenu({ open, setOpen, list, onPick, small }) {
  if (!list.length) return null;
  return (
    <div className="kfe-add">
      <button className={small ? 'chip' : 'btn'} onClick={() => setOpen(!open)}><Icon name="plus" size={12} /> Animar propriedade</button>
      {open && (
        <div className="kfe-add-list">
          {list.map((p) => <button key={p} onClick={() => onPick(p)}>{PROP_LABELS[p] || p}</button>)}
        </div>
      )}
    </div>
  );
}

/** campo numérico que só aplica ao confirmar (Enter ou sair do campo) */
function NumField({ value, step = 1, suffix, onCommit }) {
  const [txt, setTxt] = useState(null);
  const shown = txt ?? String(value);
  const done = () => { if (txt != null) { const v = parseFloat(txt.replace(',', '.')); if (Number.isFinite(v)) onCommit(v); } setTxt(null); };
  return (<>
    <input className="kfe-num" value={shown} step={step} onChange={(e) => setTxt(e.target.value)} onBlur={done}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { setTxt(null); e.currentTarget.blur(); } }} />
    {suffix && <span className="kfe-suf">{suffix}</span>}
  </>);
}
