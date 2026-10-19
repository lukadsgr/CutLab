/* =====================================================================
   App
   ===================================================================== */
function pickMime() {
  const opts = [
    ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'mp4'],
    ['video/mp4', 'mp4'],
    ['video/webm;codecs=vp9,opus', 'webm'],
    ['video/webm;codecs=vp8,opus', 'webm'],
    ['video/webm', 'webm'],
  ];
  return opts.find(([m]) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || ['video/webm', 'webm'];
}
const roundFrame = (t) => Math.round(t * FPS) / FPS;
const KEY_PROPS_FOR = (c) => (c.type === 'audio' ? ['volume'] : c.type === 'effect' ? ['intensity'] : c.type === 'adjust' ? ['brightness', 'contrast', 'saturation'] : ['x', 'y', 'scale', 'rotation', 'opacity']);

function App() {
  const [projectName, setProjectName] = useState('Meu projeto');
  const [ratio, setRatio] = useState('16:9');
  const [resolution, setResolution] = useState('720p');
  const [assets, setAssets] = useState([]);
  const rootHist = useHistory([]);
  // compostos abertos (ids da raiz para dentro): a edição acontece na linha do tempo do último
  const [path, setPath] = useState([]);
  const pathRef = useRef(path);
  const rootRef = useRef(rootHist.clips);
  rootRef.current = rootHist.clips;
  const exitStack = useRef([]);   // ao entrar num composto: tempo e estado das linhas do nível de fora
  const [multi, setMulti] = useState([]);   // outros clipes selecionados (Ctrl+clique), além de selectedId
  pathRef.current = path;
  const viewClips = useMemo(() => (path.length && clipsAtPath(rootHist.clips, path)) || rootHist.clips, [rootHist.clips, path]);
  const setView = useCallback((updater, key) => rootHist.set((root) => {
    const apply = (cs) => (typeof updater === 'function' ? updater(cs) : updater);
    const p = pathRef.current;
    if (!p.length) return apply(root);
    if (!clipsAtPath(root, p)) return root;
    return updateAtPath(root, p, apply, live.current.mainMagnet);
  }, key), [rootHist.set]);
  const hist = { ...rootHist, clips: viewClips, set: setView };
  const clips = viewClips;
  const [selectedId, setSelectedId] = useState(null);
  const [selectedTr, setSelectedTr] = useState(null);
  const [time, setTimeState] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [trackState, setTrackState] = useState({});
  const [zoom, setZoom] = useState(60);
  const [snap, setSnap] = useState(true);
  const [tlH, setTlH] = useStoredNumber('cutlab-tlH', 330);
  const [leftW, setLeftW] = useStoredNumber('cutlab-leftW', 470);
  const [rightW, setRightW] = useStoredNumber('cutlab-rightW', 360);
  const vp = useViewport();
  const fit = fitLayout(vp, leftW, rightW, tlH);   // tamanhos encaixados na janela atual
  const [tool, setTool] = useState(null);
  const [brush, setBrush] = useState(40);
  const previewRef = useRef(null);
  const pickCb = useRef(null);
  const mouseRef = useRef(null);
  const snapRef = useRef(null);
  const skimRef = useRef(null);   // eixo de visualização: tempo sob o mouse na linha do tempo
  const [mainMagnet, setMainMagnetState] = useState(true);
  const [ripple, setRipple] = useState(true);   // exclusão em cadeia: fechar buracos em todas as faixas
  const [blade, setBlade] = useState(false);    // ferramenta lâmina na linha do tempo
  const [curveOpen, setCurveOpen] = useState(false);   // editor de curvas dos keyframes
  const [linkage, setLinkage] = useState(true);
  const [skim, setSkim] = useState(false);
  const [recording, setRecording] = useState(false);
  const voiceRef = useRef(null);
  const [textEdit, setTextEdit] = useState(null);   // linhas de encaixe/rótulo enquanto arrasta no reprodutor
  const hoverRef = useRef(null);  // alça sob o cursor
  const [rulers, setRulers] = useState(() => { try { return localStorage.getItem('cutlab-rulers') === '1'; } catch { return false; } });
  const [guides, setGuides] = useState({ v: [], h: [] }); // guias das réguas, em fração do quadro
  useEffect(() => { try { localStorage.setItem('cutlab-rulers', rulers ? '1' : '0'); } catch {} }, [rulers]);
  const [markers, setMarkers] = useState([]);
  const [capStyle, setCapStyle] = useState(CAPTION_STYLES[0]);
  // vincular legendas: mover/redimensionar uma legenda aplica o mesmo a todas
  const [capLink, setCapLink] = useState(() => { try { return localStorage.getItem('cutlab-caplink') === '1'; } catch { return false; } });
  const capLinkRef = useRef(capLink);
  capLinkRef.current = capLink;
  useEffect(() => { try { localStorage.setItem('cutlab-caplink', capLink ? '1' : '0'); } catch {} }, [capLink]);
  // qualidade da prévia (o canvas do reprodutor é menor que o quadro do projeto; ver PREVIEW_Q)
  const [previewQ, setPreviewQ] = useState(() => { try { return PREVIEW_Q[localStorage.getItem('cutlab-previewq')] ? localStorage.getItem('cutlab-previewq') : 'auto'; } catch { return 'auto'; } });
  useEffect(() => { try { localStorage.setItem('cutlab-previewq', previewQ); } catch {} }, [previewQ]);
  const [diagOn, setDiagOn] = useState(false);   // diagnóstico de reprodução (Ctrl+Shift+D)
  useEffect(() => { perfDiag.on = diagOn; if (diagOn) perfDiag.reset(); }, [diagOn]);
  const [exportState, setExportState] = useState(null);
  const [info, setInfo] = useState(null);
  const [dropHint, setDropHint] = useState(false);
  const [toast, setToast] = useState(null);

  const canvasRef = useRef();
  const overlayRef = useRef();
  const importRef = useRef();
  const timeRef = useRef(0);
  const boxesRef = useRef([]);
  const recRef = useRef(null);
  const offlineRef = useRef(null);   // exportação offline em andamento: { cancelled }

  // mídias que faltam (projeto aberto sem o arquivo) ficam fora do motor até serem importadas de novo
  const assetMap = useMemo(() => Object.fromEntries(assets.filter((a) => !a.missing).map((a) => [a.id, a])), [assets]);
  const libMap = useMemo(() => Object.fromEntries(assets.map((a) => [a.id, a])), [assets]);
  const duration = useMemo(() => clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0), [clips]);
  const q = RESOLUTIONS[resolution];
  const W = Math.round(RATIOS[ratio][0] * q), H = Math.round(RATIOS[ratio][1] * q);
  const selected = clips.find((c) => c.id === selectedId) || null;

  const live = useRef({});
  live.current = { ...live.current, W, H, clips, assetMap, playing, trackState, duration, selectedId, selectedTr, tool, brush, guides: rulers ? guides : null, mainMagnet, linkage, ripple, multi, blade, curveOpen };

  const notify = useCallback((msg) => { setToast(msg); clearTimeout(notify.t); notify.t = setTimeout(() => setToast(null), 2600); }, []);
  const seek = useCallback((t) => { t = Math.max(0, t); timeRef.current = t; playClock.set(t); setTimeState(t); }, []);

  const select = useCallback((id) => { setSelectedId(id); setSelectedTr(null); setMulti([]); }, []);
  /** seleção inteira de uma vez (caixa de seleção na linha do tempo) */
  const setSelection = useCallback((ids) => {
    ids = expandGroups(live.current.clips, ids);   // quem está num grupo traz o grupo inteiro
    setSelectedId(ids[ids.length - 1] ?? null); setMulti(ids.slice(0, -1)); setSelectedTr(null);
  }, []);
  /** Ctrl/Shift+clique: inclui ou tira o clipe da seleção */
  const toggleSel = useCallback((id) => {
    const cur = [...live.current.multi, live.current.selectedId].filter(Boolean);
    const both = expandGroups(live.current.clips, [id]);   // num grupo, entra ou sai o grupo todo
    const next = cur.includes(id) ? cur.filter((x) => !both.includes(x)) : [...cur.filter((x) => !both.includes(x)), ...both];
    setSelectedId(next[next.length - 1] ?? null);
    setMulti(next.slice(0, -1));
    setSelectedTr(null);
  }, []);

  useEffect(() => { engine.prune(rootHist.clips); }, [rootHist.clips]);
  // prévia "Completa" usa os arquivos originais; as outras, os proxies (ver 38-proxy)
  useEffect(() => { engine.noProxy = previewQ === 'full'; }, [previewQ]);

  /* proxies de prévia: só dos trechos que a linha do tempo usa, um por vez, em segundo plano
     (guardados neste navegador). Editar gera só o pedaço que ainda não tem proxy */
  const assetsRef = useRef(assets);
  assetsRef.current = assets;
  const [proxyWant, setProxyWant] = useState(() => new Map());
  const proxyWantRef = useRef(proxyWant);
  proxyWantRef.current = proxyWant;
  // espera a edição assentar (1,5 s) antes de decidir: aparar um corte não dispara proxies a cada passo
  useEffect(() => { const id = setTimeout(() => setProxyWant(usedRanges(rootHist.clips)), 1500); return () => clearTimeout(id); }, [rootHist.clips]);
  const proxyRun = useRef({ busy: false, loaded: new Set(), need: new Map(), failed: new Set() });
  const [proxyTick, setProxyTick] = useState(0);
  useEffect(() => {
    const run = proxyRun.current;
    if (run.busy) return;
    const ok = (x) => x.type === 'video' && x.file && !x.loading && !x.missing && !x.error;
    let job = null;
    for (const a of assets) {
      if (!ok(a) || !proxyWant.has(a.id)) continue;
      if (!run.loaded.has(a.id) || !run.need.has(a.id)) { job = { a, kind: 'load' }; break; }
      if (!run.need.get(a.id)) continue;
      const r = proxyWant.get(a.id).find((r) => !proxyCovering(a.proxies, r[2], r[3]) && !run.failed.has(`${a.id}:${r[0]}:${r[1]}`));
      if (r) { job = { a, kind: 'make', r }; break; }
    }
    if (!job) return;
    run.busy = true;
    const { a } = job;
    const attach = (segs) => {
      const add = segs.map((s) => { const file = new File([s.blob], `proxy-${a.id}.mp4`, { type: 'video/mp4' }); return { from: s.from, to: s.to, off: s.off, file, url: URL.createObjectURL(file) }; });
      setAssets((as) => as.map((x) => {
        if (x.id !== a.id) return x;
        // um trecho novo engole os menores que ele cobre (os clipes passam a usar o novo)
        const keep = (x.proxies || []).filter((o) => !add.some((n) => n.from <= o.from && n.to >= o.to && n !== o));
        for (const o of (x.proxies || [])) if (!keep.includes(o)) { deleteProxySeg(a.id, o); setTimeout(() => URL.revokeObjectURL(o.url), 5000); }
        return { ...x, proxies: [...add, ...keep] };
      }));
    };
    (async () => {
      try {
        if (job.kind === 'load') {
          if (!run.loaded.has(a.id)) { run.loaded.add(a.id); const segs = await loadProxySegs(a.id); if (segs.length) attach(segs); }
          if (!run.need.has(a.id)) run.need.set(a.id, await proxyNeed(a.file));
          return;
        }
        const [from, to] = job.r;
        proxyProgress.set(a.id, 0);
        let last = 0;
        const { blob, off } = await makeProxy(a.file, {
          from, to,
          onProgress: (q) => { if (q - last >= 0.01 || q === 1) { last = q; proxyProgress.set(a.id, q); } },
          // mídia removida, ou o trecho saiu da linha do tempo no meio do caminho
          isCancelled: () => !assetsRef.current.some((x) => x.id === a.id) || !(proxyWantRef.current.get(a.id) || []).some((w) => w[0] < to && w[1] > from),
        });
        const seg = { blob, from, to, off };
        saveProxySeg(a.id, seg).catch(() => {});
        attach([seg]);
      } catch (e) {
        if (job.kind === 'make' && e?.name !== 'AbortError') {
          run.failed.add(`${a.id}:${job.r[0]}:${job.r[1]}`);
          console.warn('Proxy não gerado para', a.name, e);   // esse trecho fica com o original
        }
      } finally {
        proxyProgress.set(a.id, null);
        run.busy = false;
        setProxyTick((n) => n + 1);
      }
    })();
  }, [assets, proxyWant, proxyTick]);
  // brilho que segue o cursor em cartões e botões (micro-interação)
  useEffect(() => {
    const mv = (e) => {
      const el = e.target.closest?.('.card-thumb, .btn, .tool, .chip, .mask-opt, .speed-opt, .tpl-thumb');
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      el.style.setProperty('--my', (e.clientY - r.top) + 'px');
    };
    window.addEventListener('pointermove', mv, { passive: true });
    return () => window.removeEventListener('pointermove', mv);
  }, []);
  useEffect(() => { FONTS.forEach((f) => document.fonts?.load(`700 40px "${f}"`)); }, []);

  /* loop principal: avança o tempo, sincroniza mídia e desenha */
  useEffect(() => {
    let raf, last = performance.now(), lastUi = 0, uiT = 0, held = 0;
    const tick = () => {
      const now = performance.now();
      let dt = Math.min(0.5, (now - last) / 1000);
      last = now;
      const s = live.current;
      if (offlineRef.current) return;   // exportação offline usa o motor sozinha
      if (s.playing) {
        // vídeo em cena ainda buscando/carregando: o relógio espera por ele (até 1,5 s). Se seguisse
        // sozinho, o vídeo ficaria para trás e teria de saltar para alcançar — o "pulo de quadros"
        if (engine.stalled && held < 1.5) { held += dt; dt = 0; } else if (!engine.stalled) held = 0;
        let nt = timeRef.current + dt;
        // com mídia tocando em cena, o tempo vem dela (relógio mestre): cada quadro do vídeo aparece
        // uma vez, sem a correção de velocidade que fazia a imagem engasgar. Nunca anda para trás
        const mt = engine.clockTime();
        if (mt != null && Math.abs(mt - nt) < 0.25) nt = Math.max(timeRef.current, mt);
        const end = nt >= s.duration;
        if (end) {
          nt = s.duration;
          setPlaying(false);
          if (recRef.current) recRef.current.stop();
        }
        timeRef.current = nt;
        playClock.set(nt);
        // o React (painéis, valores do inspetor) não recebe o tempo durante a reprodução: cada atualização
        // redesenha a interface inteira e os picos derrubavam quadros. Cursor e timecode andam pelo
        // playClock; ao pausar a interface recebe o tempo exato. Exportando, a barra de progresso anda 4×/s
        if (end || (recRef.current && now - lastUi > 250)) { lastUi = now; uiT = nt; setTimeState(nt); }
      } else if (uiT !== timeRef.current) {
        // pausou (ou buscou): a interface fica com o tempo exato
        uiT = timeRef.current;
        playClock.set(uiT);
        setTimeState(uiT);
      }
      const t = !s.playing && skimRef.current != null ? skimRef.current : timeRef.current;
      const p0 = performance.now();
      engine.sync(t, s.playing && t < s.duration, s.clips, s.assetMap, s.trackState);
      const p1 = performance.now();
      const cv = canvasRef.current;
      if (cv) {
        // prévia temporária (ex.: passar o mouse sobre um modo de mistura)
        const pv = previewRef.current;
        const clipsR = pv ? s.clips.map((c) => (c.id === pv.id ? { ...c, props: { ...c.props, ...pv.patch } } : c)) : s.clips;
        // a prévia é desenhada num canvas menor que o quadro; as caixas voltam para px do projeto (W×H),
        // que é a unidade de toda a interação no reprodutor
        boxesRef.current = toFrameBoxes(engine.render(cv.getContext('2d'), cv.width, cv.height, t, clipsR, s.assetMap, s.trackState), s.W / cv.width);
        const sel = recRef.current ? null : s.clips.find((c) => c.id === s.selectedId);
        drawOverlay(overlayRef.current, { width: s.W, height: s.H }, boxesRef.current, sel?.id, {
          tool: s.tool, mouse: mouseRef.current, brush: s.brush,
          props: sel ? resolveProps(sel, clamp(t - sel.start, 0, sel.duration)) : null,
          pen: sel && s.tool === 'pen' ? penAt(sel, clamp(t - sel.start, 0, sel.duration)) : null,
          snap: snapRef.current, hover: hoverRef.current,
        });
        // durante a exportação, cada quadro desenhado é capturado explicitamente
        recRef.current?.track?.requestFrame?.();
        // o que entra em cena logo já fica preparado (bitmap da imagem, primeiro quadro na GPU)
        engine.warmUp(t, s.clips, s.assetMap, s.playing);
      }
      if (perfDiag.on) perfDiag.frame(now, t, s.playing, p1 - p0, performance.now() - p1, s.clips);
    };
    const loop = () => { tick(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    // reserva: quando o navegador pausa o requestAnimationFrame (aba/painel oculto), o relógio continua
    const iv = setInterval(() => { if (performance.now() - last > 80) tick(); }, 40);
    return () => { cancelAnimationFrame(raf); clearInterval(iv); };
  }, []);

  /* ---------- edição básica ---------- */
  const localOf = (c) => roundFrame(clamp(timeRef.current - c.start, 0, c.duration));
  const setClip = useCallback((id, patch, key) => hist.set((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)), key), [hist.set]);
  /** altera props respeitando keyframes (props animadas ganham keyframe no cursor) */
  const setProps = useCallback((id, patch, key) =>
    hist.set((cs) => {
      const me = cs.find((c) => c.id === id);
      // legendas vinculadas: posição e tamanho mudam juntos em todas as legendas
      const shared = capLinkRef.current && me?.track === 'caption' ? pickCapLayout(patch) : null;
      return cs.map((c) => (c.id === id ? applyPatch(c, patch, localOf(c))
        : shared && c.track === 'caption' ? setCapLayout(c, shared) : c));
    }, key), [hist.set]);
  const mapClip = (id, fn, key) => hist.set((cs) => cs.map((c) => (c.id === id ? fn(c) : c)), key);

  const makeClip = (type, { assetId = null, track = defaultTrack(type), duration = 3, name = '', props = {} }) =>
    ({ id: uid(), type, assetId, track, start: 0, in: 0, duration, speed: 1, name, props: { ...BASE_PROPS, ...(type === 'text' ? TEXT_BASE : {}), ...props } });

  const addClip = useCallback((clip, start, lane) => {
    if (lane) clip = { ...clip, lane };
    hist.set((cs) => {
      const s = start != null ? start
        : clip.track === 'main' ? cs.filter((c) => c.track === 'main').reduce((m, c) => Math.max(m, c.start + c.duration), 0)
        : timeRef.current;
      const placed = { ...clip, start: s };
      return [...cs, { ...placed, lane: freeLane(cs, placed, clip.lane || 0) }];
    });
    select(clip.id);
  }, [hist.set, select]);

  const addAsset = useCallback((asset, track, start, lane = 0) => {
    if (asset.loading || asset.error || asset.missing) return;
    const tr = track && TRACKS.find((t) => t.id === track)?.accepts.includes(asset.type) ? track : defaultTrack(asset.type);
    addClip(makeClip(asset.type, {
      assetId: asset.id, track: tr, name: asset.name,
      duration: asset.type === 'image' ? 5 : asset.duration,
      props: tr === 'overlay' ? { scale: 45, x: 45, y: -40 } : {},
    }), start, lane);
  }, [addClip]);

  const importFiles = useCallback((files) => {
    let n = 0, relinked = 0;
    const pending = projectRef.current.assets.filter((a) => a.missing);
    for (const f of files) {
      const type = mediaKind(f);
      if (!type) continue;
      // arquivo de uma mídia que faltava no projeto aberto: religa em vez de importar de novo
      const m = missingMatch(pending, f);
      if (m) {
        pending.splice(pending.indexOf(m), 1);
        const { ref, ...meta } = assetMeta(m);
        const back = restoreAsset(meta, f);
        setAssets((a) => a.map((x) => (x.id === m.id ? back : x)));
        relinked++;
        continue;
      }
      n++;
      const id = uid();
      const url = URL.createObjectURL(f);
      setAssets((a) => [...a, { id, type, name: f.name, url, file: f, loading: true }]);
      analyzeFile(type, url, f)
        .then((meta) => setAssets((a) => a.map((x) => (x.id === id ? { ...x, ...meta, loading: false } : x))))
        .catch(() => setAssets((a) => a.map((x) => (x.id === id ? { ...x, loading: false, error: true } : x))));
    }
    notify(relinked ? `${relinked} mídia(s) religada(s) ao projeto${n ? ` e ${n} importada(s)` : ''}` : n ? `${n} arquivo(s) importado(s)` : 'Formato não suportado');
  }, [notify]);

  /** remove da biblioteca e da linha do tempo inteira (inclusive de dentro dos compostos) */
  const removeAsset = (id) => {
    const asset = assets.find((x) => x.id === id);
    const strip = (cs) => cs.filter((c) => c.assetId !== id).map((c) => (c.children ? { ...c, children: strip(c.children) } : c));
    const count = (cs) => cs.reduce((n, c) => n + (c.assetId === id ? 1 : 0) + (c.children ? count(c.children) : 0), 0);
    const used = count(rootRef.current);
    if (used && !window.confirm(`“${asset?.name || 'Este item'}” está em ${used} clipe(s) da linha do tempo, que também serão removidos. Continuar?`)) return;
    setAssets((a) => a.filter((x) => x.id !== id));
    if (used) rootHist.set(strip);
    if (live.current.selectedId && !allClipIds(strip(rootRef.current)).has(live.current.selectedId)) select(null);
    notify(`${asset?.type === 'audio' ? 'Áudio' : 'Item'} excluído`);
  };

  const addSfx = async (def) => {
    const r = await renderSfx(def);
    const asset = { id: uid(), type: 'audio', name: def.name, ...r };
    setAssets((a) => [...a, asset]);
    addClip(makeClip('audio', { assetId: asset.id, track: 'audio', name: asset.name, duration: asset.duration }));
  };

  const addText = (pr) => {
    const { y, ...style } = pr.style;
    addClip(makeClip('text', { name: pr.name, props: { ...style, text: pr.sample, ...(y != null ? { y } : {}) } }));
  };
  const addSticker = (e) => addClip(makeClip('text', { name: 'Sticker', track: 'overlay', props: { text: e, fontSize: 280, shadow: false, bold: false, animIn: 'pop' } }));
  const addColor = (color) => addClip(makeClip('color', { name: 'Fundo', duration: 5, props: { color } }));
  const applyFilter = (f) => { if (selected) setProps(selected.id, { ...ADJ_RESET, ...f.v, filter: f.id }); };
  const addEffect = (id, start) => addClip(makeClip('effect', { name: EFFECT_MAP[id].name, duration: 3, props: { effect: id } }), start);
  const addAdjust = (pr) => addClip(makeClip('adjust', { name: pr.name, duration: 5, props: { ...pr.v } }));

  /* ---------- transições ---------- */
  /** cortes (clipes encostados) de todas as linhas visuais; com `row`, só daquela linha */
  const cuts = (cs, row) => {
    const out = [];
    for (const B of cs) {
      if (!canTransition(B) || (row && clipRow(B) !== row)) continue;
      const A = cs.find((a) => a !== B && clipRow(a) === clipRow(B) && Math.abs(a.start + a.duration - B.start) < 0.05);
      if (A) out.push({ A, B });
    }
    return out;
  };
  const applyTransition = (type, at, row) => {
    const cs = live.current.clips;
    const sel = cs.find((c) => c.id === live.current.selectedId);
    const list = cuts(cs, row || (at == null && sel ? clipRow(sel) : null));
    let cut = at == null ? list.find((x) => x.B.id === live.current.selectedId) : null;
    if (!cut) {
      const ref = at ?? timeRef.current;
      cut = list.sort((a, b) => Math.abs(a.B.start - ref) - Math.abs(b.B.start - ref))[0];
    }
    if (!cut) { notify('Coloque dois clipes encostados na mesma linha para usar transições'); return; }
    const d = Math.min(0.8, cut.A.duration, cut.B.duration);
    setClip(cut.B.id, { transition: { type, duration: cut.B.transition?.duration ?? d } });
    setSelectedId(null);
    setSelectedTr(cut.B.id);
  };
  const trPair = useMemo(() => {
    if (!selectedTr) return null;
    return transitionPairs(clips).find((p) => p.B.id === selectedTr) || null;
  }, [clips, selectedTr]);
  const trApi = {
    onType: (type) => mapClip(selectedTr, (c) => ({ ...c, transition: { ...c.transition, type } })),
    onDuration: (d) => mapClip(selectedTr, (c) => ({ ...c, transition: { ...c.transition, duration: d } }), `trd:${selectedTr}`),
    onRemove: () => { mapClip(selectedTr, (c) => ({ ...c, transition: null })); setSelectedTr(null); },
    onAll: () => {
      const tr = clips.find((c) => c.id === selectedTr)?.transition;
      const trRow = clips.find((c) => c.id === selectedTr);
      const ids = new Set(cuts(clips, trRow ? clipRow(trRow) : null).map((x) => x.B.id));
      hist.set((cs) => cs.map((c) => (ids.has(c.id) ? { ...c, transition: { ...tr } } : c)));
      notify(`Transição aplicada a ${ids.size} corte(s)`);
    },
    onEdit: (id) => openTrEditor(id, selectedTr),
    onNew: () => openTrEditor(null, selectedTr),
  };

  /* ---------- transições personalizadas ---------- */
  const [trEdit, setTrEdit] = useState(null);   // { def, applyTo }
  /** abre o editor: as do usuário são editadas no lugar; as prontas em dados viram uma cópia */
  const openTrEditor = (id, applyTo = null) => {
    const src = id && TRANSITION_MAP[id]?.def;
    const def = !src ? null : isUserTransition(id) ? structuredClone(src) : { ...structuredClone(src), id: 'u:' + uid(), name: `${src.name} (minha)` };
    setTrEdit({ def, applyTo });
  };
  const saveTrEditor = (def) => {
    const saved = saveUserTransition(def);
    const to = trEdit?.applyTo;
    if (to) mapClip(to, (c) => ({ ...c, transition: { type: saved.id, duration: c.transition?.duration ?? saved.duration } }));
    setTrEdit(null);
    notify(to ? `“${saved.name}” salva e aplicada no corte` : `“${saved.name}” salva em Minhas transições`);
  };
  /** troca o tipo da transição em todos os cortes do projeto (inclusive dentro dos compostos) */
  const retypeTransitions = (from, to) => {
    const walk = (cs) => cs.map((c) => ({ ...c, ...(c.transition?.type === from ? { transition: { ...c.transition, type: to } } : {}), ...(c.children ? { children: walk(c.children) } : {}) }));
    rootHist.set(walk);
  };
  const libTrApi = {
    onNew: () => openTrEditor(null),
    onEdit: (id) => openTrEditor(id),
    onExport: (id) => exportTransitions([TRANSITION_MAP[id].def], TRANSITION_MAP[id].name),
    onDelete: (id) => {
      const count = (cs) => cs.reduce((n, c) => n + (c.transition?.type === id ? 1 : 0) + (c.children ? count(c.children) : 0), 0);
      const used = count(rootRef.current), name = TRANSITION_MAP[id].name;
      if (!confirm(used ? `“${name}” está em ${used} corte(s), que passarão a usar Mistura. Excluir?` : `Excluir “${name}”?`)) return;
      if (used) retypeTransitions(id, 'mix');
      deleteUserTransition(id);
      notify('Transição excluída');
    },
    onImport: async (files) => {
      let n = 0;
      for (const f of files) {
        try { n += (await importTransitionsFile(f)).length; } catch (e) { notify(`“${f.name}”: ${e.message || 'arquivo inválido'}`); }
      }
      if (n) notify(`${n} transição(ões) importada(s) para Minhas transições`);
    },
  };

  /* ---------- keyframes ---------- */
  const kfApi = {
    curves: () => setCurveOpen(true),
    toggle: (id, prop) => mapClip(id, (c) => toggleKf(c, prop, localOf(c))),
    addAll: (id, props) => mapClip(id, (c) => addKfs(c, props, localOf(c))),
    ease: (id, at, e) => mapClip(id, (c) => setKfEase(c, at, e)),
    clear: (id) => mapClip(id, (c) => ({ ...c, props: resolveProps(c, localOf(c)), keyframes: {} })),
    toggleGroup: (id, props) => mapClip(id, (c) => {
      const l = localOf(c);
      if (props.every((k) => kfAtTime(c, k, l))) { let out = c; for (const k of props) out = toggleKf(out, k, l); return out; }
      return addKfs(c, props, l);
    }),
    nav: (dir, props) => {
      const c = live.current.clips.find((x) => x.id === live.current.selectedId);
      if (!c) return;
      const sub = props ? { keyframes: Object.fromEntries(props.filter((k) => hasKf(c, k)).map((k) => [k, c.keyframes[k]])) } : c;
      const ts = kfTimes(sub).map((t) => c.start + t);
      const t = timeRef.current;
      const target = dir > 0 ? ts.find((x) => x > t + KF_EPS) : [...ts].reverse().find((x) => x < t - KF_EPS);
      if (target != null) { setPlaying(false); seek(target); }
    },
  };
  const keyframeHere = useCallback(() => {
    const c = live.current.clips.find((x) => x.id === live.current.selectedId);
    if (!c) return;
    const t = timeRef.current;
    if (t < c.start || t > c.start + c.duration) { notify('Posicione o cursor sobre o clipe selecionado'); return; }
    mapClip(c.id, (x) => addKfs(x, KEY_PROPS_FOR(x), localOf(x)));
    notify('Keyframe adicionado — mova o cursor e altere valores para animar');
  }, [notify]);

  /* ---------- dividir / aparar ---------- */
  const targetAt = (t) => {
    const inside = (c) => t > c.start + 0.05 && t < c.start + c.duration - 0.05;
    const cs = live.current.clips;
    return cs.find((c) => c.id === live.current.selectedId && inside(c)) || cs.find((c) => c.track === 'main' && inside(c));
  };
  const splitParts = (target, t) => {
    const s = t - target.start;
    const [kl, kr] = splitKf(target, s);
    // com rampa de velocidade, cada metade vira velocidade constante equivalente (mantém o trecho de mídia)
    const mid = srcTimeAt(target, s), end = srcTimeAt(target, target.duration);
    const curve = !!target.speedCurve;
    const left = { ...target, duration: s, keyframes: kl, speedCurve: null, speed: curve ? (mid - target.in) / s : target.speed, props: { ...target.props, fadeOut: 0, animOut: 'none' } };
    const right = { ...(isCompound(target) ? reid(target) : target), id: uid(), start: t, in: mid, duration: target.duration - s, keyframes: kr, transition: null, speedCurve: null,
      speed: curve ? (end - mid) / (target.duration - s) : target.speed,
      props: { ...target.props, fadeIn: 0, animIn: 'none', penKfs: (target.props.penKfs || []).map((f) => ({ ...f, t: f.t - s })).filter((f) => f.t >= -KF_EPS) } };
    return [left, right];
  };
  /** divide no cursor: o clipe selecionado ou, sem seleção, todos os clipes sob o cursor (de qualquer faixa) */
  const split = useCallback(() => {
    const t = roundFrame(timeRef.current);
    const { clips: cs, trackState: ts, selectedId: sel } = live.current;
    const inside = (c) => t > c.start + 0.05 && t < c.start + c.duration - 0.05 && !ts[clipRow(c)]?.lock;
    const picked = cs.find((c) => c.id === sel && inside(c));
    const targets = picked ? [picked] : cs.filter(inside);
    if (!targets.length) { notify('Posicione o cursor sobre um clipe para dividir'); return; }
    const parts = new Map(targets.map((c) => [c.id, splitParts(c, t)]));
    hist.set((all) => all.flatMap((c) => parts.get(c.id) || [c]));
    select(picked ? parts.get(picked.id)[1].id : null);
  }, [hist.set, notify, select]);
  /** lâmina: corta no tempo `t` o clipe clicado (ou, com `all`, todas as camadas desbloqueadas) */
  const bladeAt = useCallback((id, t, all) => {
    t = roundFrame(t);
    const { clips: cs, trackState: ts } = live.current;
    const ok = (c) => t > c.start + 0.05 && t < c.start + c.duration - 0.05 && !ts[clipRow(c)]?.lock;
    const targets = cs.filter((c) => (all || c.id === id) && ok(c));
    if (!targets.length) { notify('Muito perto da borda do clipe para cortar'); return; }
    const parts = new Map(targets.map((c) => [c.id, splitParts(c, t)]));
    hist.set((xs) => xs.flatMap((c) => parts.get(c.id) || [c]));
    seek(t);
    select(parts.get(id)?.[1].id ?? null);
  }, [hist.set, notify, select, seek]);
  const trimSide = useCallback((side) => {
    const t = timeRef.current;
    const target = targetAt(t);
    if (!target) { notify('Posicione o cursor sobre um clipe'); return; }
    const [left, right] = splitParts(target, t);
    const keep = side === 'left' ? { ...right, id: target.id } : left;
    const before = live.current.clips;
    let out = before.map((c) => (c.id === target.id ? keep : c));
    // fecha o buraco deixado pelo trecho excluído
    if (live.current.ripple) out = side === 'left'
      ? closeGap(out, clipRow(target), right.start, right.start - target.start)
      : closeGap(out, clipRow(target), target.start + target.duration, target.start + target.duration - right.start);
    hist.set(() => finishEdit(before, out, target.id));
    if (side === 'left' && live.current.ripple) seek(target.start);
    select(target.id);
  }, [hist.set, notify, select, seek]);

  const remove = useCallback(() => {
    const { selectedId: id, selectedTr: tr } = live.current;
    if (tr) { mapClip(tr, (c) => ({ ...c, transition: null })); setSelectedTr(null); return; }
    if (!id) return;
    const before = live.current.clips;
    const ids = new Set([...live.current.multi, id]);
    // do último para o primeiro, para que cada buraco fechado não desloque os próximos a excluir
    const gone = before.filter((c) => ids.has(c.id)).sort((a, b) => b.start - a.start);
    let rest = before;
    for (const g of gone) {
      rest = rest.filter((c) => c.id !== g.id);
      // exclusão em cadeia: o que vem depois na mesma linha anda para trás e fecha o buraco
      if (live.current.ripple) rest = closeGap(rest, clipRow(g), g.start + g.duration, g.duration);
    }
    const packed = finishEdit(before, compactLanes(rest), id);
    hist.set(() => packed);
    setTrackState((ts) => remapTrackState(ts, laneRemap(rest, packed)));
    select(null);
  }, [hist.set, select]);

  /* ---------- mover vários clipes ---------- */
  const moveClips = useCallback((orig, dt, key, layers = (cs) => cs) =>
    hist.set((cs) => layers(cs.map((c) => (orig.has(c.id) ? { ...c, start: orig.get(c.id) + dt } : c))), key), [hist.set]);
  /** durante o arraste de um clipe: aplica `patch` nele e põe os vizinhos onde o arraste pede
   *  (`starts`); quem não está em `starts` volta para onde estava em `base` (o arraste pode ter trocado de linha) */
  const dragLayout = useCallback((id, patch, starts, base, key) => {
    const was = new Map(base.map((c) => [c.id, c.start]));
    hist.set((cs) => cs.map((c) => {
      if (c.id === id) return { ...c, ...patch };
      const s = starts.has(c.id) ? starts.get(c.id) : was.get(c.id) ?? c.start;
      return Math.abs(s - c.start) > 1e-6 ? { ...c, start: s } : c;
    }), key);
  }, [hist.set]);
  /** ao soltar o grupo: quem caiu sobre outro clipe sobe para uma camada livre; depois ímã e vinculação */
  const settleGroup = useCallback((ids, key, before) => {
    let cs = live.current.clips;
    for (const id of ids) {
      const c = cs.find((x) => x.id === id);
      if (!c || c.track === 'main') continue;
      const lane = freeLane(cs, c, laneOf(c));
      if (lane !== laneOf(c)) cs = cs.map((x) => (x.id === id ? { ...x, lane } : x));
    }
    const packed = finishEdit(before, compactLanes(cs), new Set(ids));
    hist.set(() => packed, key);
    // o estado das linhas (rótulo, bloqueio, fosco...) segue os clipes; numa linha dividida, fica com quem não se moveu
    const moved = new Set(ids);
    setTrackState((ts) => remapTrackState(ts, laneRemap([...before.filter((c) => moved.has(c.id)), ...before.filter((c) => !moved.has(c.id))], packed)));
  }, [hist.set]);
  /** ordem de camada da seleção (o grupo inteiro): +1/-1 passa uma camada, 'top'/'bottom' vai para a ponta */
  const layerOrder = useCallback((steps) => {
    const { clips: cs, selectedId: sid, multi: more } = live.current;
    const ids = expandGroups(cs, [...more, sid].filter(Boolean));
    if (!ids.length) return;
    const after = shiftLayers(cs, ids, steps);
    if (after.every((c, i) => laneOf(c) === laneOf(cs[i]))) return;
    hist.set(() => after);
    const moved = new Set(ids);
    setTrackState((ts) => remapTrackState(ts, laneRemap([...cs.filter((c) => moved.has(c.id)), ...cs.filter((c) => !moved.has(c.id))], after)));
  }, [hist.set]);

  /* ---------- clipes compostos ---------- */
  const createCompound = useCallback(() => {
    const { clips: cs, selectedId: sid, multi: more, trackState: ts } = live.current;
    const ids = new Set([...more, sid].filter(Boolean));
    if (ids.size < 2) { notify('Selecione 2 ou mais clipes (Ctrl+clique) para criar um clipe composto'); return; }
    const span = () => { const sel = cs.filter((c) => ids.has(c.id)); return [Math.min(...sel.map((c) => c.start)), Math.max(...sel.map((c) => c.start + c.duration))]; };
    let [t0, t1] = span();
    const onMain = cs.some((c) => ids.has(c.id) && c.track === 'main');
    if (onMain) {
      // a Principal não pode ter sobreposição: clipes dela dentro do intervalo entram junto
      for (const c of cs) if (c.track === 'main' && c.start < t1 - 1e-3 && c.start + c.duration > t0 + 1e-3) ids.add(c.id);
      [t0, t1] = span();
    }
    const sel = cs.filter((c) => ids.has(c.id));
    if (sel.some((c) => ts[clipRow(c)]?.lock)) { notify('Há clipes em camadas bloqueadas na seleção'); return; }
    const n = cs.filter(isCompound).length + 1;
    const comp = {
      id: uid(), type: 'compound', name: `Composto ${n}`, assetId: null, track: onMain ? 'main' : 'overlay', lane: 0,
      start: t0, in: 0, duration: t1 - t0, speed: 1, keyframes: {}, transition: null, trackState: {},
      props: { ...BASE_PROPS },
      children: compactLanes(sel.map((c) => ({ ...c, start: c.start - t0 }))),
    };
    const rest = cs.filter((c) => !ids.has(c.id));
    const placed = { ...comp, lane: onMain ? 0 : freeLane(rest, comp, 0) };
    const after = compactLanes([...rest, placed]);
    hist.set(() => finishEdit(cs, after, comp.id));
    setTrackState((s) => remapTrackState(s, laneRemap([...rest, placed], after)));
    select(comp.id);
    notify(`“${comp.name}” criado com ${sel.length} clipes — clique duas vezes para editar por dentro`);
  }, [hist.set, notify, select]);
  /** desfaz o composto: os clipes de dentro voltam para a linha do tempo atual (cortados ao trecho visível) */
  const ungroupCompound = useCallback(() => {
    const cs = live.current.clips, c = cs.find((x) => x.id === live.current.selectedId);
    if (!isCompound(c)) { notify('Selecione um clipe composto para desfazer'); return; }
    const a = c.start, b = c.start + c.duration, off = c.start - c.in;
    let rest = cs.filter((x) => x.id !== c.id);
    for (let k of c.children) {
      k = { ...k, start: k.start + off };
      if (k.start + k.duration <= a + 1e-3 || k.start >= b - 1e-3) continue;
      if (k.start < a - 1e-3) k = splitParts(k, a)[1];
      if (k.start + k.duration > b + 1e-3) k = splitParts(k, b)[0];
      if (k.track === 'main' && c.track !== 'main') k = { ...k, track: 'overlay' };
      rest = [...rest, { ...k, lane: k.track === 'main' ? 0 : freeLane(rest, k, laneOf(k)) }];
    }
    const after = compactLanes(rest);
    hist.set(() => finishEdit(cs, after, null));
    select(null);
    notify('Clipe composto desfeito');
  }, [hist.set, notify, select]);
  const enterCompound = useCallback((id) => {
    const c = live.current.clips.find((x) => x.id === id);
    if (!isCompound(c)) return;
    setPlaying(false);
    exitStack.current.push({ ts: live.current.trackState });
    setTrackState(c.trackState || {});
    setPath((p) => [...p, id]);
    select(null);
    seek(clamp(timeRef.current - c.start + c.in, 0, innerLength(c.children)));
  }, [select, seek]);
  /** volta até a profundidade `depth` (0 = projeto); grava o estado das linhas de cada nível no composto */
  const exitTo = useCallback((depth) => {
    let p = pathRef.current;
    if (depth >= p.length) return;
    setPlaying(false);
    let ts = live.current.trackState, t = timeRef.current;
    while (p.length > depth) {
      const id = p[p.length - 1], parent = p.slice(0, -1), inner = ts;
      rootHist.replace((root) => updateAtPath(root, parent, (cs) => cs.map((c) => (c.id === id ? { ...c, trackState: inner } : c)), false));
      const c = clipsAtPath(rootRef.current, parent)?.find((x) => x.id === id);
      if (c) t = clamp(c.start + t - c.in, c.start, c.start + c.duration);
      ts = exitStack.current.pop()?.ts || {};
      p = parent;
    }
    setTrackState(ts);
    setPath(p);
    select(null);
    seek(t);
  }, [rootHist.replace, select, seek]);
  // desfazer pode apagar o composto aberto: volta ao projeto
  useEffect(() => {
    if (path.length && !clipsAtPath(rootHist.clips, path)) { setTrackState(exitStack.current[0]?.ts || {}); exitStack.current = []; setPath([]); select(null); }
  }, [rootHist.clips, path]);
  const crumbs = path.map((id, i) => ({ depth: i + 1, name: clipsAtPath(rootHist.clips, path.slice(0, i))?.find((c) => c.id === id)?.name || 'Composto' }));

  /* ---------- copiar / recortar / colar ---------- */
  // a área de transferência guarda todos os clipes selecionados (com os grupos inteiros);
  // ao colar, eles mantêm o espaçamento entre si e a camada de origem, a partir do cursor
  const clipboardRef = useRef(null);
  const copyClip = useCallback(() => {
    const { clips: cs, selectedId: sid, multi: more } = live.current;
    if (!sid) return false;
    const ids = new Set(expandGroups(cs, [...more, sid]));
    const sel = cs.filter((c) => ids.has(c.id));
    if (!sel.length) return false;
    clipboardRef.current = structuredClone(sel);
    const groups = new Set(sel.map((c) => c.group).filter(Boolean)).size;
    notify(`${sel.length > 1 ? `${sel.length} clipes copiados` : 'Clipe copiado'}${groups ? ` (${groups} grupo${groups > 1 ? 's' : ''})` : ''} — Ctrl+V cola no cursor`);
    return true;
  }, [notify]);
  const cutClip = useCallback(() => { if (copyClip()) remove(); }, [copyClip, remove]);
  const pasteClip = useCallback(() => {
    const src = clipboardRef.current;
    if (!src?.length) { notify('Nada copiado ainda — selecione clipes e use Ctrl+C'); return; }
    const am = live.current.assetMap;
    const lost = (c) => (c.assetId && !am[c.assetId]) || (isCompound(c) && c.children.some(lost));
    const ok = src.filter((c) => !lost(c));
    if (!ok.length) { notify('A mídia desses clipes não está mais no projeto'); return; }
    const t = roundFrame(timeRef.current), t0 = Math.min(...ok.map((c) => c.start));
    // grupos colados viram grupos novos, independentes dos originais
    const gmap = new Map();
    const regroup = (g) => g && (gmap.get(g) || gmap.set(g, uid()).get(g));
    const fresh = ok.map((c) => ({ src: c, clip: { ...reid(structuredClone(c)), group: regroup(c.group) } }));
    let cs = live.current.clips;
    // Principal: os clipes entram no cursor, um depois do outro, e o resto anda para a direita
    const main = fresh.filter((f) => f.clip.track === 'main').sort((x, y) => x.src.start - y.src.start);
    let at = t;
    main.forEach((f, i) => {
      // a transição só fica se o clipe anterior (também colado) estava encostado nele
      const prev = main[i - 1]?.src, keepTr = prev && Math.abs(prev.start + prev.duration - f.src.start) < 1e-3;
      f.clip = { ...f.clip, start: at, transition: keepTr ? f.clip.transition : null };
      cs = insertMain(cs, at, f.clip);
      at += f.clip.duration;
    });
    // outras faixas: mesmo deslocamento em relação ao primeiro clipe, tentando manter a camada de origem
    for (const f of fresh) {
      if (f.clip.track === 'main') continue;
      f.clip = { ...f.clip, start: t + f.src.start - t0, transition: null };
      cs = [...cs, { ...f.clip, lane: freeLane(cs, f.clip, laneOf(f.src)) }];
    }
    hist.set(() => cs);
    const ids = fresh.map((f) => f.clip.id);
    setSelectedId(ids[ids.length - 1]); setMulti(ids.slice(0, -1)); setSelectedTr(null);
    if (ok.length < src.length) notify('Alguns clipes ficaram de fora: a mídia deles não está mais no projeto');
  }, [hist.set, notify]);

  /* ---------- grupos ---------- */
  const groupClips = useCallback(() => {
    const { clips: cs, selectedId: sid, multi: more, trackState: ts } = live.current;
    const ids = new Set(expandGroups(cs, [...more, sid].filter(Boolean)));
    if (ids.size < 2) { notify('Selecione 2 ou mais clipes (Ctrl+clique ou caixa de seleção) para agrupar'); return; }
    if (cs.some((c) => ids.has(c.id) && ts[clipRow(c)]?.lock)) { notify('Há clipes em camadas bloqueadas na seleção'); return; }
    const g = uid();
    hist.set((all) => all.map((c) => (ids.has(c.id) ? { ...c, group: g } : c)));
    notify(`${ids.size} clipes agrupados — movem, copiam e excluem juntos · Ctrl+Shift+G desagrupa`);
  }, [hist.set, notify]);
  const ungroupClips = useCallback(() => {
    const { clips: cs, selectedId: sid, multi: more } = live.current;
    const ids = new Set([...more, sid].filter(Boolean));
    const gs = new Set(cs.filter((c) => ids.has(c.id) && c.group).map((c) => c.group));
    if (!gs.size) { notify('Selecione um grupo para desagrupar'); return; }
    hist.set((all) => all.map((c) => (gs.has(c.group) ? { ...c, group: undefined } : c)));
    notify(gs.size > 1 ? `${gs.size} grupos desfeitos` : 'Grupo desfeito');
  }, [hist.set, notify]);

  /** insere `clip` na Principal em `t` (corta o clipe sob o cursor e empurra o restante) */
  const insertMain = (cs, t, clip) => {
    const inside = cs.find((c) => c.track === 'main' && t > c.start + 0.05 && t < c.start + c.duration - 0.05);
    if (inside) { const [l, r] = splitParts(inside, t); cs = cs.flatMap((c) => (c.id === inside.id ? [l, r] : [c])); }
    const pushed = cs.map((c) => (c.track === 'main' && c.start >= t - 1e-3 ? { ...c, start: c.start + clip.duration } : c));
    return finishEdit(cs, [...pushed, { ...clip, track: 'main', lane: 0 }], clip.id);
  };

  /* ---------- congelar quadro ---------- */
  const FREEZE_DUR = 2;
  const freezeFrame = useCallback(async () => {
    const t = roundFrame(timeRef.current);
    const { clips: cs, selectedId: sid, assetMap: am } = live.current;
    const on = (c) => c && c.type === 'video' && t >= c.start - 1e-3 && t < c.start + c.duration - 1e-3;
    const sel = cs.find((c) => c.id === sid);
    const target = on(sel) ? sel : cs.find((c) => c.track === 'main' && on(c)) || cs.find(on);
    if (!target) { notify('Posicione o cursor sobre um clipe de vídeo para congelar o quadro'); return; }
    const asset = am[target.assetId];
    if (!asset) return;
    setPlaying(false);
    const local = clamp(t - target.start, 0, target.duration);
    let shot;
    try { shot = await grabFrame(asset.url, srcTimeAt(target, local)); }
    catch { notify('Não foi possível capturar o quadro'); return; }
    const base = (asset.name || 'video').replace(/\.[^.]+$/, '');
    const file = new File([shot.blob], `${base} — quadro ${fmt(t).replace(/:/g, '.')}.png`, { type: 'image/png' });
    const url = URL.createObjectURL(file);
    const img = { id: uid(), type: 'image', name: file.name, url, file, width: shot.width, height: shot.height, duration: 5, thumb: url, loading: false };
    setAssets((a) => [...a, img]);
    // o quadro herda o visual do clipe naquele instante (posição, cor, máscara…), sem animações
    const p = resolveProps(target, local);
    const freeze = {
      ...target, id: uid(), type: 'image', assetId: img.id, name: 'Quadro congelado', start: t, in: 0, duration: FREEZE_DUR,
      speed: 1, speedCurve: null, keyframes: {}, transition: null,
      props: { ...p, fadeIn: 0, fadeOut: 0, animIn: 'none', animOut: 'none', penPath: penAt(target, local) || p.penPath, penKfs: [] },
    };
    const now = live.current.clips;
    let out;
    if (target.track === 'main') out = insertMain(now, t, freeze);
    else {
      // em outras camadas: corta, encaixa o quadro e empurra o restante da linha
      let cs2 = now;
      if (t > target.start + 0.05) { const [l, r] = splitParts(target, t); cs2 = cs2.flatMap((c) => (c.id === target.id ? [l, r] : [c])); }
      const row = clipRow(target);
      out = [...cs2.map((c) => (clipRow(c) === row && c.start >= t - 1e-3 ? { ...c, start: c.start + FREEZE_DUR } : c)), freeze];
    }
    hist.set(() => out);
    select(freeze.id);
    notify(`Quadro congelado por ${FREEZE_DUR}s — ajuste a duração arrastando a borda`);
  }, [hist.set, notify, select]);

  const duplicate = useCallback(() => {
    const c = live.current.clips.find((x) => x.id === live.current.selectedId);
    if (!c) return;
    const copy = { ...reid(c), start: c.start + c.duration, transition: null, props: { ...c.props } };
    hist.set((cs) => [...cs, { ...copy, lane: freeLane(cs, copy, laneOf(c)) }]);
    select(copy.id);
  }, [hist.set, select]);

  /**
   * Extrai o áudio do vídeo para a faixa Áudio: novo clipe no mesmo tempo e trecho (velocidade,
   * volume, fades e keyframes de volume vão junto) e o vídeo fica mudo. Como começa junto com
   * o vídeo, acompanha o clipe quando ele é movido na faixa principal.
   */
  const extractAudio = useCallback((id) => {
    const c = live.current.clips.find((x) => x.id === id);
    if (!c || c.type !== 'video') return;
    if ((c.props.volume ?? 100) === 0 && !c.keyframes?.volume?.length) { notify('O áudio deste vídeo já foi extraído (ou ele está mudo)'); return; }
    const a = assetMap[c.assetId];
    const audio = {
      ...makeClip('audio', { assetId: c.assetId, track: 'audio', name: `${c.name} · áudio`, duration: c.duration }),
      start: c.start, in: c.in, speed: c.speed, ...(c.speedCurve ? { speedCurve: c.speedCurve } : {}),
      keyframes: c.keyframes?.volume ? { volume: c.keyframes.volume } : {},
      props: { ...BASE_PROPS, volume: c.props.volume ?? 100, fadeIn: c.props.fadeIn || 0, fadeOut: c.props.fadeOut || 0 },
    };
    const { volume: _v, ...restKf } = c.keyframes || {};
    hist.set((cs) => [
      ...cs.map((x) => (x.id === id ? { ...x, keyframes: restKf, props: { ...x.props, volume: 0 } } : x)),
      { ...audio, lane: freeLane(cs, audio, 0) },
    ]);
    select(audio.id);
    notify('Áudio extraído para a faixa Áudio');
    // forma de onda: o vídeo não tem uma; calcula a partir do áudio dele (em segundo plano)
    if (a && !a.peaks) {
      const whole = { ...makeClip('audio', { assetId: a.id, track: 'audio', duration: a.duration }), start: 0 };
      mixProjectAudio([whole], { [a.id]: a }, {}, a.duration, 8000)
        .then((buf) => setAssets((as) => as.map((x) => (x.id === a.id ? { ...x, peaks: computePeaks(buf) } : x))))
        .catch(() => {});
    }
  }, [hist.set, notify, select, assetMap]);

  /** M: cria um marcador no cursor — ou remove, se já houver um ali */
  const addMarker = useCallback(() => setMarkers((m) => {
    const t = timeRef.current, near = m.find((x) => Math.abs(x.t - t) < FRAME * 1.5);
    return near ? m.filter((x) => x !== near) : [...m, { id: uid(), t }];
  }), []);
  const clearMarkers = () => { if (markers.length > 1 && !confirm(`Remover os ${markers.length} marcadores?`)) return; setMarkers([]); };

  const togglePlay = useCallback(() => {
    const s = live.current;
    if (s.duration <= 0) return;
    engine.ensureAudio();
    if (!s.playing && timeRef.current >= s.duration - 0.02) seek(0);
    setPlaying((p) => !p);
  }, [seek]);

  /* ---------- ímã da faixa principal e vinculação ---------- */
  /** depois de mover/aparar/excluir: encosta a Principal (ímã) e leva junto os clipes vinculados */
  const finishEdit = (before, after, movedId) => {
    let out = after;
    if (live.current.mainMagnet) out = packMain(out);
    if (live.current.linkage) out = applyLinkage(before, out, movedId);
    return out;
  };
  const setMainMagnet = (v) => {
    setMainMagnetState(v);
    live.current.mainMagnet = v;
    if (v) {
      const cs = live.current.clips, packed = finishEdit(cs, cs, null);
      if (packed !== cs) hist.set(() => packed);
    }
  };
  /* ---------- narração pelo microfone ---------- */
  const recordVoice = async () => {
    if (voiceRef.current) { voiceRef.current.stop(); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch { notify('Microfone indisponível ou permissão negada'); return; }
    const rec = new MediaRecorder(stream), chunks = [], start = timeRef.current;
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      voiceRef.current = null;
      setRecording(false);
      setPlaying(false);
      try {
        // converte para WAV: duração exata e busca confiável (o WebM do gravador não tem duração)
        const raw = await new Blob(chunks, { type: rec.mimeType }).arrayBuffer();
        const buf = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(raw);
        const n = live.current.clips.filter((c) => c.name?.startsWith('Narração')).length + 1;
        const asset = { id: uid(), type: 'audio', name: `Narração ${n}`, url: URL.createObjectURL(encodeWav(buf)), duration: buf.duration, peaks: computePeaks(buf) };
        setAssets((a) => [...a, asset]);
        addClip(makeClip('audio', { assetId: asset.id, track: 'audio', name: asset.name, duration: asset.duration }), start);
        notify(`${asset.name} adicionada (${buf.duration.toFixed(1)} s)`);
      } catch { notify('Não foi possível processar a gravação'); }
    };
    rec.start(250);
    voiceRef.current = rec;
    setRecording(true);
    engine.ensureAudio();
    if (live.current.duration > timeRef.current + 0.1) setPlaying(true);
    notify('Gravando narração… clique no microfone para parar');
  };
  /* ---------- editar texto direto no reprodutor ---------- */
  const startTextEdit = (id) => {
    setTextEdit(id);
    select(id);
    previewRef.current = { id, patch: { blendOn: true, opacity: 0 } }; // o canvas esconde o texto enquanto a caixa de edição mostra
  };
  const endTextEdit = () => { previewRef.current = null; setTextEdit(null); };
  const onPreviewDbl = (e) => {
    if (tool) return;
    const r = e.currentTarget.getBoundingClientRect(), k = W / r.width;
    const px = (e.clientX - r.left) * k, py = (e.clientY - r.top) * k;
    const hit = [...boxesRef.current].reverse().find((b) => {
      if (!b.w || live.current.trackState[b.row]?.lock) return false;
      const [lx, ly] = boxLocal(b, px, py);
      return Math.abs(lx) <= b.w / 2 && Math.abs(ly) <= b.h / 2 && live.current.clips.find((c) => c.id === b.id)?.type === 'text';
    });
    if (hit) startTextEdit(hit.id);
  };

  /* ---------- camadas (painel estilo After Effects) ---------- */
  const setRow = (rk, patch) => setTrackState((s) => ({ ...s, [rk]: { ...s[rk], ...patch } }));
  const rowApi = {
    setRow,
    /** nova ordem de uma zona de camadas (lista de cima para baixo): grava o z de cada linha */
    setOrder: (rks) => setTrackState((s) => {
      const out = { ...s };
      rks.forEach((rk, i) => { out[rk] = { ...s[rk], z: rks.length - i }; });
      return out;
    }),
    setParent: (rk, parent) => {
      if (!parent) { setRow(rk, { parent: undefined, rest: undefined }); return; }
      const ts = live.current.trackState;
      if (!canParentRow(parent) || !canParentRow(rk)) { notify('Só camadas de imagem/vídeo/texto podem ter vínculo'); return; }
      if (parentChainHas(ts, parent, rk)) { notify('Vínculo circular: a outra camada já depende desta'); return; }
      // guarda o estado do pai agora: o filho não pula e passa a seguir as mudanças a partir daqui
      const rest = engine.worldU(parent, timeRef.current, live.current.clips, ts, W, H, 0, true);
      if (!rest) { notify('A camada escolhida ainda não tem clipes'); return; }
      setRow(rk, { parent, rest: toArr(rest) });
    },
    setProps: (id, patch, key) => setProps(id, patch, key),
    addKf: (id, keys) => mapClip(id, (c) => addKfs(c, keys, localOf(c))),
    toggleKfs: (id, keys) => kfApi.toggleGroup(id, keys),
    // cronômetro desligado: remove a animação e mantém o valor atual
    stopwatchOff: (id, keys) => mapClip(id, (c) => {
      const l = localOf(c), props = { ...c.props }, keyframes = { ...c.keyframes };
      for (const k of keys) { props[k] = propAt(c, k, l); delete keyframes[k]; }
      return { ...c, props, keyframes };
    }),
  };
  const toggleTrack = (id, k) => setTrackState((s) => ({ ...s, [id]: { ...s[id], [k]: !s[id]?.[k] } }));

  /* ---------- legendas ---------- */
  const captionList = useMemo(() => clips.filter((c) => c.track === 'caption').sort((a, b) => a.start - b.start), [clips]);
  const makeCaption = (text, start, dur) => {
    // vinculadas: a nova legenda nasce com a posição/tamanho das que já existem
    const ref = capLinkRef.current && live.current.clips.find((c) => c.track === 'caption');
    return { ...makeClip('text', { track: 'caption', name: 'Legenda', duration: dur, props: { ...capStyle.style, text, y: 78, ...(ref ? pickCapLayout(ref.props) : {}) } }), start };
  };
  const capApi = {
    link: capLink, count: captionList.length,
    setLink: (v) => { setCapLink(v); notify(v ? 'Legendas vinculadas: posição e tamanho mudam em todas' : 'Legendas desvinculadas'); },
    /** copia a posição/tamanho desta legenda para todas as outras */
    applyAll: (clip) => {
      const lay = pickCapLayout(resolveProps(clip, localOf(clip)));
      hist.set((cs) => cs.map((c) => (c.track === 'caption' && c.id !== clip.id ? setCapLayout(c, lay) : c)));
      notify(`Posição e tamanho aplicados a ${captionList.length - 1} legenda(s)`);
    },
    /** separa uma legenda transcrita em uma legenda por palavra (mantendo o estilo dela) */
    splitWords: (clip) => {
      const ws = clip.props.words;
      if (!ws?.length) return;
      const parts = wordsToSingleCaptions(ws.map((w) => ({ w: w.w, s: clip.start + w.s, e: clip.start + w.e })));
      const end = clip.start + clip.duration;
      const { words, karaoke, ...style } = clip.props;
      const made = parts.filter((g) => g.start < end).map((g) => ({ ...clip, id: uid(), keyframes: undefined, start: g.start,
        duration: Math.max(0.05, Math.min(g.end, end) - g.start), props: { ...style, text: g.text } }));
      hist.set((cs) => [...cs.filter((c) => c.id !== clip.id), ...made]);
      select(made[0]?.id);
      notify(`Legenda separada em ${made.length} palavra(s)`);
    },
  };
  /** clipes de vídeo/áudio selecionados (clique e Ctrl+clique) */
  const selMediaClips = (cs) => {
    const ids = new Set([...live.current.multi, live.current.selectedId].filter(Boolean));
    const sel = cs.filter((c) => ids.has(c.id) && isMedia(c));
    // vídeo com o áudio extraído: o som está no clipe de áudio do mesmo arquivo que começa junto
    const extracted = cs.filter((a) => a.type === 'audio' && !ids.has(a.id)
      && sel.some((v) => v.type === 'video' && v.assetId === a.assetId && Math.abs(v.start - a.start) < 1e-3));
    return [...sel, ...extracted];
  };
  const selMedia = useMemo(() => {
    const sel = selMediaClips(clips);
    if (!sel.length) return null;
    return { count: sel.filter((c) => c.id === selectedId || multi.includes(c.id)).length, name: sel[0].name, start: Math.min(...sel.map((c) => c.start)), end: Math.max(...sel.map((c) => c.start + c.duration)) };
  }, [clips, selectedId, multi]);
  const captions = {
    list: captionList, time, styleId: capStyle.id, selMedia,
    onAdd: () => { const c = makeCaption('Nova legenda', timeRef.current, 2); hist.set((cs) => [...cs, c]); select(c.id); },
    onUpdate: (id, text) => setProps(id, { text }, `cap:${id}`),
    onRemove: (id) => hist.set((cs) => cs.filter((c) => c.id !== id)),
    onSeek: (t) => { setPlaying(false); seek(t); },
    onImport: (items) => {
      if (!items.length) { notify('Nenhuma legenda encontrada no arquivo'); return; }
      hist.set((cs) => [...cs, ...items.map((it) => makeCaption(it.text, it.start, it.end - it.start))]);
      notify(`${items.length} legenda(s) importada(s)`);
    },
    onScript: (text, cps) => {
      const parts = text.replace(/\s+/g, ' ').split(/(?<=[.!?…;])\s+/).map((s) => s.trim()).filter(Boolean)
        .flatMap((s) => { // quebra frases longas em pedaços de até ~42 caracteres
          if (s.length <= 42) return [s];
          const out = []; let cur = '';
          for (const w of s.split(' ')) { if ((cur + ' ' + w).trim().length > 42) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
          return cur ? [...out, cur] : out;
        });
      let t = timeRef.current;
      const made = parts.map((s) => { const d = clamp(s.length / cps, 1, 6); const c = makeCaption(s, t, d); t += d; return c; });
      hist.set((cs) => [...cs, ...made]);
      notify(`${made.length} legenda(s) criada(s)`);
    },
    /** transcreve a fala da linha do tempo aberta e cria legendas com o tempo de cada palavra */
    onAuto: async (o, onStage) => {
      const { clips: cs, assetMap: am, trackState: ts, duration: dur } = live.current;
      if (dur <= 0) { notify('A linha do tempo está vazia'); return; }
      // trecho: tudo, da agulha até o fim, ou só o(s) clipe(s) de mídia selecionado(s) (ouvindo só eles)
      let from = 0, to = dur, src = cs;
      if (o.scope === 'playhead') {
        from = clamp(timeRef.current, 0, dur);
        if (dur - from < 0.3) { notify('A agulha está no fim da linha do tempo'); return; }
      } else if (o.scope === 'clip') {
        const sel = selMediaClips(cs);
        if (!sel.length) { notify('Selecione um clipe de vídeo ou áudio na linha do tempo'); return; }
        from = Math.min(...sel.map((c) => c.start));
        to = Math.max(...sel.map((c) => c.start + c.duration));
        src = sel;
      }
      setPlaying(false);
      try {
        const words = (await transcribeProject({ clips: src, assetMap: am, trackState: ts, from, to, lang: o.lang, model: o.model, onStage }))
          .filter((w) => w.s < to && w.e > from);
        if (!words.length) { notify('Nenhuma fala reconhecida'); return; }
        const made = o.perWord
          ? wordsToSingleCaptions(words).map((g) => makeCaption(g.text, g.start, g.end - g.start))
          : wordsToCaptions(words, { lines: o.lines }).map((g) => {
            const c = makeCaption(g.text, g.start, g.end - g.start);
            return o.karaoke ? { ...c, props: { ...c.props, words: g.words, karaoke: true, hlMode: o.hlMode, hlColor: o.hlColor } } : c;
          });
        // substitui só as legendas que tocam o trecho transcrito
        const inRange = (c) => c.track === 'caption' && c.start < to && c.start + c.duration > from;
        hist.set((xs) => [...(o.replace ? xs.filter((c) => !inRange(c)) : xs), ...made]);
        notify(`${made.length} legenda(s) criada(s) a partir de ${words.length} palavras`);
      } catch (e) {
        notify('Não foi possível transcrever: ' + (e?.message || e));
      }
    },
    onStyle: (s) => {
      setCapStyle(s);
      hist.set((cs) => cs.map((c) => (c.track === 'caption' ? { ...c, props: { ...c.props, ...s.style } } : c)));
    },
  };

  /* ---------- modelos ---------- */
  const applyTemplate = (tpl) => {
    const t0 = timeRef.current;
    const make = (type, start, dur, props = {}, opts = {}) => ({ ...makeClip(type, { duration: dur, props, name: opts.name || (type === 'effect' ? EFFECT_MAP[props.effect]?.name : tpl.name), assetId: opts.assetId, track: opts.track || defaultTrack(type) }), start });
    const res = tpl.build({ make, t0, assets });
    if (res.error) { notify(res.error); return; }
    if (res.ratio) setRatio(res.ratio);
    hist.set((cs) => [...cs, ...res.clips]);
    select(null);
    notify(`Modelo “${tpl.name}” inserido`);
  };

  /* ---------- projeto: abrir, salvar e salvamento automático ---------- */
  const [saveState, setSaveState] = useState('idle');   // idle | saving | saved | error
  const restoredRef = useRef(false);
  const projectFileRef = useRef();
  const loadProject = useCallback((doc) => {
    setPlaying(false);
    select(null);
    exitStack.current = [];
    setPath([]);
    adoptProjectTransitions(doc.transitions);
    hist.reset(doc.clips || []);
    setAssets(doc.assets || []);
    setMarkers(doc.markers || []);
    setTrackState(doc.trackState || {});
    setGuides(doc.guides || { v: [], h: [] });
    setCapStyle(CAPTION_STYLES.find((s) => s.id === doc.capStyle) || CAPTION_STYLES[0]);
    if (RATIOS[doc.ratio]) setRatio(doc.ratio);
    if (RESOLUTIONS[doc.resolution]) setResolution(doc.resolution);
    setProjectName(doc.name || 'Meu projeto');
    seek(0);
  }, [hist.reset, select, seek]);
  // ao abrir o editor, retoma o último projeto salvo automaticamente
  useEffect(() => {
    navigator.storage?.persist?.().catch(() => {});
    loadAutosave()
      .then((doc) => { if (doc && (doc.clips?.length || doc.assets.length)) { loadProject(doc); notify('Projeto anterior restaurado'); } })
      .catch((e) => console.warn('CutLab: falha ao restaurar', e))
      .finally(() => { restoredRef.current = true; });
  }, []);
  // dentro de um composto, o projeto continua sendo a raiz (e o estado das linhas de fora)
  const projectState = { name: projectName, ratio, resolution, clips: rootHist.clips, assets, markers, trackState: exitStack.current[0]?.ts ?? trackState, guides, capStyle };
  const projectRef = useRef(projectState);
  projectRef.current = projectState;
  // grava ~1 s depois da última alteração (gestos contínuos viram um único salvamento)
  useEffect(() => {
    if (!restoredRef.current) return;
    if (assets.some((a) => a.loading)) return;
    setSaveState('saving');
    const t = setTimeout(() => {
      autosaveProject(projectRef.current)
        .then(() => setSaveState('saved'))
        .catch((e) => { console.warn('CutLab: falha ao salvar', e); setSaveState('error'); });
    }, 1000);
    return () => clearTimeout(t);
  }, [projectName, ratio, resolution, clips, assets, markers, trackState, guides, capStyle]);
  const saveProject = useCallback(async (opts) => {
    try {
      notify('Preparando arquivo do projeto…');
      const r = await saveProjectFile(projectRef.current, opts);
      if (r) notify(`Projeto salvo (${r.size < 1048576 ? Math.max(1, Math.round(r.size / 1024)) + ' KB' : (r.size / 1048576).toFixed(1) + ' MB'})`);
    } catch (e) { notify('Não foi possível salvar: ' + e.message); }
  }, [notify]);
  const savePackage = useCallback(() => saveProject({ withMedia: true }), [saveProject]);
  const openProject = useCallback(() => {
    if (live.current.clips.length && !confirm('Abrir outro projeto? A edição atual será substituída (ela continua salva só se você salvou o arquivo).')) return;
    projectFileRef.current.click();
  }, []);
  const openProjectFile = async (f) => {
    try {
      const doc = await unpackProject(f, projectRef.current.assets);
      loadProject(doc);
      const miss = doc.assets.filter((a) => a.missing).length;
      notify(miss ? `“${f.name}” aberto — importe de novo ${miss} mídia(s) que faltam (aba Mídia)` : `“${f.name}” aberto`);
    }
    catch (e) { notify(e.message || 'Arquivo de projeto inválido'); }
  };

  const newProject = () => {
    if (clips.length && !confirm('Começar um novo projeto? A edição atual será descartada.')) return;
    exitStack.current = [];
    setPath([]);
    hist.reset([]);
    setAssets([]);
    setMarkers([]);
    setTrackState({});
    select(null);
    setPlaying(false);
    seek(0);
    setProjectName('Novo projeto');
  };

  /* ---------- arrastar no preview para mover o clipe ---------- */
  /* ---------- remoção automática de fundo ---------- */
  const onAutoBg = (clip, on) => {
    if (!on) { setProps(clip.id, { autoBg: false, chromaOn: false }); return; }
    const { src, ready } = engine.source(clip, assetMap[clip.assetId], clip.props);
    if (!ready || !src) { notify('Posicione o cursor sobre o clipe para analisar o quadro'); return; }
    const res = detectBackground(src);
    if (!res) { notify('Não foi possível detectar o fundo'); return; }
    setProps(clip.id, { autoBg: true, chromaOn: true, chromaColor: res.color, chromaStrength: 35, chromaSoft: 18 });
    notify(res.share < 0.4 ? 'Fundo pouco uniforme — ajuste em Chroma key ou use a remoção personalizada' : `Fundo detectado (${res.color}) e removido`);
  };

  /* ---------- caneta: edição do caminho ---------- */
  const lastPenDown = useRef({ i: -1, t: 0 });
  /** grava o caminho (no keyframe do instante atual, se o recorte for animado) */
  const setPen = (id, path, key) => hist.set((cs) => cs.map((c) => {
    if (c.id !== id) return c;
    const l = localOf(c), kfs = c.props.penKfs || [];
    if (kfs.length) {
      const i = kfs.findIndex((f) => Math.abs(f.t - l) < KF_EPS);
      const next = i >= 0 ? kfs.map((f, j) => (j === i ? { ...f, path } : f)) : [...kfs, { t: l, path }].sort((a, b) => a.t - b.t);
      return { ...c, props: { ...c.props, penKfs: next } };
    }
    return { ...c, props: { ...c.props, penPath: path } };
  }), key);
  const uvToCanvas = (b, u, v) => {
    const lx = (u - 0.5) * b.w, ly = (v - 0.5) * b.h, c = Math.cos(b.rot), s = Math.sin(b.rot);
    return [b.cx + lx * c - ly * s, b.cy + lx * s + ly * c];
  };
  const penDown = (e, clip, b, px, py, k, toCanvas, onDrag) => {
    const path = clonePath(penAt(clip, localOf(clip)));
    const P = path.pts;
    const key = 'pen:' + uid();
    const near = (u, v, r = 10) => { const [cx, cy] = uvToCanvas(b, u, v); return Math.hypot(cx - px, cy - py) < r * k; };
    const [u0, v0] = clipUV(b, px, py);
    // 1) alças de curva
    for (let i = 0; i < P.length; i++) {
      for (const side of ['o', 'i']) {
        const hx = P[i][side + 'x'], hy = P[i][side + 'y'];
        if ((hx !== P[i].x || hy !== P[i].y) && near(hx, hy, 8)) {
          onDrag((ev) => {
            const [u, v] = clipUV(b, ...toCanvas(ev));
            const q = P[i];
            q[side + 'x'] = u; q[side + 'y'] = v;
            if (!ev.altKey) { const o = side === 'o' ? 'i' : 'o'; q[o + 'x'] = 2 * q.x - u; q[o + 'y'] = 2 * q.y - v; }
            setPen(clip.id, clonePath(path), key);
          });
          return;
        }
      }
    }
    // 2) pontos de ancoragem
    const hit = P.findIndex((q) => near(q.x, q.y));
    if (hit >= 0) {
      const now = performance.now(), dbl = lastPenDown.current.i === hit && now - lastPenDown.current.t < 380;
      lastPenDown.current = { i: hit, t: now };
      if (!path.closed && hit === 0 && P.length > 2) { path.closed = true; setPen(clip.id, path); notify('Recorte fechado — arraste pontos e alças para refinar'); return; }
      if (dbl && P.length > 3) { P.splice(hit, 1); setPen(clip.id, path); return; }
      if (e.altKey) {
        const q = P[hit];
        if (q.ix === q.x && q.iy === q.y && q.ox === q.x && q.oy === q.y) {
          const a = P[(hit - 1 + P.length) % P.length], c2 = P[(hit + 1) % P.length];
          const dx = (c2.x - a.x) / 6, dy = (c2.y - a.y) / 6;
          Object.assign(q, { ix: q.x - dx, iy: q.y - dy, ox: q.x + dx, oy: q.y + dy });
        } else Object.assign(q, { ix: q.x, iy: q.y, ox: q.x, oy: q.y });
        setPen(clip.id, path);
        return;
      }
      const q = P[hit], start = { ...q };
      onDrag((ev) => {
        const [u, v] = clipUV(b, ...toCanvas(ev));
        const dx = u - start.x, dy = v - start.y;
        Object.assign(q, { x: start.x + dx, y: start.y + dy, ix: start.ix + dx, iy: start.iy + dy, ox: start.ox + dx, oy: start.oy + dy });
        setPen(clip.id, clonePath(path), key);
      });
      return;
    }
    // 3) caminho aberto: novo ponto (arrastar cria a curva)
    if (!path.closed) {
      const q = { x: u0, y: v0, ix: u0, iy: v0, ox: u0, oy: v0 };
      P.push(q);
      setPen(clip.id, clonePath(path), key);
      onDrag((ev) => {
        const [u, v] = clipUV(b, ...toCanvas(ev));
        Object.assign(q, { ox: u, oy: v, ix: 2 * q.x - u, iy: 2 * q.y - v });
        setPen(clip.id, clonePath(path), key);
      });
      return;
    }
    // 4) caminho fechado: clicar sobre a linha insere um ponto
    let best = null;
    for (let i = 0; i < P.length; i++) {
      const a = P[i], c2 = P[(i + 1) % P.length];
      for (let s = 1; s < 24; s++) {
        const t = s / 24;
        const u = bez(a.x, a.ox, c2.ix, c2.x, t), v = bez(a.y, a.oy, c2.iy, c2.y, t);
        const [cx, cy] = uvToCanvas(b, u, v);
        const d = Math.hypot(cx - px, cy - py);
        if (d < 9 * k && (!best || d < best.d)) best = { d, i, u, v };
      }
    }
    if (best) {
      P.splice(best.i + 1, 0, { x: best.u, y: best.v, ix: best.u, iy: best.v, ox: best.u, oy: best.v });
      setPen(clip.id, path);
    }
  };
  const penApi = {
    close: (id) => { const c = clips.find((x) => x.id === id); const pth = clonePath(penAt(c, localOf(c))); pth.closed = true; setPen(id, pth); },
    undoPoint: (id) => { const c = clips.find((x) => x.id === id); const pth = clonePath(penAt(c, localOf(c))); pth.pts.pop(); setPen(id, pth); },
    clear: (id) => mapClip(id, (c) => ({ ...c, props: { ...c.props, penPath: { closed: false, pts: [] }, penKfs: [] } })),
    clearKfs: (id) => mapClip(id, (c) => ({ ...c, props: { ...c.props, penPath: clonePath(penAt(c, localOf(c))), penKfs: [] } })),
    toggleKf: (id) => mapClip(id, (c) => {
      const l = localOf(c), kfs = c.props.penKfs || [], cur = clonePath(penAt(c, l));
      const i = kfs.findIndex((f) => Math.abs(f.t - l) < KF_EPS);
      if (i >= 0) {
        const next = kfs.filter((_, j) => j !== i);
        return { ...c, props: { ...c.props, penKfs: next, penPath: next.length ? c.props.penPath : cur } };
      }
      return { ...c, props: { ...c.props, penKfs: [...kfs, { t: l, path: cur }].sort((a, b) => a.t - b.t) } };
    }),
    /** duplica o clipe na faixa de Sobreposição só com o sujeito recortado */
    extract: (id) => {
      const c = clips.find((x) => x.id === id);
      const copy = { ...c, id: uid(), track: 'overlay', lane: 0, transition: null, props: { ...c.props, maskOn: true, maskType: 'pen', maskInvert: false } };
      hist.set((cs) => [...cs, { ...copy, lane: freeLane(cs, copy) }]);
      select(copy.id);
      notify('Sujeito extraído para a faixa Sobreposição — mova, escale ou anime à vontade');
    },
    /** salva o quadro atual recortado como PNG transparente, cortado nos limites do caminho */
    savePng: (id) => {
      const c = clips.find((x) => x.id === id);
      const l = localOf(c);
      const p = resolveProps(c, l);
      const { src, sw, sh, ready } = engine.source(c, assetMap[c.assetId], p);
      if (!ready) { notify('Posicione o cursor sobre o clipe'); return; }
      const path = penAt(c, l);
      const S = processClip({ ...p, maskOn: true, maskType: 'pen' }, src, sw, sh, Math.min(sw, sh) / 720, null, { local: l, pen: path });
      const xs = [], ys = [];
      for (const q of path.pts) { xs.push(q.x, q.ix, q.ox); ys.push(q.y, q.iy, q.oy); }
      const pad = (p.maskFeather / 100) * Math.min(sw, sh) * 0.12 * 2;
      const x0 = clamp(Math.floor(Math.min(...xs) * sw - pad), 0, sw), y0 = clamp(Math.floor(Math.min(...ys) * sh - pad), 0, sh);
      const x1 = clamp(Math.ceil(Math.max(...xs) * sw + pad), 0, sw), y1 = clamp(Math.ceil(Math.max(...ys) * sh + pad), 0, sh);
      const out = document.createElement('canvas');
      out.width = Math.max(1, x1 - x0); out.height = Math.max(1, y1 - y0);
      out.getContext('2d').drawImage(S, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
      out.toBlob((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `recorte-${(c.name || 'clipe').replace(/\.[^.]+$/, '')}.png`;
        a.click();
        notify(`PNG salvo (${out.width}×${out.height})`);
      }, 'image/png');
    },
  };

  /* ---------- aba Ajuste: análises de quadro e ações em lote ---------- */
  const frameOf = (clip) => {
    if (clip.type === 'adjust') {
      // camada de ajuste: analisa a imagem que ela recebe — o quadro de agora sem ela e sem o que está acima
      const t = timeRef.current, s = live.current, cv = canvasRef.current;
      if (!cv || t < clip.start || t >= clip.start + clip.duration) return null;
      const below = s.clips.filter((c) => c.id !== clip.id && !(c.track === 'effect' && laneOf(c) >= laneOf(clip)));
      const f = tmpCanvas('adjFrame', cv.width, cv.height);
      engine.render(f.getContext('2d'), f.width, f.height, t, below, s.assetMap, s.trackState);
      return f;
    }
    const { src, ready } = engine.source(clip, assetMap[clip.assetId], clip.props);
    if (clip.type === 'color') { const c = tmpCanvas('colorFrame', 4, 4), x = c.getContext('2d'); x.fillStyle = clip.props.color; x.fillRect(0, 0, 4, 4); return c; }
    return ready ? src : null;
  };
  const needFrame = (clip) => {
    const f = frameOf(clip);
    if (!f) notify(clip.type === 'adjust' ? 'Posicione a agulha sobre a camada de ajuste para analisar o quadro' : 'Posicione o cursor sobre o clipe para analisar o quadro');
    return f;
  };
  const colorApi = {
    notify,
    auto: (clip) => { const f = needFrame(clip); if (f) { setProps(clip.id, { autoOn: true, ...autoLevels(f) }); notify('Níveis e cores ajustados automaticamente'); } },
    wb: (clip) => { const f = needFrame(clip); if (f) { setProps(clip.id, { wbOn: true, ...whiteBalance(f) }); notify('Balanço de branco corrigido'); } },
    refs: (clip) => assets.filter((a) => (a.type === 'image' || a.type === 'video') && a.thumb && !a.loading && a.id !== clip.assetId),
    match: (clip, a) => {
      const f = needFrame(clip);
      if (!f) return;
      const img = new Image();
      img.onload = () => { setProps(clip.id, { matchOn: true, matchRef: a.id, ...colorMatch(f, img) }); notify(`Cores combinadas com “${a.name}”`); };
      img.src = a.type === 'image' ? a.url : a.thumb;
    },
    importRef: () => importRef.current.click(),
    histogram: (clip) => { const f = frameOf(clip); return f ? frameStats(f).hist : null; },
    onPick: (cb) => { pickCb.current = cb; },
    applyAll: (clip) => {
      const vals = Object.fromEntries(GRADE_KEYS.map((k) => [k, clip.props[k]]));
      const n = live.current.clips.filter((c) => (c.type === 'video' || c.type === 'image') && c.id !== clip.id).length;
      hist.set((cs) => cs.map((c) => ((c.type === 'video' || c.type === 'image') && c.id !== clip.id ? { ...c, props: { ...c.props, ...vals } } : c)));
      setTimeout(() => notify(`Ajuste aplicado a ${n} clipe(s)`), 0);
    },
  };

  /** converte um ponto do canvas para coordenadas locais do clipe (0..1) */
  const clipUV = (b, px, py) => {
    const dx = px - b.cx, dy = py - b.cy, c = Math.cos(-b.rot), sn = Math.sin(-b.rot);
    return [(dx * c - dy * sn) / b.w + 0.5, (dx * sn + dy * c) / b.h + 0.5];
  };
  const toolDown = (e, px, py, k) => {
    const clip = clips.find((c) => c.id === selectedId);
    const b = clip && boxesRef.current.find((x) => x.id === clip.id);
    if (!clip || !b || !b.w) { notify('Posicione o cursor sobre o clipe selecionado'); return; }
    const onDrag = (move, up) => {
      const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); up && up(); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', stop);
    };
    const rect = e.currentTarget.getBoundingClientRect();
    const toCanvas = (ev) => [(ev.clientX - rect.left) * k, (ev.clientY - rect.top) * k];

    if (tool === 'pen') { penDown(e, clip, b, px, py, k, toCanvas, onDrag); return; }
    if (tool === 'colorpick') {
      const cv = canvasRef.current, f = cv.width / W;   // o canvas da prévia é menor que o quadro
      const d = cv.getContext('2d').getImageData(clamp(Math.floor(px * f), 0, cv.width - 1), clamp(Math.floor(py * f), 0, cv.height - 1), 1, 1).data;
      pickCb.current?.([d[0], d[1], d[2]]);
      setTool(null);
      return;
    }
    if (tool === 'pick') {
      const [u, v] = clipUV(b, px, py);
      const { src, ready } = engine.source(clip, assetMap[clip.assetId], clip.props);
      if (!ready || !src) return;
      const S = 256, c = tmpCanvas('pick', S, S), x = c.getContext('2d', { willReadFrequently: true });
      x.clearRect(0, 0, S, S);
      x.drawImage(src, 0, 0, S, S);
      const d = x.getImageData(clamp(Math.floor(u * S), 0, S - 1), clamp(Math.floor(v * S), 0, S - 1), 1, 1).data;
      setProps(clip.id, { chromaColor: rgbToHex(d[0], d[1], d[2]), chromaOn: true });
      setTool(null);
      return;
    }
    if (tool === 'erase' || tool === 'restore') {
      const ed = engine.editableErase(clip, b.w / b.h);
      ed.live = true;
      const m = ed.canvas.getContext('2d');
      const MW = ed.canvas.width, MH = ed.canvas.height;
      const r = Math.max(1, (brush / 2 / b.w) * MW);
      m.save();
      m.globalCompositeOperation = tool === 'erase' ? 'source-over' : 'destination-out';
      m.fillStyle = m.strokeStyle = '#fff';
      m.lineCap = m.lineJoin = 'round';
      m.lineWidth = r * 2;
      const at = (qx, qy) => { const [u, v] = clipUV(b, qx, qy); return [u * MW, v * MH]; };
      let [lx, ly] = at(px, py);
      m.beginPath(); m.arc(lx, ly, r, 0, Math.PI * 2); m.fill();
      onDrag((ev) => {
        const [qx, qy] = toCanvas(ev);
        mouseRef.current = [qx, qy];
        const [nx, ny] = at(qx, qy);
        m.beginPath(); m.moveTo(lx, ly); m.lineTo(nx, ny); m.stroke();
        lx = nx; ly = ny;
      }, () => {
        m.restore();
        const url = ed.canvas.toDataURL();
        ed.src = url; ed.live = false; ed.ready = true;
        setProps(clip.id, { eraseMask: url, eraseOn: true });
      });
      return;
    }
    if (tool === 'mask') {
      const p0 = resolveProps(clip, localOf(clip));
      const g = maskOnCanvas(b, p0);
      const toLocal = (qx, qy) => { const dx = qx - g.mx, dy = qy - g.my, c = Math.cos(-g.rot), sn = Math.sin(-g.rot); return [dx * c - dy * sn, dx * sn + dy * c]; };
      const hs = maskHandles(g, p0.maskType, k);
      const [lx, ly] = toLocal(px, py);
      const near = (h) => h && Math.hypot(lx - h[0], ly - h[1]) < 14 * k;
      const mode = near(hs.rot) ? 'rot' : near(hs.fea) ? 'fea' : near(hs.res) ? 'res' : 'move';
      const key = 'mask:' + uid();
      const cb = Math.cos(-b.rot), sb = Math.sin(-b.rot);
      onDrag((ev) => {
        const [qx, qy] = toCanvas(ev);
        if (mode === 'move') {
          const dx = qx - px, dy = qy - py;
          const cx = dx * cb - dy * sb, cy = dx * sb + dy * cb;
          setProps(clip.id, { maskX: Math.round((p0.maskX + (cx / (b.w / 2)) * 100) * 10) / 10, maskY: Math.round((p0.maskY + (cy / (b.h / 2)) * 100) * 10) / 10 }, key);
        } else if (mode === 'rot') {
          let a = (Math.atan2(qy - g.my, qx - g.mx) + Math.PI / 2 - b.rot) * 180 / Math.PI;
          a = ((a + 540) % 360) - 180;
          if (ev.shiftKey) a = Math.round(a / 15) * 15;
          setProps(clip.id, { maskRot: Math.round(a) }, key);
        } else if (mode === 'fea') {
          const [, ny] = toLocal(qx, qy);
          const base = p0.maskType === 'linear' ? 0 : Math.abs(g.mh) / 2;
          setProps(clip.id, { maskFeather: Math.round(clamp(((ny - base - 22 * k) / (Math.min(b.w, b.h) * 0.3)) * 100, 0, 100)) }, key);
        } else {
          const [nx, ny] = toLocal(qx, qy);
          if (p0.maskType === 'film') setProps(clip.id, { maskH: clamp((Math.abs(ny) * 2) / b.h * 100, 1, 250) }, key);
          else {
            const mw = clamp((Math.abs(nx) * 2) / b.w * 100, 1, 250);
            let mh = clamp((Math.abs(ny) * 2) / b.h * 100, 1, 250);
            if (ev.shiftKey) mh = clamp(mw * (p0.maskH / p0.maskW), 1, 250);
            setProps(clip.id, { maskW: Math.round(mw * 10) / 10, maskH: Math.round(mh * 10) / 10 }, key);
          }
        }
      });
    }
  };

  const onPreviewMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const k = W / r.width;
    mouseRef.current = [(e.clientX - r.left) * k, (e.clientY - r.top) * k];
    if (!tool && !snapRef.current) {
      const b = selectedId && boxesRef.current.find((x) => x.id === selectedId);
      const h = b ? hitHandle(b, ...mouseRef.current, k) : null;
      hoverRef.current = h;
      const inside = !h && boxesRef.current.some((x) => { if (!x.w) return false; const [lx, ly] = boxLocal(x, ...mouseRef.current); return Math.abs(lx) <= x.w / 2 && Math.abs(ly) <= x.h / 2; });
      e.currentTarget.style.cursor = handleCursor(h, b?.rot || 0) || (inside ? 'move' : '');
    }
  };

  const onPreviewDown = (e) => {
    if (tool && selectedId) {
      const r0 = e.currentTarget.getBoundingClientRect();
      const k0 = W / r0.width;
      toolDown(e, (e.clientX - r0.left) * k0, (e.clientY - r0.top) * k0, k0);
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    const k = W / r.width;
    const px = (e.clientX - r.left) * k, py = (e.clientY - r.top) * k;
    const hits = boxesRef.current.filter((b) => !live.current.trackState[b.row]?.lock).filter((b) => {
      const dx = px - b.cx, dy = py - b.cy;
      const lx = dx * Math.cos(-b.rot) - dy * Math.sin(-b.rot);
      const ly = dx * Math.sin(-b.rot) + dy * Math.cos(-b.rot);
      return Math.abs(lx) <= b.w / 2 && Math.abs(ly) <= b.h / 2;
    });
    const selBox = selectedId && boxesRef.current.find((b) => b.id === selectedId && !live.current.trackState[b.row]?.lock);
    const handle = selBox ? hitHandle(selBox, px, py, k) : null;
    // clique seleciona o item de cima; Alt+clique desce para o item logo abaixo do selecionado (alcança o que está coberto)
    const pickHit = () => {
      if (!hits.length) return null;
      if (e.altKey) {
        const i = hits.findIndex((b) => b.id === selectedId);
        return hits[i > 0 ? i - 1 : hits.length - 1];
      }
      return hits[hits.length - 1];
    };
    const pref = handle ? selBox : pickHit();
    if (!pref) { select(null); return; }
    const clip = clips.find((c) => c.id === pref.id);
    select(clip.id);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const b0 = { ...pref };
    const rp = { ...BASE_PROPS, ...resolveProps(clip, localOf(clip)) };
    const key = 'mv:' + uid();
    const targets = snapTargets(W, H, live.current.guides, boxesRef.current.filter((b) => b.id !== clip.id));
    const th = SNAP_PX * k;
    const toCanvas = (ev) => [(ev.clientX - r.left) * k, (ev.clientY - r.top) * k];
    const straight = Math.abs(Math.sin(b0.rot)) < 1e-3 && Math.cos(b0.rot) > 0;
    const pinv = b0.pm ? b0.pm.inverse() : null;
    const toChild = (dx, dy) => (pinv ? [pinv.a * dx + pinv.c * dy, pinv.b * dx + pinv.d * dy] : [dx, dy]);
    let move;
    if (handle?.rot) {
      // girar em volta do centro; Shift = passos de 15°, sem Shift encaixa em 0/90/180/270
      const a0 = Math.atan2(py - b0.cy, px - b0.cx);
      move = (ev) => {
        const [mx, my] = toCanvas(ev);
        let deg = rp.rotation + ((Math.atan2(my - b0.cy, mx - b0.cx) - a0) * 180) / Math.PI;
        deg = ((deg + 180) % 360 + 360) % 360 - 180;
        if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
        else if (!(ev.ctrlKey || ev.metaKey)) { const n = Math.round(deg / 90) * 90; if (Math.abs(deg - n) < 3) deg = n; }
        deg = Math.round(deg * 10) / 10;
        setProps(clip.id, { rotation: deg }, key);
        snapRef.current = { label: { x: b0.cx, y: b0.cy - b0.h / 2 - 64 * k, text: `${deg}°` } };
      };
    } else if (handle) {
      // escalar pelas alças: livre (muda a forma) · Shift mantém a proporção · Alt cresce a partir do centro
      move = (ev) => {
        let [lx, ly] = boxLocal(b0, ...toCanvas(ev));
        const opts = { shift: ev.shiftKey, alt: ev.altKey, W, H, minPx: 8 * k, toChild };
        const xs = [], ys = [];
        if (straight && !ev.shiftKey && !(ev.ctrlKey || ev.metaKey)) {
          // a borda arrastada (e a espelhada, com Alt) encaixa nas linhas-alvo
          if (handle.hx) lx = snapEdge(b0.cx, lx, targets.xs, th, ev.altKey);
          if (handle.hy) ly = snapEdge(b0.cy, ly, targets.ys, th, ev.altKey);
        }
        const res = resizeFromHandle(b0, rp, handle, lx, ly, opts);
        setProps(clip.id, res.patch, key);
        if (straight && !b0.pm) {
          const ncx = b0.cx + ((res.patch.x - rp.x) / 100) * (W / 2), ncy = b0.cy + ((res.patch.y - rp.y) / 100) * (H / 2);
          xs.push(...snapLinesAt([ncx - res.w / 2, ncx + res.w / 2], targets.xs));
          ys.push(...snapLinesAt([ncy - res.h / 2, ncy + res.h / 2], targets.ys));
        }
        snapRef.current = { xs, ys, label: { x: b0.cx, y: b0.cy + b0.h / 2 + 12 * k, text: `${Math.round(res.w)} × ${Math.round(res.h)}${ev.shiftKey ? '  ⇧ proporção' : ''}${ev.altKey ? '  ⌥ centro' : ''}` } };
      };
    } else {
      // mover: Shift trava no eixo dominante · encaixe magnético nas bordas/centro do quadro, guias e outros clipes
      const [ex, ey] = boxExtent(b0);
      move = (ev) => {
        let dx = (ev.clientX - e.clientX) * k, dy = (ev.clientY - e.clientY) * k;
        if (Math.abs(dx) < 2 * k && Math.abs(dy) < 2 * k && !snapRef.current) return;
        let lockX = false, lockY = false;
        if (ev.shiftKey) { if (Math.abs(dx) >= Math.abs(dy)) { dy = 0; lockY = true; } else { dx = 0; lockX = true; } }
        const xs = [], ys = [];
        if (!(ev.ctrlKey || ev.metaKey)) {
          const cx = b0.cx + dx, cy = b0.cy + dy;
          const sx = !lockX && snap1D([cx - ex, cx, cx + ex], targets.xs, th);
          const sy = !lockY && snap1D([cy - ey, cy, cy + ey], targets.ys, th);
          if (sx) dx += sx.d;
          if (sy) dy += sy.d;
          xs.push(...snapLinesAt([b0.cx + dx - ex, b0.cx + dx, b0.cx + dx + ex], targets.xs));
          ys.push(...snapLinesAt([b0.cy + dy - ey, b0.cy + dy, b0.cy + dy + ey], targets.ys));
        }
        const [cdx, cdy] = toChild(dx, dy);
        const x = rp.x + (cdx / (W / 2)) * 100, y = rp.y + (cdy / (H / 2)) * 100;
        setProps(clip.id, { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 }, key);
        snapRef.current = { xs: lockX ? [b0.cx, ...xs] : xs, ys: lockY ? [b0.cy, ...ys] : ys };
      };
    }
    const up = () => { snapRef.current = null; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /* ---------- exportação ---------- */
  const openExport = useCallback(() => {
    if (innerLength(rootRef.current) <= 0) return;
    // a exportação é sempre do projeto inteiro
    if (pathRef.current.length) { exitTo(0); notify('Voltando ao projeto para exportar a linha do tempo completa'); }
    setPlaying(false);
    setExportState({ stage: 'setup', ext: pickMime()[1] });
    projectFps(rootRef.current, live.current.assetMap).then(({ suggest, source }) => { setExportFps(suggest); setSourceFps(source); });
  }, []);
  const [exportMethod, setExportMethod] = useState(() => (offlineExportSupported() ? 'offline' : 'realtime'));
  // quadros por segundo da exportação: sugerido pelo vídeo mais fluido do projeto (antes era sempre 30)
  const [exportFps, setExportFps] = useState(30);
  const [sourceFps, setSourceFps] = useState(null);
  const [offlineProg, setOfflineProg] = useState({ p: 0, label: '' });
  const startOffline = async () => {
    setPlaying(false);
    select(null);
    const job = { cancelled: false };
    offlineRef.current = job;
    setOfflineProg({ p: 0, label: 'Preparando…' });
    setExportState((s) => ({ ...s, stage: 'rendering', offline: true }));
    try {
      const root = rootRef.current;
      const r = await exportOffline({
        clips: root, assetMap: live.current.assetMap, trackState: exitStack.current[0]?.ts ?? live.current.trackState,
        W, H, fps: exportFps, duration: innerLength(root),
        onProgress: (p, label) => setOfflineProg({ p, label }), isCancelled: () => job.cancelled,
      });
      if (job.cancelled) return;
      setExportState({ stage: 'done', url: URL.createObjectURL(r.blob), ext: r.ext, size: r.blob.size, seconds: r.seconds, duration: innerLength(root), codec: r.codec, audio: r.audio, fps: exportFps, offline: true });
    } catch (e) {
      if (!job.cancelled) { notify('Falha na exportação: ' + (e?.message || e)); setExportState((s) => s && { ...s, stage: 'setup' }); }
    } finally {
      if (offlineRef.current === job) offlineRef.current = null;
    }
  };
  const startExport = async () => {
    if (exportMethod === 'offline' && offlineExportSupported()) return startOffline();
    engine.ensureAudio();
    engine.noProxy = true;   // a gravação em tempo real usa o canvas da prévia: com os originais
    setPlaying(false);
    select(null);
    seek(0);
    setExportState((s) => ({ ...s, stage: 'rendering' }));
    await new Promise((r) => setTimeout(r, 500));
    const [mime, ext] = pickMime();
    // captureStream(0): os quadros só entram quando chamamos requestFrame() no loop de desenho
    const stream = canvasRef.current.captureStream(0);
    const track = stream.getVideoTracks()[0];
    engine.dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: q > 1 ? 12e6 : 8e6 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      engine.noProxy = previewQ === 'full';
      const cancelled = rec.cancelled;
      recRef.current = null;
      stream.getVideoTracks().forEach((t) => t.stop());
      if (cancelled) return;
      const blob = new Blob(chunks, { type: mime.split(';')[0] });
      setExportState({ stage: 'done', url: URL.createObjectURL(blob), ext, size: blob.size });
    };
    rec.track = track;
    recRef.current = rec;
    rec.start(250);
    setPlaying(true);
  };
  const cancelExport = () => {
    if (recRef.current) { recRef.current.cancelled = true; recRef.current.stop(); }
    if (offlineRef.current) offlineRef.current.cancelled = true;   // o laço para no próximo quadro e libera a prévia
    setPlaying(false);
    setExportState(null);
  };

  /* ---------- atalhos de teclado ---------- */
  useEffect(() => {
    const down = (e) => {
      const tag = e.target.tagName;
      if (isTypingTarget(e.target)) {
        // Enter/Esc num campo de linha única encerram a edição: o Espaço volta a tocar o vídeo
        if (tag === 'INPUT' && (e.key === 'Enter' || e.key === 'Escape')) e.target.blur();
        return;
      }
      if (document.querySelector('.modal-back, .tour-back')) return;   // janela aberta: os atalhos ficam com ela
      // Espaço toca/pausa mesmo com um botão, slider ou lista focados; segurar a tecla não fica alternando
      if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) { releaseFocus(); togglePlay(); } return; }
      if (tag === 'INPUT' || tag === 'SELECT') return;     // sliders e listas usam as setas
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (e.shiftKey && !mod && key === 'r') { e.preventDefault(); setRulers((v) => !v); }
      else if (live.current.tool === 'pen' && (e.key === 'Enter' || e.key === 'Backspace' || e.key === 'Delete')) {
        e.preventDefault();
        const c = live.current.clips.find((x) => x.id === live.current.selectedId);
        const pth = c && penAt(c, clamp(timeRef.current - c.start, 0, c.duration));
        if (c && pth && !pth.closed) (e.key === 'Enter' ? penApi.close : penApi.undoPoint)(c.id);
      }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(); }
      else if (mod && key === 'b') { e.preventDefault(); split(); }
      else if (mod && e.shiftKey && key === 'd') { e.preventDefault(); setDiagOn((v) => !v); }
      else if (mod && key === 'd') { e.preventDefault(); duplicate(); }
      else if (mod && key === 'z') { e.preventDefault(); e.shiftKey ? hist.redo() : hist.undo(); }
      else if (mod && key === 'y') { e.preventDefault(); hist.redo(); }
      else if (mod && key === 'i') { e.preventDefault(); importRef.current.click(); }
      else if (mod && key === 'e') { e.preventDefault(); openExport(); }
      else if (mod && key === 's') { e.preventDefault(); saveProject(); }
      else if (mod && key === 'o') { e.preventDefault(); openProject(); }
      else if (mod && key === 'c') { e.preventDefault(); copyClip(); }
      else if (mod && key === 'x') { e.preventDefault(); cutClip(); }
      else if (mod && key === 'v') { e.preventDefault(); pasteClip(); }
      else if (mod && key === 'g') { e.preventDefault(); e.shiftKey ? ungroupClips() : groupClips(); }
      else if (e.altKey && key === 'g') { e.preventDefault(); e.shiftKey ? ungroupCompound() : createCompound(); }
      // ordem de camada: Ctrl+] / Ctrl+[ sobe/desce uma camada; com Shift vai para a frente/o fundo
      else if (mod && (key === ']' || key === '}')) { e.preventDefault(); layerOrder(e.shiftKey ? 'top' : 1); }
      else if (mod && (key === '[' || key === '{')) { e.preventDefault(); layerOrder(e.shiftKey ? 'bottom' : -1); }
      else if (mod) return;
      else if (key === 'c') split();
      else if (key === 'b') setBlade((b) => !b);
      else if (key === 'v') setBlade(false);
      else if (key === 'f') freezeFrame();
      else if (key === 'g') setCurveOpen((v) => !v);
      else if (key === 'q') trimSide('left');
      else if (key === 'w') trimSide('right');
      else if (key === 'k') keyframeHere();
      else if (key === 'm') addMarker();
      else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(timeRef.current - (e.shiftKey ? 1 : FRAME)); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); seek(Math.min(live.current.duration, timeRef.current + (e.shiftKey ? 1 : FRAME))); }
      else if (e.key === 'Home') seek(0);
      else if (e.key === 'End') seek(live.current.duration);
      else if (e.key === 'Escape') {
        // Esc: sai da lâmina, depois limpa a seleção, depois sai do composto aberto
        if (live.current.curveOpen) setCurveOpen(false);
        else if (live.current.blade) setBlade(false);
        else if (live.current.selectedId || live.current.selectedTr) select(null);
        else if (pathRef.current.length) exitTo(pathRef.current.length - 1);
      }
    };
    // clicar fora de um campo de texto encerra a edição, mesmo onde o clique não muda o foco
    // (linha do tempo, prévia): sem isso o Espaço continuaria preso no campo
    const press = (e) => {
      const a = document.activeElement;
      if (isTypingTarget(a) && !a.contains(e.target) && !isTypingTarget(e.target)) a.blur();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('pointerdown', press, true);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('pointerdown', press, true); };
  }, [togglePlay, remove, split, duplicate, trimSide, keyframeHere, addMarker, openExport, saveProject, openProject, copyClip, cutClip, pasteClip, freezeFrame, createCompound, ungroupCompound, groupClips, ungroupClips, layerOrder, exitTo, hist.undo, hist.redo, seek, select]);

  /* ---------- soltar arquivos em qualquer lugar ---------- */
  useEffect(() => {
    const isFiles = (e) => e.dataTransfer?.types?.includes('Files');
    const over = (e) => { if (isFiles(e)) { e.preventDefault(); setDropHint(true); } };
    const leave = (e) => { if (!e.relatedTarget) setDropHint(false); };
    const drop = (e) => { setDropHint(false); if (e.dataTransfer?.files?.length) { e.preventDefault(); importFiles([...e.dataTransfer.files]); } };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); };
  }, [importFiles]);

  /* colunas redimensionáveis: arraste as divisórias; clique duplo restaura */
  const startCol = (side) => (e) => {
    e.preventDefault();
    const sx = e.clientX, start = side === 'left' ? fit.left : fit.right;
    const move = (ev) => {
      const dx = ev.clientX - sx;
      const other = side === 'left' ? fit.right : fit.left;
      const max = Math.max(300, window.innerWidth - other - 360);
      if (side === 'left') setLeftW(clamp(start + dx, 300, Math.min(900, max)));
      else setRightW(clamp(start - dx, 260, Math.min(700, max)));
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.classList.remove('resizing'); };
    document.body.classList.add('resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const startResize = (e) => {
    const sy = e.clientY, sh = fit.tl;
    const move = (ev) => setTlH(clamp(sh - (ev.clientY - sy), 200, window.innerHeight - 260));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /**
   * onde a mídia solta na linha do tempo começa: faixa vazia → no início; solta depois do
   * último clipe → encostada no fim dele (sem buraco); por cima/entre clipes → onde foi solta
   */
  const dropStart = (track, lane, at) => {
    const row = live.current.clips.filter((c) => c.track === track && laneOf(c) === (lane || 0));
    if (!row.length) return 0;
    const end = Math.max(...row.map((c) => c.start + c.duration));
    return at >= end ? end : at;
  };
  const selectedAsset = selected ? assetMap[selected.assetId] : null;
  const canUngroupClips = useMemo(() => { const g = liveGroups(clips), ids = new Set([...multi, selectedId]); return clips.some((c) => ids.has(c.id) && g.has(c.group)); }, [clips, multi, selectedId]);
  // mídias da biblioteca que estão na linha do tempo (inclusive dentro de compostos): marcadas no painel
  const usedAssets = useMemo(() => {
    const out = new Map();
    const walk = (cs) => cs.forEach((c) => { if (c.assetId) out.set(c.assetId, (out.get(c.assetId) || 0) + 1); if (c.children) walk(c.children); });
    walk(rootHist.clips);
    return out;
  }, [rootHist.clips]);

  return (
    <div className="app" style={{ '--tl-h': `${fit.tl}px` }}>
      <input ref={importRef} type="file" multiple hidden accept="video/*,image/*,audio/*" onChange={(e) => { importFiles([...e.target.files]); e.target.value = ''; }} />
      <input ref={projectFileRef} type="file" hidden accept=".cutlab" onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) openProjectFile(f); }} />
      <TopBar name={projectName} setName={setProjectName} onExport={openExport} canExport={duration > 0} hist={hist} saveState={saveState}
        menu={{ newProject, openProject, saveProject, savePackage,copy: copyClip, cut: cutClip, paste: pasteClip, hasSelection: !!selectedId,
          group: groupClips, ungroupClips, canUngroupClips,
          compound: createCompound, ungroup: ungroupCompound, canCompound: multi.length > 0, canUngroup: isCompound(selected), clearMarkers, hasMarkers: markers.length > 0,
          importMedia: () => importRef.current.click(), deselect: () => select(null), shortcuts: () => setInfo('shortcuts'), about: () => setInfo('about'), diag: () => setDiagOn((v) => !v), diagOn }} />
      {diagOn && <PerfHud onClose={() => setDiagOn(false)} />}
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <filter id="cl-sharpen"><feConvolveMatrix order="3" kernelMatrix="0 -1 0 -1 5 -1 0 -1 0" preserveAlpha="true" /></filter>
      </svg>
      <div className="workspace" style={{ gridTemplateColumns: `${fit.left}px 5px minmax(0, 1fr) 5px ${fit.right}px` }}>
        <LeftPanel assets={assets} usedAssets={usedAssets} onImport={importFiles} onAddAsset={(a) => addAsset(a)} onRemoveAsset={removeAsset}
          onAddText={addText} onAddSticker={addSticker} onAddColor={addColor} onAddSfx={addSfx}
          selected={selected} selectedAsset={selectedAsset} onApplyFilter={applyFilter}
          onAddEffect={(id) => addEffect(id)} onApplyTransition={(id) => applyTransition(id)} onAddAdjust={addAdjust}
          onApplyTemplate={applyTemplate} captions={captions} trApi={libTrApi} />
        <div className="col-resizer" onPointerDown={startCol('left')} onDoubleClick={() => setLeftW(470)} title="Arraste para redimensionar · clique duplo restaura" />
        <Player W={W} H={H} ratio={ratio} setRatio={setRatio} canvasRef={canvasRef} overlayRef={overlayRef}
          quality={previewQ} setQuality={setPreviewQ} fullRes={exportState?.stage === 'rendering' && !exportState.offline /* exportação em tempo real grava este canvas */}
          time={time} duration={duration} playing={playing} onToggle={togglePlay} onSeek={seek} onPreviewDown={onPreviewDown} onPreviewMove={onPreviewMove} onPreviewLeave={() => { mouseRef.current = null; hoverRef.current = null; }} tool={tool} empty={clips.length === 0}
          rulers={rulers} setRulers={setRulers} guides={guides} setGuides={setGuides} onPreviewDbl={onPreviewDbl}
          textEdit={textEdit && clips.find((c) => c.id === textEdit) ? {
            clip: clips.find((c) => c.id === textEdit),
            getBox: () => boxesRef.current.find((b) => b.id === textEdit),
            onChange: (text) => setProps(textEdit, { text }, `p:${textEdit}:text`),
            onDone: endTextEdit,
          } : null} />
        <div className="col-resizer" onPointerDown={startCol('right')} onDoubleClick={() => setRightW(360)} title="Arraste para redimensionar · clique duplo restaura" />
        <Inspector key={selected?.id || selectedTr || 'none'} clip={selected} asset={selectedAsset}
          local={selected ? clamp(time - selected.start, 0, selected.duration) : 0}
          setProps={setProps} setClip={setClip} kfApi={kfApi}
          transition={trPair ? { pair: trPair } : null} trApi={trApi}
          colorApi={colorApi} penApi={penApi} capApi={capApi} tool={tool} setTool={setTool} brush={brush} setBrush={setBrush} onAutoBg={onAutoBg}
          setPreview={(pv) => { previewRef.current = pv; }}
          aspect={selected ? clipAspect(selected, selectedAsset, W, H) : 16 / 9}
          project={{ name: projectName, ratio, setRatio, duration, clipCount: clips.length, assetCount: assets.length }} />
      </div>
      <div className="resizer" onPointerDown={startResize} onDoubleClick={() => setTlH(330)} title="Arraste para redimensionar · clique duplo restaura" />
      <Timeline clips={clips} assetMap={libMap}time={time} duration={duration} playing={playing}
        selectedId={selectedId} multi={multi} onSelect={select} onToggleSel={toggleSel} onSetSel={setSelection} selectedTr={selectedTr} onSelectTr={(id) => { setSelectedId(null); setSelectedTr(id); }}
        onSeek={(t) => { setPlaying(false); seek(t); }} setClip={setClip}
        onDropAsset={(id, track, start, lane) => assetMap[id] && addAsset(assetMap[id], track, dropStart(track, lane, start), lane)}
        settleClip={(id, key, before0, patch) => {
          // ao soltar: entra no espaço aberto (patch); se ainda cair sobre outro clipe, sobe para a próxima camada livre; depois remove camadas vazias
          const cs = patch ? live.current.clips.map((x) => (x.id === id ? { ...x, ...patch } : x)) : live.current.clips, c = cs.find((x) => x.id === id);
          if (!c) return;
          const lane = freeLane(cs, c, laneOf(c));
          const bumped = lane === laneOf(c) ? cs : cs.map((x) => (x.id === id ? { ...x, lane } : x));
          const packed = finishEdit(before0 || cs, compactLanes(bumped), id);
          hist.set(() => packed, key);
          setTrackState((ts) => remapTrackState(ts, laneRemap(bumped, packed)));
        }}
        rowApi={rowApi}
        onDropEffect={(id, start) => addEffect(id, start)} onDropTransition={(id, at, row) => applyTransition(id, at, row)}
        tools={{ crumbs, exitTo, mainMagnet, setMainMagnet, ripple, setRipple, blade, setBlade, linkage, setLinkage, skim, setSkim: (v) => { setSkim(v); if (!v) skimRef.current = null; },
          onSkim: (t) => { skimRef.current = t; }, recording, onRecord: recordVoice }}
        trackState={trackState} toggleTrack={toggleTrack} zoom={zoom} setZoom={setZoom} snap={snap} setSnap={setSnap} markers={markers}
        actions={{ split, trimSide, remove, duplicate, extractAudio, copy: copyClip, cut: cutClip, paste: pasteClip, group: groupClips, ungroupClips, canUngroupClips, bladeAt, moveClips, dragLayout, settleGroup, layerOrder, compound: createCompound, ungroup: ungroupCompound, enterCompound, clearMarkers, canCompound: multi.length > 0, canUngroup: isCompound(selected), freeze: freezeFrame, keyframe: keyframeHere, marker: addMarker,
          removeMarker: (id) => setMarkers((m) => m.filter((x) => x.id !== id)),
          undo: hist.undo, redo: hist.redo, canUndo: hist.canUndo, canRedo: hist.canRedo }} />
      {curveOpen && selected && kfCount(selected) > 0 && (
        <KeyframeCurves clip={selected} local={clamp(time - selected.start, 0, selected.duration)}
          onChange={(kfs, key) => setClip(selected.id, { keyframes: kfs }, key)}
          onSeek={(t) => { setPlaying(false); seek(selected.start + t); }} onClose={() => setCurveOpen(false)} />
      )}
      {trEdit && <TransitionEditor initial={trEdit.def} applyTo={trEdit.applyTo} onSave={saveTrEditor} onClose={() => setTrEdit(null)} />}
      <ExportModal state={exportState} name={projectName} resolution={resolution} setResolution={setResolution} ratio={ratio}
        fps={exportFps} setFps={setExportFps} sourceFps={sourceFps}
        method={exportMethod} setMethod={setExportMethod} offlineOk={offlineExportSupported()} offlineLabel={offlineProg.label}
        onStart={startExport} onCancel={cancelExport} onClose={() => setExportState(null)} progress={exportState?.offline ? offlineProg.p : duration ? time / duration : 0} />
      <InfoModal kind={info} onClose={() => setInfo(null)} />
      <Onboarding />
      {dropHint && <div className="drop-overlay">Solte para importar</div>}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/** proporção desenhada do clipe (largura/altura) */
function clipAspect(c, a, W, H) {
  if (c.type === 'color') return W / H;
  if (a?.width && a?.height) return a.width / a.height;
  return 16 / 9;
}
/** geometria da máscara em coordenadas do canvas */
function maskOnCanvas(b, p) {
  const lx = (p.maskX / 100) * (b.w / 2), ly = (p.maskY / 100) * (b.h / 2);
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  return { mx: b.cx + lx * c - ly * s, my: b.cy + lx * s + ly * c, mw: (p.maskW / 100) * b.w, mh: (p.maskH / 100) * b.h, rot: b.rot + (p.maskRot * Math.PI) / 180 };
}
/** posições das alças (no espaço local da máscara); k = px do canvas por px da tela */
function maskHandles(g, type, k) {
  const half = type === 'linear' ? 0 : Math.abs(g.mh) / 2;
  return {
    rot: [0, -half - 30 * k],
    fea: [0, half + 22 * k],
    res: type === 'linear' ? null : type === 'film' ? [0, half] : [g.mw / 2, g.mh / 2],
  };
}

/** Principal sem buracos: cada clipe começa onde o anterior termina */
function packMain(cs) {
  const main = cs.filter((c) => c.track === 'main').sort((a, b) => a.start - b.start);
  let t = 0, changed = false;
  const at = new Map();
  for (const c of main) { if (Math.abs(c.start - t) > 1e-4) changed = true; at.set(c.id, t); t += c.duration; }
  return changed ? cs.map((c) => (at.has(c.id) ? { ...c, start: at.get(c.id) } : c)) : cs;
}
/** fecha um buraco: clipes da linha `row` que começam em `from` ou depois andam `amount` para trás */
function closeGap(cs, row, from, amount) {
  if (amount <= 1e-4) return cs;
  return cs.map((c) => (clipRow(c) === row && c.start >= from - 1e-3 ? { ...c, start: Math.max(0, c.start - amount) } : c));
}
/** clipes de outras faixas acompanham o clipe da Principal que estava sob o início deles */
/** `movedId`: id (ou Set de ids) dos clipes movidos à mão, que não são arrastados pela vinculação */
function applyLinkage(before, after, movedId) {
  const now = new Map(after.map((c) => [c.id, c]));
  const shifts = before.filter((m) => m.track === 'main' && now.has(m.id))
    .map((m) => ({ s: m.start, e: m.start + m.duration, d: now.get(m.id).start - m.start }))
    .filter((x) => Math.abs(x.d) > 1e-4);
  if (!shifts.length) return after;
  const was = new Map(before.map((c) => [c.id, c]));
  return after.map((c) => {
    if (c.track === 'main' || (movedId instanceof Set ? movedId.has(c.id) : c.id === movedId)) return c;
    const b = was.get(c.id);
    const sh = b && shifts.find((x) => b.start >= x.s - 1e-3 && b.start < x.e - 1e-3);
    return sh ? { ...c, start: Math.max(0, b.start + sh.d) } : c;
  });
}

/**
 * diagnóstico de reprodução (Menu › Diagnóstico ou Ctrl+Shift+D): mede o intervalo entre quadros
 * durante o play e registra cada engasgo com o que entrou/saiu de cena naquele instante, o tempo de
 * sincronia/desenho e as mídias buscando. O relatório pode ser copiado.
 */
const perfDiag = {
  on: false,
  reset() {
    Object.assign(this, { n: 0, slow: 0, worst: 0, sum: 0, last: 0, lastT: 0, prev: null, hitches: [], recent: [] });
    for (const el of engine.media.values()) { el._seeks = 0; el._why = {}; }
    engine.seekLog = {};
    this.peak = engine.media.size;
  },
  frame(now, t, playing, syncMs, drawMs, clips) {
    if (!playing) { this.last = 0; return; }
    const gap = this.last ? now - this.last : 0;
    if (gap) {
      this.n++; this.sum += gap; this.worst = Math.max(this.worst, gap);
      this.recent.push(now); while (this.recent.length && now - this.recent[0] > 1000) this.recent.shift();
      if (gap > 40) {
        this.slow++;
        const a = this.lastT - 0.05, b = t + 0.05, nm = (c) => c.name || (c.type === 'text' ? 'Texto “' + String(c.props?.text || '').slice(0, 18) + '”' : c.type);
        const ev = [];
        for (const c of clips) {
          if (c.start > a && c.start <= b) ev.push('entrou ' + nm(c));
          const e = c.start + c.duration;
          if (e > a && e <= b) ev.push('saiu ' + nm(c));
        }
        const seeking = [...engine.media.values()].filter((el) => el.seeking).map((el) => el._name || '?');
        this.hitches.push({ t: +t.toFixed(3), gap: Math.round(gap), sync: +syncMs.toFixed(1), draw: +drawMs.toFixed(1), prevDraw: this.prev ? +this.prev.toFixed(1) : null, ev, seeking, lat: +(engine.playLat * 1000).toFixed(0) });
        if (this.hitches.length > 200) this.hitches.shift();
      }
    }
    this.last = now; this.lastT = t; this.prev = syncMs + drawMs;
    this.peak = Math.max(this.peak || 0, engine.media.size);
  },
  report() {
    const c = canvasPreviewSize();
    // buscas por mídia desde que o diagnóstico abriu: durante o play deveriam ser quase zero
    const buscas = JSON.parse(JSON.stringify(engine.seekLog || {}));   // dos players já liberados
    for (const el of engine.media.values()) {
      if (!el._seeks) continue;
      const b = buscas[el._name || '?'] ||= { total: 0, elementos: 0, motivos: {} };
      b.total += el._seeks; b.elementos++;
      for (const [k, n] of Object.entries(el._why || {})) b.motivos[k] = (b.motivos[k] || 0) + n;
    }
    return JSON.stringify({ quadros: this.n, lentos: this.slow, elementos: engine.media.size, picoElementos: this.peak, buscas, medioMs: this.n ? +(this.sum / this.n).toFixed(1) : 0, piorMs: Math.round(this.worst), previa: c, dpr: window.devicePixelRatio, ua: navigator.userAgent, engasgos: this.hitches }, null, 1);
  },
};
perfDiag.reset();
const canvasPreviewSize = () => { const c = document.querySelector('.canvas-wrap canvas'); return c ? c.width + '×' + c.height : null; };
function PerfHud({ onClose }) {
  const [, setN] = useState(0);
  const [copied, setCopied] = useState(false);
  useEffect(() => { const iv = setInterval(() => setN((n) => n + 1), 500); return () => clearInterval(iv); }, []);
  const d = perfDiag, fps = d.recent.length;
  const copy = () => { navigator.clipboard?.writeText(d.report()).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); };
  return (
    <div className="perf-hud">
      <div className="perf-head">
        <b>Diagnóstico de reprodução</b>
        <button className="icon-btn" title="Fechar (Ctrl+Shift+D)" onClick={onClose}><Icon name="x" size={13} /></button>
      </div>
      <div className="perf-stats">
        <span><em>{fps}</em> qps</span>
        <span><em>{d.slow}</em> engasgos</span>
        <span><em>{Math.round(d.worst)}</em> ms pior</span>
        <span title="Buscas nas mídias desde que o diagnóstico abriu (no play deveriam ser quase zero)"><em>{[...engine.media.values()].reduce((n, el) => n + (el._seeks || 0), 0) + Object.values(engine.seekLog || {}).reduce((n, b) => n + b.total, 0)}</em> buscas</span>
        <span><em>{canvasPreviewSize()}</em></span>
      </div>
      <div className="perf-list">
        {d.hitches.length === 0 ? <div className="perf-empty">Dê play: cada quadro que demorar mais de 40 ms aparece aqui.</div>
          : d.hitches.slice(-8).reverse().map((h, i) => (
            <div key={i} className="perf-row">
              <span className="perf-t">{fmt(h.t)}</span><span className="perf-gap">{h.gap} ms</span>
              <span className="perf-ev" title={h.seeking.length ? 'Buscando: ' + h.seeking.join(', ') : ''}>{h.ev.length ? h.ev.join(' · ') : 'sem troca'}{h.seeking.length ? ' · buscando ' + h.seeking.length : ''}</span>
            </div>))}
      </div>
      <div className="perf-foot">
        <button className="btn" onClick={() => { d.reset(); setN((n) => n + 1); }}>Zerar</button>
        <button className="btn btn-primary" onClick={copy}>{copied ? 'Copiado!' : 'Copiar relatório'}</button>
      </div>
    </div>
  );
}

/** caixas do motor (em px do canvas da prévia) → px do quadro do projeto */
function toFrameBoxes(boxes, f) {
  if (Math.abs(f - 1) < 1e-6) return boxes;
  return boxes.map((b) => {
    if (!b) return b;
    const o = { ...b, cx: b.cx * f, cy: b.cy * f, w: b.w * f, h: b.h * f };
    // matriz do pai: só a translação depende da escala (S·M·S⁻¹)
    if (b.pm) o.pm = new DOMMatrix([b.pm.a, b.pm.b, b.pm.c, b.pm.d, b.pm.e * f, b.pm.f * f]);
    return o;
  });
}
/** `cv`: tamanho do quadro do projeto ({ width, height }), unidade das caixas e do mouse */
function drawOverlay(ov, cv, boxes, selectedId, extra = {}) {
  if (!ov) return;
  const r = ov.getBoundingClientRect();
  const dpr0 = window.devicePixelRatio || 1;
  const dpr = dpr0 * Math.min(1, 4096 / Math.max(1, r.width * dpr0, r.height * dpr0));
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (ov.width !== w || ov.height !== h) { ov.width = w; ov.height = h; }
  const ctx = ov.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  const s = w / cv.width;
  const { tool, mouse, brush, props: p, pen, snap, hover } = extra;
  drawSnapGuides(ctx, snap, s, dpr, cv.width, cv.height);
  const b = selectedId && boxes.find((x) => x.id === selectedId);

  // cursor do pincel / conta-gotas
  if (mouse && (tool === 'erase' || tool === 'restore')) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(mouse[0] * s, mouse[1] * s, (brush / 2) * s, 0, Math.PI * 2);
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeStyle = '#000';
    ctx.stroke();
    ctx.setLineDash([4 * dpr, 3 * dpr]);
    ctx.strokeStyle = tool === 'erase' ? '#ff5c6c' : '#2bd47d';
    ctx.stroke();
    ctx.restore();
  }
  if (mouse && tool === 'pick') {
    ctx.save();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5 * dpr;
    const [mx, my] = [mouse[0] * s, mouse[1] * s];
    ctx.beginPath(); ctx.arc(mx, my, 10 * dpr, 0, Math.PI * 2); ctx.moveTo(mx - 16 * dpr, my); ctx.lineTo(mx + 16 * dpr, my); ctx.moveTo(mx, my - 16 * dpr); ctx.lineTo(mx, my + 16 * dpr); ctx.stroke();
    ctx.restore();
  }
  if (!b || !b.w) return;

  // caixa do clipe selecionado
  const bw = b.w * s, bh = b.h * s;
  ctx.save();
  ctx.translate(b.cx * s, b.cy * s);
  ctx.rotate(b.rot);
  ctx.strokeStyle = tool === 'mask' ? 'rgba(255,45,70,.45)' : '#ff2d46';
  ctx.lineWidth = 1.5 * dpr;
  ctx.strokeRect(-bw / 2, -bh / 2, bw, bh);
  if (!tool) drawHandles(ctx, bw, bh, dpr, hover);
  ctx.restore();

  // caneta: caminho, pontos, alças e linha elástica até o cursor
  if (tool === 'pen' && pen) {
    const P = pen.pts;
    const toS = (u, v) => { const lx = (u - 0.5) * b.w, ly = (v - 0.5) * b.h, c = Math.cos(b.rot), sn = Math.sin(b.rot); return [(b.cx + lx * c - ly * sn) * s, (b.cy + lx * sn + ly * c) * s]; };
    ctx.save();
    ctx.lineWidth = 2 * dpr;
    if (P.length > 1) {
      ctx.beginPath();
      ctx.moveTo(...toS(P[0].x, P[0].y));
      const seg = (a, c2) => ctx.bezierCurveTo(...toS(a.ox, a.oy), ...toS(c2.ix, c2.iy), ...toS(c2.x, c2.y));
      for (let i = 1; i < P.length; i++) seg(P[i - 1], P[i]);
      if (pen.closed) { seg(P[P.length - 1], P[0]); ctx.closePath(); ctx.fillStyle = 'rgba(255,45,70,0.10)'; ctx.fill(); }
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 4 * dpr; ctx.stroke();
      ctx.strokeStyle = '#ff2d46'; ctx.lineWidth = 2 * dpr; ctx.stroke();
    }
    if (!pen.closed && P.length && mouse) {
      ctx.setLineDash([5 * dpr, 5 * dpr]);
      ctx.beginPath(); ctx.moveTo(...toS(P[P.length - 1].x, P[P.length - 1].y)); ctx.lineTo(mouse[0] * s, mouse[1] * s);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.2 * dpr; ctx.stroke();
      ctx.setLineDash([]);
    }
    for (let i = 0; i < P.length; i++) {
      const q = P[i], [ax, ay] = toS(q.x, q.y);
      for (const sd of ['i', 'o']) {
        if (q[sd + 'x'] === q.x && q[sd + 'y'] === q.y) continue;
        const [hx, hy] = toS(q[sd + 'x'], q[sd + 'y']);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(hx, hy); ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1 * dpr; ctx.stroke();
        ctx.beginPath(); ctx.arc(hx, hy, 3.5 * dpr, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
      }
      const first = i === 0 && !pen.closed && P.length > 2;
      const r = (first ? 6 : 4.5) * dpr;
      ctx.fillStyle = first ? '#ff2d46' : '#fff';
      ctx.strokeStyle = first ? '#fff' : '#ff2d46';
      ctx.lineWidth = 1.5 * dpr;
      ctx.fillRect(ax - r, ay - r, r * 2, r * 2);
      ctx.strokeRect(ax - r, ay - r, r * 2, r * 2);
    }
    ctx.restore();
  }

  // contorno e alças da máscara
  if (tool === 'mask' && p && p.maskOn && p.maskType !== 'none') {
    const g = maskOnCanvas(b, p);
    const k = cv.width / r.width;
    const hs = maskHandles(g, p.maskType, k);
    ctx.save();
    ctx.translate(g.mx * s, g.my * s);
    ctx.rotate(g.rot);
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeStyle = '#ffd23f';
    ctx.setLineDash([6 * dpr, 4 * dpr]);
    const L = Math.max(bw, bh) * 1.2;
    if (p.maskType === 'linear') { ctx.beginPath(); ctx.moveTo(-L, 0); ctx.lineTo(L, 0); ctx.stroke(); }
    else if (p.maskType === 'film') { ctx.beginPath(); ctx.moveTo(-L, -g.mh * s / 2); ctx.lineTo(L, -g.mh * s / 2); ctx.moveTo(-L, g.mh * s / 2); ctx.lineTo(L, g.mh * s / 2); ctx.stroke(); }
    else if (p.maskType === 'text') ctx.strokeRect(-g.mw * s / 2, -g.mh * s / 2, g.mw * s, g.mh * s);
    else { maskShape(ctx, p, g.mw * s, g.mh * s); ctx.stroke(); }
    ctx.setLineDash([]);
    const dot = (pt, label, color) => {
      if (!pt) return;
      const [x, y] = [pt[0] * s, pt[1] * s];
      ctx.fillStyle = color; ctx.strokeStyle = '#000';
      ctx.beginPath(); ctx.arc(x, y, 8 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#000'; ctx.font = `bold ${10 * dpr}px Inter, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, x, y + 0.5);
    };
    ctx.beginPath(); ctx.arc(0, 0, 4 * dpr, 0, Math.PI * 2); ctx.fillStyle = '#ffd23f'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, hs.rot[1] * s); ctx.strokeStyle = 'rgba(255,210,63,.5)'; ctx.stroke();
    dot(hs.rot, '↻', '#ffd23f');
    dot(hs.fea, '⇕', '#fff');
    if (hs.res) dot(hs.res, '◻', '#fff');
    ctx.restore();
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
