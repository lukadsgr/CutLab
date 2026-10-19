/* =====================================================================
   Editor de transições personalizadas
   - três grupos de trilhas: Sai (A), Entra (B) e Por cima (flash, tremor)
   - mexer num valor cria um keyframe no ponto da agulha; arraste os
     losangos para mudar o tempo, clique duplo para apagar
   - pré-visualização em loop com o mesmo interpretador do vídeo final
   ===================================================================== */
const TR_NEW = () => normalizeTransition({
  id: 'u:' + uid(), name: 'Minha transição', duration: 0.6, motionBlur: 50,
  B: { opacity: [{ t: 0, v: 0, ease: 'smooth' }, { t: 1, v: 100 }] },
});
const TR_GROUPS = [
  { id: 'A', label: 'Sai (A)', color: '#ff9a5a' },
  { id: 'B', label: 'Entra (B)', color: '#38c6d9' },
  { id: 'over', label: 'Por cima', color: '#ffd166' },
];
const trGroupProps = (g, def) => (g === 'over' ? TR_OVER_PROPS : g === 'B' && def.reveal !== 'none' ? [...TR_LAYER_PROPS, TR_REVEAL_PROP] : TR_LAYER_PROPS);
const TR_SNAP = 0.015;

/** quadros de exemplo grandes e fáceis de acompanhar (A quente, B frio, com letras) */
let _trSamples;
function trEditorSamples(W, H) {
  if (_trSamples?.W === W) return _trSamples;
  const mk = (stops, letter, sun) => {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, H);
    stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s));
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.fillStyle = sun; x.beginPath(); x.arc(W * 0.72, H * 0.3, H * 0.12, 0, 7); x.fill();
    x.fillStyle = 'rgba(0,0,0,.35)';
    x.beginPath(); x.moveTo(0, H * 0.8); x.lineTo(W * 0.3, H * 0.5); x.lineTo(W * 0.5, H * 0.68); x.lineTo(W * 0.75, H * 0.48); x.lineTo(W, H * 0.72); x.lineTo(W, H); x.lineTo(0, H); x.fill();
    x.fillStyle = '#fff'; x.font = `700 ${H * 0.42}px Geist, Inter, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.shadowColor = 'rgba(0,0,0,.4)'; x.shadowBlur = H * 0.04;
    x.fillText(letter, W * 0.32, H * 0.42);
    // grade fina: deixa o movimento e o desfoque fáceis de ver
    x.shadowBlur = 0; x.strokeStyle = 'rgba(255,255,255,.12)'; x.lineWidth = 1;
    for (let i = 1; i < 8; i++) { x.beginPath(); x.moveTo((W * i) / 8, 0); x.lineTo((W * i) / 8, H); x.stroke(); }
    return c;
  };
  _trSamples = { W, a: mk(['#ff9a5a', '#e2557d', '#5b2a86'], 'A', '#ffe7a8'), b: mk(['#9fe8ff', '#1fb5c9', '#0b4f6c'], 'B', '#f4f1e8') };
  return _trSamples;
}

function TransitionEditor({ initial, applyTo, onSave, onClose }) {
  const [def, setDef] = useState(() => normalizeTransition(initial || TR_NEW()));
  const [u, setU] = useState(0.5);
  const [playing, setPlaying] = useState(true);
  const [sel, setSel] = useState(null);   // { g, prop, key } — o próprio objeto do keyframe
  const [dirty, setDirty] = useState(false);
  const cvRef = useRef();
  const defRef = useRef(def); defRef.current = def;
  const uRef = useRef(u); uRef.current = u;
  const fn = useMemo(() => makeTransitionFn(def), [def]);
  const fnRef = useRef(fn); fnRef.current = fn;
  const W = 640, H = 360;

  const edit = (f) => { setDef((d) => f(structuredClone(d))); setDirty(true); };
  const set = (patch) => edit((d) => Object.assign(d, patch));

  // pré-visualização: toca em loop com uma pausa curta nas pontas
  useEffect(() => {
    const cv = cvRef.current, ctx = cv.getContext('2d');
    const { a, b } = trEditorSamples(W, H);
    let raf, t0 = performance.now() - uRef.current * defRef.current.duration * 1000;
    const draw = (p) => { ctx.save(); clearBlack(ctx, W, H); fnRef.current(ctx, a, b, p, W, H, defRef.current.duration); ctx.restore(); };
    const loop = () => {
      const d = defRef.current.duration, cyc = d + 0.8;
      const local = (((performance.now() - t0) / 1000) % cyc) - 0.4;
      const p = clamp(local / d, 0, 1);
      setU(p);
      draw(p);
      raf = requestAnimationFrame(loop);
    };
    if (playing) loop(); else draw(uRef.current);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  // parado: redesenha ao mexer
  useEffect(() => {
    if (playing) return;
    const ctx = cvRef.current.getContext('2d'), { a, b } = trEditorSamples(W, H);
    ctx.save(); clearBlack(ctx, W, H); fn(ctx, a, b, u, W, H, def.duration); ctx.restore();
  }, [fn, u, playing]);

  const keyAt = (list, t) => list?.find((k) => Math.abs(k.t - t) < 0.005);
  const seek = (t) => { setPlaying(false); setU(clamp(t, 0, 1)); };
  /** valor novo no ponto da agulha: atualiza o keyframe dali ou cria um */
  const setValue = (g, prop, v) => edit((d) => {
    const list = (d[g][prop] ||= []);
    const k = keyAt(list, u);
    if (k) k.v = v; else list.push({ t: u, v, ease: 'smooth' });
    list.sort((x, y) => x.t - y.t);
    return d;
  });
  const toggleKey = (g, prop) => edit((d) => {
    const list = (d[g][prop] ||= []);
    const k = keyAt(list, u);
    if (k) list.splice(list.indexOf(k), 1);
    else { list.push({ t: u, v: trValue(defRef.current[g], prop, u), ease: 'smooth' }); list.sort((x, y) => x.t - y.t); }
    if (!list.length) delete d[g][prop];
    return d;
  });
  const clearTrack = (g, prop) => { edit((d) => { delete d[g][prop]; return d; }); setSel(null); };
  const delKey = (g, prop, i) => {
    edit((d) => { d[g][prop].splice(i, 1); if (!d[g][prop].length) delete d[g][prop]; return d; });
    setSel(null);
  };
  const selKey = sel && def[sel.g][sel.prop]?.[sel.i];

  /* arrastar um keyframe: gruda em 0, 50%, 100% e na agulha */
  const dragKey = (e, g, prop, i) => {
    e.preventDefault(); e.stopPropagation();
    setPlaying(false);
    setSel({ g, prop, i });
    const lane = e.currentTarget.parentElement.getBoundingClientRect();
    const t0 = defRef.current[g][prop][i].t;
    let cur = i, moved = false;
    const move = (ev) => {
      let t = clamp((ev.clientX - lane.left) / lane.width, 0, 1);
      for (const s of [0, 0.5, 1]) if (Math.abs(t - s) < TR_SNAP) t = s;
      if (!moved && Math.abs(t - t0) < 0.003) return;
      moved = true;
      const d = structuredClone(defRef.current);
      const list = d[g][prop], k = list[cur];
      k.t = t;
      list.sort((x, y) => x.t - y.t);
      cur = list.indexOf(k);
      defRef.current = d;
      setDef(d);
      setDirty(true);
      setSel({ g, prop, i: cur });
      setU(t);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (!moved) setU(t0); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const scrub = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const at = (ev) => seek((ev.clientX - r.left) / r.width);
    at(e);
    const up = () => { window.removeEventListener('pointermove', at); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', at);
    window.addEventListener('pointerup', up);
  };

  const close = () => { if (!dirty || confirm('Descartar as alterações desta transição?')) onClose(); };
  const loadPreset = (id) => {
    const src = TRANSITION_MAP[id]?.def;
    if (!src) return;
    if (dirty && !confirm('Trocar pelo modelo? As alterações atuais serão perdidas.')) return;
    setDef({ ...structuredClone(src), id: def.id, name: def.name });
    setSel(null);
    setDirty(true);
  };
  const pct = (t) => `${(t * 100).toFixed(1)}%`;
  // Espaço toca/pausa, Delete apaga o keyframe selecionado, Esc fecha
  const keysRef = useRef();
  keysRef.current = (e) => {
    if (isTypingTarget(e.target)) return;
    if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) { releaseFocus(); setPlaying((p) => !p); } return; }
    if (['INPUT', 'SELECT'].includes(e.target.tagName)) return;
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selKey) { e.preventDefault(); delKey(sel.g, sel.prop, sel.i); }
    else if (e.key === 'Escape') close();
  };
  useEffect(() => {
    const h = (e) => keysRef.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  return (
    <div className="modal-back" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal tr-editor">
        <div className="tre-head">
          <input className="tre-name" value={def.name} onChange={(e) => set({ name: e.target.value })} spellCheck={false} aria-label="Nome da transição" />
          <select className="tre-preset" value="" onChange={(e) => loadPreset(e.target.value)} title="Começar de um modelo">
            <option value="" disabled>Começar de um modelo…</option>
            {TRANSITIONS.filter((t) => t.def && t.id !== def.id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button className="icon-btn" title="Fechar" onClick={close}><Icon name="x" /></button>
        </div>

        <div className="tre-top">
          <div className="tre-preview">
            <canvas ref={cvRef} width={W} height={H} />
            <div className="tre-transport">
              <button className="icon-btn" title={playing ? 'Pausar' : 'Tocar em loop'} onClick={() => setPlaying(!playing)}><Icon name={playing ? 'pause' : 'play'} /></button>
              <div className="tre-scrub" onPointerDown={scrub}>
                <div className="tre-cut" title="Ponto do corte" />
                <div className="tre-fill" style={{ width: pct(u) }} />
              </div>
              <span className="kbd">{Math.round(u * 100)}%</span>
            </div>
          </div>
          <div className="tre-settings">
            <Slider label="Duração padrão (s)" value={def.duration} min={0.1} max={3} step={0.05} onChange={(v) => set({ duration: v })} def={0.6} />
            <div className="field">
              <div className="field-top"><label>Qual fica por cima</label></div>
              <div className="seg">
                <button className={def.order === 'B' ? 'on' : ''} onClick={() => set({ order: 'B' })}>Entra (B)</button>
                <button className={def.order === 'A' ? 'on' : ''} onClick={() => set({ order: 'A' })}>Sai (A)</button>
              </div>
            </div>
            <div className="field">
              <div className="field-top"><label>Revelação do B</label></div>
              <div className="seg">
                {[['none', 'Nenhuma'], ['linear', 'Linear'], ['iris', 'Íris']].map(([id, l]) => (
                  <button key={id} className={def.reveal === id ? 'on' : ''} onClick={() => edit((d) => {
                    d.reveal = id;
                    if (id !== 'none' && !d.B.reveal) d.B.reveal = [{ t: 0, v: 0, ease: 'smooth' }, { t: 1, v: 100 }];
                    return d;
                  })}>{l}</button>
                ))}
              </div>
            </div>
            {def.reveal === 'linear' && <Slider label="Ângulo da revelação" value={def.revealAngle} min={-180} max={180} onChange={(v) => set({ revealAngle: v })} def={0} />}
            {def.reveal !== 'none' && <Slider label="Borda suave" value={def.revealFeather} min={0} max={100} onChange={(v) => set({ revealFeather: v })} def={20} />}
            <Slider label="Desfoque de movimento" value={def.motionBlur} min={0} max={100} onChange={(v) => set({ motionBlur: v })} def={50} />
            <div className="row" style={{ gap: 10 }}>
              <label className="tre-color" title="Cor do flash"><input type="color" value={def.flashColor} onChange={(e) => set({ flashColor: e.target.value })} /> Cor do flash</label>
            </div>
            <Slider label="Velocidade do tremor (Hz)" value={def.shakeFreq} min={1} max={40} onChange={(v) => set({ shakeFreq: v })} def={12} />
          </div>
        </div>

        <div className="tre-tracks">
          {TR_GROUPS.map((G) => (
            <div key={G.id} className="tre-group">
              <div className="tre-glabel" style={{ '--gc': G.color }}>{G.label}</div>
              {trGroupProps(G.id, def).map((P) => {
                const list = def[G.id][P.id];
                const v = trValue(def[G.id], P.id, u);
                const onKey = !!keyAt(list, u);
                return (
                  <div key={P.id} className={`tre-row ${list ? 'tre-animated' : ''}`}>
                    <span className="tre-label" title={list ? 'Clique duplo: apaga a animação desta propriedade' : P.label}
                      onDoubleClick={() => list && clearTrack(G.id, P.id)}>{P.label}</span>
                    <input className="num" type="number" step={P.step} value={Math.round(v * 10) / 10}
                      onChange={(e) => { const n = parseFloat(e.target.value); if (!isNaN(n)) setValue(G.id, P.id, clamp(n, P.min, P.max)); }} />
                    <button className={`kf-btn ${onKey ? 'on' : list ? 'animated' : ''}`} title={onKey ? 'Remover keyframe' : 'Adicionar keyframe aqui'} onClick={() => toggleKey(G.id, P.id)}>
                      <Icon name={onKey ? 'diamondFill' : 'diamond'} size={12} stroke={2} />
                    </button>
                    <div className="tre-lane" onPointerDown={scrub}>
                      <div className="tre-mid" />
                      {list?.length > 1 && <div className="tre-span" style={{ left: pct(list[0].t), width: pct(list[list.length - 1].t - list[0].t), '--gc': G.color }} />}
                      {list?.map((k, i) => (
                        <div key={i} className={`tre-key ${sel?.g === G.id && sel.prop === P.id && sel.i === i ? 'sel' : ''} e-${k.ease}`} style={{ left: pct(k.t), '--gc': G.color }}
                          title={`${Math.round(k.t * 100)}% · ${k.v}${P.unit} · ${EASES[k.ease]?.name}`}
                          onPointerDown={(e) => dragKey(e, G.id, P.id, i)} onDoubleClick={(e) => { e.stopPropagation(); delKey(G.id, P.id, i); }} />
                      ))}
                      <div className="tre-head-line" style={{ left: pct(u) }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="tre-keybar">
          {selKey ? (<>
            <span className="tre-hint">Keyframe de <b>{TR_PROP_DEFS[sel.prop].label}</b> em {Math.round(selKey.t * 100)}% · curva até o próximo:</span>
            <div className="seg">
              {TR_EASES.map((id) => (
                <button key={id} className={selKey.ease === id ? 'on' : ''} onClick={() => edit((d) => { d[sel.g][sel.prop][sel.i].ease = id; return d; })}>{EASES[id].name}</button>
              ))}
            </div>
            <button className="btn danger" onClick={() => delKey(sel.g, sel.prop, sel.i)}><Icon name="trash" size={13} /></button>
          </>) : <span className="tre-hint">Mexa num valor para criar um keyframe na agulha. Arraste os losangos; clique duplo apaga. A linha do meio é o ponto do corte.</span>}
        </div>

        <div className="actions">
          <button className="btn" onClick={() => exportTransitions([def], def.name)}><Icon name="download" size={14} /> Exportar</button>
          <div className="spacer" />
          <button className="btn" onClick={close}>Cancelar</button>
          <button className="btn btn-primary" onClick={() => onSave(def)}>{applyTo ? 'Salvar e aplicar no corte' : 'Salvar na biblioteca'}</button>
        </div>
      </div>
    </div>
  );
}
