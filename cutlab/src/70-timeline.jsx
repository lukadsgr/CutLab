/* =====================================================================
   Linha do tempo
   ===================================================================== */
// largura do painel de camadas: estado `hw` dentro da Timeline (redimensionável)

function ClipView({ c, asset, pps, selected, onDown, onKfDown, onOpen, label: labelColor, locked }) {
  const left = c.start * pps;
  const width = Math.max(4, c.duration * pps);
  let wave = null;
  if (c.type === 'audio' && asset?.peaks && asset.duration) {
    const n = asset.peaks.length;
    const a = Math.floor((c.in / asset.duration) * n);
    const b = Math.ceil(((c.in + c.duration * c.speed) / asset.duration) * n);
    wave = <MiniWave peaks={asset.peaks.slice(a, Math.max(a + 1, b))} className="clip-wave" />;
  }
  const label = c.type === 'text' ? c.props.text.replace(/\n/g, ' ')
    : c.type === 'effect' ? EFFECT_MAP[c.props.effect]?.name
    : c.type === 'adjust' ? `Ajuste${c.name && c.name !== 'Ajuste' ? ' · ' + c.name : ''}`
    : c.type === 'compound' ? `${c.name} · ${c.children.length} clipes` : c.name;
  const icon = { text: 'type', effect: 'sparkles', adjust: 'sliders', compound: 'layers' }[c.type];
  const times = kfTimes(c);
  return (
    <div data-id={c.id} className={`clip clip-${c.type} ${c.track === 'caption' ? 'clip-caption' : ''} ${selected ? 'sel' : ''} ${locked ? 'locked' : ''}`} style={{ left, width, "--label": labelColor }} onPointerDown={(e) => onDown(e, c, 'move')}
      onDoubleClick={c.type === 'compound' ? () => onOpen(c.id) : undefined} title={c.type === 'compound' ? 'Clique duplo para editar por dentro' : undefined}>
      {(c.type === 'video' || c.type === 'image') && asset?.thumb && <div className="clip-thumbs" style={{ backgroundImage: `url(${asset.thumb})` }} />}
      {c.type === 'color' && <div className="clip-swatch" style={{ background: c.props.color }} />}
      {c.type === 'compound' && <div className="clip-nest">{c.children.slice(0, 40).map((k) => <i key={k.id} className={`n-${k.type}`} style={{ left: `${((k.start - c.in) / c.duration) * 100}%`, width: `${(k.duration / c.duration) * 100}%` }} />)}</div>}
      {wave}
      {c.props.fadeIn > 0 && <div className="clip-fade in" style={{ width: c.props.fadeIn * pps }} />}
      {c.props.fadeOut > 0 && <div className="clip-fade out" style={{ width: c.props.fadeOut * pps }} />}
      <div className="clip-label">
        {icon && <Icon name={icon} size={11} stroke={2.4} />}
        {c.speed !== 1 && <em>{+c.speed.toFixed(2)}×</em>}
        {c.props.filter && c.props.filter !== 'none' && <em>{FILTERS.find((f) => f.id === c.props.filter)?.name}</em>}
        {times.length > 0 && !selected && <em>◆ {times.length}</em>}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
        <span style={{ opacity: 0.7, marginLeft: 'auto' }}>{width > 110 ? fmtDur(c.duration) : ''}</span>
      </div>
      {selected && times.map((t) => (
        <div key={t} className="kf-dot" style={{ left: t * pps }} title={`Keyframe em ${fmt(c.start + t)} — arraste para mover`}
          onPointerDown={(e) => onKfDown(e, c, t)}>
          <Icon name="diamondFill" size={10} />
        </div>
      ))}
      <div className="handle l" onPointerDown={(e) => onDown(e, c, 'left')} />
      <div className="handle r" onPointerDown={(e) => onDown(e, c, 'right')} />
    </div>
  );
}

function Timeline({ clips, assetMap, time, duration, playing, selectedId, multi = [], onSelect, onToggleSel, onSetSel, selectedTr, onSelectTr, onSeek, setClip,
  onDropAsset, settleClip, rowApi, onDropEffect, onDropTransition, trackState, toggleTrack, zoom, setZoom, snap, setSnap, markers, actions, tools }) {
  const scrollRef = useRef();
  const [dropTrack, setDropTrack] = useState(null);
  const [hwSaved, setHw] = useStoredNumber('cutlab-tlHeadW', 430); // largura do painel de camadas
  const vp = useViewport();
  const hw = Math.min(hwSaved, Math.max(HEAD_MIN, Math.round(vp.w * 0.3))); // em telas estreitas sobra espaço para os clipes
  const [labelMenu, setLabelMenu] = useState(null);
  // o nome tem prioridade: TrkMat some primeiro, depois Pai e vínculo
  const free = hw - 168;
  const cols = { parent: free - 108 >= 96, matte: free - 108 - 70 >= 96 };
  const [whip, setWhip] = useState(null);
  /** seletor de vínculo (pick whip): arraste do @ até outra camada */
  const startWhip = (e, rk) => {
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
    setWhip({ x0, y0, x: x0, y: y0, rk });
    const target = (ev) => document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-row]')?.dataset.row;
    const move = (ev) => setWhip({ x0, y0, x: ev.clientX, y: ev.clientY, rk, over: target(ev) });
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setWhip(null);
      const t = target(ev);
      if (t && t !== rk) rowApi.setParent(rk, t);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const startHeadResize = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX, w0 = hw;
    const move = (ev) => setHw(clamp(w0 + ev.clientX - sx, HEAD_MIN, HEAD_MAX));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.classList.remove('col-resizing'); };
    document.body.classList.add('col-resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const [extraRows, setExtraRows] = useState([]); // durante o arraste: camadas fixadas + linha "nova camada"
  const rows = useMemo(() => timelineRows(clips, extraRows), [clips, extraRows]);
  // numeração de cima para baixo (#) e lista de camadas que podem ser pai
  const rowInfo = useMemo(() => {
    const m = new Map();
    let n = 0;
    for (const r of rows) if (!r.ghost) m.set(rowKey(r.tr.id, r.lane), { num: ++n });
    return m;
  }, [rows]);
  const parentOpts = rows.filter((r) => !r.ghost && canParentRow(rowKey(r.tr.id, r.lane))).map((r) => {
    const rk = rowKey(r.tr.id, r.lane);
    return { rk, num: rowInfo.get(rk)?.num, name: rowName(trackState, r.tr, r.lane, rows.filter((x) => x.tr === r.tr && !x.ghost).length) };
  });
  // ao surgir a linha "Nova camada", mantém o clipe arrastado parado sob o cursor
  const anchorRef = useRef(null);
  useLayoutEffect(() => {
    const a = anchorRef.current, el = scrollRef.current;
    if (!a || !el) return;
    anchorRef.current = null;
    const node = el.querySelector(`.clip[data-id="${a.id}"]`);
    if (node) el.scrollTop += node.getBoundingClientRect().top - a.top;
  }, [extraRows]);
  const pps = zoom;
  const total = Math.max(duration + 20, 60);
  const width = total * pps;
  const pairs = useMemo(() => transitionPairs(clips), [clips]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!playing || !el) return;
    const x = hw + time * pps;
    if (x > el.scrollLeft + el.clientWidth - 40 || x < el.scrollLeft + hw) el.scrollLeft = x - hw - 40;
  }, [time, playing, pps]);

  useEffect(() => {
    const el = scrollRef.current;
    const wheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => clamp(z * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 8, 300));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [setZoom]);

  const laneT = (clientX) => {
    const el = scrollRef.current;
    const r = el.getBoundingClientRect();
    return (clientX - r.left - hw + el.scrollLeft) / pps;
  };
  const onWindowDrag = (move, up) => {
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); up && up(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  const [phSnap, setPhSnap] = useState(false);
  const startScrub = (e) => {
    e.preventDefault();
    const pts = [0, ...markers.map((m) => m.t)];
    if (snap) for (const c of clips) pts.push(c.start, c.start + c.duration, ...kfTimes(c).map((t) => c.start + t));
    const go = (ev) => {
      let t = Math.max(0, laneT(ev.clientX)), hit = false;
      // Alt solta o ímã temporariamente
      if (snap && !ev.altKey) {
        const th = 8 / pps;
        let bd = th;
        for (const p of pts) { const d = Math.abs(p - t); if (d < bd) { bd = d; t = p; hit = true; } }
      }
      setPhSnap(hit);
      onSeek(t);
    };
    go(e);
    onWindowDrag(go, () => setPhSnap(false));
  };
  // eixo de visualização: o reprodutor mostra o quadro sob o mouse
  const [skimT, setSkimT] = useState(null);
  const skimMove = (e) => {
    if (!tools.skim || e.buttons) { if (skimT != null) { setSkimT(null); tools.onSkim(null); } return; }
    const t = laneT(e.clientX);
    const over = e.clientX - scrollRef.current.getBoundingClientRect().left > hw;
    const v = over && t >= 0 ? t : null;
    setSkimT(v);
    tools.onSkim(v);
  };
  const skimLeave = () => { setSkimT(null); tools.onSkim(null); setBladeT(null); };

  /* lâmina: corta onde o mouse está (encaixa no cursor, marcadores e bordas; Alt solta) */
  const [bladeT, setBladeT] = useState(null);
  useEffect(() => { if (!tools.blade) setBladeT(null); }, [tools.blade]);
  const bladeTime = (ev) => {
    let t = Math.max(0, laneT(ev.clientX));
    if (snap && !ev.altKey) {
      let bd = 8 / pps;
      for (const p of [time, ...markers.map((m) => m.t), ...clips.flatMap((c) => [c.start, c.start + c.duration])]) { const d = Math.abs(p - t); if (d < bd) { bd = d; t = p; } }
    }
    return Math.round(t * FPS) / FPS;
  };
  const bladeMove = (e) => {
    if (!tools.blade) return;
    const over = e.target.closest?.('.clip');
    setBladeT(over ? { t: bladeTime(e), all: e.shiftKey } : null);
  };

  const startDrag = (e, clip, mode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    if (trackState[clipRow(clip)]?.lock) return; // camada bloqueada
    if (tools.blade) { actions.bladeAt(clip.id, bladeTime(e), e.shiftKey); return; }
    // Ctrl/Shift+clique: monta uma seleção de vários clipes (ex.: para criar um clipe composto)
    if (e.ctrlKey || e.metaKey || e.shiftKey) { if (mode === 'move') onToggleSel(clip.id); return; }
    // clicou num clipe que faz parte de uma seleção múltipla: arrasta o grupo todo
    const selIds = [...multi, selectedId].filter(Boolean);
    if (mode === 'move' && selIds.length > 1 && selIds.includes(clip.id)) { startGroupDrag(e, clip, selIds); return; }
    onSelect(clip.id);
    const sx = e.clientX, sy = e.clientY;
    const o = { ...clip };
    const key = 'drag:' + uid();
    const asset = assetMap[clip.assetId];
    const media = isMedia(clip) || isCompound(clip);   // têm conteúdo de origem: aparar mexe no ponto de entrada
    const srcMax = isCompound(clip) ? innerLength(clip.children) : media && asset ? asset.duration : Infinity;
    const points = [time, 0, ...markers.map((m) => m.t), ...clips.filter((c) => c.id !== clip.id).flatMap((c) => [c.start, c.start + c.duration])];
    const snapTo = (v) => {
      if (!snap) return v;
      const th = 8 / pps;
      let best = v, bd = th;
      for (const p of points) { const d = Math.abs(p - v); if (d < bd) { bd = d; best = p; } }
      return best;
    };
    let moved = false;
    // linhas existentes ficam fixas durante o arraste e aparece uma linha vazia acima para criar nova camada
    const ghostTrack = clip.track === 'main' ? 'overlay' : clip.track;
    const pinned = clips.map((c) => ({ track: c.track, lane: laneOf(c) }));
    const used = clips.filter((c) => c.track === ghostTrack);
    const ghost = { track: ghostTrack, lane: used.length ? Math.max(...used.map(laneOf)) + 1 : 0, ghost: true };
    onWindowDrag((ev) => {
      const dt = (ev.clientX - sx) / pps;
      if (!moved && mode === 'move' && Math.abs(ev.clientX - sx) < 3 && Math.abs(ev.clientY - sy) < 6) return;
      if (!moved && mode === 'move') {
        const node = scrollRef.current.querySelector(`.clip[data-id="${clip.id}"]`);
        if (node) anchorRef.current = { id: clip.id, top: node.getBoundingClientRect().top };
        setExtraRows([...pinned, ghost]);
      }
      moved = true;
      if (mode === 'move') {
        let ns = Math.max(0, o.start + dt);
        const s1 = snapTo(ns), e1 = snapTo(ns + o.duration);
        if (s1 !== ns) ns = s1; else if (e1 !== ns + o.duration) ns = e1 - o.duration;
        ns = Math.max(0, ns);
        const lane = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-track]');
        let track = o.track, ln = laneOf(o);
        if (lane) {
          const tr = TRACKS.find((t) => t.id === lane.dataset.track);
          if (tr && tr.accepts.includes(clip.type)) { track = tr.id; ln = +lane.dataset.lane || 0; }
        }
        setClip(clip.id, { start: ns, track, lane: track === 'main' ? 0 : ln }, key);
      } else if (mode === 'left') {
        const end = o.start + o.duration;
        const minStart = media ? o.start - o.in / o.speed : -Infinity;
        const ns = clamp(snapTo(o.start + dt), Math.max(0, minStart), end - 0.1);
        setClip(clip.id, {
          start: ns, duration: end - ns, in: media ? o.in + (ns - o.start) * o.speed : 0,
          keyframes: shiftKf(o, o.start - ns).keyframes,
        }, key);
      } else {
        const maxEnd = media ? o.start + (srcMax - o.in) / o.speed : Infinity;
        const ne = clamp(snapTo(o.start + o.duration + dt), o.start + 0.1, maxEnd);
        setClip(clip.id, { duration: ne - o.start }, key);
      }
    }, () => {
      setExtraRows([]);
      if (moved) settleClip(clip.id, key, clips);
    });
  };

  /** arrasta vários clipes juntos na horizontal (cada um fica na sua linha); a borda mais próxima encaixa */
  const startGroupDrag = (e, clip, ids) => {
    const group = clips.filter((c) => ids.includes(c.id) && !trackState[clipRow(c)]?.lock);
    if (!group.length) return;
    const orig = new Map(group.map((c) => [c.id, c.start]));
    const minStart = Math.min(...group.map((c) => c.start));
    const sx = e.clientX, key = 'gdrag:' + uid();
    const points = [time, 0, ...markers.map((m) => m.t), ...clips.filter((c) => !orig.has(c.id)).flatMap((c) => [c.start, c.start + c.duration])];
    const edges = group.flatMap((c) => [c.start, c.start + c.duration]);
    let moved = false;
    onWindowDrag((ev) => {
      if (!moved && Math.abs(ev.clientX - sx) < 3) return;
      moved = true;
      let dt = (ev.clientX - sx) / pps;
      if (snap && !ev.altKey) {
        let bd = 8 / pps, fix = null;
        for (const e0 of edges) for (const p of points) { const d = p - (e0 + dt); if (Math.abs(d) < bd) { bd = Math.abs(d); fix = d; } }
        if (fix != null) dt += fix;
      }
      actions.moveClips(orig, Math.max(-minStart, dt), key);
    }, () => { if (moved) actions.settleGroup([...orig.keys()], key, clips); else onSelect(clip.id); });
  };

  /** arrastar no vazio de uma faixa: caixa de seleção (Ctrl/Shift soma à seleção); clique simples posiciona o cursor */
  const [marq, setMarq] = useState(null);
  const startMarquee = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = scrollRef.current, content = () => el.querySelector('.tl-content').getBoundingClientRect();
    const add = e.ctrlKey || e.metaKey || e.shiftKey;
    const base = add ? [...multi, selectedId].filter(Boolean) : [];
    const c0 = content(), ax = e.clientX - c0.left, ay = e.clientY - c0.top; // âncora em coordenadas do conteúdo (resiste à rolagem)
    let moved = false;
    onWindowDrag((ev) => {
      if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return;
      moved = true;
      const c = content(), bx = ev.clientX - c.left, by = ev.clientY - c.top;
      const r = { left: Math.min(ax, bx), top: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) };
      setMarq(r);
      const X0 = c.left + r.left, X1 = X0 + r.width, Y0 = c.top + r.top, Y1 = Y0 + r.height;
      const hit = [...el.querySelectorAll('.tl-lane .clip:not(.locked)')].filter((n) => {
        const b = n.getBoundingClientRect();
        return b.right > X0 && b.left < X1 && b.bottom > Y0 && b.top < Y1;
      }).map((n) => n.dataset.id);
      onSetSel([...new Set([...base, ...hit])]);
    }, () => {
      setMarq(null);
      if (!moved) { if (!add) onSelect(null); onSeek(bladeTime(e)); }
    });
  };
  const startKfDrag = (e, clip, t) => {
    e.stopPropagation();
    e.preventDefault();
    const sx = e.clientX, o = { ...clip }, key = 'kf:' + uid();
    let moved = false;
    onWindowDrag((ev) => {
      if (!moved && Math.abs(ev.clientX - sx) < 3) return;
      moved = true;
      const nt = clamp(t + (ev.clientX - sx) / pps, 0, o.duration);
      setClip(clip.id, { keyframes: moveKfTime(o, t, Math.round(nt * FPS) / FPS).keyframes }, key);
    }, () => { if (!moved) onSeek(clip.start + t); });
  };

  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120];
  const step = steps.find((s) => s * pps >= 70) || 120;
  const ticks = [];
  for (let s = 0; s <= total; s += step) ticks.push(s);
  const minor = (step * pps) / 5;
  const rulerBg = `repeating-linear-gradient(90deg, #3a3a43 0 1px, transparent 1px ${minor}px)`;
  const dropTypes = ['text/asset', 'text/effect', 'text/transition'];

  return (
    <div className={`timeline ${playing ? 'playing' : ''} ${tools.blade ? 'blade-mode' : ''} ${tools.crumbs?.length ? 'nested' : ''}`}>
      {tools.crumbs?.length > 0 && (
        <div className="tl-crumbs">
          <button className="btn crumb-back" onClick={() => tools.exitTo(tools.crumbs.length - 1)} title="Voltar um nível (Esc)"><Icon name="chevronL" size={14} /> Voltar</button>
          <button className="crumb" onClick={() => tools.exitTo(0)}>Projeto</button>
          {tools.crumbs.map((c) => (
            <React.Fragment key={c.depth}><Icon name="chevronR" size={12} />
              <button className={`crumb ${c.depth === tools.crumbs.length ? 'cur' : ''}`} onClick={() => tools.exitTo(c.depth)}><Icon name="layers" size={12} /> {c.name}</button>
            </React.Fragment>
          ))}
          <span className="crumb-hint">Editando dentro do clipe composto — as mudanças aparecem no projeto</span>
        </div>
      )}
      <div className="tl-toolbar">
        <button className="icon-btn" title="Desfazer (Ctrl+Z)" disabled={!actions.canUndo} onClick={actions.undo}><Icon name="undo" size={16} /></button>
        <button className="icon-btn" title="Refazer (Ctrl+Y)" disabled={!actions.canRedo} onClick={actions.redo}><Icon name="redo" size={16} /></button>
        <div className="tl-sep" />
        <button className={`icon-btn ${tools.blade ? 'on' : ''}`} title="Lâmina (B): clique num clipe para cortar onde está o mouse · Shift+clique corta todas as camadas · V ou Esc volta à seleção" onClick={() => tools.setBlade(!tools.blade)}><Icon name="blade" size={16} /></button>
        <button className="icon-btn" title="Dividir no cursor (C ou Ctrl+B) · sem seleção corta todas as faixas" onClick={actions.split}><Icon name="scissors" size={16} /></button>
        <button className="icon-btn" title="Excluir à esquerda (Q)" onClick={() => actions.trimSide('left')}><Icon name="splitL" size={16} /></button>
        <button className="icon-btn" title="Excluir à direita (W)" onClick={() => actions.trimSide('right')}><Icon name="splitR" size={16} /></button>
        <button className="icon-btn" title="Excluir (Delete)" disabled={!selectedId && !selectedTr} onClick={actions.remove}><Icon name="trash" size={16} /></button>
        <button className="icon-btn" title="Duplicar (Ctrl+D)" disabled={!selectedId} onClick={actions.duplicate}><Icon name="copy" size={16} /></button>
        <button className="icon-btn" title="Congelar quadro (F): pausa a imagem no cursor por 2s" onClick={actions.freeze}><Icon name="freeze" size={16} /></button>
        <div className="tl-sep" />
        <button className="icon-btn" title="Keyframe no cursor (K)" disabled={!selectedId} onClick={actions.keyframe}><Icon name="diamond" size={15} stroke={2} /></button>
        <button className="icon-btn" title="Marcador (M): cria no cursor; se já houver um ali, remove · botão direito remove todos" onClick={actions.marker}
          onContextMenu={(e) => { e.preventDefault(); if (markers.length) actions.clearMarkers(); }}><Icon name="marker" size={15} /></button>
        <div className="tl-sep" />
        <button className="icon-btn" title="Criar clipe composto (Ctrl+G): selecione 2 ou mais clipes com Ctrl+clique" disabled={!actions.canCompound} onClick={actions.compound}><Icon name="layers" size={16} /></button>
        <button className="icon-btn" title="Desfazer clipe composto (Ctrl+Shift+G)" disabled={!actions.canUngroup} onClick={actions.ungroup}><Icon name="ungroup" size={16} /></button>
        <div className="spacer" />
        <button className={`icon-btn rec-btn ${tools.recording ? 'recording' : ''}`} title={tools.recording ? 'Parar gravação da narração' : 'Gravar narração (microfone) a partir do cursor'} onClick={tools.onRecord}>
          <Icon name="mic" size={16} />{tools.recording && <span className="rec-dot" />}
        </button>
        <div className="tl-sep" />
        <div className="tl-switches">
          <button className={`sw-btn ${tools.ripple ? 'on' : ''}`} title="Fechar buracos: ao excluir um clipe ou trecho (Delete, Q, W), o que vem depois na mesma linha anda para trás" onClick={() => tools.setRipple(!tools.ripple)}><Icon name="ripple" size={17} /></button>
          <button className={`sw-btn ${tools.mainMagnet ? 'on' : ''}`} title="Ímã da faixa principal: os clipes da Principal ficam encostados, sem buracos" onClick={() => tools.setMainMagnet(!tools.mainMagnet)}><Icon name="mainMagnet" size={17} /></button>
          <button className={`sw-btn ${snap ? 'on' : ''}`} title="Encaixe automático: clipes e cursor grudam em cortes, keyframes e marcadores (Alt solta)" onClick={() => setSnap(!snap)}><Icon name="autoSnap" size={17} /></button>
          <button className={`sw-btn ${tools.linkage ? 'on' : ''}`} title="Vinculação: textos, efeitos e sobreposições acompanham o clipe da Principal sob eles" onClick={() => tools.setLinkage(!tools.linkage)}><Icon name="linkage" size={17} /></button>
          <button className={`sw-btn ${tools.skim ? 'on' : ''}`} title="Eixo de visualização: passe o mouse na linha do tempo para ver o quadro no reprodutor" onClick={() => tools.setSkim(!tools.skim)}><Icon name="previewAxis" size={17} /></button>
        </div>
        <div className="tl-sep" />
        <button className="icon-btn" title="Diminuir zoom" onClick={() => setZoom((z) => clamp(z / 1.3, 8, 300))}><Icon name="zoomOut" size={16} /></button>
        <input className="zoom-range" type="range" min={8} max={300} value={zoom} style={{ '--p': `${((zoom - 8) / 292) * 100}%` }} onChange={(e) => setZoom(+e.target.value)} aria-label="Zoom" />
        <button className="icon-btn" title="Aumentar zoom" onClick={() => setZoom((z) => clamp(z * 1.3, 8, 300))}><Icon name="zoomIn" size={16} /></button>
      </div>
      <div className="tl-scroll" ref={scrollRef} onPointerMove={(e) => { skimMove(e); bladeMove(e); }} onPointerLeave={skimLeave}>
        <div className={`tl-content ${cols.matte ? '' : 'no-matte'} ${cols.parent ? '' : 'no-parent'}`} style={{ width: hw + width, '--c-matte': cols.matte ? '70px' : '0px', '--c-parent': cols.parent ? '108px' : '0px' }}>
          <div className="tl-row tl-ruler-row">
            <div className="tl-head tl-corner ae-cols" style={{ width: hw }}>
              <span className="ae-sw" title="Visível · Áudio · Solo · Bloqueio"><Icon name="eye" size={11} /><Icon name="volume" size={11} /><span className="solo-dot" /><Icon name="lock" size={11} /></span>
              <span className="ae-label-h"><Icon name="tag" size={10} /></span>
              <span className="ae-num">#</span>
              <span className="ae-tc">{fmt(time)}</span>
              <span className="ae-col ae-matte">TrkMat</span>
              <span className="ae-col ae-parent">Pai e vínculo</span>
              <div className="head-resizer" onPointerDown={startHeadResize} onDoubleClick={() => setHw(430)} title="Arraste para redimensionar o painel de camadas" />
            </div>
            <div className="tl-ruler" style={{ width, backgroundImage: rulerBg }} onPointerDown={startScrub}>
              {ticks.map((s) => <div key={s} className="tick" style={{ left: s * pps }}><span>{fmtShort(s)}</span></div>)}
              {markers.map((m) => (
                <div key={m.id} className="marker" style={{ left: m.t * pps }} title="Marcador — clique para ir · clique duplo ou botão direito remove"
                  onPointerDown={(e) => { e.stopPropagation(); if (e.button === 0) onSeek(m.t); }} onDoubleClick={() => actions.removeMarker(m.id)}
                  onContextMenu={(e) => { e.preventDefault(); actions.removeMarker(m.id); }} />
              ))}
            </div>
          </div>
          <div className="tl-fill"><div className="tl-head" style={{ width: hw }} /></div>
          {rows.map(({ tr, lane, ghost }) => {
            const rk = rowKey(tr.id, lane);
            const st = trackState[rk] || {};
            const trackClips = clips.filter((c) => c.track === tr.id && laneOf(c) === lane);
            const nLanes = rows.filter((r) => r.tr === tr && !r.ghost).length;
            const info = rowInfo.get(rk);
            const label = rowLabel(trackState, tr.id, lane);
            const opts = parentOpts.filter((o) => o.rk !== rk && !parentChainHas(trackState, o.rk, rk));
            return (
              <React.Fragment key={rk}>
              <div className={`tl-row ${ghost ? 'ghost-row' : ''} ${lane ? 'sub-row' : ''} ${whip?.over === rk && whip.rk !== rk ? 'whip-over' : ''}`}>
                <LayerHead tr={tr} lane={lane} ghost={ghost} rk={rk} st={st} num={info?.num} name={rowName(trackState, tr, lane, nLanes)} label={label}
                  hw={hw} height={tr.h} parentOptions={opts} rowApi={rowApi} onWhipStart={startWhip} open={!!st.open}
                  onLabelMenu={(k, at) => setLabelMenu({ rk: k, at })} />
                <div className={`tl-lane lane-${tr.id} ${dropTrack === rk ? 'drop' : ''}`} data-track={tr.id} data-lane={lane}
                  style={{ width, height: tr.h, opacity: st.hidden ? 0.5 : 1 }}
                  onPointerDown={(e) => { if (e.target === e.currentTarget) startMarquee(e); }}
                  onDragOver={(e) => { if (dropTypes.some((t) => e.dataTransfer.types.includes(t))) { e.preventDefault(); setDropTrack(rk); } }}
                  onDragLeave={() => setDropTrack(null)}
                  onDrop={(e) => {
                    setDropTrack(null);
                    const at = Math.max(0, laneT(e.clientX));
                    const asset = e.dataTransfer.getData('text/asset');
                    const fx = e.dataTransfer.getData('text/effect');
                    const trn = e.dataTransfer.getData('text/transition');
                    if (!asset && !fx && !trn) return;
                    e.preventDefault();
                    e.stopPropagation();
                    if (asset) onDropAsset(asset, tr.id, at, lane);
                    else if (fx) onDropEffect(fx, at);
                    else onDropTransition(trn, at, rk);
                  }}>
                  {trackClips.map((c) => (
                    <ClipView key={c.id} c={c} asset={assetMap[c.assetId]} pps={pps} selected={c.id === selectedId || multi.includes(c.id)} onDown={startDrag} onKfDown={startKfDrag} onOpen={actions.enterCompound} label={label} locked={st.lock} />
                  ))}
                  {pairs.filter((pr) => pr.row === rk).map(({ B, d }) => {
                    const w = Math.max(18, d * pps);
                    return (
                      <div key={'tr' + B.id} className={`tr-marker ${selectedTr === B.id ? 'sel' : ''}`} style={{ left: B.start * pps - w / 2, width: w }}
                        title={`Transição: ${TRANSITION_MAP[B.transition.type]?.name}`} onPointerDown={(e) => { e.stopPropagation(); onSelectTr(B.id); }}>
                        <Icon name="transition" size={10} stroke={2.2} />
                      </div>
                    );
                  })}
                  {ghost && <div className="lane-hint"><Icon name="plus" size={14} /> Solte aqui para criar uma camada acima</div>}
                  {tr.id === 'main' && trackClips.length === 0 && (
                    <div className="lane-hint"><Icon name="film" size={14} /> Arraste vídeos ou imagens para cá</div>
                  )}
                </div>
              </div>
              {!ghost && st.open && (
                <PropRows tr={tr} rk={rk} clip={focusClip(clips, rk, time, selectedId)} time={time} pps={pps} width={width} hw={hw}
                  rowApi={rowApi} onSeek={onSeek} />
              )}
              </React.Fragment>
            );
          })}
          {tools.blade && bladeT && <div className={`tl-blade ${bladeT.all ? 'all' : ''}`} style={{ left: hw + bladeT.t * pps }}><span>{bladeT.all ? 'Cortar tudo · ' : ''}{fmt(bladeT.t)}</span></div>}
          {marq && <div className="tl-marquee" style={marq} />}
          {skimT != null && <div className="tl-skim" style={{ left: hw + skimT * pps }}><span>{fmt(skimT)}</span></div>}
          <div className={`tl-playhead ${phSnap ? 'snapped' : ''}`} style={{ left: hw + time * pps }}>
            <div className="ph-handle" onPointerDown={startScrub} />
          </div>
          {labelMenu && <LabelMenu at={labelMenu.at} current={trackState[labelMenu.rk]?.label ?? DEFAULT_LABEL[rowTrack(labelMenu.rk)]}
            onPick={(i) => rowApi.setRow(labelMenu.rk, { label: i })} onClose={() => setLabelMenu(null)} />}
          {whip && (
            <svg className="whip-line"><line x1={whip.x0} y1={whip.y0} x2={whip.x} y2={whip.y} /><circle cx={whip.x} cy={whip.y} r="4" /></svg>
          )}
        </div>
      </div>
    </div>
  );
}
