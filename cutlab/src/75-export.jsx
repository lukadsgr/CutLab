/* =====================================================================
   Janela de exportação
   Três etapas: configurar (nome, pasta, resolução, qualidade…), renderizar (quadro sendo gerado,
   tempo restante, velocidade) e pronto (o vídeo para assistir e Salvar).
   No programa para Windows o vídeo vai direto para a pasta escolhida (como no CapCut); no navegador
   "Salvar" abre o seletor de arquivo (Chrome/Edge) ou, sem ele, baixa o arquivo.
   ===================================================================== */
const EXPORT_QUALITY = {
  small: { name: 'Leve', hint: 'arquivo menor, para enviar', f: 0.55 },
  rec: { name: 'Recomendada', hint: 'equilíbrio entre tamanho e imagem', f: 1 },
  high: { name: 'Alta', hint: 'mais detalhe, arquivo maior', f: 1.8 },
};
/** taxa de bits do vídeo (bps): 1080p 30 qps "Recomendada" = 16 Mb/s (o que a exportação sempre usou) */
function exportBitrate(W, H, fps, quality) {
  const base = W * H >= 1800000 ? 16e6 : 9e6;
  return Math.round(base * (fps > 30 ? 1.4 : 1) * (EXPORT_QUALITY[quality]?.f ?? 1));
}
const safeFileName = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'video';
const fmtMB = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1048576).toFixed(b < 10485760 ? 1 : 0)} MB`);
const fmtClock = (s) => { s = Math.max(0, Math.round(s)); return s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`; };
const desktopSave = () => !!window.cutlabDesktop?.writeExport;

/**
 * "Salvar" fora do programa: seletor de arquivo do navegador (Chrome/Edge) ou download.
 * Devolve { name } | { download: true } | null (cancelado). Precisa vir direto de um clique.
 */
async function saveInBrowser(blob, fileName, ext) {
  if (window.showSaveFilePicker) {
    try {
      const h = await window.showSaveFilePicker({ suggestedName: fileName, types: [{ description: 'Vídeo', accept: { [blob.type || 'video/mp4']: ['.' + ext] } }] });
      const w = await h.createWritable();
      await w.write(blob);
      await w.close();
      return { name: h.name };
    } catch (e) {
      if (e?.name === 'AbortError') return null;   // fechou o seletor
      // seletor indisponível aqui (iframe, permissão): cai no download
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  return { download: true };
}

function ExportModal({ state, name, resolution, setResolution, ratio, onStart, onCancel, onClose, prog, method, setMethod, offlineOk, fps, setFps, sourceFps, quality, setQuality, duration, poster }) {
  // o áudio da exportação rápida depende dos codificadores do navegador (AAC falta em alguns, ex.: Opera)
  const [audioSup, setAudioSup] = useState('aac');
  const [fileName, setFileName] = useState('');
  const [dir, setDir] = useState(null);
  const [saved, setSaved] = useState(null);   // { path } | { name } | { download } | { error }
  const [saving, setSaving] = useState(false);
  const liveRef = useRef(null);
  const stage = state?.stage;
  useEffect(() => {
    if (stage !== 'setup') return;
    setFileName(safeFileName(name));
    setSaved(null);
    if (offlineOk) offlineAudioSupport().then(setAudioSup, () => setAudioSup(null));
    if (desktopSave()) window.cutlabDesktop.exportDir().then(setDir, () => {});
  }, [stage === 'setup']);
  // quadro sendo renderizado, em miniatura
  useEffect(() => {
    const cv = liveRef.current, src = prog?.canvas;
    if (!cv || !src || stage !== 'rendering') return;
    const x = cv.getContext('2d');
    try { x.drawImage(src, 0, 0, cv.width, cv.height); } catch { /* quadro indisponível */ }
  }, [prog, stage]);
  // pronto: no programa, grava direto na pasta escolhida
  useEffect(() => {
    if (stage !== 'done' || !state.blob || !desktopSave() || !dir) return;
    let off = false;
    setSaving(true);
    state.blob.arrayBuffer()
      .then((buf) => window.cutlabDesktop.writeExport(dir, `${fileName}.${state.ext}`, buf))
      .then((path) => { if (!off) setSaved({ path }); }, (e) => { if (!off) setSaved({ error: e?.message || String(e) }); })
      .finally(() => { if (!off) setSaving(false); });
    return () => { off = true; };
  }, [stage === 'done' && state.url]);
  if (!state) return null;

  const [bw, bh] = RATIOS[ratio];
  const q = RESOLUTIONS[resolution];
  const W = Math.round(bw * q) & ~1, H = Math.round(bh * q) & ~1;
  const offline = method === 'offline' && offlineOk;
  const ext = offline ? 'mp4' : state.ext;
  const vbps = offline ? exportBitrate(W, H, fps, quality) : (q > 1 ? 12e6 : 8e6) * (EXPORT_QUALITY[quality]?.f ?? 1);
  const estimate = ((vbps + 192000) * duration) / 8;
  const busy = stage === 'rendering';
  const sub = stage === 'setup' ? `${fmtClock(duration)} de vídeo` : busy ? (state.offline ? 'Renderizando quadro a quadro' : 'Gravando enquanto toca') : 'Exportação concluída';
  const pick = async () => { const d = await window.cutlabDesktop.pickExportDir(dir); if (d) setDir(d); };
  const saveAgain = async () => {
    setSaving(true);
    try {
      if (desktopSave()) {
        const path = await window.cutlabDesktop.saveExportAs(`${fileName}.${state.ext}`, await state.blob.arrayBuffer());
        if (path) setSaved({ path });
      } else {
        const r = await saveInBrowser(state.blob, `${fileName}.${state.ext}`, state.ext);
        if (r) setSaved(r);
      }
    } catch (e) { setSaved({ error: e?.message || String(e) }); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-back">
      <div className={`modal export-modal ${stage}`}>
        <div className="ex-head">
          <div className="ex-title">
            <span className="ex-ico"><Icon name={stage === 'done' ? 'check' : 'film'} size={17} /></span>
            <div><h2>{stage === 'done' ? 'Vídeo pronto' : busy ? 'Exportando…' : 'Exportar vídeo'}</h2><span>{sub}</span></div>
          </div>
          {!busy && <button className="ex-x" onClick={onClose} title="Fechar"><Icon name="x" size={16} /></button>}
        </div>

        {stage === 'setup' && (<>
          <div className="ex-body">
            <div className="ex-left">
              <div className="ex-preview" style={{ aspectRatio: `${bw} / ${bh}` }}>
                {poster ? <img src={poster} alt="" /> : <Icon name="film" size={28} />}
                <span className="ex-chip br">{fmtClock(duration)}</span>
              </div>
              <div className="ex-facts">
                <div><span>Formato</span><b>{offline ? `MP4 · H.264 · ${audioSup === 'aac' ? 'AAC' : audioSup === 'opus' ? 'Opus' : 'sem som'}` : ext.toUpperCase()}</b></div>
                <div><span>Tamanho</span><b>{W} × {H}</b></div>
                <div><span>Arquivo estimado</span><b>~{fmtMB(estimate)}</b></div>
              </div>
            </div>
            <div className="ex-form">
              <label className="ex-field">
                <span className="ex-label">Nome</span>
                <div className="ex-name">
                  <input value={fileName} onChange={(e) => setFileName(e.target.value)} onBlur={() => setFileName((v) => safeFileName(v))} spellCheck={false} />
                  <span>.{ext}</span>
                </div>
              </label>
              {desktopSave() && (
                <div className="ex-field">
                  <span className="ex-label">Salvar em</span>
                  <div className="ex-dir">
                    <Icon name="folder" size={15} />
                    <span title={dir || ''}>{dir || '…'}</span>
                    <button className="btn" onClick={pick}>Alterar…</button>
                  </div>
                </div>
              )}
              <div className="ex-field">
                <span className="ex-label">Resolução</span>
                <div className="ex-opts">
                  {Object.keys(RESOLUTIONS).map((r) => (
                    <button key={r} className={r === resolution ? 'on' : ''} onClick={() => setResolution(r)}>
                      <b>{r}</b><small>{Math.round(bw * RESOLUTIONS[r]) & ~1}×{Math.round(bh * RESOLUTIONS[r]) & ~1}</small>
                    </button>
                  ))}
                </div>
              </div>
              {offline && (
                <div className="ex-field">
                  <span className="ex-label">Quadros por segundo{sourceFps ? <em>original: {+sourceFps.toFixed(2)}</em> : null}</span>
                  <div className="ex-opts compact">
                    {EXPORT_FPS.map((f) => <button key={f} className={f === fps ? 'on' : ''} onClick={() => setFps(f)}><b>{f}</b></button>)}
                  </div>
                  {sourceFps && fps < sourceFps - 1 && <div className="ex-hint">Abaixo do original: o movimento fica menos fluido.</div>}
                </div>
              )}
              <div className="ex-field">
                <span className="ex-label">Qualidade</span>
                <div className="ex-opts">
                  {Object.entries(EXPORT_QUALITY).map(([k, o]) => (
                    <button key={k} className={k === quality ? 'on' : ''} onClick={() => setQuality(k)} title={o.hint}>
                      <b>{o.name}</b><small>{(exportBitrateFor(k) / 1e6).toFixed(0)} Mb/s</small>
                    </button>
                  ))}
                </div>
              </div>
              <div className="ex-field">
                <span className="ex-label">Método</span>
                <div className="ex-opts">
                  <button className={offline ? 'on' : ''} disabled={!offlineOk} onClick={() => setMethod('offline')} title={offlineOk ? '' : 'Este navegador não tem WebCodecs'}>
                    <b>Rápida</b><small>quadro a quadro</small>
                  </button>
                  <button className={!offline ? 'on' : ''} onClick={() => setMethod('realtime')}>
                    <b>Tempo real</b><small>grava enquanto toca</small>
                  </button>
                </div>
                <div className="ex-hint">{offline
                  ? 'Não precisa tocar o vídeo: costuma levar menos que a duração e pode ficar em segundo plano.'
                  : 'Leva a duração do vídeo. Mantenha esta janela aberta e visível até terminar.'}</div>
              </div>
            </div>
          </div>
          {offline && audioSup !== 'aac' && <AudioWarn kind={audioSup} before />}
          <div className="actions">
            <button className="btn" onClick={onClose}>Cancelar</button>
            <button className="btn btn-primary ex-go" onClick={() => onStart(safeFileName(fileName))} disabled={desktopSave() && !dir}>
              <Icon name="upload" size={15} /> Exportar
            </button>
          </div>
        </>)}

        {busy && (() => {
          const p = clamp(prog?.p || 0, 0, 1);
          const el = state.startedAt ? (performance.now() - state.startedAt) / 1000 : 0;
          const left = p > 0.02 ? (el * (1 - p)) / p : null;
          const speed = el > 0.5 ? (p * duration) / el : null;
          return (<>
            <div className="ex-live" style={{ aspectRatio: `${bw} / ${bh}` }}>
              {state.offline ? <canvas ref={liveRef} width={Math.round((480 * bw) / Math.max(bw, bh))} height={Math.round((480 * bh) / Math.max(bw, bh))} /> : (poster && <img src={poster} alt="" />)}
              <div className="ex-pct">{Math.floor(p * 100)}<small>%</small></div>
            </div>
            <div className="progress ex-bar"><div style={{ width: `${p * 100}%` }} /></div>
            <div className="ex-stats">
              <div><span>{state.offline ? 'Quadro' : 'Tempo'}</span><b>{state.offline && prog?.N ? `${Math.min(prog.N, (prog.i || 0) + 1)} / ${prog.N}` : `${fmtClock(p * duration)} / ${fmtClock(duration)}`}</b></div>
              <div><span>Decorrido</span><b>{fmtClock(el)}</b></div>
              <div><span>Restante</span><b>{left == null ? '—' : `~${fmtClock(left)}`}</b></div>
              <div><span>Velocidade</span><b>{speed == null ? '—' : `${speed.toFixed(1)}×`}</b></div>
            </div>
            <div className="ex-step">{state.offline ? prog?.label || 'Preparando…' : 'Gravando a composição com áudio. Não troque de janela.'}</div>
            <div className="actions"><button className="btn" onClick={onCancel}>Cancelar exportação</button></div>
          </>);
        })()}

        {stage === 'done' && (<>
          <video className="ex-result" src={state.url} controls playsInline style={{ aspectRatio: `${bw} / ${bh}` }} />
          <div className="ex-stats">
            <div><span>Arquivo</span><b>{fmtMB(state.size)}</b></div>
            <div><span>Duração</span><b>{fmtClock(state.duration || duration)}</b></div>
            <div><span>Exportado em</span><b>{state.seconds ? `${fmtClock(state.seconds)} · ${((state.duration || duration) / state.seconds).toFixed(1)}×` : '—'}</b></div>
            <div><span>Formato</span><b>{state.offline ? `${codecName(state.codec)} · ${state.fps} qps` : state.ext.toUpperCase()}</b></div>
          </div>
          {state.offline && state.audio !== 'aac' && <AudioWarn kind={state.audio} />}
          {saving && <div className="ex-saved"><Icon name="save" size={15} /><span>Salvando…</span></div>}
          {!saving && saved?.path && (
            <div className="ex-saved ok">
              <Icon name="check" size={15} />
              <span>Salvo em <b title={saved.path}>{saved.path}</b></span>
              <button className="btn" onClick={() => window.cutlabDesktop.showInFolder(saved.path)}><Icon name="folder" size={14} /> Mostrar na pasta</button>
            </div>
          )}
          {!saving && saved?.name && <div className="ex-saved ok"><Icon name="check" size={15} /><span>Salvo como <b>{saved.name}</b></span></div>}
          {!saving && saved?.download && <div className="ex-saved ok"><Icon name="check" size={15} /><span>Enviado para a pasta de downloads do navegador.</span></div>}
          {!saving && saved?.error && <div className="ex-saved err"><Icon name="x" size={15} /><span>Não foi possível salvar: {saved.error}</span></div>}
          <div className="actions">
            <button className="btn" onClick={onClose}>Fechar</button>
            <button className="btn btn-primary" onClick={saveAgain} disabled={saving}>
              <Icon name="save" size={15} /> {saved?.path || saved?.name ? 'Salvar outra cópia…' : 'Salvar…'}
            </button>
          </div>
        </>)}
      </div>
    </div>
  );

  function exportBitrateFor(k) { return offline ? exportBitrate(W, H, fps, k) : (q > 1 ? 12e6 : 8e6) * EXPORT_QUALITY[k].f; }
}

const codecName = (c = '') => (c.startsWith('avc') ? 'H.264' : c.startsWith('hvc') || c.startsWith('hev') ? 'H.265' : c.startsWith('vp09') ? 'VP9' : c.startsWith('av01') ? 'AV1' : c);

/** aviso quando o navegador não grava AAC: Opus no MP4 fica mudo em vários players; sem codificador, sai sem áudio */
function AudioWarn({ kind, before }) {
  return (
    <div className="export-warn">
      <Icon name="volume" size={15} />
      <span>{kind === 'opus'
        ? <>Este navegador não grava áudio AAC, então o som {before ? 'vai sair' : 'saiu'} em <b>Opus</b>. Players como o do Windows, alguns editores e redes sociais tocam esse MP4 <b>sem som</b>. Para AAC, exporte pelo <b>Chrome</b> ou <b>Edge</b>, ou use o método <b>Tempo real</b>.</>
        : <>Este navegador não consegue gravar áudio na exportação rápida: o vídeo {before ? 'vai sair' : 'saiu'} <b>sem som</b>. Use o método <b>Tempo real</b> ou exporte pelo <b>Chrome</b> ou <b>Edge</b>.</>}</span>
    </div>
  );
}
