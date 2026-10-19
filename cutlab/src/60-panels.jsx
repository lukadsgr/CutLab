/* =====================================================================
   Barra superior com menu
   ===================================================================== */
function TopBar({ name, setName, onExport, canExport, hist, menu, saveState }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!ref.current.contains(e.target)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  const item = (label, fn, kbd, disabled) => (
    <button className="menu-item" disabled={disabled} onClick={() => { setOpen(false); fn(); }}>
      <span>{label}</span>{kbd && <kbd>{kbd}</kbd>}
    </button>
  );
  return (
    <header className="topbar">
      <div className="brand"><div className="logo"><Icon name="logo" size={16} stroke={2} /></div>CutLab</div>
      <div className="menu-wrap" ref={ref}>
        <button className={`menu-btn ${open ? 'on' : ''}`} onClick={() => setOpen(!open)}>Menu <Icon name="chevronD" size={12} /></button>
        {open && (
          <div className="menu">
            {item('Novo projeto', menu.newProject)}
            {item('Abrir projeto…', menu.openProject, 'Ctrl+O')}
            {item('Salvar projeto…', menu.saveProject, 'Ctrl+S')}
            {item('Salvar pacote com mídias…', menu.savePackage)}
            <div className="menu-sep" />
            {item('Importar mídia…', menu.importMedia, 'Ctrl+I')}
            {item('Exportar…', onExport, 'Ctrl+E', !canExport)}
            <div className="menu-sep" />
            {item('Remover todos os marcadores', menu.clearMarkers, null, !menu.hasMarkers)}
            <div className="menu-sep" />
            {item(menu.diagOn ? 'Fechar diagnóstico de reprodução' : 'Diagnóstico de reprodução', menu.diag, 'Ctrl+Shift+D')}
            {item('Atalhos de teclado', menu.shortcuts)}
            {item('Tutorial rápido', openTour)}
            {item('Novidades', openWhatsNew)}
            {DESKTOP && item('Procurar atualizações…', openUpdates)}
            {item('Sobre o CutLab', menu.about)}
          </div>
        )}
      </div>
      {/* nome centrado na janela; o aviso de salvamento fica ao lado, sem empurrá-lo */}
      <div className="proj-center">
        <input className="proj-name" value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} aria-label="Nome do projeto" />
        {saveState !== 'idle' && <span className={`save-state ${saveState}`} title={saveState === 'error' ? 'O navegador recusou o salvamento (espaço cheio?). Use Menu › Salvar projeto.' : 'Salvo automaticamente neste navegador'}>
          {saveState === 'saving' ? 'Salvando…' : saveState === 'saved' ? 'Salvo' : 'Não salvo'}</span>}
      </div>
      <div className="spacer" />
      <UpdateButton />
      <button className="icon-btn" title="Desfazer (Ctrl+Z)" disabled={!hist.canUndo} onClick={hist.undo}><Icon name="undo" /></button>
      <button className="icon-btn" title="Refazer (Ctrl+Y)" disabled={!hist.canRedo} onClick={hist.redo}><Icon name="redo" /></button>
      <button className="btn btn-primary" disabled={!canExport} onClick={onExport}><Icon name="download" size={16} /> Exportar</button>
    </header>
  );
}

/* =====================================================================
   Player
   ===================================================================== */
const ZOOMS = [0.5, 1, 1.5, 2, 3, 4, 6, 8];
const RULER = 20; // espessura das réguas, em px
/** qualidade da prévia (como no CapCut): o reprodutor desenha num quadro menor que o do projeto.
 *  `short` = lado menor máximo em px; a exportação usa sempre a resolução do projeto */
const PREVIEW_Q = {
  perf: { label: 'Desempenho', short: 360, hint: '360p · mais leve', tip: 'prévia em 360p, reprodução mais leve' },
  auto: { label: 'Equilibrada', short: 540, hint: 'até 540p · padrão', tip: 'prévia em até 540p (padrão)' },
  full: { label: 'Completa', short: Infinity, hint: 'resolução do projeto', tip: 'prévia na resolução do projeto, mais pesada' },
};
const PREVIEW_STEPS = [360, 540, 720, 1080, 1440, 2160];
/** tamanho do canvas da prévia: limitado pela qualidade e pelo tamanho em que ele aparece na tela */
function previewSize(W, H, quality, onScreenShort, full) {
  const S = Math.min(W, H);
  let s = S;
  if (!full) {
    // em degraus: redimensionar o painel não recria o canvas a cada pixel
    const fit = PREVIEW_STEPS.find((x) => x >= onScreenShort) ?? S;
    s = Math.min(S, (PREVIEW_Q[quality] || PREVIEW_Q.auto).short, fit);
  }
  const f = s / S;
  return [Math.max(2, Math.round(W * f)), Math.max(2, Math.round(H * f))];
}
function Player({ W, H, ratio, setRatio, canvasRef, overlayRef, time, duration, playing, onToggle, onSeek, onPreviewDown, onPreviewMove, onPreviewLeave, tool, empty, rulers, setRulers, guides, setGuides, onPreviewDbl, textEdit, quality = 'auto', setQuality, fullRes }) {
  const stageRef = useRef();
  const wrapRef = useRef();
  const miniRef = useRef();
  const [box, setBox] = useState([0, 0]);
  const [view, setView] = useState({ z: 1, x: 0, y: 0 });
  const [anim, setAnim] = useState(true);
  const [hand, setHand] = useState(false);
  const [panning, setPanning] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  const boxRef = useRef(box);
  boxRef.current = box;
  useEffect(() => {
    const el = stageRef.current;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const pad = 32 + (rulers ? RULER : 0);
      const s = Math.min((r.width - pad) / W, (r.height - pad) / H);
      setBox((b) => { const n = [Math.max(10, W * s), Math.max(10, H * s)]; return Math.abs(b[0] - n[0]) < 0.5 && Math.abs(b[1] - n[1]) < 0.5 ? b : n; });
    };
    // mede já na montagem e também por intervalo: o ResizeObserver pode não disparar com o painel em segundo plano
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const iv = setInterval(measure, 500);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); clearInterval(iv); window.removeEventListener("resize", measure); };
  }, [W, H, rulers]);

  /* ---------- réguas (em px do quadro) ---------- */
  const rulerTop = useRef(), rulerLeft = useRef();
  useEffect(() => {
    if (!rulers) return;
    let raf;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const st = stageRef.current, wr = wrapRef.current, mouse = mouseScr.current;
      if (!st || !wr) return;
      const sr = st.getBoundingClientRect(), r = wr.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const ppu = r.width / W; // px de tela por px do quadro
      if (!(ppu > 1e-4) || !sr.width || !sr.height) return; // reprodutor oculto/sem tamanho: nada a desenhar
      const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((s) => s * ppu >= 9) || 1000;
      const major = step * ([1, 2, 5, 10, 20, 50, 100, 200, 500].includes(step) ? 10 : 4);
      for (const [cv, horiz] of [[rulerTop.current, true], [rulerLeft.current, false]]) {
        if (!cv) continue;
        const len = horiz ? sr.width - RULER : sr.height - RULER;
        const cw = Math.round((horiz ? len : RULER) * dpr), ch = Math.round((horiz ? RULER : len) * dpr);
        if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
        const x = cv.getContext('2d');
        x.setTransform(dpr, 0, 0, dpr, 0, 0);
        x.clearRect(0, 0, cw, ch);
        const o = horiz ? r.left - sr.left - RULER : r.top - sr.top - RULER; // origem do quadro na régua
        const span = horiz ? W : H;
        // área do quadro destacada
        x.fillStyle = 'rgba(255,255,255,0.035)';
        if (horiz) x.fillRect(o, 0, span * ppu, RULER); else x.fillRect(0, o, RULER, span * ppu);
        x.strokeStyle = 'rgba(255,255,255,0.28)';
        x.fillStyle = 'rgba(255,255,255,0.55)';
        x.font = "500 9px 'Geist Mono', monospace";
        x.lineWidth = 1;
        const u0 = Math.floor(-o / ppu / step) * step, u1 = (len - o) / ppu;
        x.beginPath();
        for (let u = u0, n = 0; u <= u1 && n < 2000; u += step, n++) {
          const p = Math.round(o + u * ppu) + 0.5, big = u % major === 0, mid = !big && u % (major / 2) === 0;
          const tl = big ? RULER : mid ? 8 : 4;
          if (horiz) { x.moveTo(p, RULER); x.lineTo(p, RULER - tl); } else { x.moveTo(RULER, p); x.lineTo(RULER - tl, p); }
          if (big) {
            if (horiz) x.fillText(String(u), p + 3, 9);
            else { x.save(); x.translate(9, p + 3); x.rotate(-Math.PI / 2); x.textAlign = 'right'; x.fillText(String(u), 0, 0); x.restore(); }
          }
        }
        x.stroke();
        // centro do quadro e posição do mouse
        x.fillStyle = '#ff2d46';
        const c = o + (span / 2) * ppu;
        if (horiz) { x.beginPath(); x.moveTo(c - 4, 0); x.lineTo(c + 4, 0); x.lineTo(c, 5); x.fill(); }
        else { x.beginPath(); x.moveTo(0, c - 4); x.lineTo(0, c + 4); x.lineTo(5, c); x.fill(); }
        if (mouse) {
          const m = horiz ? mouse[0] - sr.left - RULER : mouse[1] - sr.top - RULER;
          x.strokeStyle = '#ff2d46'; x.beginPath();
          if (horiz) { x.moveTo(m + 0.5, 0); x.lineTo(m + 0.5, RULER); } else { x.moveTo(0, m + 0.5); x.lineTo(RULER, m + 0.5); }
          x.stroke();
        }
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [rulers, W, H]);
  const mouseScr = useRef(null);
  /** arrastar da régua cria uma guia; soltar de volta na régua apaga */
  const dragGuide = (axis, idx) => (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const list = axis === 'v' ? 'v' : 'h';
    let i = idx ?? -1;
    const at = (ev) => {
      const r = wrapRef.current.getBoundingClientRect();
      return list === 'v' ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height;
    };
    const overRuler = (ev) => {
      const sr = stageRef.current.getBoundingClientRect();
      return list === 'v' ? ev.clientX < sr.left + RULER : ev.clientY < sr.top + RULER;
    };
    const set = (f) => setGuides((g) => {
      const arr = [...g[list]];
      if (i < 0) { i = arr.length; arr.push(f); } else arr[i] = f;
      return { ...g, [list]: arr };
    });
    const move = (ev) => {
      let f = at(ev);
      // guias encaixam no centro e nas bordas do quadro
      for (const t of [0, 0.5, 1]) if (Math.abs(f - t) * (list === 'v' ? wrapRef.current.getBoundingClientRect().width : wrapRef.current.getBoundingClientRect().height) < 6) f = t;
      set(Math.round(f * 10000) / 10000);
      setGuideTip({ list, f, x: ev.clientX, y: ev.clientY });
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setGuideTip(null);
      if (i >= 0 && overRuler(ev)) setGuides((g) => ({ ...g, [list]: g[list].filter((_, j) => j !== i) }));
    };
    if (idx == null) move(e);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const [guideTip, setGuideTip] = useState(null);
  useEffect(() => setView({ z: 1, x: 0, y: 0 }), [W, H]);

  /** limita o deslocamento para o conteúdo não sumir da tela */
  const clampView = (v) => {
    const r = stageRef.current.getBoundingClientRect(), b = boxRef.current;
    const mx = Math.max(0, (b[0] * v.z - r.width) / 2 + 60), my = Math.max(0, (b[1] * v.z - r.height) / 2 + 60);
    return { z: v.z, x: clamp(v.x, -mx, mx), y: clamp(v.y, -my, my) };
  };
  /** zoom mantendo fixo o ponto sob o cursor (ou o centro) */
  const zoomTo = (z, cx, cy, smooth = true) => {
    z = clamp(z, 0.25, 12);
    const r = stageRef.current.getBoundingClientRect();
    const v = viewRef.current;
    const mx = (cx ?? r.left + r.width / 2) - (r.left + r.width / 2), my = (cy ?? r.top + r.height / 2) - (r.top + r.height / 2);
    const px = (mx - v.x) / v.z, py = (my - v.y) / v.z;
    setAnim(smooth);
    setView(clampView({ z, x: z <= 1 ? 0 : mx - px * z, y: z <= 1 ? 0 : my - py * z }));
  };
  const step = (dir) => {
    const z = viewRef.current.z;
    const next = dir > 0 ? ZOOMS.find((q) => q > z + 0.01) ?? 12 : [...ZOOMS].reverse().find((q) => q < z - 0.01) ?? 0.25;
    zoomTo(next);
  };
  const fitView = () => { setAnim(true); setView({ z: 1, x: 0, y: 0 }); };

  // roda: Ctrl/⌘ (ou pinça no touchpad) = zoom no cursor; sem Ctrl com zoom ativo = mover a vista
  useEffect(() => {
    const el = stageRef.current;
    const wheel = (e) => {
      const v = viewRef.current;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomTo(v.z * Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0022)), e.clientX, e.clientY, false);
      } else if (v.z > 1) {
        e.preventDefault();
        setAnim(false);
        const dx = e.shiftKey ? e.deltaY : e.deltaX, dy = e.shiftKey ? 0 : e.deltaY;
        setView(clampView({ ...v, x: v.x - dx, y: v.y - dy }));
      }
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);
  // atalhos: Ctrl + / Ctrl − / Ctrl 0 (ajustar) e H (mão)
  useEffect(() => {
    const key = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); step(1); }
      else if (mod && e.key === '-') { e.preventDefault(); step(-1); }
      else if (mod && e.key === '0') { e.preventDefault(); fitView(); }
      else if (!mod && (e.key === 'h' || e.key === 'H')) setHand((h) => !h);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  // arrastar a vista: ferramenta Mão ou botão do meio do mouse
  const startPan = (e) => {
    if (!(hand || e.button === 1)) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, v0 = viewRef.current;
    setAnim(false);
    setPanning(true);
    const move = (ev) => setView(clampView({ ...v0, x: v0.x + ev.clientX - sx, y: v0.y + ev.clientY - sy }));
    const up = () => { setPanning(false); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  // minimapa: quadro inteiro + área visível
  const zoomed = view.z > 1.01;
  useEffect(() => {
    if (!zoomed) return;
    const iv = setInterval(() => {
      const m = miniRef.current, cv = canvasRef.current;
      if (!m || !cv) return;
      const w = 150, h = Math.round((150 * H) / W);
      if (m.width !== w || m.height !== h) { m.width = w; m.height = h; }
      m.getContext('2d').drawImage(cv, 0, 0, w, h);
    }, 120);
    return () => clearInterval(iv);
  }, [zoomed, W, H]);
  const stageR = stageRef.current?.getBoundingClientRect();
  const visW = stageR ? Math.min(1, stageR.width / (box[0] * view.z)) : 1, visH = stageR ? Math.min(1, stageR.height / (box[1] * view.z)) : 1;
  const visX = 0.5 - view.x / (box[0] * view.z) - visW / 2, visY = 0.5 - view.y / (box[1] * view.z) - visH / 2;
  const miniDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setAnim(false);
    const go = (ev) => {
      const u = clamp((ev.clientX - r.left) / r.width, 0, 1), v = clamp((ev.clientY - r.top) / r.height, 0, 1);
      const z = viewRef.current.z;
      setView(clampView({ z, x: (0.5 - u) * boxRef.current[0] * z, y: (0.5 - v) * boxRef.current[1] * z }));
    };
    go(e);
    const up = () => { window.removeEventListener('pointermove', go); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', go);
    window.addEventListener('pointerup', up);
  };
  const pct = Math.round(view.z * 100);
  const [PW, PH] = previewSize(W, H, quality, Math.min(box[0], box[1]) * view.z * (window.devicePixelRatio || 1), fullRes);

  return (
    <section className="player">
      <div className="player-head">
        Reprodutor
        <div className="spacer" />
        Proporção
        <div className="seg">
          {Object.keys(RATIOS).map((r) => <button key={r} className={r === ratio ? 'on' : ''} onClick={() => setRatio(r)}>{r}</button>)}
        </div>
      </div>
      <div className={`stage ${hand ? 'hand' : ''} ${panning ? 'panning' : ''} ${rulers ? 'with-rulers' : ''}`} ref={stageRef} onPointerDown={startPan} onAuxClick={(e) => e.preventDefault()}
        onPointerMove={(e) => { mouseScr.current = [e.clientX, e.clientY]; }} onPointerLeave={() => { mouseScr.current = null; }}>
        <div className={`canvas-wrap ${anim ? 'zoom-anim' : ''} ${view.z >= 3 ? 'pixelated' : ''}`} ref={wrapRef}
          style={{ width: box[0], height: box[1], transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
          <canvas ref={canvasRef} width={PW} height={PH} />
          <canvas ref={overlayRef} className={`overlay tool-${tool || 'none'}`} onPointerDown={(e) => { if (hand || e.button === 1) return; onPreviewDown(e); }} onPointerMove={onPreviewMove} onPointerLeave={onPreviewLeave} onDoubleClick={onPreviewDbl} />
          {textEdit && <TextEditor {...textEdit} W={W} H={H} />}
          {rulers && guides.v.map((f, i) => (
            <div key={'v' + i} className="guide v" style={{ left: `${f * 100}%`, '--z': view.z }} onPointerDown={dragGuide('v', i)}
              onDoubleClick={() => setGuides((g) => ({ ...g, v: g.v.filter((_, j) => j !== i) }))} title="Guia — arraste para mover · arraste até a régua ou clique duplo para remover" />
          ))}
          {rulers && guides.h.map((f, i) => (
            <div key={'h' + i} className="guide h" style={{ top: `${f * 100}%`, '--z': view.z }} onPointerDown={dragGuide('h', i)}
              onDoubleClick={() => setGuides((g) => ({ ...g, h: g.h.filter((_, j) => j !== i) }))} title="Guia — arraste para mover · arraste até a régua ou clique duplo para remover" />
          ))}
        </div>
        {rulers && (<>
          <canvas className="ruler top" ref={rulerTop} onPointerDown={dragGuide('h')} title="Arraste para criar uma guia horizontal" />
          <canvas className="ruler left" ref={rulerLeft} onPointerDown={dragGuide('v')} title="Arraste para criar uma guia vertical" />
          <button className="ruler-corner" title="Limpar guias" onClick={() => setGuides({ v: [], h: [] })} disabled={!guides.v.length && !guides.h.length}><Icon name="x" size={11} /></button>
        </>)}
        {guideTip && <div className="guide-tip" style={{ left: guideTip.x + 12, top: guideTip.y + 12 }}>{guideTip.list === 'v' ? 'X' : 'Y'} {Math.round(guideTip.f * (guideTip.list === 'v' ? W : H))} px{guideTip.f === 0.5 ? ' · centro' : ''}</div>}
        {empty && <div className="empty-stage"><div>Importe mídia, adicione um texto<br />ou escolha um modelo para começar</div></div>}
        {zoomed && (
          <div className="minimap" onPointerDown={miniDrag} title="Arraste para navegar">
            <canvas ref={miniRef} />
            <span className="mini-view" style={{ left: `${visX * 100}%`, top: `${visY * 100}%`, width: `${visW * 100}%`, height: `${visH * 100}%` }} />
          </div>
        )}
      </div>
      <div className="player-bar">
        <div><ClockText className="tc cur" format={fmt} /> <span className="tc">/ {fmt(duration)}</span></div>
        <div className="transport">
          <button className="icon-btn" title="Início (Home)" onClick={() => onSeek(0)}><Icon name="skipBack" size={16} /></button>
          <button className={`play-btn ${playing ? 'is-playing' : ''}`} title="Reproduzir/Pausar (Espaço)" onClick={onToggle}><span key={playing ? 'p' : 's'} className="play-ic"><Icon name={playing ? 'pause' : 'play'} size={16} /></span></button>
          <button className="icon-btn" title="Fim (End)" onClick={() => onSeek(duration)}><Icon name="skipFwd" size={16} /></button>
        </div>
        <div className="zoom-ctl">
          <button className={`icon-btn ${rulers ? 'on' : ''}`} title="Réguas e guias (Shift R) — arraste da régua para criar guias" onClick={() => setRulers(!rulers)}><Icon name="ruler" size={15} /></button>
          <button className={`icon-btn ${hand ? 'on' : ''}`} title="Mão: arrastar a vista (H) · o botão do meio do mouse também move" onClick={() => setHand(!hand)}><Icon name="hand" size={15} /></button>
          <Dropdown className="mini-dd q-dd" value={quality} onChange={(v) => setQuality?.(v)}
            title={`Qualidade da prévia: ${PREVIEW_Q[quality]?.tip || ''} · agora ${PW}×${PH} · a exportação não muda`}
            options={Object.entries(PREVIEW_Q).map(([id, q]) => ({ id, label: q.label, hint: q.hint }))} />
          <button className="icon-btn" title="Diminuir zoom (Ctrl −)" onClick={() => step(-1)}><Icon name="zoomOut" size={15} /></button>
          <select className="zoom-sel" value="" onChange={(e) => (e.target.value === 'fit' ? fitView() : zoomTo(parseFloat(e.target.value)))} title="Zoom — Ctrl + roda do mouse no reprodutor">
            <option value="" hidden>{pct}%</option>
            <option value="fit">Ajustar (Ctrl 0)</option>
            {ZOOMS.map((z) => <option key={z} value={z}>{z * 100}%</option>)}
          </select>
          <button className="icon-btn" title="Aumentar zoom (Ctrl +)" onClick={() => step(1)}><Icon name="zoomIn" size={15} /></button>
          <button className="icon-btn" title="Tela cheia" onClick={() => wrapRef.current.requestFullscreen?.()}><Icon name="maximize" size={15} /></button>
        </div>
      </div>
    </section>
  );
}

/* =====================================================================
   Controles do inspetor
   ===================================================================== */
function Slider({ label, value, min, max, step = 1, onChange, kf, onKf, track, def }) {
  value = value ?? def ?? min;
  const pct = clamp(((value - min) / (max - min)) * 100, 0, 100);
  const dec = step < 1 ? (step < 0.1 ? 2 : 1) : 0;
  const z = clamp((-min / (max - min)) * 100, 0, 100);
  const bg = track || (min < 0 && max > 0
    ? `linear-gradient(90deg, var(--track) ${Math.min(z, pct)}%, var(--accent) ${Math.min(z, pct)}%, var(--accent) ${Math.max(z, pct)}%, var(--track) ${Math.max(z, pct)}%)`
    : undefined);
  return (
    <div className={`field ${kf === 'on' ? 'kf-on' : ''}`}>
      <div className="field-top">
        <label onDoubleClick={() => def != null && onChange(def)} title={def != null ? 'Clique duplo para restaurar' : undefined}>{label}</label>
        <div className="row" style={{ gap: 6 }}>
          <input className="num" type="number" value={Number(value).toFixed(dec)} step={step}
            onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(clamp(v, min, max)); }} />
          {onKf && (
            <button className={`kf-btn ${kf}`} title={kf === 'on' ? 'Remover keyframe' : 'Adicionar keyframe'} onClick={onKf}>
              <Icon name={kf === 'on' ? 'diamondFill' : 'diamond'} size={13} stroke={2} />
            </button>
          )}
        </div>
      </div>
      <input type="range" className={track ? 'has-track' : ''} min={min} max={max} step={step} value={value} style={{ '--p': `${pct}%`, ...(bg ? { background: bg } : null) }}
        onChange={(e) => onChange(parseFloat(e.target.value))} onDoubleClick={() => def != null && onChange(def)} aria-label={label} />
    </div>
  );
}

/* abas que usam a barra de keyframes geral (as demais têm keyframes por seção) */
const TAB_KF = {
  'Áudio': ['volume'],
  'Efeito': ['intensity'],
  'Texto': ['fontSize'],
};
const MASK_KF = ['maskX', 'maskY', 'maskW', 'maskH', 'maskRot', 'maskFeather', 'maskRound'];
const MASK_RESET = { maskX: 0, maskY: 0, maskW: 60, maskH: 60, maskRot: 0, maskFeather: 0, maskRound: 0, maskInvert: false };
const CHROMA_RESET = { chromaColor: '#00ff00', chromaStrength: 40, chromaSoft: 20, chromaSpill: 50, chromaMatte: false };

/** seção recolhível no estilo do painel do CapCut: caixa de ativação, redefinir e navegação de keyframes */
function Section({ title, checked, onCheck, onReset, kf, badge, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="sec">
      <div className="sec-head">
        {onCheck && <input type="checkbox" className="chk" checked={!!checked} onChange={(e) => onCheck(e.target.checked)} aria-label={title} />}
        <button className="sec-title" onClick={() => setOpen(!open)}>{title}<Icon name={open ? 'chevronD' : 'chevronR'} size={12} /></button>
        {badge}
        <div className="spacer" />
        {onReset && <button className="icon-btn sm" title="Redefinir" onClick={onReset}><Icon name="reset" size={13} /></button>}
        {kf && <KfNav {...kf} />}
      </div>
      {open && <div className={`sec-body ${onCheck && !checked ? 'off' : ''}`}>{children}</div>}
    </div>
  );
}
function KfNav({ clip, props, local, kfApi }) {
  const times = kfTimes({ keyframes: Object.fromEntries(props.filter((k) => hasKf(clip, k)).map((k) => [k, clip.keyframes[k]])) });
  const on = props.every((k) => kfAtTime(clip, k, local));
  const some = props.some((k) => kfAtTime(clip, k, local));
  return (
    <div className="kf-nav">
      <button className="icon-btn sm" disabled={!times.some((t) => t < local - KF_EPS)} onClick={() => kfApi.nav(-1, props)} title="Keyframe anterior"><Icon name="chevronL" size={12} /></button>
      <button className={`kf-btn ${on ? 'on' : some || times.length ? 'animated' : 'none'}`} onClick={() => kfApi.toggleGroup(clip.id, props)} title={on ? 'Remover keyframes desta seção' : 'Adicionar keyframe nesta seção'}>
        <Icon name={on ? 'diamondFill' : 'diamond'} size={13} stroke={2} />
      </button>
      <button className="icon-btn sm" disabled={!times.some((t) => t > local + KF_EPS)} onClick={() => kfApi.nav(1, props)} title="Próximo keyframe"><Icon name="chevronR" size={12} /></button>
    </div>
  );
}
/** mostrador circular de ângulo (arraste para girar; Shift = passos de 15°) */
function AngleDial({ value, onChange, size = 38 }) {
  const ref = useRef();
  const down = (e) => {
    e.preventDefault();
    const go = (ev) => {
      const r = ref.current.getBoundingClientRect();
      let a = (Math.atan2(ev.clientY - r.top - r.height / 2, ev.clientX - r.left - r.width / 2) * 180) / Math.PI;
      if (ev.shiftKey) a = Math.round(a / 15) * 15;
      onChange(Math.round(a));
    };
    go(e);
    const up = () => { window.removeEventListener('pointermove', go); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', go);
    window.addEventListener('pointerup', up);
  };
  const r = (value * Math.PI) / 180;
  return (
    <div className="angle-dial" ref={ref} onPointerDown={down} style={{ width: size, height: size }} title="Arraste para definir a direção da sombra (Shift = 15°)">
      <span className="angle-hand" style={{ transform: `rotate(${value}deg)` }} />
      <span className="angle-dot" style={{ left: `${50 + Math.cos(r) * 38}%`, top: `${50 + Math.sin(r) * 38}%` }} />
    </div>
  );
}
/** menu de modos de mistura com prévia ao passar o mouse */
function BlendSelect({ value, onChange, onPreview }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!ref.current.contains(e.target)) { setOpen(false); onPreview(null); } };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  const item = (b) => (
    <button key={b.id} className={`dd-item ${b.id === value ? 'on' : ''}`} onMouseEnter={() => onPreview(b.id)}
      onClick={() => { onChange(b.id); onPreview(null); setOpen(false); }}>
      <span className="dd-check">{b.id === value ? '✓' : ''}</span>{b.name}
    </button>
  );
  return (
    <div className="dd" ref={ref}>
      <button className="select dd-btn" onClick={() => setOpen(!open)}>{BLEND_MODES.find((b) => b.id === value)?.name}<Icon name="chevronD" size={13} /></button>
      {open && (
        <div className="dd-list" onMouseLeave={() => onPreview(null)}>
          {BLEND_MODES.filter((b) => !b.extra).map(item)}
          <div className="dd-sep">Mais modos</div>
          {BLEND_MODES.filter((b) => b.extra).map(item)}
        </div>
      )}
    </div>
  );
}

const COLOR_SUBS = ['Básico', 'HSL', 'Curvas', 'Roda de cores', 'Estilo'];
const TAB_DEFS = {
  video: [{ id: 'Vídeo', subs: ['Básico', 'Remover fundo', 'Máscara', 'Retoque'] }, { id: 'Áudio' }, { id: 'Velocidade' }, { id: 'Animação' }, { id: 'Ajuste', subs: COLOR_SUBS }],
  image: [{ id: 'Imagem', subs: ['Básico', 'Remover fundo', 'Máscara', 'Retoque'] }, { id: 'Animação' }, { id: 'Ajuste', subs: COLOR_SUBS }],
  color: [{ id: 'Fundo', subs: ['Básico', 'Máscara'] }, { id: 'Animação' }, { id: 'Ajuste', subs: COLOR_SUBS }],
  text: [{ id: 'Texto' }, { id: 'Básico' }, { id: 'Animação' }],
  audio: [{ id: 'Áudio' }, { id: 'Velocidade' }],
  effect: [{ id: 'Efeito' }],
  adjust: [{ id: 'Ajuste', subs: COLOR_SUBS }],
  compound: [{ id: 'Composto', subs: ['Básico', 'Máscara'] }, { id: 'Áudio' }, { id: 'Animação' }, { id: 'Ajuste', subs: COLOR_SUBS }],
};

function Inspector({ clip, asset, local, setProps, setClip, kfApi, transition, trApi, project, tool, setTool, brush, setBrush, onAutoBg, setPreview, aspect, colorApi, penApi, capApi }) {
  const defs = clip ? TAB_DEFS[clip.type] || [] : [];
  const [tabState, setTab] = useState(defs[0]?.id);
  const [subs, setSubs] = useState({});
  const cur = defs.find((d) => d.id === tabState) || defs[0];
  const subTab = cur?.subs ? subs[cur.id] || cur.subs[0] : null;
  // "view" identifica o conteúdo exibido
  const tab = !cur ? null : cur.id === 'Ajuste' ? 'Ajuste:' + subTab : cur.subs ? (subTab === 'Remover fundo' ? 'Fundo' : subTab) : cur.id;
  // ferramentas do reprodutor acompanham a aba aberta
  const maskActive = clip?.props.maskOn && clip?.props.maskType !== 'none';
  useEffect(() => {
    if (tab === 'Máscara' && maskActive) setTool(clip.props.maskType === 'pen' ? 'pen' : 'mask');
    else if (tool === 'mask' || tool === 'pen' || (tab !== 'Fundo' && tool && !(tool === 'colorpick' && tab?.startsWith('Ajuste')))) setTool(null);
  }, [tab, maskActive, clip?.props.maskType]);
  useEffect(() => () => { setTool(null); setPreview(null); }, []);

  if (transition) return <TransitionPanel {...transition} {...trApi} />;
  if (!clip) return <ProjectPanel {...project} />;

  const p = resolveProps(clip, local);
  const sp = (k) => (v) => setProps(clip.id, { [k]: v }, `p:${clip.id}:${k}`);
  const kfState = (k) => (kfAtTime(clip, k, local) ? 'on' : hasKf(clip, k) ? 'animated' : 'none');
  const S = (label, k, min, max, step = 1, extra = {}) => (
    <Slider key={k} label={label} value={p[k] ?? BASE_PROPS[k] ?? TEXT_BASE[k]} min={min} max={max} step={step} onChange={sp(k)} kf={kfState(k)} onKf={() => kfApi.toggle(clip.id, k)} def={BASE_PROPS[k] ?? TEXT_BASE[k]} {...extra} />
  );
  const kfNav = (props) => ({ clip, props, local, kfApi });
  // formas "quadradas" (círculo, estrela, coração) compensam a proporção do clipe
  const squareFor = (type) => {
    const m = MASK_TYPES.find((x) => x.id === type);
    if (m?.square) return { maskW: 50, maskH: clamp(50 * (aspect || 16 / 9), 1, 250) };
    if (type === 'text') return { maskW: 80, maskH: 35 };
    if (type === 'film') return { maskH: 35 };
    return {};
  };
  const chooseMask = (type) => {
    if (type === 'none') { setProps(clip.id, { maskOn: false, maskType: 'none' }); return; }
    setProps(clip.id, { maskOn: true, maskType: type, ...(type !== p.maskType ? squareFor(type) : {}) });
  };
  const typeName = { video: 'Vídeo', image: 'Imagem', audio: 'Áudio', text: clip.track === 'caption' ? 'Legenda' : p.text?.length <= 2 ? 'Sticker' : 'Texto', color: 'Fundo', effect: 'Efeito', adjust: 'Ajuste', compound: 'Composto' }[clip.type];
  const title = clip.type === 'text' ? p.text.split('\n')[0] : clip.type === 'effect' ? EFFECT_MAP[p.effect]?.name : clip.name;
  const maxSpeedDur = asset && isMedia(clip) ? asset.duration : Infinity;
  const times = kfTimes(clip);
  const atKf = times.find((t) => Math.abs(t - local) < KF_EPS);
  const atKfEase = atKf != null ? Object.values(clip.keyframes).flat().find((f) => Math.abs(f.t - atKf) < KF_EPS)?.ease : null;
  const tabKf = TAB_KF[tab] || [];
  const setSpeed = (v, key) => {
    let dur = (clip.duration * clip.speed) / v;
    if (isFinite(maxSpeedDur)) dur = Math.min(dur, (maxSpeedDur - clip.in) / v);
    setClip(clip.id, { ...scaleKf(clip, clip.speed / v), speed: v, duration: dur }, key);
  };

  return (
    <aside className="inspector">
      <div className="insp-head">
        <h3>{typeName} · {title}</h3>
        <div className="sub">{fmt(clip.start)} → {fmt(clip.start + clip.duration)} · {fmtDur(clip.duration)}</div>
      </div>
      <div className="insp-tabs">
        <SegTabs variant="line" items={defs.map((d) => d.id)} value={cur.id} onChange={(v) => vt(() => setTab(v))} />
      </div>
      {cur.subs && (
        <div className="insp-subtabs">
          <SegTabs items={cur.subs} value={subTab} onChange={(v) => vt(() => setSubs((s) => ({ ...s, [cur.id]: v })))} />
        </div>
      )}
      {tabKf.length > 0 && (
        <div className="kf-bar">
          <button className="icon-btn" title="Keyframe anterior" disabled={!times.some((t) => t < local - KF_EPS)} onClick={() => kfApi.nav(-1)}><Icon name="chevronL" size={14} /></button>
          <button className={`kf-main ${atKf != null ? 'on' : ''}`} title={`Adicionar keyframe em ${tab.toLowerCase()}`} onClick={() => kfApi.addAll(clip.id, tabKf)}>
            <Icon name={atKf != null ? 'diamondFill' : 'diamond'} size={13} stroke={2} /> Keyframe
          </button>
          <button className="icon-btn" title="Próximo keyframe" disabled={!times.some((t) => t > local + KF_EPS)} onClick={() => kfApi.nav(1)}><Icon name="chevronR" size={14} /></button>
          <span className="kf-count">{kfCount(clip)} ◆</span>
          <div className="spacer" />
          {atKf != null && (
            <select className="select mini" value={atKfEase || 'smooth'} title="Curva até o próximo keyframe" onChange={(e) => kfApi.ease(clip.id, atKf, e.target.value)}>
              {Object.entries(EASES).map(([id, e]) => <option key={id} value={id}>{e.name}</option>)}
              {atKfEase === 'bezier' && <option value="bezier" disabled>Personalizada</option>}
            </select>
          )}
          {kfCount(clip) > 0 && <button className="icon-btn" title="Editor de curvas (G)" onClick={kfApi.curves}><Icon name="curve" size={15} /></button>}
          {kfCount(clip) > 0 && atKf == null && <button className="link-btn" onClick={() => kfApi.clear(clip.id)}>Limpar</button>}
        </div>
      )}
      <div className="insp-body" key={tab}>
        {clip.track === 'caption' && (tab === 'Texto' || tab === 'Básico') && capApi && (
          <div className="cap-link">
            <label className="check-row" title="Mover ou redimensionar uma legenda (aqui ou no reprodutor) muda todas as legendas">
              <input type="checkbox" checked={capApi.link} onChange={(e) => capApi.setLink(e.target.checked)} /> Mesma posição e tamanho em todas as legendas
            </label>
            {capApi.count > 1 && <button className="link-btn" onClick={() => capApi.applyAll(clip)}>Aplicar a todas agora</button>}
          </div>
        )}
        {tab === 'Texto' && (<>
          <div className="field"><textarea className="textarea" value={p.text} onChange={(e) => setProps(clip.id, { text: e.target.value }, `p:${clip.id}:text`)} spellCheck={false} /></div>
          {p.words?.length > 0 && (
            <Section title="Destaque da palavra falada" checked={!!p.karaoke} onCheck={(v) => setProps(clip.id, { karaoke: v })}>
              <div className="row" style={{ gap: 8 }}>
                <div className="seg" style={{ flex: 1 }}>
                  <button className={p.hlMode !== 'color' ? 'on' : ''} onClick={() => setProps(clip.id, { hlMode: 'box' })}>Caixa</button>
                  <button className={p.hlMode === 'color' ? 'on' : ''} onClick={() => setProps(clip.id, { hlMode: 'color' })}>Cor</button>
                </div>
                <input type="color" className="color" value={p.hlColor || '#ffd23f'} onChange={(e) => setProps(clip.id, { hlColor: e.target.value }, `p:${clip.id}:hl`)} />
              </div>
              <div className="hint">O destaque segue o tempo de cada palavra da transcrição. Se você mudar a quantidade de palavras do texto, ele é desligado.</div>
              {capApi && clip.track === 'caption' && p.words.length > 1 && (
                <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => capApi.splitWords(clip)}><Icon name="scissors" size={14} /> Separar em uma legenda por palavra</button>
              )}
            </Section>
          )}
          <div className="field">
            <div className="field-top"><label>Fonte</label></div>
            <select className="select" value={p.fontFamily} onChange={(e) => sp('fontFamily')(e.target.value)} style={{ fontFamily: p.fontFamily }}>
              {FONTS.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
            </select>
          </div>
          {S('Tamanho', 'fontSize', 10, 600)}
          <div className="row-between">
            <label className="kbd">Cor</label>
            <div className="row">
              <button className={`toggle ${p.bold ? 'on' : ''}`} onClick={() => sp('bold')(!p.bold)}><b>B</b></button>
              <button className={`toggle ${p.italic ? 'on' : ''}`} onClick={() => sp('italic')(!p.italic)}><i>I</i></button>
              {['left', 'center', 'right'].map((a) => (
                <button key={a} className={`toggle ${p.align === a ? 'on' : ''}`} onClick={() => sp('align')(a)} title={a}>
                  {a === 'left' ? '⇤' : a === 'center' ? '↔' : '⇥'}
                </button>
              ))}
              <input type="color" className="color" value={p.color} onChange={(e) => sp('color')(e.target.value)} />
            </div>
          </div>
          <Section title="Contorno" checked={p.stroke > 0} onCheck={(v) => sp('stroke')(v ? 3 : 0)} onReset={() => setProps(clip.id, { stroke: 0, strokeColor: '#000000' })}>
            <div className="row-between"><label className="kbd">Cor</label><input type="color" className="color" value={p.strokeColor} onChange={(e) => sp('strokeColor')(e.target.value)} /></div>
            {S('Espessura', 'stroke', 0, 20, 0.5)}
          </Section>
          <Section title="Sombra" checked={!!p.shadow} onCheck={(v) => sp('shadow')(v)}
            onReset={() => setProps(clip.id, { shadowColor: '#000000', shadowOpacity: 60, shadowBlur: 16, shadowDist: 5, shadowAngle: 90 })}
            kf={kfNav(['shadowOpacity', 'shadowBlur', 'shadowDist', 'shadowAngle'])}>
            <div className="row-between"><label className="kbd">Cor</label><input type="color" className="color" value={p.shadowColor ?? '#000000'} onChange={(e) => sp('shadowColor')(e.target.value)} /></div>
            {S('Força (opacidade) %', 'shadowOpacity', 0, 100)}
            {S('Tamanho (desfoque)', 'shadowBlur', 0, 100)}
            {S('Distância', 'shadowDist', 0, 60, 0.5)}
            <div className="angle-row">
              {S('Ângulo °', 'shadowAngle', -180, 180)}
              <AngleDial value={p.shadowAngle ?? 90} onChange={sp('shadowAngle')} />
            </div>
          </Section>
          <Section title="Neon" checked={!!p.glow} onCheck={(v) => sp('glow')(v ? '#1fd6cb' : '')}
            onReset={() => setProps(clip.id, { glowStrength: 100, glowSpread: 60 })} kf={kfNav(['glowStrength', 'glowSpread'])}>
            <div className="row-between"><label className="kbd">Cor do brilho</label><input type="color" className="color" value={p.glow || '#1fd6cb'} onChange={(e) => sp('glow')(e.target.value)} /></div>
            {S('Força %', 'glowStrength', 0, 300)}
            {S('Dispersão', 'glowSpread', 0, 200)}
          </Section>
          <Section title="Caixa de fundo" checked={!!p.bg} onCheck={(v) => sp('bg')(v ? '#000000' : '')}
            onReset={() => setProps(clip.id, { bgOpacity: 100, bgRadius: 26, bgPadX: 40, bgPadY: 22 })} kf={kfNav(['bgOpacity', 'bgRadius', 'bgPadX', 'bgPadY'])}>
            <div className="row-between"><label className="kbd">Cor</label><input type="color" className="color" value={p.bg?.startsWith('#') ? p.bg : '#000000'} onChange={(e) => sp('bg')(e.target.value)} /></div>
            {S('Opacidade %', 'bgOpacity', 0, 100)}
            <div className="row-between">
              <label className="kbd">Forma</label>
              <div className="seg seg-sm">
                {[['Quadrada', 0], ['Suave', 26], ['Redonda', 60], ['Pílula', 100]].map(([n, v]) => (
                  <button key={n} className={Math.round(p.bgRadius ?? 26) === v ? 'on' : ''} onClick={() => sp('bgRadius')(v)}>{n}</button>
                ))}
              </div>
            </div>
            {S('Arredondamento %', 'bgRadius', 0, 100)}
            {S('Largura (margem lateral)', 'bgPadX', 0, 200)}
            {S('Altura (margem vertical)', 'bgPadY', 0, 150)}
          </Section>
        </>)}

        {tab === 'Básico' && (<>
          <Section title="Transformar" onReset={() => setProps(clip.id, { x: 0, y: 0, scale: 100, scaleX: 100, scaleY: 100, rotation: 0 })} kf={kfNav(['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotation'])}>
            {clip.type === 'color' && (
              <div className="row-between"><label className="kbd">Cor do fundo</label><input type="color" className="color" value={p.color} onChange={(e) => sp('color')(e.target.value)} /></div>
            )}
            {S('Escala %', 'scale', 5, 400)}
            {S('Largura %', 'scaleX', 5, 400)}
            {S('Altura %', 'scaleY', 5, 400)}
            {S('Posição X', 'x', -150, 150)}
            {S('Posição Y', 'y', -150, 150)}
            {S('Rotação °', 'rotation', -360, 360)}
          </Section>
          <Section title="Mistura" checked={p.blendOn} onCheck={(v) => setProps(clip.id, { blendOn: v })}
            onReset={() => setProps(clip.id, { blend: 'normal', opacity: 100 })} kf={kfNav(['opacity'])}>
            <div className="field">
              <div className="field-top"><label>Modo</label></div>
              <BlendSelect value={p.blend} onChange={(v) => setProps(clip.id, { blend: v })}
                onPreview={(v) => setPreview(v ? { id: clip.id, patch: { blend: v, blendOn: true } } : null)} />
            </div>
            {S('Opacidade %', 'opacity', 0, 100)}
            <div className="hint">A mistura combina este clipe com o que está abaixo dele — por exemplo, uma <b>Sobreposição</b> em modo Tela sobre a faixa Principal. Passe o mouse pelos modos para ver a prévia.</div>
          </Section>
        </>)}

        {tab === 'Fundo' && (<>
          <Section title="Remoção automática" checked={p.autoBg} onCheck={(v) => onAutoBg(clip, v)}
            badge={p.autoBg && <span className="swatch-mini" style={{ background: p.chromaColor }} title={`Fundo detectado: ${p.chromaColor}`} />}>
            <div className="hint">Detecta a cor do fundo pelas bordas do quadro e a remove. Funciona melhor com tela verde/azul, parede lisa ou fundo de estúdio. Refine em <b>Chroma key</b> abaixo.</div>
            {p.autoBg && <button className="btn" style={{ marginTop: 10 }} onClick={() => onAutoBg(clip, true)}><Icon name="wandAuto" size={14} /> Detectar de novo neste quadro</button>}
          </Section>
          <Section title="Remoção personalizada" checked={p.eraseOn} onCheck={(v) => { setProps(clip.id, { eraseOn: v }); if (!v && (tool === 'erase' || tool === 'restore')) setTool(null); }}
            onReset={() => setProps(clip.id, { eraseMask: '' })}>
            <div className="tool-row">
              <button className={`tool ${tool === 'erase' ? 'on' : ''}`} onClick={() => { if (!p.eraseOn) setProps(clip.id, { eraseOn: true }); setTool(tool === 'erase' ? null : 'erase'); }}>
                <Icon name="brush" size={15} /> Apagar
              </button>
              <button className={`tool ${tool === 'restore' ? 'on' : ''}`} onClick={() => { if (!p.eraseOn) setProps(clip.id, { eraseOn: true }); setTool(tool === 'restore' ? null : 'restore'); }}>
                <Icon name="eraser" size={15} /> Restaurar
              </button>
              <button className="tool" disabled={!p.eraseMask} onClick={() => setProps(clip.id, { eraseMask: '' })}><Icon name="trash" size={14} /> Limpar</button>
            </div>
            <Slider label="Tamanho do pincel" value={brush} min={4} max={250} onChange={setBrush} />
            <div className="hint">{tool === 'erase' || tool === 'restore' ? 'Pinte sobre o clipe no reprodutor. As pinceladas acompanham o clipe se ele for movido ou girado.' : 'Escolha Apagar ou Restaurar e pinte direto no reprodutor.'}</div>
          </Section>
          <Section title="Chroma key" checked={p.chromaOn} onCheck={(v) => setProps(clip.id, v ? { chromaOn: true } : { chromaOn: false, autoBg: false })}
            onReset={() => setProps(clip.id, CHROMA_RESET)} kf={kfNav(['chromaStrength', 'chromaSoft', 'chromaSpill'])}>
            <div className="row-between">
              <label className="kbd">Cor-chave</label>
              <div className="row">
                <button className={`tool ${tool === 'pick' ? 'on' : ''}`} title="Conta-gotas: clique no reprodutor para escolher a cor" onClick={() => setTool(tool === 'pick' ? null : 'pick')}>
                  <Icon name="pipette" size={14} />
                </button>
                {['#00ff00', '#0047ff'].map((c) => <button key={c} className="swatch-btn" style={{ background: c }} title={c === '#00ff00' ? 'Tela verde' : 'Tela azul'} onClick={() => setProps(clip.id, { chromaColor: c, chromaOn: true })} />)}
                <input type="color" className="color" value={p.chromaColor} onChange={(e) => setProps(clip.id, { chromaColor: e.target.value, chromaOn: true }, `p:${clip.id}:chromaColor`)} />
              </div>
            </div>
            {tool === 'pick' && <div className="hint" style={{ marginBottom: 12 }}>Clique na cor do fundo no reprodutor.</div>}
            {S('Intensidade', 'chromaStrength', 0, 100)}
            {S('Suavização da borda', 'chromaSoft', 0, 100)}
            {S('Remover reflexo', 'chromaSpill', 0, 100)}
            <div className="row-between">
              <label className="kbd">Ver máscara (preto e branco)</label>
              <button className={`toggle ${p.chromaMatte ? 'on' : ''}`} onClick={() => sp('chromaMatte')(!p.chromaMatte)}>{p.chromaMatte ? 'Ligado' : 'Desligado'}</button>
            </div>
          </Section>
        </>)}

        {tab === 'Máscara' && (
          <Section title="Máscara" checked={p.maskOn}
            onCheck={(v) => setProps(clip.id, v ? { maskOn: true, maskType: p.maskType === 'none' ? 'circle' : p.maskType, ...(p.maskType === 'none' ? squareFor('circle') : {}) } : { maskOn: false })}
            onReset={() => setProps(clip.id, { ...MASK_RESET, ...squareFor(p.maskType) })} kf={kfNav(MASK_KF)}>
            <div className="mask-grid">
              {[{ id: 'none', name: 'Nenhuma', icon: 'mNone' }, ...MASK_TYPES].map((m) => (
                <button key={m.id} className={`mask-opt ${(maskActive ? p.maskType : 'none') === m.id ? 'on' : ''}`} onClick={() => chooseMask(m.id)}>
                  <Icon name={m.icon} size={22} stroke={1.6} /><span>{m.name}</span>
                </button>
              ))}
            </div>
            {maskActive && p.maskType === 'pen' && <PenSection clip={clip} p={p} local={local} S={S} sp={sp} penApi={penApi} />}
            {maskActive && p.maskType !== 'pen' && (<>
              {p.maskType === 'text' && (<>
                <div className="field"><input className="select" value={p.maskText} onChange={(e) => setProps(clip.id, { maskText: e.target.value }, `p:${clip.id}:maskText`)} /></div>
                <div className="field">
                  <select className="select" value={p.maskFont} onChange={(e) => sp('maskFont')(e.target.value)}>{FONTS.map((f) => <option key={f}>{f}</option>)}</select>
                </div>
              </>)}
              {S('Posição X', 'maskX', -150, 150)}
              {S('Posição Y', 'maskY', -150, 150)}
              {S('Rotação °', 'maskRot', -180, 180)}
              {p.maskType === 'film' && S('Espessura %', 'maskH', 1, 200)}
              {!['linear', 'film'].includes(p.maskType) && (<>{S('Largura %', 'maskW', 1, 250)}{S('Altura %', 'maskH', 1, 250)}</>)}
              {p.maskType === 'rect' && S('Arredondar cantos', 'maskRound', 0, 100)}
              {S('Pena (borda suave)', 'maskFeather', 0, 100)}
              <div className="row-between">
                <label className="kbd">Inverter máscara</label>
                <button className={`toggle ${p.maskInvert ? 'on' : ''}`} onClick={() => sp('maskInvert')(!p.maskInvert)}><Icon name="invert" size={13} /> {p.maskInvert ? 'Invertida' : 'Normal'}</button>
              </div>
              <div className="hint">No reprodutor: arraste o centro para mover, <b>◻</b> para redimensionar, <b>↻</b> para girar e <b>⇕</b> para suavizar a borda. Use os keyframes da seção para animar a máscara.</div>
            </>)}
          </Section>
        )}

        {tab === 'Retoque' && (
          <Section title="Retoque" onReset={() => setProps(clip.id, { smooth: 0, sharpen: 0, bloom: 0 })} kf={kfNav(['smooth', 'sharpen', 'bloom'])}>
            {S('Suavizar (pele)', 'smooth', 0, 100)}
            {S('Nitidez', 'sharpen', 0, 100)}
            {S('Brilho suave', 'bloom', 0, 100)}
            <div className="hint">Suavizar reduz texturas e ruído; Nitidez realça detalhes; Brilho suave cria um halo luminoso nas áreas claras.</div>
          </Section>
        )}

        {tab === 'Efeito' && (<>
          <div className="field">
            <div className="field-top"><label>Efeito</label></div>
            <select className="select" value={p.effect} onChange={(e) => setProps(clip.id, { effect: e.target.value })}>
              {uniq(EFFECTS.map((e) => e.cat)).map((c) => (
                <optgroup key={c} label={c}>{EFFECTS.filter((e) => e.cat === c).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</optgroup>
              ))}
            </select>
          </div>
          {S('Intensidade', 'intensity', 0, 100)}
          <Slider label="Velocidade do efeito" value={p.fxSpeed} min={0.25} max={3} step={0.05} onChange={sp('fxSpeed')} />
          <Slider label="Fade in (s)" value={p.fadeIn} min={0} max={Math.min(5, clip.duration)} step={0.1} onChange={sp('fadeIn')} />
          <Slider label="Fade out (s)" value={p.fadeOut} min={0} max={Math.min(5, clip.duration)} step={0.1} onChange={sp('fadeOut')} />
        </>)}

        {tab === 'Áudio' && (<>
          {S('Volume %', 'volume', 0, 200)}
          <Slider label="Fade in (s)" value={p.fadeIn} min={0} max={Math.min(5, clip.duration)} step={0.1} onChange={sp('fadeIn')} />
          <Slider label="Fade out (s)" value={p.fadeOut} min={0} max={Math.min(5, clip.duration)} step={0.1} onChange={sp('fadeOut')} />
          <div className="hint">Use keyframes no volume para fazer “ducking”: abaixe a música enquanto alguém fala.</div>
        </>)}

        {tab === 'Velocidade' && <SpeedPanel clip={clip} p={p} asset={asset} local={local} setClip={setClip} setProps={setProps} S={S} />}
        {tab === 'Animação' && <AnimPanel clip={clip} p={p} setProps={setProps} S={S} kfNav={kfNav} />}
        {tab?.startsWith('Ajuste:') && (
          <ColorPanel sub={tab.slice(7)} clip={clip} p={p} S={S} setProps={setProps} kfNav={kfNav} api={colorApi} tool={tool} setTool={setTool} />
        )}
      </div>
    </aside>
  );
}

/** controles da máscara de caneta */
function PenSection({ clip, p, local, S, sp, penApi }) {
  const path = penAt(clip, local) || { pts: [] };
  const n = path.pts.length;
  const kfs = clip.props.penKfs || [];
  const atKf = kfs.some((f) => Math.abs(f.t - local) < KF_EPS);
  return (<>
    <div className="pen-status">
      <span className={`pen-led ${path.closed ? 'ok' : n ? 'draw' : ''}`} />
      {!n ? 'Clique no reprodutor para começar a desenhar' : path.closed ? `Recorte fechado · ${n} pontos` : `Desenhando · ${n} ponto(s) — clique no 1º ponto ou Enter para fechar`}
    </div>
    <div className="tool-row">
      {!path.closed && n > 2 && <button className="tool on" onClick={() => penApi.close(clip.id)}>Fechar caminho</button>}
      {!path.closed && n > 0 && <button className="tool" onClick={() => penApi.undoPoint(clip.id)}>Desfazer ponto</button>}
      <button className="tool" disabled={!n} onClick={() => penApi.clear(clip.id)}><Icon name="trash" size={13} /> Limpar</button>
    </div>
    <div className="pen-kf">
      <button className={`kf-main ${atKf ? 'on' : ''}`} disabled={n < 3} onClick={() => penApi.toggleKf(clip.id)} title="Grava a forma atual neste instante — mova o cursor e ajuste os pontos para acompanhar o sujeito">
        <Icon name={atKf ? 'diamondFill' : 'diamond'} size={13} stroke={2} /> Keyframe do recorte
      </button>
      <span className="kbd">{kfs.length ? `${kfs.length} keyframe(s)` : 'recorte fixo'}</span>
      {kfs.length > 0 && <button className="link-btn" onClick={() => penApi.clearKfs(clip.id)}>Limpar</button>}
    </div>
    {S('Pena (borda suave)', 'maskFeather', 0, 100)}
    <div className="row-between">
      <label className="kbd">Inverter (remover o sujeito)</label>
      <button className={`toggle ${p.maskInvert ? 'on' : ''}`} onClick={() => sp('maskInvert')(!p.maskInvert)}><Icon name="invert" size={13} /> {p.maskInvert ? 'Invertida' : 'Normal'}</button>
    </div>
    <div className="group-label">Usar o recorte</div>
    <div className="tool-row">
      <button className="tool" disabled={!path.closed} onClick={() => penApi.extract(clip.id)}><Icon name="extract" size={14} /> Extrair para Sobreposição</button>
      <button className="tool" disabled={n < 3} onClick={() => penApi.savePng(clip.id)}><Icon name="png" size={14} /> Salvar PNG</button>
    </div>
    <div className="hint">
      <b>Clique</b> adiciona um ponto reto · <b>clique e arraste</b> cria uma curva · clique no <b>1º ponto</b> fecha.
      Depois de fechado: arraste pontos e alças, <b>Alt + clique</b> alterna canto/curva, <b>clique duplo</b> remove um ponto e clicar na linha insere um novo.
      Para objetos em movimento, grave keyframes do recorte em momentos diferentes.
    </div>
  </>);
}

function TransitionPanel({ pair, onType, onDuration, onRemove, onAll, onEdit, onNew }) {
  const { A, B, type } = pair;
  const max = Math.max(0.1, Math.min(A.duration, B.duration, 3));
  const trV = useTransitionsVersion();
  const cur = TRANSITION_MAP[type];
  return (
    <aside className="inspector">
      <div className="insp-head"><h3>Transição · {TRANSITION_MAP[type]?.name}</h3><div className="sub">no corte em {fmt(B.start)}</div></div>
      <div />
      <div className="insp-body">
        <Slider label="Duração (s)" value={Math.min(B.transition.duration, max)} min={0.1} max={max} step={0.1} onChange={onDuration} />
        <div className="row" style={{ gap: 8, margin: '4px 0 10px', flexWrap: 'wrap' }}>
          {cur?.def && <button className="btn" onClick={() => onEdit(type)}><Icon name="pen" size={14} /> {cur.cat === USER_TR_CAT ? 'Editar transição' : 'Editar uma cópia'}</button>}
          <button className="btn" onClick={onNew}><Icon name="plus" size={14} /> Criar transição</button>
        </div>
        <div className="section-label">Tipo</div>
        <div className="tr-grid">
          {TRANSITIONS.map((t) => (
            <button key={t.id} className={`tr-opt ${t.id === type ? 'on' : ''}`} onClick={() => onType(t.id)}>
              <FxThumb key={`${t.id}:${trV}`} kind="transition" id={t.id} />
              <span>{t.name}</span>
            </button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn" onClick={onAll}>Aplicar a todos os cortes</button>
          <button className="btn danger" onClick={onRemove}><Icon name="trash" size={14} /> Remover</button>
        </div>
      </div>
    </aside>
  );
}

const SHORTCUTS = [
  ['Reproduzir / pausar', 'Espaço'], ['Dividir no cursor', 'C / Ctrl + B'], ['Excluir à esquerda / direita', 'Q / W'],
  ['Excluir clipe', 'Delete'], ['Duplicar clipe', 'Ctrl + D'], ['Desfazer / refazer', 'Ctrl + Z / Y'],
  ['Keyframe no clipe selecionado', 'K'], ['Marcador', 'M'], ['Quadro anterior / próximo', '← / →'],
  ['Pular 1 segundo', 'Shift + ← / →'], ['Importar mídia', 'Ctrl + I'], ['Exportar', 'Ctrl + E'], ['Salvar projeto', 'Ctrl + S'], ['Abrir projeto', 'Ctrl + O'],
  ['Lâmina: cortar com o mouse', 'B (Shift+clique corta tudo)'], ['Voltar à seleção', 'V / Esc'], ['Selecionar nada', 'Esc'],
  ['Copiar / recortar clipe', 'Ctrl + C / X'], ['Colar no cursor', 'Ctrl + V'], ['Congelar quadro', 'F'],
  ['Editor de keyframes', 'G'], ['Selecionar com caixa', 'Arrastar no vazio da faixa (Ctrl soma)'],
  ['Selecionar vários clipes', 'Ctrl + clique'], ['Agrupar / desagrupar clipes', 'Ctrl + G / Ctrl + Shift + G'],
  ['Criar / desfazer clipe composto', 'Alt + G / Alt + Shift + G'], ['Editar clipe composto', 'Clique duplo · Esc volta'],
  ['Camada acima / abaixo', 'Ctrl + ] / ['], ['Camada para a frente / o fundo', 'Ctrl + Shift + ] / ['],
  ['Criar ou remover marcador no cursor', 'M · botão direito no marcador remove'], ['Zoom na linha do tempo', 'Ctrl + roda'],
  ['Mostrar / esconder réguas', 'Shift + R'], ['Mão (arrastar a prévia)', 'H'], ['Zoom da prévia', 'Ctrl + + / − · Ctrl + 0 ajusta'],
  ['Início / fim do projeto', 'Home / End'], ['Diagnóstico de reprodução', 'Ctrl + Shift + D'],
  ['Excluir mídias selecionadas na biblioteca', 'Delete (pede confirmação)'],
  ['Keyframes: Easy Ease', 'F9 (no editor de keyframes)'], ['Keyframes: suavizar entrada / saída', 'Shift + F9 / Ctrl + Shift + F9'],
  ['Keyframes: copiar / colar no cursor', 'Ctrl + C / V (no editor)'], ['Keyframes: selecionar todos', 'Ctrl + A (no editor)'], ['Keyframes: empurrar 1 quadro', 'Alt + ← / →'],
];

function ProjectPanel({ name, ratio, setRatio, duration, clipCount, assetCount }) {
  return (
    <aside className="inspector">
      <div className="insp-head"><h3>Projeto</h3><div className="sub">Nenhum clipe selecionado</div></div>
      <div />
      <div className="insp-body">
        <div className="stat"><span>Nome</span><b>{name}</b></div>
        <div className="stat"><span>Proporção</span><b>{ratio}</b></div>
        <div className="stat"><span>Duração</span><b>{fmt(duration)}</b></div>
        <div className="stat"><span>Clipes</span><b>{clipCount}</b></div>
        <div className="stat"><span>Itens na biblioteca</span><b>{assetCount}</b></div>
      </div>
    </aside>
  );
}

function InfoModal({ kind, onClose }) {
  if (!kind) return null;
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${kind === 'shortcuts' ? 'shortcuts-modal' : ''}`}>
        {kind === 'shortcuts' ? (<>
          <h2>Atalhos de teclado</h2>
          {/* a lista rola por dentro: a janela nunca passa da altura da tela */}
          <div className="shortcuts-list">{SHORTCUTS.map(([a, k]) => <div key={a} className="shortcut"><span>{a}</span><kbd>{k}</kbd></div>)}</div>
        </>) : (<>
          <h2>CutLab</h2>
          <p>Editor de vídeo no navegador, inspirado no fluxo de trabalho de editores como o CapCut. Tudo roda localmente: seus arquivos não saem do computador.</p>
        </>)}
        <div className="actions"><button className="btn" onClick={onClose}>Fechar</button></div>
      </div>
    </div>
  );
}
