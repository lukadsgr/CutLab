/* =====================================================================
   Atualizações do programa de desktop (Windows)
   Só aparece no CutLab instalado (window.cutlabDesktop vem do preload do Electron);
   no site não muda nada. O processo principal avisa quando há versão nova no
   GitHub Releases; o usuário clica para baixar e depois para reiniciar e instalar.
   ===================================================================== */
const DESKTOP = typeof window !== 'undefined' ? window.cutlabDesktop : null;
const openUpdates = () => window.dispatchEvent(new Event('cutlab-updates'));

function UpdateButton() {
  const [st, setSt] = useState({ state: 'idle' });
  const [open, setOpen] = useState(false);
  const manual = useRef(false);   // o usuário pediu a verificação pelo menu: mostrar também "nenhuma atualização"
  useEffect(() => {
    if (!DESKTOP) return;
    const off = DESKTOP.onUpdateStatus((s) => {
      setSt((cur) => (s.state === 'checking' && (cur.state === 'downloading' || cur.state === 'ready') ? cur : { ...cur, ...s }));
      if (s.state === 'available' && !manual.current) setOpen(true);   // versão nova encontrada sozinho: avisa uma vez
    });
    const onOpen = () => { manual.current = true; setOpen(true); DESKTOP.checkForUpdates(); };
    window.addEventListener('cutlab-updates', onOpen);
    return () => { off(); window.removeEventListener('cutlab-updates', onOpen); };
  }, []);
  if (!DESKTOP) return null;
  const close = () => { setOpen(false); manual.current = false; };
  const pill = st.state === 'available' || st.state === 'downloading' || st.state === 'ready';
  const pct = Math.round(st.percent || 0);
  return (<>
    {pill && (
      <button className={`update-pill ${st.state}`} onClick={() => setOpen(true)}
        title={st.state === 'ready' ? 'Atualização baixada: reinicie para instalar' : `CutLab ${st.version} disponível`}>
        <Icon name="download" size={14} />
        {st.state === 'available' && <>Atualização disponível</>}
        {st.state === 'downloading' && <>Baixando… {pct}%</>}
        {st.state === 'ready' && <>Reiniciar para atualizar</>}
      </button>
    )}
    {open && (
      <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && close()}>
        <div className="modal update-modal">
          <h2>Atualizações</h2>
          <div className="stat"><span>Versão instalada</span><b>{DESKTOP.version}</b></div>
          {(st.state === 'idle' || st.state === 'checking') && <p>Procurando atualizações…</p>}
          {st.state === 'none' && <p>Você já está com a versão mais recente do CutLab.</p>}
          {st.state === 'dev' && <p>Modo de desenvolvimento: as atualizações só funcionam no CutLab instalado.</p>}
          {st.state === 'error' && <p className="update-err">Não foi possível procurar atualizações agora ({st.message}). Verifique a internet e tente de novo.</p>}
          {(st.state === 'available' || st.state === 'downloading' || st.state === 'ready') && (<>
            <div className="stat"><span>Nova versão</span><b>{st.version}</b></div>
            {st.notes && <div className="update-notes">{st.notes}</div>}
          </>)}
          {st.state === 'available' && <p>Clique em “Baixar e instalar”. Você pode continuar editando enquanto baixa; seu projeto fica salvo.</p>}
          {st.state === 'downloading' && (<>
            <div className="progress"><div style={{ width: `${pct}%` }} /></div>
            <div className="kbd">{pct}%{st.total ? ` de ${(st.total / 1048576).toFixed(0)} MB` : ''}</div>
          </>)}
          {st.state === 'ready' && <p>Download concluído. O CutLab vai fechar, instalar a nova versão e abrir de novo.</p>}
          <div className="actions">
            <button className="btn" onClick={close}>{st.state === 'available' ? 'Depois' : 'Fechar'}</button>
            {(st.state === 'none' || st.state === 'error') && <button className="btn" onClick={() => DESKTOP.checkForUpdates()}>Procurar de novo</button>}
            {st.state === 'available' && <button className="btn btn-primary" onClick={() => { setSt((c) => ({ ...c, state: 'downloading', percent: 0 })); DESKTOP.downloadUpdate(); }}>
              <Icon name="download" size={15} /> Baixar e instalar</button>}
            {st.state === 'ready' && <button className="btn btn-primary" onClick={() => DESKTOP.installUpdate()}>Reiniciar e instalar</button>}
          </div>
        </div>
      </div>
    )}
  </>);
}
