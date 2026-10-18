/* =====================================================================
   Painéis avançados do inspetor: Ajuste (cor), Velocidade e Animação
   ===================================================================== */

/** abas segmentadas com indicador deslizante */
function SegTabs({ items, value, onChange, variant = 'pill', dots = {} }) {
  const ref = useRef();
  const [ind, setInd] = useState(null);
  const measure = useCallback(() => {
    const el = ref.current?.querySelector('[data-on="1"]');
    if (el) setInd({ x: el.offsetLeft, w: el.offsetWidth });
  }, []);
  useLayoutEffect(measure, [value, items.join('|'), measure]);
  useEffect(() => {
    const ro = new ResizeObserver(measure);
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [measure]);
  return (
    <div className={`seg-tabs ${variant}`} ref={ref} role="tablist">
      <span className="seg-ind" style={ind ? { transform: `translateX(${ind.x}px)`, width: ind.w } : { opacity: 0 }} />
      {items.map((i) => (
        <button key={i} role="tab" aria-selected={i === value} data-on={i === value ? '1' : '0'} className={i === value ? 'on' : ''} onClick={() => i !== value && onChange(i)}>
          {i}{dots[i] && <span className="seg-dot" />}
        </button>
      ))}
    </div>
  );
}

const TRACK_TEMP = 'linear-gradient(90deg,#3d7bff,#9aa3b5 50%,#ffc23d)';
const TRACK_TINT = 'linear-gradient(90deg,#2bd47d,#9aa3b5 50%,#e04bd8)';
const TRACK_SAT = 'linear-gradient(90deg,#8a8a8a,#ff2d46)';
const TRACK_LUM = 'linear-gradient(90deg,#111,#ddd)';

/* ---------- Ajuste ---------- */
function ColorPanel({ sub, clip, p, S, setProps, kfNav, api, tool, setTool }) {
  const id = clip.id;
  const [saved, setSaved] = useState(() => { try { return JSON.parse(localStorage.getItem('cutlab-grades') || '[]'); } catch { return []; } });
  const [naming, setNaming] = useState(null);
  const persist = (list) => { setSaved(list); try { localStorage.setItem('cutlab-grades', JSON.stringify(list)); } catch { /* sem armazenamento */ } };
  const pickGrade = () => Object.fromEntries(GRADE_KEYS.map((k) => [k, p[k]]));
  const applyPreset = (v) => setProps(id, { ...GRADE_DEFAULTS, sharpen: 0, bloom: 0, ...v });

  return (
    <div className="color-panel">
      {sub === 'Básico' && (<>
        <div className="preset-strip">
          {[...ADJUST_PRESETS.slice(1).map((x) => ({ ...x, builtIn: true })), ...saved].map((pr, i) => (
            <button key={(pr.builtIn ? 'b' : 's') + i} className="chip" style={{ '--i': i }} onClick={() => applyPreset(pr.v)} title={pr.builtIn ? 'Predefinição' : 'Sua predefinição'}>
              {!pr.builtIn && <span className="chip-dot" />}{pr.name}
              {!pr.builtIn && <span className="chip-x" onClick={(e) => { e.stopPropagation(); persist(saved.filter((s) => s !== pr)); }}>×</span>}
            </button>
          ))}
        </div>
        <Section title="Ajuste automático" checked={p.autoOn} onCheck={(v) => (v ? api.auto(clip) : setProps(id, { autoOn: false }))}
          onReset={() => setProps(id, { autoAmt: 80 })} kf={kfNav(['autoAmt'])} defaultOpen={p.autoOn}>
          {S('Intensidade', 'autoAmt', 0, 100)}
          <button className="btn ghost" onClick={() => api.auto(clip)}><Icon name="wandAuto" size={14} /> Analisar quadro atual</button>
        </Section>
        <Section title="Combinação de cores" checked={p.matchOn} onCheck={(v) => (v ? (p.matchRef ? setProps(id, { matchOn: true }) : api.notify('Escolha uma imagem de referência abaixo')) : setProps(id, { matchOn: false }))}
          onReset={() => setProps(id, { matchOn: false, matchRef: '', matchGain: [1, 1, 1], matchOff: [0, 0, 0], matchAmt: 80 })} kf={kfNav(['matchAmt'])} defaultOpen={p.matchOn}>
          <div className="hint" style={{ marginBottom: 10 }}>Escolha uma referência: as cores deste clipe passam a imitar as dela.</div>
          <div className="ref-grid">
            {api.refs(clip).map((a) => (
              <button key={a.id} className={`ref ${p.matchRef === a.id ? 'on' : ''}`} style={{ backgroundImage: `url(${a.thumb})` }} title={a.name} onClick={() => api.match(clip, a)} />
            ))}
            <button className="ref add" title="Importar imagem de referência" onClick={api.importRef}><Icon name="plus" size={18} /></button>
          </div>
          {S('Intensidade', 'matchAmt', 0, 100)}
        </Section>
        <Section title="Correção de cor" checked={p.wbOn} onCheck={(v) => (v ? api.wb(clip) : setProps(id, { wbOn: false }))}
          onReset={() => setProps(id, { wbAmt: 80 })} kf={kfNav(['wbAmt'])} defaultOpen={p.wbOn}>
          <div className="hint" style={{ marginBottom: 10 }}>Balanço de branco automático: neutraliza dominantes de cor do quadro.</div>
          {S('Intensidade', 'wbAmt', 0, 100)}
        </Section>
        <Section title="Ajustar" checked={p.gradeOn} onCheck={(v) => setProps(id, { gradeOn: v })}
          onReset={() => setProps(id, { ...Object.fromEntries([...GRADE_BASIC, 'gGrain', 'gVignette'].map((k) => [k, 0])), sharpen: 0, bloom: 0 })}
          kf={kfNav([...GRADE_BASIC, ...GRADE_FX])}>
          <div className="group-label">Cor</div>
          {S('Temperatura', 'gTemp', -100, 100, 1, { track: TRACK_TEMP })}
          {S('Matiz', 'gTint', -100, 100, 1, { track: TRACK_TINT })}
          {S('Saturação', 'gSat', -100, 100, 1, { track: TRACK_SAT })}
          <div className="group-label">Claridade</div>
          {S('Exposição', 'gExposure', -100, 100)}
          {S('Contraste', 'gContrast', -100, 100)}
          {S('Realces', 'gHighlights', -100, 100)}
          {S('Sombras', 'gShadows', -100, 100)}
          {S('Brancos', 'gWhites', -100, 100)}
          {S('Pretos', 'gBlacks', -100, 100)}
          {S('Brilho', 'gBrightness', -100, 100)}
          <div className="group-label">Efeitos</div>
          {S('Aumentar a nitidez', 'sharpen', 0, 100)}
          {S('Brilho suave', 'bloom', 0, 100)}
          {S('Partículas (granulado)', 'gGrain', 0, 100)}
          {S('Fade', 'gFade', 0, 100)}
          {S('Vinheta', 'gVignette', -100, 100)}
        </Section>
      </>)}

      {sub === 'HSL' && <HslPanel clip={clip} p={p} S={S} setProps={setProps} kfNav={kfNav} api={api} tool={tool} setTool={setTool} />}
      {sub === 'Curvas' && <CurvesPanel clip={clip} p={p} setProps={setProps} api={api} />}
      {sub === 'Roda de cores' && (
        <Section title="Roda de cores" checked={p.wheelsOn} onCheck={(v) => setProps(id, { wheelsOn: v })}
          onReset={() => setProps(id, { ...Object.fromEntries(WHEEL_KEYS.map((k) => [k, 0])), wheelAmt: 100 })} kf={kfNav([...WHEEL_KEYS, 'wheelAmt'])}>
          <select className="select" value="primary" onChange={() => {}} style={{ marginBottom: 12 }}><option value="primary">Primário</option></select>
          {S('Intensidade', 'wheelAmt', 0, 100)}
          <div className="wheel-grid">
            {WHEELS.map((w) => (
              <ColorWheel key={w.id} name={w.name} x={p[`wh_${w.id}_x`]} y={p[`wh_${w.id}_y`]} l={p[`wh_${w.id}_l`]}
                onChange={(patch, key) => setProps(id, Object.fromEntries(Object.entries(patch).map(([k, v]) => [`wh_${w.id}_${k}`, v])), key)}
                onReset={() => setProps(id, { [`wh_${w.id}_x`]: 0, [`wh_${w.id}_y`]: 0, [`wh_${w.id}_l`]: 0 })} />
            ))}
          </div>
          <div className="hint">Arraste o ponto para tingir a faixa tonal; o arco à direita controla a luminância. Clique duplo restaura.</div>
        </Section>
      )}

      <div className="insp-footer">
        {naming != null ? (
          <form className="save-row" onSubmit={(e) => { e.preventDefault(); if (naming.trim()) { persist([...saved, { name: naming.trim(), v: pickGrade() }]); api.notify(`Predefinição “${naming.trim()}” salva`); } setNaming(null); }}>
            <input autoFocus className="select" value={naming} placeholder="Nome da predefinição" onChange={(e) => setNaming(e.target.value)} />
            <button className="btn btn-primary" type="submit">Salvar</button>
            <button className="btn" type="button" onClick={() => setNaming(null)}>Cancelar</button>
          </form>
        ) : (<>
          <button className="btn btn-primary" onClick={() => setNaming('')}>Salvar como predefinição</button>
          <button className="btn" onClick={() => api.applyAll(clip)}>Aplicar a tudo</button>
        </>)}
      </div>
    </div>
  );
}

function HslPanel({ clip, p, S, setProps, kfNav, api, tool, setTool }) {
  const [sel, setSel] = useState('red');
  const R = HSL_RANGES.find((r) => r.id === sel);
  const keys = ['h', 's', 'l'].map((k) => `hsl_${sel}_${k}`);
  const hueTrack = `linear-gradient(90deg, hsl(${R.hue - 40},90%,55%), hsl(${R.hue},90%,55%), hsl(${R.hue + 40},90%,55%))`;
  const pick = () => {
    if (tool === 'colorpick') { setTool(null); return; }
    api.onPick((rgb) => {
      const [h, s] = rgb2hsl(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
      if (s < 0.08) { api.notify('Cor sem saturação — escolha uma área colorida'); return; }
      const near = HSL_RANGES.reduce((b, r) => { const d = Math.min(Math.abs(h - r.hue), 360 - Math.abs(h - r.hue)); return d < b.d ? { r, d } : b; }, { r: null, d: 999 });
      setSel(near.r.id);
    });
    setTool('colorpick');
  };
  return (
    <Section title="HSL" checked={p.hslOn} onCheck={(v) => setProps(clip.id, { hslOn: v })}
      onReset={() => setProps(clip.id, Object.fromEntries(HSL_KEYS.map((k) => [k, 0])))} kf={kfNav(keys)}>
      <div className="hsl-row">
        <button className={`tool round ${tool === 'colorpick' ? 'on' : ''}`} title="Conta-gotas: clique numa cor no reprodutor" onClick={pick}><Icon name="pipette" size={14} /></button>
        {HSL_RANGES.map((r) => {
          const touched = ['h', 's', 'l'].some((k) => p[`hsl_${r.id}_${k}`]);
          return (
            <button key={r.id} className={`hsl-dot ${sel === r.id ? 'on' : ''}`} style={{ '--c': r.color }} title={r.name} onClick={() => setSel(r.id)}>
              {touched && <span className="hsl-mark" />}
            </button>
          );
        })}
      </div>
      <div className="group-label">{R.name}</div>
      {S('Matiz', keys[0], -100, 100, 1, { track: hueTrack })}
      {S('Saturação', keys[1], -100, 100, 1, { track: `linear-gradient(90deg,#777,${R.color})` })}
      {S('Brilho', keys[2], -100, 100, 1, { track: `linear-gradient(90deg,#000,${R.color},#fff)` })}
    </Section>
  );
}

const CURVE_CH = [
  { id: 'L', key: 'curveL', name: 'Luma', color: '#ffffff', hist: 0 },
  { id: 'R', key: 'curveR', name: 'Vermelho', color: '#ff4058', hist: 1 },
  { id: 'G', key: 'curveG', name: 'Verde', color: '#3ddc84', hist: 2 },
  { id: 'B', key: 'curveB', name: 'Azul', color: '#4d8dff', hist: 3 },
];
function CurvesPanel({ clip, p, setProps, api }) {
  const [ch, setCh] = useState('L');
  const [hist, setHist] = useState(null);
  const C = CURVE_CH.find((c) => c.id === ch);
  useEffect(() => {
    const upd = () => setHist(api.histogram(clip));
    upd();
    const iv = setInterval(upd, 600);
    return () => clearInterval(iv);
  }, [clip.id]);
  return (
    <Section title="Curvas" checked={p.curvesOn} onCheck={(v) => setProps(clip.id, { curvesOn: v })}
      onReset={() => setProps(clip.id, { curveL: ID_CURVE, curveR: ID_CURVE, curveG: ID_CURVE, curveB: ID_CURVE })}>
      <div className="curve-ch">
        {CURVE_CH.map((c) => (
          <button key={c.id} className={`curve-chip ${ch === c.id ? 'on' : ''}`} style={{ '--c': c.color }} onClick={() => setCh(c.id)}>
            <span className="cdot" />{c.name}{!isIdCurve(p[c.key]) && <span className="seg-dot" />}
          </button>
        ))}
        <button className="icon-btn sm" title={`Redefinir ${C.name}`} onClick={() => setProps(clip.id, { [C.key]: ID_CURVE })}><Icon name="reset" size={13} /></button>
      </div>
      <CurveEditor points={p[C.key]} color={C.color} hist={hist?.[C.hist]} others={CURVE_CH.filter((c) => c.id !== ch).map((c) => ({ pts: p[c.key], color: c.color }))}
        onChange={(pts, key) => setProps(clip.id, { [C.key]: pts }, key)} />
      <div className="hint">Clique para adicionar um ponto, arraste para ajustar, clique duplo para remover. O histograma do quadro atual aparece ao fundo.</div>
    </Section>
  );
}

function CurveEditor({ points, color, hist, others, onChange }) {
  const ref = useRef();
  const [active, setActive] = useState(-1);
  const pts = points || ID_CURVE;
  const table = curveTable(pts);
  let d = '';
  for (let i = 0; i <= 64; i++) { const x = i / 64; d += `${i ? 'L' : 'M'}${x * 256} ${256 - sampleCurve(table, x) * 256}`; }
  let hd = '';
  if (hist) {
    let mx = 0;
    for (let i = 0; i < 256; i++) mx = Math.max(mx, Math.log1p(hist[i]));
    hd = 'M0 256';
    for (let i = 0; i < 256; i++) hd += `L${i} ${256 - (Math.log1p(hist[i]) / (mx || 1)) * 230}`;
    hd += 'L256 256Z';
  }
  const at = (e) => { const r = ref.current.getBoundingClientRect(); return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp(1 - (e.clientY - r.top) / r.height, 0, 1)]; };
  const down = (e) => {
    e.preventDefault();
    const [x, y] = at(e);
    let list = pts.map((q) => [...q]);
    let i = list.findIndex((q) => Math.hypot(q[0] - x, q[1] - y) < 0.05);
    if (i < 0) {
      if (list.length >= 14) return;
      list.push([x, y]);
      list.sort((a, b) => a[0] - b[0]);
      i = list.findIndex((q) => q[0] === x && q[1] === y);
    }
    const key = 'curve:' + uid();
    setActive(i);
    onChange(list, key);
    const move = (ev) => {
      const [mx2, my2] = at(ev);
      const end = i === 0 || i === list.length - 1;
      const lo = i > 0 ? list[i - 1][0] + 0.01 : 0, hi = i < list.length - 1 ? list[i + 1][0] - 0.01 : 1;
      list = list.map((q, j) => (j === i ? [end ? q[0] : clamp(mx2, lo, hi), my2] : q));
      onChange(list, key);
    };
    const up = () => { setActive(-1); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const dbl = (e) => {
    const [x, y] = at(e);
    const i = pts.findIndex((q) => Math.hypot(q[0] - x, q[1] - y) < 0.05);
    if (i > 0 && i < pts.length - 1) onChange(pts.filter((_, j) => j !== i));
  };
  return (
    <div className="curve-box">
      <svg ref={ref} viewBox="0 0 256 256" className="curve-svg" onPointerDown={down} onDoubleClick={dbl}>
        {[64, 128, 192].map((v) => <g key={v}><line x1={v} y1="0" x2={v} y2="256" /><line x1="0" y1={v} x2="256" y2={v} /></g>)}
        {hd && <path d={hd} className="curve-hist" style={{ fill: color }} />}
        <line x1="0" y1="256" x2="256" y2="0" className="curve-diag" />
        {others.filter((o) => !isIdCurve(o.pts)).map((o, i) => {
          const t = curveTable(o.pts);
          let od = '';
          for (let k = 0; k <= 32; k++) { const x = k / 32; od += `${k ? 'L' : 'M'}${x * 256} ${256 - sampleCurve(t, x) * 256}`; }
          return <path key={i} d={od} className="curve-other" style={{ stroke: o.color }} />;
        })}
        <path d={d} className="curve-line" style={{ stroke: color }} />
        {pts.map((q, i) => (
          <circle key={i} cx={q[0] * 256} cy={256 - q[1] * 256} r={active === i ? 6.5 : 5} className={`curve-pt ${active === i ? 'on' : ''}`} style={{ stroke: color }} />
        ))}
      </svg>
    </div>
  );
}

function ColorWheel({ name, x, y, l, onChange, onReset }) {
  const ref = useRef();
  const [drag, setDrag] = useState(false);
  const rgb = wheelRGB(x / 100, y / 100).map((v) => v + l / 100 * 0.5);
  const startPuck = (e) => {
    e.preventDefault();
    const r = ref.current.getBoundingClientRect();
    const key = 'wheel:' + uid();
    setDrag(true);
    const move = (ev) => {
      let dx = (ev.clientX - (r.left + r.width / 2)) / (r.width / 2), dy = (ev.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const m = Math.hypot(dx, dy);
      if (m > 1) { dx /= m; dy /= m; }
      onChange({ x: Math.round(dx * 1000) / 10, y: Math.round(dy * 1000) / 10 }, key);
    };
    move(e);
    const up = () => { setDrag(false); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const startArc = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const r = ref.current.getBoundingClientRect();
    const key = 'wl:' + uid();
    const move = (ev) => {
      const a = Math.atan2(ev.clientY - (r.top + r.height / 2), ev.clientX - (r.left + r.width / 2)) * 180 / Math.PI;
      onChange({ l: Math.round(clamp(-a / 50, -1, 1) * 100) }, key);
    };
    move(e);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  // arco de luminância à direita da roda (−50° a +50°)
  const R = 58, C = 64, arc = (deg) => [C + R * Math.cos(deg * Math.PI / 180), C + R * Math.sin(deg * Math.PI / 180)];
  const [ax0, ay0] = arc(-50), [ax1, ay1] = arc(50), [hx, hy] = arc(-(l / 100) * 50);
  return (
    <div className="wheel">
      <div className="wheel-head"><span>{name}</span><button className="icon-btn sm" title="Redefinir" onClick={onReset}><Icon name="reset" size={12} /></button></div>
      <div className="wheel-wrap">
        <div ref={ref} className={`wheel-disc ${drag ? 'drag' : ''}`} onPointerDown={startPuck} onDoubleClick={() => onChange({ x: 0, y: 0 })}>
          <span className="wheel-puck" style={{ left: `${50 + x / 2}%`, top: `${50 + y / 2}%` }} />
        </div>
        <svg className="wheel-arc" viewBox="0 0 128 128">
          <path d={`M${ax0} ${ay0} A${R} ${R} 0 0 1 ${ax1} ${ay1}`} className="arc-track" />
          <circle cx={hx} cy={hy} r="5.5" className="arc-handle" onPointerDown={startArc} onDoubleClick={() => onChange({ l: 0 })} />
        </svg>
      </div>
      <div className="wheel-vals">
        {rgb.map((v, i) => <span key={i} style={{ '--c': ['#ff4058', '#3ddc84', '#4d8dff'][i] }}>{v.toFixed(2)}</span>)}
      </div>
    </div>
  );
}

/* ---------- Velocidade ---------- */
const logY = (v, H = 150, top = 12) => top + (1 - (Math.log10(clamp(v, 0.1, 10)) + 1) / 2) * H;
function curvePath(pts, W = 400, H = 150, top = 12, n = 80) {
  let d = '';
  for (let i = 0; i <= n; i++) { const u = i / n; d += `${i ? 'L' : 'M'}${(u * W).toFixed(1)} ${logY(speedAt(pts, u), H, top).toFixed(1)}`; }
  return d;
}
function MiniCurve({ pts }) {
  return (
    <svg viewBox="0 0 64 40" className="mini-curve">
      <line x1="0" y1="20" x2="64" y2="20" className="mc-mid" />
      {pts && <path d={curvePath(pts, 64, 32, 4, 32)} />}
    </svg>
  );
}

function SpeedPanel({ clip, p, asset, local, setClip, setProps, S }) {
  const [sub, setSub] = useState(clip.speedCurve ? 'Curvo' : 'Padrão');
  const [preset, setPreset] = useState(() => (clip.speedCurve ? (SPEED_PRESETS.find((s) => JSON.stringify(s.pts) === JSON.stringify(clip.speedCurve))?.id || 'custom') : 'none'));
  const media = isMedia(clip);
  const span = srcSpan(clip);
  const maxSrc = asset && media ? asset.duration - clip.in : Infinity;
  /** troca curva/velocidade mantendo o trecho de mídia; ajusta duração e keyframes */
  const apply = (curve, speed, key) => {
    const s = Math.min(span, maxSrc);
    const F = curve ? integralAt(speedIntegral(curve), 1) : 1;
    const D = Math.max(0.1, s / (speed * F));
    setClip(clip.id, { speedCurve: curve, speed, duration: D, keyframes: scaleKf(clip, D / clip.duration).keyframes }, key);
  };
  return (
    <div className="speed-panel">
      <SegTabs items={['Padrão', 'Curvo', 'Efeitos de velocidade']} value={sub} onChange={(v) => vt(() => setSub(v))} dots={{ Curvo: !!clip.speedCurve, 'Efeitos de velocidade': p.speedFx !== 'none' }} />
      {sub === 'Padrão' && (<div className="tab-pane">
        {clip.speedCurve && (
          <div className="notice">Uma curva de velocidade está ativa.
            <button className="link-btn" onClick={() => { apply(null, clip.speed); setPreset('none'); }}>Remover curva</button>
          </div>
        )}
        <Slider label="Velocidade ×" value={clip.speed} min={0.1} max={10} step={0.05} onChange={(v) => apply(clip.speedCurve, v, `s:${clip.id}`)} />
        <div className="speed-chips">
          {[0.25, 0.5, 1, 1.5, 2, 3, 5, 10].map((v, i) => (
            <button key={v} style={{ '--i': i }} className={`chip ${Math.abs(clip.speed - v) < 0.01 ? 'on' : ''}`} onClick={() => apply(clip.speedCurve, v)}>{v}×</button>
          ))}
        </div>
        <div className="stat"><span>Duração</span><b>{fmtDur(span / clip.speed)} → {fmtDur(clip.duration)}</b></div>
        <BlendToggle p={p} clip={clip} asset={asset} setProps={setProps} />
        <div className="hint" style={{ marginTop: 10 }}>A duração na linha do tempo e os keyframes acompanham a velocidade.</div>
      </div>)}
      {sub === 'Curvo' && (<div className="tab-pane">
        <div className="speed-grid">
          {[{ id: 'none', name: 'Nenhum' }, { id: 'custom', name: 'Personalizado' }, ...SPEED_PRESETS].map((s, i) => (
            <button key={s.id} style={{ '--i': i }} className={`speed-opt ${preset === s.id ? 'on' : ''}`} onClick={() => {
              setPreset(s.id);
              if (s.id === 'none') apply(null, clip.speed);
              else if (s.id === 'custom') apply(clip.speedCurve || [[0, 1], [0.33, 1], [0.66, 1], [1, 1]], clip.speed);
              else apply(s.pts, clip.speed);
            }}>
              <div className="speed-ic">{s.id === 'none' ? <Icon name="mNone" size={22} /> : s.id === 'custom' ? <Icon name="sliders" size={20} /> : <MiniCurve pts={s.pts} />}</div>
              <span>{s.name}</span>
            </button>
          ))}
        </div>
        <BlendToggle p={p} clip={clip} asset={asset} setProps={setProps} />
        {clip.speedCurve && (
          <SpeedCurveEditor pts={clip.speedCurve} progress={clamp(local / clip.duration, 0, 1)} durFrom={span / clip.speed} durTo={clip.duration}
            onChange={(pts, key) => { setPreset('custom'); apply(pts, clip.speed, key); }}
            onReset={() => apply([[0, 1], [0.33, 1], [0.66, 1], [1, 1]], clip.speed)} />
        )}
      </div>)}
      {sub === 'Efeitos de velocidade' && (<div className="tab-pane">
        <Section title="Efeitos de velocidade" checked={p.speedFx !== 'none'} onCheck={(v) => setProps(clip.id, { speedFx: v ? 'motion' : 'none' })} onReset={() => setProps(clip.id, { speedFxAmt: 80 })}>
          <div className="card-grid">
            <Card title="Nenhum" active={p.speedFx === 'none'} onClick={() => setProps(clip.id, { speedFx: 'none' })}><Icon name="mNone" size={26} /></Card>
            {SPEED_FX.map((f) => (
              <Card key={f.id} title={f.name} active={p.speedFx === f.id} onClick={() => setProps(clip.id, { speedFx: f.id })}><SpeedFxThumb id={f.id} /></Card>
            ))}
          </div>
          <div style={{ height: 12 }} />
          <Slider label="Intensidade" value={p.speedFxAmt} min={0} max={100} onChange={(v) => setProps(clip.id, { speedFxAmt: v }, `p:${clip.id}:speedFxAmt`)} />
          <div className="hint">O efeito fica mais forte quanto mais o clipe se afasta de 1× — combine com uma curva de velocidade.</div>
        </Section>
      </div>)}
    </div>
  );
}

/** qualidade da velocidade: motor exato, interpolação de quadros e desfoque de movimento */
const INTERP_MODES = [
  { id: 'none', name: 'Nenhuma', hint: 'repete quadros (estilo "stop motion")' },
  { id: 'blend', name: 'Mistura', hint: 'funde quadros vizinhos — leve' },
  { id: 'flow', name: 'Fluxo óptico', hint: 'cria quadros intermediários (GPU)' },
];
function BlendToggle({ p, clip, asset, setProps }) {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    if (clip.type !== 'video') return;
    const upd = () => setInfo(engine.preciseInfo(clip, asset));
    upd();
    const iv = setInterval(upd, 700);
    return () => clearInterval(iv);
  }, [clip.id, clip.assetId]);
  if (clip.type !== 'video') return null;
  const on = p.precise !== false;
  const altered = clip.speedCurve || Math.abs(clip.speed - 1) > 1e-3;
  const status = !on ? ['off', 'Modo compatível (vídeo HTML)']
    : info?.state === 'ready' ? ['ok', `Quadro a quadro · ${(info.codec || '').split('.')[0].toUpperCase()} ${info.w}×${info.h} · ${Math.round(info.fps)} fps`]
    : info?.state === 'loading' ? ['load', 'Indexando o arquivo…']
    : ['err', info?.error || 'Motor exato indisponível'];
  return (
    <div className="speed-quality">
      <div className="sq-head">
        <span className={`sq-led ${status[0]}`} />
        <div className="sq-title">
          <b>Motor de velocidade</b>
          <span>{status[1]}{on && !altered && info?.state === 'ready' ? ' — ativa ao mudar a velocidade' : ''}</span>
        </div>
        <button className={`toggle ${on ? 'on' : ''}`} title="Decodifica cada quadro no tempo exato (recomendado)" onClick={() => setProps(clip.id, { precise: !on })}>{on ? 'Exato' : 'Compatível'}</button>
      </div>
      <div className="sq-label">Interpolação em câmera lenta</div>
      <div className="sq-seg">
        {INTERP_MODES.map((m) => (
          <button key={m.id} className={(p.frameInterp || 'flow') === m.id ? 'on' : ''} title={m.hint} onClick={() => setProps(clip.id, { frameInterp: m.id, frameBlend: m.id !== 'none' })}>{m.name}</button>
        ))}
      </div>
      <div className="kbd" style={{ margin: '6px 0 12px' }}>{INTERP_MODES.find((m) => m.id === (p.frameInterp || 'flow'))?.hint}</div>
      <Slider label="Desfoque de movimento (trechos rápidos)" value={p.motionBlur ?? 45} min={0} max={100} onChange={(v) => setProps(clip.id, { motionBlur: v }, `p:${clip.id}:mb`)} def={45} />
    </div>
  );
}

function SpeedCurveEditor({ pts, progress, durFrom, durTo, onChange, onReset }) {
  const ref = useRef();
  const [active, setActive] = useState(-1);
  const W = 400, H = 150, TOP = 12;
  const at = (e) => {
    const r = ref.current.getBoundingClientRect();
    const u = clamp((e.clientX - r.left) / r.width, 0, 1);
    const yy = ((e.clientY - r.top) / r.height) * (H + TOP * 2);
    const v = Math.pow(10, clamp((1 - (yy - TOP) / H) * 2 - 1, -1, 1));
    return [u, v];
  };
  const down = (e) => {
    e.preventDefault();
    const [u, v] = at(e);
    let list = pts.map((q) => [...q]);
    const r = ref.current.getBoundingClientRect();
    let i = list.findIndex((q) => Math.abs(q[0] - u) * r.width < 12 && Math.abs(logY(q[1], H, TOP) - logY(v, H, TOP)) * (r.height / (H + TOP * 2)) < 14);
    if (i < 0) { list.push([u, v]); list.sort((a, b) => a[0] - b[0]); i = list.findIndex((q) => q[0] === u); }
    const key = 'sc:' + uid();
    setActive(i);
    onChange(list, key);
    const move = (ev) => {
      const [mu, mv] = at(ev);
      const end = i === 0 || i === list.length - 1;
      const lo = i > 0 ? list[i - 1][0] + 0.02 : 0, hi = i < list.length - 1 ? list[i + 1][0] - 0.02 : 1;
      list = list.map((q, j) => (j === i ? [end ? q[0] : clamp(mu, lo, hi), Math.round(mv * 100) / 100] : q));
      onChange(list, key);
    };
    const up = () => { setActive(-1); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const dbl = (e) => {
    const [u] = at(e);
    const r = ref.current.getBoundingClientRect();
    const i = pts.findIndex((q) => Math.abs(q[0] - u) * r.width < 12);
    if (i > 0 && i < pts.length - 1) onChange(pts.filter((_, j) => j !== i));
  };
  return (
    <div className="sc-box">
      <div className="sc-head"><span>Duração</span><span className="kbd">{fmtDur(durFrom)}</span><span className="sc-arrow" /><b>{fmtDur(durTo)}</b></div>
      <svg ref={ref} viewBox={`0 0 ${W} ${H + TOP * 2}`} preserveAspectRatio="none" className="sc-svg" onPointerDown={down} onDoubleClick={dbl}>
        {[10, 1, 0.1].map((v) => <g key={v}><line x1="0" x2={W} y1={logY(v, H, TOP)} y2={logY(v, H, TOP)} className={v === 1 ? 'sc-one' : 'sc-grid'} /></g>)}
        <path d={curvePath(pts, W, H, TOP) + `L${W} ${logY(1, H, TOP)}L0 ${logY(1, H, TOP)}Z`} className="sc-fill" />
        <path d={curvePath(pts, W, H, TOP)} className="sc-line" />
        <line x1={progress * W} x2={progress * W} y1="0" y2={H + TOP * 2} className="sc-play" />
        {pts.map((q, i) => (
          <g key={i} transform={`translate(${q[0] * W} ${logY(q[1], H, TOP)})`} className={`sc-pt ${active === i ? 'on' : ''}`}>
            <rect x="-6" y="-9" width="12" height="18" rx="4" />
            <line x1="0" x2="0" y1="-4" y2="4" />
          </g>
        ))}
      </svg>
      <div className="sc-labels"><span>10×</span><span>1×</span><span>0.1×</span></div>
      <div className="sc-foot">
        <span className="kbd">Clique para adicionar · clique duplo remove</span>
        <button className="btn" onClick={onReset}>Redefinir</button>
      </div>
    </div>
  );
}

function SpeedFxThumb({ id }) {
  const ref = useRef(), hover = useRef(false);
  useEffect(() => {
    const cv = ref.current, { a, S } = sampleImages();
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d');
    let raf, t0 = performance.now();
    const draw = (t) => {
      const T = tmpCanvas('sfxThumb', S, S), x = T.getContext('2d');
      x.clearRect(0, 0, S, S); x.drawImage(a, 0, 0);
      speedFx(T, id, hover.current ? 0.35 + 0.65 * Math.abs(Math.sin(t * 2)) : 0.7, t, S / 360);
      ctx.clearRect(0, 0, S, S); ctx.drawImage(T, 0, 0);
    };
    const loop = () => { draw((performance.now() - t0) / 1000); if (hover.current) raf = requestAnimationFrame(loop); };
    draw(0.5);
    const el = cv.parentElement;
    const en = () => { hover.current = true; t0 = performance.now(); loop(); }, lv = () => { hover.current = false; cancelAnimationFrame(raf); draw(0.5); };
    el.addEventListener('mouseenter', en); el.addEventListener('mouseleave', lv);
    return () => { cancelAnimationFrame(raf); el.removeEventListener('mouseenter', en); el.removeEventListener('mouseleave', lv); };
  }, [id]);
  return <canvas ref={ref} className="fx-thumb" />;
}

/* ---------- Animação ---------- */
function AnimThumb({ mode, id }) {
  const ref = useRef(), hover = useRef(false);
  useEffect(() => {
    const cv = ref.current, { a, S } = sampleImages();
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d');
    const def = mode === 'Combinação' ? COMBO_MAP[id] : ANIM_MAP[id];
    let raf, t0 = performance.now();
    const draw = (t) => {
      const T = ID_TR();
      if (mode === 'Combinação') mergeTr(T, def.fn(t));
      else {
        const cyc = t % 1.6, q = clamp(cyc / 1, 0, 1);
        mergeTr(T, def.fn(mode === 'Saída' ? 1 - q : q, t));
      }
      ctx.save();
      ctx.fillStyle = '#0b0b0d'; ctx.fillRect(0, 0, S, S);
      ctx.globalAlpha = clamp(T.a, 0, 1);
      ctx.translate(S / 2 + T.x * S, S / 2 + T.y * S);
      ctx.rotate(T.r * Math.PI / 180);
      ctx.scale(0.72 * T.s * T.sx, 0.72 * T.s * T.sy);
      const f = (T.blur ? `blur(${T.blur * 0.3}px) ` : '') + (T.bright !== 1 ? `brightness(${T.bright})` : '');
      if (f) ctx.filter = f;
      animClip(ctx, T, S, S);
      let src = a;
      if (T.rgb > 0.01 || T.glitch > 0.01) { const P = tmpCanvas('animThumb', S, S), px = P.getContext('2d'); px.clearRect(0, 0, S, S); px.drawImage(a, 0, 0); animPixelFx(P, T, t, S / 360); src = P; }
      ctx.drawImage(src, -S / 2, -S / 2);
      if (T.flash > 0.01) { ctx.filter = 'none'; ctx.globalAlpha = T.flash; ctx.fillStyle = '#fff'; ctx.fillRect(-S / 2, -S / 2, S, S); }
      ctx.restore();
    };
    const loop = () => { draw((performance.now() - t0) / 1000); if (hover.current) raf = requestAnimationFrame(loop); };
    draw(mode === 'Combinação' ? 0.4 : 0.45);
    const el = cv.parentElement;
    const en = () => { hover.current = true; t0 = performance.now(); loop(); }, lv = () => { hover.current = false; cancelAnimationFrame(raf); draw(mode === 'Combinação' ? 0.4 : 0.45); };
    el.addEventListener('mouseenter', en); el.addEventListener('mouseleave', lv);
    return () => { cancelAnimationFrame(raf); el.removeEventListener('mouseenter', en); el.removeEventListener('mouseleave', lv); };
  }, [mode, id]);
  return <canvas ref={ref} className="fx-thumb" />;
}

function AnimPanel({ clip, p, setProps }) {
  const [mode, setMode] = useState('Entrada');
  const [cat, setCat] = useState('Em alta');
  const [q, setQ] = useState('');
  const [favs, toggleFav] = useFavorites();
  const key = mode === 'Entrada' ? 'animIn' : mode === 'Saída' ? 'animOut' : 'animCombo';
  const lib = mode === 'Combinação' ? COMBO_LIB : ANIM_LIB.filter((a) => !a.textOnly || (clip.type === 'text' && mode === 'Entrada'));
  const qq = q.trim().toLowerCase();
  const list = lib.filter((a) => (qq ? a.name.toLowerCase().includes(qq) : cat === 'Em alta' ? a.hot : cat === 'Favoritos' ? favs.has(`anim:${a.id}`) : a.cat === cat));
  const cur = ANIM_ALIAS[p[key]] || p[key] || 'none';
  const choose = (id) => {
    const patch = { [key]: id };
    if (mode === 'Entrada' && cur === 'none') patch.animInDur = Math.min(0.6, clip.duration / 2);
    if (mode === 'Saída' && cur === 'none') patch.animOutDur = Math.min(0.6, clip.duration / 2);
    setProps(clip.id, patch);
  };
  const maxD = Math.max(0.1, Math.min(5, clip.duration));
  return (
    <div className="anim-panel">
      <SegTabs items={['Entrada', 'Saída', 'Combinação']} value={mode} onChange={(v) => vt(() => setMode(v))}
        dots={{ Entrada: p.animIn && p.animIn !== 'none', Saída: p.animOut !== 'none', Combinação: p.animCombo !== 'none' }} />
      <div className="search" style={{ marginTop: 12 }}>
        <Icon name="search" size={14} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar animações" />
      </div>
      <div className="cat-chips">
        {['Favoritos', ...ANIM_CATS].map((c) => <button key={c} className={`chip ${cat === c && !qq ? 'on' : ''}`} onClick={() => { setCat(c); setQ(''); }}>{c}</button>)}
      </div>
      <div className="card-grid anim-grid2" key={mode + cat + qq}>
        <Card title="Nenhum" active={cur === 'none'} onClick={() => setProps(clip.id, { [key]: 'none' })}><Icon name="mNone" size={26} /></Card>
        {list.map((a, i) => (
          <div key={a.id} style={{ '--i': i }} className="stagger">
            <Card title={a.name} active={cur === a.id} onClick={() => choose(a.id)} fav={favs.has(`anim:${a.id}`)} onFav={() => toggleFav(`anim:${a.id}`)}>
              {a.id === 'type' ? <span className="type-thumb">Abc<i>|</i></span> : <AnimThumb mode={mode} id={a.id} />}
            </Card>
          </div>
        ))}
      </div>
      {!list.length && <div className="hint">{cat === 'Favoritos' ? 'Clique na estrela de uma animação para favoritá-la.' : 'Nada encontrado.'}</div>}
      {cur !== 'none' && (
        <div className="anim-dur">
          {mode === 'Entrada' && <Slider label="Duração (s)" value={Math.min(p.animInDur, maxD)} min={0.1} max={maxD} step={0.1} onChange={(v) => setProps(clip.id, { animInDur: v }, `p:${clip.id}:aid`)} />}
          {mode === 'Saída' && <Slider label="Duração (s)" value={Math.min(p.animOutDur, maxD)} min={0.1} max={maxD} step={0.1} onChange={(v) => setProps(clip.id, { animOutDur: v }, `p:${clip.id}:aod`)} />}
          {mode === 'Combinação' && <Slider label="Velocidade" value={p.animComboSpeed} min={0.25} max={3} step={0.05} onChange={(v) => setProps(clip.id, { animComboSpeed: v }, `p:${clip.id}:acs`)} />}
        </div>
      )}
    </div>
  );
}
