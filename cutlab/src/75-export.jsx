/* =====================================================================
   Modal de exportação
   ===================================================================== */
function ExportModal({ state, name, resolution, setResolution, ratio, onStart, onCancel, onClose, progress, method, setMethod, offlineOk, offlineLabel }) {
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
