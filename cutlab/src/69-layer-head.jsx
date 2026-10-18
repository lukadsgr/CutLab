/* =====================================================================
   Cabeçalho das linhas no estilo After Effects
   [olho · som · solo · cadeado] [rótulo] [#] [▸ nome] [TrkMat] [@ Pai e vínculo]
   + propriedades de transformação ao expandir (cronômetro, valores arrastáveis)
   ===================================================================== */
const HEAD_MIN = 200, HEAD_MAX = 620;

/** nome exibido da linha */
const rowName = (ts, tr, lane, nLanes) => ts[rowKey(tr.id, lane)]?.name || `${tr.label}${nLanes > 1 ? ' ' + (lane + 1) : ''}`;
/** a linha `rk` está na cadeia de pais de `cand`? (evita ciclos) */
const parentChainHas = (ts, cand, rk) => {
  for (let p = cand, n = 0; p && n < 20; p = ts[p]?.parent, n++) if (p === rk) return true;
  return false;
};

/** número arrastável (como no After Effects): arraste para alterar, clique para digitar.
    Shift ×10 · Ctrl ×0,1 */
function Scrub({ value, onChange, step = 1, digits = 1, suffix = '', min = -Infinity, max = Infinity, onCommit }) {
  const [edit, setEdit] = useState(null);
  const fmtV = (v) => (Number.isFinite(v) ? (+v.toFixed(digits)).toString() : '—');
  if (edit != null) {
    const done = (ok) => {
      if (ok) { const v = parseFloat(String(edit).replace(',', '.')); if (Number.isFinite(v)) onChange(clamp(v, min, max)); }
      setEdit(null);
      onCommit?.();
    };
    return <input className="scrub-in" autoFocus value={edit} onChange={(e) => setEdit(e.target.value)} onBlur={() => done(true)}
      onKeyDown={(e) => { if (e.key === 'Enter') done(true); else if (e.key === 'Escape') done(false); e.stopPropagation(); }} onPointerDown={(e) => e.stopPropagation()} />;
  }
  const down = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX, v0 = value;
    let moved = false;
    const move = (ev) => {
      const dx = ev.clientX - sx;
      if (!moved && Math.abs(dx) < 2) return;
      moved = true;
      document.body.classList.add('scrubbing');
      const mul = ev.shiftKey ? 10 : ev.ctrlKey || ev.metaKey ? 0.1 : 1;
      onChange(clamp(+(v0 + dx * step * mul).toFixed(Math.max(digits, 2)), min, max));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('scrubbing');
      if (!moved) setEdit(fmtV(value));
      else onCommit?.();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return <span className="scrub" onPointerDown={down} title="Arraste para alterar (Shift ×10 · Ctrl ×0,1) · clique para digitar">{fmtV(value)}{suffix}</span>;
}

/** propriedades mostradas ao expandir cada tipo de linha */
const ROW_PROPS = {
  visual: [
    { name: 'Posição', keys: ['x', 'y'], step: 0.2, digits: 1 },
    { name: 'Escala', keys: ['scale'], step: 0.5, digits: 1, suffix: '%', min: 1 },
    { name: 'Rotação', keys: ['rotation'], step: 0.5, digits: 1, suffix: '°' },
    { name: 'Opacidade', keys: ['opacity'], step: 0.5, digits: 0, suffix: '%', min: 0, max: 100 },
  ],
  audio: [{ name: 'Volume', keys: ['volume'], step: 0.5, digits: 0, suffix: '%', min: 0, max: 200 }],
  effect: [{ name: 'Intensidade', keys: ['intensity'], step: 0.5, digits: 0, suffix: '%', min: 0, max: 100 }],
};
const propsForTrack = (tid) => (tid === 'audio' ? ROW_PROPS.audio : tid === 'effect' ? ROW_PROPS.effect : ROW_PROPS.visual);
/** clipe "em foco" da linha: o selecionado (se estiver nela), o do cursor, ou o mais próximo */
function focusClip(clips, rk, time, selectedId) {
  const inRow = clips.filter((c) => clipRow(c) === rk);
  return inRow.find((c) => c.id === selectedId)
    || inRow.find((c) => time >= c.start && time < c.start + c.duration)
    || inRow.sort((a, b) => Math.abs(a.start - time) - Math.abs(b.start - time))[0] || null;
}

function LayerHead({ tr, lane, ghost, rk, st, num, name, label, hw, height, parentOptions, rowApi, onWhipStart, onLabelMenu, open }) {
  const [renaming, setRenaming] = useState(false);
  const visualRow = canParentRow(rk);
  const matteRow = VISUAL_TRACKS.includes(tr.id);
  const sw = (key, icon, offIcon, title, show = true) => (
    <button className={`ae-sw-btn ${st[key] ? 'on' : ''} ${key}`} title={title} onClick={(e) => { e.stopPropagation(); rowApi.setRow(rk, { [key]: !st[key] }); }} style={{ visibility: show ? 'visible' : 'hidden' }}>
      <Icon name={st[key] ? offIcon : icon} size={12} stroke={2} />
    </button>
  );
  if (ghost) {
    return (
      <div className="tl-head ae-head ghost" style={{ height, width: hw }}>
        <span className="ae-ghost"><Icon name="plus" size={12} /> Nova camada</span>
      </div>
    );
  }
  return (
    <div className={`tl-head ae-head ${st.lock ? 'is-locked' : ''}`} data-row={rk} style={{ height, width: hw, '--label': label }}>
      <div className="ae-sw">
        {sw('hidden', 'eye', 'eyeOff', st.hidden ? 'Mostrar camada' : 'Ocultar camada', tr.id !== 'audio')}
        {sw('muted', 'volume', 'volumeX', st.muted ? 'Ativar som' : 'Silenciar', ['main', 'overlay', 'audio'].includes(tr.id))}
        <button className={`ae-sw-btn solo ${st.solo ? 'on' : ''}`} title="Solo — mostra só as camadas em solo" onClick={(e) => { e.stopPropagation(); rowApi.setRow(rk, { solo: !st.solo }); }}><span className="solo-dot" /></button>
        {sw('lock', 'unlock', 'lock', st.lock ? 'Desbloquear camada' : 'Bloquear camada (impede selecionar e mover)')}
      </div>
      <button className="ae-label" title="Cor do rótulo" onClick={(e) => { e.stopPropagation(); onLabelMenu(rk, e.currentTarget.getBoundingClientRect()); }} />
      <span className="ae-num">{num}</span>
      <button className={`ae-twirl ${open ? 'open' : ''}`} title={open ? 'Recolher propriedades' : 'Mostrar propriedades (Transformar)'} onClick={(e) => { e.stopPropagation(); rowApi.setRow(rk, { open: !open }); }}>
        <Icon name="chevronR" size={11} stroke={2.4} />
      </button>
      <div className="ae-name" onDoubleClick={() => setRenaming(true)} title="Clique duplo para renomear">
        <Icon name={tr.icon} size={12} />
        {renaming ? (
          <input autoFocus defaultValue={name} onPointerDown={(e) => e.stopPropagation()}
            onBlur={(e) => { rowApi.setRow(rk, { name: e.target.value.trim() || undefined }); setRenaming(false); }}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(false); }} />
        ) : <span>{name}</span>}
      </div>
      <div className="ae-col ae-matte">
        {matteRow ? (
          <Dropdown value={st.matte || 'none'} onChange={(v) => rowApi.setRow(rk, { matte: v })} title="Fosco de trilha (TrkMat): usa a camada logo acima como fosco"
            options={MATTES.map((m) => ({ id: m.id, label: m.short, name: m.name }))} />
        ) : <span className="ae-dash">—</span>}
      </div>
      <div className="ae-col ae-parent">
        {visualRow ? (<>
          <button className={`whip ${st.parent ? 'on' : ''}`} title="Seletor de vínculo: arraste até outra camada para torná-la pai" onPointerDown={(e) => onWhipStart(e, rk)}>
            <Icon name="whip" size={12} stroke={2} />
          </button>
          <Dropdown value={st.parent || ''} onChange={(v) => rowApi.setParent(rk, v || null)} title="Pai e vínculo"
            options={[{ id: '', label: 'Nenhum' }, ...parentOptions.map((o) => ({ id: o.rk, label: o.name, num: o.num }))]} />
        </>) : <span className="ae-dash">—</span>}
      </div>
    </div>
  );
}

/** linhas de propriedades (Transformar) de uma camada expandida */
function PropRows({ tr, rk, clip, time, pps, width, hw, rowApi, onSeek }) {
  const list = propsForTrack(tr.id);
  if (!clip) {
    return (
      <div className="tl-row prop-row">
        <div className="tl-head ae-prop" style={{ width: hw }}><span className="ae-prop-empty">Sem clipe nesta camada</span></div>
        <div className="tl-lane prop-lane" style={{ width }} />
      </div>
    );
  }
  const local = clamp(time - clip.start, 0, clip.duration);
  const p = { ...BASE_PROPS, ...resolveProps(clip, local) };
  const inside = time >= clip.start && time <= clip.start + clip.duration;
  return (<>
    <div className="tl-row prop-row group">
      <div className="tl-head ae-prop" style={{ width: hw }}>
        <span className="ae-prop-group"><span className="rot90"><Icon name="chevronR" size={10} stroke={2.4} /></span> Transformar</span>
        <button className="ae-reset" onClick={() => rowApi.setProps(clip.id, { x: 0, y: 0, scale: 100, rotation: 0, opacity: 100 }, 'reset')} title="Redefinir transformação">Redefinir</button>
      </div>
      <div className="tl-lane prop-lane" style={{ width }}>
        <div className="prop-span" style={{ left: clip.start * pps, width: clip.duration * pps }} />
      </div>
    </div>
    {list.map((pr) => {
      const animated = pr.keys.some((k) => hasKf(clip, k));
      const onKf = pr.keys.every((k) => kfAtTime(clip, k, local));
      const times = kfTimes({ keyframes: Object.fromEntries(pr.keys.filter((k) => hasKf(clip, k)).map((k) => [k, clip.keyframes[k]])) });
      const prev = [...times].reverse().find((t) => t < local - KF_EPS), next = times.find((t) => t > local + KF_EPS);
      return (
        <div className="tl-row prop-row" key={pr.name}>
          <div className="tl-head ae-prop" style={{ width: hw }}>
            <button className={`stopwatch ${animated ? 'on' : ''}`} title={animated ? 'Desativar animação (remove os keyframes desta propriedade)' : 'Ativar animação (cria keyframe no cursor)'}
              onClick={() => (animated ? rowApi.stopwatchOff(clip.id, pr.keys) : inside ? rowApi.addKf(clip.id, pr.keys) : onSeek(clip.start))}>
              <Icon name="stopwatch" size={12} stroke={2} />
            </button>
            <span className="ae-prop-name">{pr.name}</span>
            <span className="ae-prop-vals">
              {pr.keys.map((k, i) => (
                <React.Fragment key={k}>
                  {i > 0 && <span className="sep">,</span>}
                  <Scrub value={p[k]} step={pr.step} digits={pr.digits} suffix={pr.suffix || ''} min={pr.min} max={pr.max}
                    onChange={(v) => rowApi.setProps(clip.id, { [k]: v }, `scrub:${clip.id}:${k}`)} />
                </React.Fragment>
              ))}
            </span>
            {animated && (
              <span className="ae-kfnav">
                <button disabled={prev == null} onClick={() => onSeek(clip.start + prev)} title="Keyframe anterior">◀</button>
                <button className={onKf ? 'on' : ''} disabled={!inside} onClick={() => rowApi.toggleKfs(clip.id, pr.keys)} title={onKf ? 'Remover keyframe' : 'Adicionar keyframe'}>◆</button>
                <button disabled={next == null} onClick={() => onSeek(clip.start + next)} title="Próximo keyframe">▶</button>
              </span>
            )}
          </div>
          <div className="tl-lane prop-lane" style={{ width }}>
            <div className="prop-span" style={{ left: clip.start * pps, width: clip.duration * pps }} />
            {times.map((t) => (
              <div key={t} className={`prop-kf ${Math.abs(t - local) < KF_EPS ? 'cur' : ''}`} style={{ left: (clip.start + t) * pps }}
                title={`Keyframe em ${fmt(clip.start + t)}`} onPointerDown={(e) => { e.stopPropagation(); onSeek(clip.start + t); }} />
            ))}
          </div>
        </div>
      );
    })}
  </>);
}

/** menu de cores de rótulo */
function LabelMenu({ at, current, onPick, onClose }) {
  const ref = useRef();
  useEffect(() => {
    const close = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, []);
  return (
    <div className="label-menu" ref={ref} style={{ left: at.left, top: at.bottom + 4 }}>
      {LABELS.map((l, i) => (
        <button key={i} className={i === current ? 'on' : ''} onClick={() => { onPick(i); onClose(); }}>
          <i style={{ background: l.c }} />{l.name}
        </button>
      ))}
    </div>
  );
}

/** menu suspenso no estilo do CutLab (abre num portal para não ser cortado pela linha do tempo) */
function Dropdown({ value, options, onChange, title }) {
  const [at, setAt] = useState(null);
  const btn = useRef(), list = useRef();
  const cur = options.find((o) => o.id === value) || options[0];
  useEffect(() => {
    if (!at) return;
    const close = (e) => { if (!list.current?.contains(e.target) && !btn.current?.contains(e.target)) setAt(null); };
    const esc = (e) => { if (e.key === 'Escape') setAt(null); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', esc); window.removeEventListener('resize', close); };
  }, [at]);
  const open = () => {
    if (at) { setAt(null); return; }
    const r = btn.current.getBoundingClientRect();
    const h = Math.min(300, options.length * 30 + 10);
    const below = window.innerHeight - r.bottom > h + 8;
    setAt({ left: r.left, width: Math.max(r.width, 170), top: below ? r.bottom + 4 : r.top - h - 4 });
  };
  return (<>
    <button ref={btn} className={`mini-dd ${at ? 'open' : ''} ${value ? 'set' : ''}`} onClick={open} title={title}>
      <span>{cur?.num ? `${cur.num}. ` : ''}{cur?.label}</span><Icon name="chevronD" size={11} stroke={2.2} />
    </button>
    {at && ReactDOM.createPortal(
      <div ref={list} className="dd-list mini-dd-list" style={{ position: 'fixed', left: at.left, top: at.top, width: at.width, right: 'auto' }}>
        {options.map((o) => (
          <button key={o.id} className={`dd-item ${o.id === value ? 'on' : ''}`} onClick={() => { onChange(o.id); setAt(null); }} title={o.name || o.label}>
            <span className="dd-check">{o.id === value ? '✓' : ''}</span>
            {o.num != null && <span className="dd-num">{o.num}</span>}
            <span className="dd-label">{o.name || o.label}</span>
          </button>
        ))}
      </div>, document.body)}
  </>);
}
