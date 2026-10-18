/* =====================================================================
   Modal de exportação
   ===================================================================== */
function ExportModal({ state, name, resolution, setResolution, ratio, onStart, onCancel, onClose, progress, method, setMethod, offlineOk, offlineLabel }) {
  // o áudio da exportação rápida depende dos codificadores do navegador (AAC falta em alguns, ex.: Opera)
  const [audioSup, setAudioSup] = useState('aac');
  useEffect(() => { if (state?.stage === 'setup' && offlineOk) offlineAudioSupport().then(setAudioSup, () => setAudioSup(null)); }, [state?.stage, offlineOk]);
  if (!state) return null;
  const [bw, bh] = RATIOS[ratio];
  const q = RESOLUTIONS[resolution];
  const offline = method === 'offline' && offlineOk;
  const ext = offline ? 'mp4' : state.ext;
  return (
    <div className="modal-back">
      <div className="modal">
        {state.stage === 'setup' && (<>
          <h2>Exportar vídeo</h2>
          <div className="field">
            <div className="field-top"><label>Método</label></div>
            <div className="seg">
              <button className={offline ? 'on' : ''} disabled={!offlineOk} onClick={() => setMethod('offline')}
                title={offlineOk ? '' : 'Este navegador não tem WebCodecs'}>Rápida (offline)</button>
              <button className={!offline ? 'on' : ''} onClick={() => setMethod('realtime')}>Tempo real</button>
            </div>
          </div>
          <p>{offline
            ? 'Cada quadro é renderizado e codificado direto em MP4, sem precisar tocar o vídeo: costuma ser mais rápido que a duração e não depende de a aba ficar visível.'
            : 'O vídeo é gravado enquanto toca, em tempo real. Mantenha esta aba aberta e visível até terminar.'}</p>
          <div className="field">
            <div className="field-top"><label>Resolução</label><span className="kbd">{Math.round(bw * q)} × {Math.round(bh * q)}</span></div>
            <div className="seg">
              {Object.keys(RESOLUTIONS).map((r) => <button key={r} className={r === resolution ? 'on' : ''} onClick={() => setResolution(r)}>{r}</button>)}
            </div>
          </div>
          <div className="stat"><span>Arquivo</span><b>{name || 'video'}.{ext}</b></div>
          {offline && audioSup !== 'aac' && <AudioWarn kind={audioSup} before />}
          <div className="actions">
            <button className="btn" onClick={onClose}>Cancelar</button>
            <button className="btn btn-primary" onClick={onStart}><Icon name="download" size={15} /> Exportar</button>
          </div>
        </>)}
        {state.stage === 'rendering' && (<>
          <h2>Renderizando…</h2>
          <p>{state.offline ? (offlineLabel || 'Renderizando…') : 'Gravando a composição com áudio. Não troque de aba.'}</p>
          <div className="progress"><div style={{ width: `${progress * 100}%` }} /></div>
          <div className="kbd">{Math.round(progress * 100)}%</div>
          <div className="actions"><button className="btn" onClick={onCancel}>Cancelar</button></div>
        </>)}
        {state.stage === 'done' && (<>
          <h2>Pronto! 🎉</h2>
          <p>Seu vídeo foi exportado ({(state.size / 1048576).toFixed(1)} MB)
            {state.seconds ? ` em ${state.seconds.toFixed(1)}s — ${(state.duration / state.seconds).toFixed(1)}× a velocidade real` : ''}.</p>
          {state.offline && <div className="stat"><span>Codecs</span><b>{codecName(state.codec)} · {state.audio ? state.audio.toUpperCase() : 'sem áudio'}</b></div>}
          {state.offline && state.audio !== 'aac' && <AudioWarn kind={state.audio} />}
          <div className="actions">
            <button className="btn" onClick={onClose}>Fechar</button>
            <a className="btn btn-primary" href={state.url} download={`${name || 'video'}.${state.ext}`} style={{ textDecoration: 'none' }}>
              <Icon name="download" size={15} /> Baixar arquivo
            </a>
          </div>
        </>)}
      </div>
    </div>
  );
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
