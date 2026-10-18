/* =====================================================================
   Editor de curvas dos keyframes (gráfico de valor × tempo)
   - arraste os pontos para mudar tempo e valor (Shift: só valor)
   - clique num trecho para ver as alças Bézier e arraste-as
   - predefinições aplicam a curva no trecho (ou em todos)
   ===================================================================== */
const CURVE_PRESETS = [
  { id: 'linear', name: 'Linear', bz: [0, 0, 1, 1] },
  { id: 'smooth', name: 'Suave', bz: [0.65, 0, 0.35, 1] },
  { id: 'in', name: 'Acelerar', bz: [0.32, 0, 0.67, 0] },
  { id: 'out', name: 'Desacelerar', bz: [0.33, 1, 0.68, 1] },
  { id: 'overshoot', name: 'Passar do ponto', bz: [0.34, 1.56, 0.64, 1] },
  { id: 'anticipate', name: 'Antecipar', bz: [0.36, -0.56, 0.64, 1] },
  { id: 'spring', name: 'Mola', bz: null },
  { id: 'hold', name: 'Congelar', bz: null },
];
/** alças Bézier equivalentes às curvas com nome (para mostrar e começar a editar) */
const bzOf = (f) => (f.ease === 'bezier' && f.bz ? f.bz : CURVE_PRESETS.find((p) => p.id === f.ease)?.bz || [0, 0, 1, 1]);
const PROP_LABELS = {
  x: 'Posição X', y: 'Posição Y', scale: 'Escala', scaleX: 'Largura', scaleY: 'Altura', rotation: 'Rotação', opacity: 'Opacidade',
  volume: 'Volume', brightness: 'Brilho', contrast: 'Contraste', saturation: 'Saturação', hue: 'Matiz', blur: 'Desfoque', intensity: 'Intensidade',
  fontSize: 'Tamanho do texto', maskX: 'Máscara X', maskY: 'Máscara Y', maskW: 'Máscara largura', maskH: 'Máscara altura', maskRot: 'Máscara rotação', maskFeather: 'Máscara suavização',
};

function KeyframeCurves({ clip, local, onChange, onSeek, onClose }) {
  const props = Object.keys(clip.keyframes || {}).filter((k) => clip.keyframes[k]?.length);
  const [propSel, setProp] = useState(props[0]);
  const prop = props.includes(propSel) ? propSel : props[0];
  const list = prop ? clip.keyframes[prop] : [];
  const [segSel, setSeg] = useState(0);
  const seg = clamp(segSel, 0, Math.max(0, list.length - 2));
  const [all, setAll] = useState(false);
  const wrapRef = useRef();
  const [w, setW] = useState(720);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const springKey = useRef('');   // um passo de desfazer por arraste do controle da mola
  const drag = useRef(null);   // { range } fixo durante o arraste (o eixo não "foge" do mouse)

  if (!prop) return null;
  const H = 230, P = { l: 48, r: 16, t: 16, b: 24 };
  const T1 = Math.max(clip.duration, 0.1);
  // faixa de valores: amostra a curva (inclui o que passa do ponto)
  let range = drag.current?.range;
  if (!range) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i <= 160; i++) { const v = kfValueAt(list, (T1 * i) / 160); lo = Math.min(lo, v); hi = Math.max(hi, v); }
    for (const f of list) { lo = Math.min(lo, f.v); hi = Math.max(hi, f.v); }
    // as alças também precisam caber (dá para puxá-las de volta)
    list.forEach((f, j) => { const n = list[j + 1]; if (!n || f.ease === 'hold' || f.ease === 'spring') return; const z = bzOf(f), dd = n.v - f.v; for (const y of [z[1], z[3]]) { const v = f.v + y * dd; lo = Math.min(lo, v); hi = Math.max(hi, v); } });
    if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.12;
    range = [lo - pad, hi + pad];
  }
  const [vmin, vmax] = range;
  const iw = Math.max(50, w - P.l - P.r), ih = H - P.t - P.b;
  const X = (t) => P.l + (t / T1) * iw, Y = (v) => P.t + (1 - (v - vmin) / (vmax - vmin)) * ih;
  const tOf = (px) => clamp(((px - P.l) / iw) * T1, 0, T1), vOf = (py) => vmin + (1 - (py - P.t) / ih) * (vmax - vmin);

  let d = '';
  for (let i = 0; i <= 240; i++) { const t = (T1 * i) / 240; d += `${i ? 'L' : 'M'}${X(t).toFixed(1)} ${Y(kfValueAt(list, t)).toFixed(1)}`; }

  const a = list[seg], b = list[seg + 1];
  const showHandles = a && b && a.ease !== 'hold' && a.ease !== 'spring';
  const bz = a ? bzOf(a) : null;
  const dv = b ? b.v - a.v : 0;
  const dvShow = Math.abs(dv) > 1e-9 ? dv : (vmax - vmin) * 0.3;   // valor igual nos dois pontos: alças só para a forma
  const h1 = showHandles ? [X(a.t + bz[0] * (b.t - a.t)), Y(a.v + bz[1] * dvShow)] : null;
  const h2 = showHandles ? [X(a.t + bz[2] * (b.t - a.t)), Y(a.v + bz[3] * dvShow)] : null;

  const commit = (next, key) => onChange({ ...clip.keyframes, [prop]: next }, key);
  const ptr = (e) => { const r = e.currentTarget.ownerSVGElement?.getBoundingClientRect() || e.currentTarget.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const startDrag = (e, kind, idx) => {
    e.preventDefault();
    e.stopPropagation();
    const svg = e.currentTarget.ownerSVGElement;
    const key = 'curve:' + uid();
    drag.current = { range };
    const move = (ev) => {
      const r = svg.getBoundingClientRect(), px = ev.clientX - r.left, py = ev.clientY - r.top;
      if (kind === 'point') {
        const f = list[idx], prev = list[idx - 1], nxt = list[idx + 1];
        let t = f.t;
        if (!ev.shiftKey) t = clamp(Math.round(tOf(px) * FPS) / FPS, prev ? prev.t + FRAME : 0, nxt ? nxt.t - FRAME : T1);
        const v = +vOf(py).toFixed(2);
        commit(list.map((x, j) => (j === idx ? { ...x, t, v } : x)), key);
      } else {
        const nb = [...bz];
        const xs = clamp((tOf(px) - a.t) / Math.max(1e-6, b.t - a.t), 0, 1);
        const ys = clamp((vOf(py) - a.v) / dvShow, -2, 3);
        if (kind === 'h1') { nb[0] = +xs.toFixed(3); nb[1] = +ys.toFixed(3); } else { nb[2] = +xs.toFixed(3); nb[3] = +ys.toFixed(3); }
        commit(list.map((x, j) => (j === seg ? { ...x, ease: 'bezier', bz: nb } : x)), key);
      }
    };
    const up = () => { drag.current = null; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setW((v) => v + 0); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const clickGraph = (e) => {
    const [px] = ptr(e);
    const t = tOf(px);
    onSeek(t);
    const i = list.findIndex((f, j) => list[j + 1] && t >= f.t && t < list[j + 1].t);
    if (i >= 0) setSeg(i);
  };
  const applyPreset = (p) => {
    const set = (f) => (p.id === 'hold' || EASES[p.id] ? { ...f, ease: p.id, bz: undefined } : { ...f, ease: 'bezier', bz: p.bz });
    commit(list.map((f, j) => (j < list.length - 1 && (all || j === seg) ? set(f) : f)));
  };
  // elasticidade/amortecimento da mola (no trecho escolhido ou em todos os trechos com mola)
  const setSpring = (i, v) => {
    if (!springKey.current) springKey.current = 'spring:' + uid();
    commit(list.map((f, j) => (j < list.length - 1 && f.ease === 'spring' && (all || j === seg) ? { ...f, sp: Object.assign([...(f.sp || SPRING_DEF)], { [i]: v }) } : f)), springKey.current);
  };
  // grade: ~5 linhas de valor e marcas de tempo
  const vStep = niceStep((vmax - vmin) / 5), tStep = niceStep(T1 / 8);
  const grid = [];
  for (let v = Math.ceil(vmin / vStep) * vStep; v <= vmax; v += vStep) grid.push(v);
  const tgrid = [];
  for (let t = 0; t <= T1 + 1e-6; t += tStep) tgrid.push(t);
  const activePreset = a && (a.ease === 'bezier' ? CURVE_PRESETS.find((p) => p.bz && p.bz.join() === a.bz?.join())?.id : a.ease);

  return (
    <div className="curve-editor" role="dialog" aria-label="Editor de curvas">
      <div className="ce-head">
        <Icon name="curve" size={15} />
        <b>Editor de curvas</b>
        <span className="ce-clip">{clip.name || clip.props.text?.slice(0, 24) || ''}</span>
        <div className="ce-props">
          {props.map((k) => <button key={k} className={`chip ${k === prop ? 'on' : ''}`} onClick={() => { setProp(k); setSeg(0); }}>{PROP_LABELS[k] || k}</button>)}
        </div>
        <button className="icon-btn" title="Fechar (Esc)" onClick={onClose}><Icon name="x" size={14} /></button>
      </div>
      <div className="ce-graph" ref={wrapRef}>
        <svg width={w} height={H} onPointerDown={clickGraph}>
          {grid.map((v) => (
            <g key={'v' + v}><line x1={P.l} x2={w - P.r} y1={Y(v)} y2={Y(v)} className="ce-grid" /><text x={P.l - 6} y={Y(v) + 3} className="ce-lbl" textAnchor="end">{+v.toFixed(2)}</text></g>
          ))}
          {tgrid.map((t) => <text key={'t' + t} x={X(t)} y={H - 6} className="ce-lbl" textAnchor="middle">{+t.toFixed(2)}s</text>)}
          {showHandles && <rect x={X(a.t)} y={P.t} width={X(b.t) - X(a.t)} height={ih} className="ce-seg" />}
          <path d={d} className="ce-curve" />
          <line x1={X(local)} x2={X(local)} y1={P.t} y2={H - P.b} className="ce-playhead" />
          {showHandles && (<>
            <line x1={X(a.t)} y1={Y(a.v)} x2={h1[0]} y2={h1[1]} className="ce-arm" />
            <line x1={X(b.t)} y1={Y(b.v)} x2={h2[0]} y2={h2[1]} className="ce-arm" />
            <circle cx={h1[0]} cy={h1[1]} r={6} className="ce-handle" onPointerDown={(e) => startDrag(e, 'h1')} />
            <circle cx={h2[0]} cy={h2[1]} r={6} className="ce-handle" onPointerDown={(e) => startDrag(e, 'h2')} />
          </>)}
          {list.map((f, j) => (
            <rect key={j} x={X(f.t) - 6} y={Y(f.v) - 6} width={12} height={12} transform={`rotate(45 ${X(f.t)} ${Y(f.v)})`}
              className={`ce-kf ${j === seg || j === seg + 1 ? 'on' : ''}`} onPointerDown={(e) => { setSeg(Math.min(j, list.length - 2)); startDrag(e, 'point', j); }}>
              <title>{`${fmt(clip.start + f.t)} · ${+f.v.toFixed(2)}`}</title>
            </rect>
          ))}
        </svg>
      </div>
      <div className="ce-foot">
        {list.length < 2 ? <span className="hint">Esta propriedade tem só um keyframe — adicione outro para ter uma curva.</span> : (<>
          <span className="ce-seg-lbl">Trecho {seg + 1}/{list.length - 1}</span>
          {CURVE_PRESETS.map((p) => (
            <button key={p.id} className={`chip ${activePreset === p.id ? 'on' : ''}`} onClick={() => applyPreset(p)} title={p.bz ? `cubic-bezier(${p.bz.join(', ')})` : p.id === 'spring' ? 'Passa do ponto e volta balançando, como uma mola' : 'Mantém o valor até o próximo keyframe'}>
              <EaseIcon bz={p.bz} fn={p.id === 'spring' ? springFn(a?.ease === 'spring' ? a.sp : undefined) : null} /> {p.name}
            </button>
          ))}
          <label className="check-row" style={{ margin: 0 }}><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> todos os trechos</label>
          {a?.ease === 'spring' && (<>
            <SpringKnob label="Elasticidade" value={(a.sp || SPRING_DEF)[0]} onChange={(v) => setSpring(0, v)} onDone={() => { springKey.current = ''; }} />
            <SpringKnob label="Amortecimento" value={(a.sp || SPRING_DEF)[1]} onChange={(v) => setSpring(1, v)} onDone={() => { springKey.current = ''; }} />
          </>)}
          {a?.ease === 'bezier' && <span className="kbd">cubic-bezier({a.bz.join(', ')})</span>}
        </>)}
      </div>
    </div>
  );
}
/** passo "redondo" para a grade (1, 2, 5 × 10^n) */
function niceStep(raw) {
  const e = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
  const m = raw / e;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * e;
}
/** controle compacto da mola no rodapé do editor de curvas */
function SpringKnob({ label, value, onChange, onDone }) {
  return (
    <label className="check-row" style={{ margin: 0, gap: 6 }} title={label}>
      {label}
      <input type="range" min={0} max={100} value={value} onChange={(e) => onChange(+e.target.value)} onPointerUp={onDone} onKeyUp={onDone} style={{ width: 90 }} />
      <span className="kbd">{value}</span>
    </label>
  );
}
function EaseIcon({ bz, fn }) {
  let d = 'M1 13';
  if (!bz && !fn) d = 'M1 13H13V1';
  else { const f = fn || bezierFn(bz); for (let i = 1; i <= 12; i++) d += ` L${1 + i} ${13 - f(i / 12) * 12}`; }
  return <svg width="14" height="14" className="mini-curve"><path d={d} /></svg>;
}
