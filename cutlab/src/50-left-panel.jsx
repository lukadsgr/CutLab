/* =====================================================================
   Painel esquerdo: barra de abas superior + categorias laterais
   ===================================================================== */
const TOP_TABS = [
  { id: 'media', label: 'Mídia', icon: 'media' },
  { id: 'audio', label: 'Áudio', icon: 'disc' },
  { id: 'text', label: 'Texto', icon: 'textT' },
  { id: 'stickers', label: 'Stickers', icon: 'sticker' },
  { id: 'effects', label: 'Efeitos', icon: 'sparkles' },
  { id: 'transitions', label: 'Transições', icon: 'transition' },
  { id: 'captions', label: 'Legendas', icon: 'captions' },
  { id: 'filters', label: 'Filtros', icon: 'filter' },
  { id: 'adjust', label: 'Ajuste', icon: 'sliders' },
  { id: 'templates', label: 'Modelos', icon: 'template' },
];
const uniq = (a) => [...new Set(a)];
const SIDEBARS = {
  media: [{ id: 'local', label: 'Local' }, { id: 'bg', label: 'Fundos' }],
  audio: [{ id: 'mine', label: 'Seus áudios' }, { id: 'sfx', label: 'Efeitos sonoros' }, { id: 'music', label: 'Trilhas' }],
  text: [{ id: 'fav', label: 'Favoritos' }, { id: 'add', label: 'Adicionar texto' }, { id: 'styles', label: 'Efeitos de texto' }],
  stickers: [{ id: 'fav', label: 'Favoritos' }, ...Object.keys(STICKER_CATS).map((c) => ({ id: c, label: c }))],
  effects: [{ id: 'fav', label: 'Favoritos' }, { group: 'Efeitos de vídeo' }, { id: 'all', label: 'Populares' }, ...uniq(EFFECTS.map((e) => e.cat)).map((c) => ({ id: c, label: c }))],
  transitions: [{ id: 'fav', label: 'Favoritos' }, { group: 'Transições' }, { id: 'all', label: 'Populares' },
    ...uniq(TRANSITIONS.map((e) => e.cat)).filter((c) => c !== USER_TR_CAT).map((c) => ({ id: c, label: c })),
    { group: 'Personalizadas' }, { id: USER_TR_CAT, label: 'Minhas transições' }],
  captions: [{ id: 'editor', label: 'Legendas' }, { id: 'auto', label: 'Automáticas' }, { id: 'script', label: 'Do roteiro' }, { id: 'styles', label: 'Estilos' }],
  filters: [{ id: 'fav', label: 'Favoritos' }, { id: 'all', label: 'Todos' }, ...uniq(FILTERS.map((f) => f.cat)).map((c) => ({ id: c, label: c }))],
  adjust: [{ id: 'custom', label: 'Ajustes' }, { id: 'presets', label: 'Predefinições' }],
  templates: [{ id: 'all', label: 'Todos' }, ...uniq(TEMPLATES.map((t) => t.cat)).map((c) => ({ id: c, label: c }))],
};
const DEFAULT_CAT = { media: 'local', audio: 'mine', text: 'add', stickers: 'Rostos', effects: 'all', transitions: 'all', captions: 'editor', filters: 'all', adjust: 'custom', templates: 'all' };
const SEARCHABLE = ['stickers', 'effects', 'transitions', 'filters', 'text', 'templates'];

function useFavorites() {
  const [favs, setFavs] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('cutlab-favs') || '[]')); } catch { return new Set(); }
  });
  const toggle = (key) => setFavs((s) => {
    const n = new Set(s);
    n.has(key) ? n.delete(key) : n.add(key);
    try { localStorage.setItem('cutlab-favs', JSON.stringify([...n])); } catch { /* armazenamento indisponível */ }
    return n;
  });
  return [favs, toggle];
}

function MiniWave({ peaks, className }) {
  if (!peaks) return null;
  const n = peaks.length;
  const step = Math.max(1, Math.floor(n / 120));
  let d = '';
  for (let i = 0; i < n; i += step) d += `M${i} ${50 - peaks[i] * 46}V${50 + peaks[i] * 46}`;
  return (
    <svg className={className} viewBox={`0 0 ${n} 100`} preserveAspectRatio="none">
      <path d={d} stroke="currentColor" strokeWidth={step * 0.6} fill="none" />
    </svg>
  );
}

function Card({ title, children, onClick, drag, fav, onFav, active }) {
  return (
    <div className={`card ${active ? 'active' : ''}`} onClick={onClick} draggable={!!drag}
      onDragStart={drag ? (e) => { e.dataTransfer.setData(drag[0], drag[1]); e.dataTransfer.effectAllowed = 'copy'; } : undefined} title={title}>
      <div className="card-thumb">
        {children}
        {onFav && (
          <button className={`card-fav ${fav ? 'on' : ''}`} title={fav ? 'Remover dos favoritos' : 'Favoritar'} onClick={(e) => { e.stopPropagation(); onFav(); }}>
            <Icon name={fav ? 'starFill' : 'star'} size={12} />
          </button>
        )}
        <span className="card-add"><Icon name="plus" size={13} stroke={2.6} /></span>
      </div>
      <div className="card-title">{title}</div>
    </div>
  );
}

/** miniatura do sticker com a mesma imagem que vai para o vídeo (cai para o emoji do sistema sem internet) */
function StickerIcon({ e }) {
  const [bad, setBad] = useState(false);
  return bad ? e : <img className="emoji-img" src={emojiUrl(e)} alt={e} draggable={false} onError={() => setBad(true)} />;
}

function LeftPanel(props) {
  const { assets, usedAssets = new Map(), onImport, onAddAsset, onRemoveAsset, onAddText, onAddSticker, onAddColor, onAddSfx, selected, selectedAsset,
    onApplyFilter, onAddEffect, onApplyTransition, onAddAdjust, onApplyTemplate, captions, trApi } = props;
  const trV = useTransitionsVersion();
  const trFileRef = useRef();
  const [tab, setTab] = useState('media');
  const [cats, setCats] = useState(DEFAULT_CAT);
  const [query, setQuery] = useState('');
  const [favs, toggleFav] = useFavorites();
  const fileRef = useRef();
  const tabsRef = useRef();
  const cat = cats[tab];
  const setCat = (c) => setCats((s) => ({ ...s, [tab]: c }));
  const q = query.trim().toLowerCase();
  const match = (name) => !q || name.toLowerCase().includes(q);
  const openPicker = (accept) => { fileRef.current.accept = accept; fileRef.current.click(); };
  const switchTab = (id) => vt(() => { setTab(id); setQuery(''); });
  // indicador deslizante da aba ativa
  const [ind, setInd] = useState(null);
  useLayoutEffect(() => { const el = tabsRef.current?.querySelector('.top-tab.active'); if (el) setInd({ x: el.offsetLeft, w: el.offsetWidth }); }, [tab]);

  /* lista filtrada por categoria/favoritos/busca */
  const pick = (items, key, catOf) => items.filter((it) => {
    if (q) return match(it.name);
    if (cat === 'fav') return favs.has(`${key}:${it.id}`);
    return cat === 'all' || catOf(it) === cat;
  });

  const visualAssets = assets.filter((a) => a.type !== 'audio');
  const audioAssets = assets.filter((a) => a.type === 'audio');
  const missingCount = assets.filter((a) => a.missing).length;
  const sampleUrl = useMemo(() => sampleImages().a.toDataURL(), []);
  const previewImg = selectedAsset?.thumb || sampleUrl;
  const canFilter = selected && (selected.type === 'video' || selected.type === 'image' || selected.type === 'color');
  const favCard = (key, id) => ({ fav: favs.has(`${key}:${id}`), onFav: () => toggleFav(`${key}:${id}`) });
  const empty = (msg) => <div className="hint">{msg}</div>;

  const assetTile = (a) => (
    <div key={a.id} className="asset" draggable={!a.loading} onDragStart={(e) => { e.dataTransfer.setData('text/asset', a.id); }} onDoubleClick={() => onAddAsset(a)} title={a.name}>
      <div className="asset-thumb" style={a.thumb ? { backgroundImage: `url(${a.thumb})` } : null}>
        {!a.thumb && <Icon name={a.type === 'audio' ? 'music' : 'image'} size={22} />}
      </div>
      <div className="asset-name">{a.name}</div>
      {a.duration && a.type !== 'image' ? <span className="asset-badge">{fmtDur(a.duration)}</span> : null}
      {usedAssets.has(a.id) && <span className="asset-used" title={`Na linha do tempo (${usedAssets.get(a.id)} clipe${usedAssets.get(a.id) > 1 ? 's' : ''})`}><Icon name="check" size={11} stroke={3} /></span>}
      {!a.loading && !a.error && !a.missing && <button className="asset-add" title="Adicionar à linha do tempo" onClick={() => onAddAsset(a)}><Icon name="plus" size={14} stroke={2.5} /></button>}
      <button className="asset-del" title="Remover da biblioteca" onClick={() => onRemoveAsset(a.id)}><Icon name="x" size={11} stroke={2.5} /></button>
      {a.loading && <div className="asset-loading">Processando…</div>}
      {a.error && <div className="asset-loading">Formato não suportado</div>}
      {a.missing && <div className="asset-loading" title="Importe este arquivo de novo para religá-lo">Arquivo não encontrado</div>}
    </div>
  );
  const audioRow = (a) => (
    <div key={a.id} className="list-item" draggable={!a.loading} onDragStart={(e) => e.dataTransfer.setData('text/asset', a.id)} onDoubleClick={() => onAddAsset(a)}>
      <div className="li-icon">{usedAssets.has(a.id) ? <span className="asset-used inline" title="Na linha do tempo"><Icon name="check" size={11} stroke={3} /></span> : null}<Icon name="music" size={15} /></div>
      <div className="li-text">
        <div className="li-name" title={a.name}>{a.name}</div>
        {a.peaks ? <MiniWave peaks={a.peaks} className="mini-wave" /> : null}
        <div className="li-sub">{a.loading ? 'Processando…' : a.error ? 'Formato não suportado' : a.missing ? 'Arquivo não encontrado — importe de novo' : a.duration ? fmtDur(a.duration) : ''}</div>
      </div>
      {!a.loading && !a.error && !a.missing && <button className="icon-btn" title="Adicionar" onClick={() => onAddAsset(a)}><Icon name="plus" size={15} /></button>}
      <button className="icon-btn li-del" title="Excluir áudio" onClick={(e) => { e.stopPropagation(); onRemoveAsset(a.id); }}><Icon name="trash" size={14} /></button>
    </div>
  );
  const sfxRow = (s) => (
    <div key={s.id} className="list-item" onClick={() => onAddSfx(s)} style={{ cursor: 'pointer' }}>
      <div className="li-icon" style={{ background: 'rgba(79,140,255,.2)', color: '#8fb3ff' }}><Icon name="wand" size={15} /></div>
      <div className="li-text"><div className="li-name">{s.name}</div><div className="li-sub">Gerado na hora · {fmtDur(s.dur)}</div></div>
      <Icon name="plus" size={15} />
    </div>
  );
  const textCard = (pr) => {
    const s = { ...TEXT_BASE, ...pr.style };
    return (
      <Card key={pr.id} title={pr.name} onClick={() => onAddText(pr)} {...favCard('text', pr.id)}>
        <span className="text-sample" style={{
          fontFamily: `"${s.fontFamily}"`, fontWeight: s.bold ? 700 : 400, fontStyle: s.italic ? 'italic' : 'normal',
          fontSize: Math.min(22, s.fontSize * 0.28), color: s.color, background: s.bg || 'transparent', padding: s.bg ? '2px 5px' : 0, borderRadius: 4,
          WebkitTextStroke: s.stroke ? `${Math.max(1, s.stroke * 0.25)}px ${s.strokeColor}` : undefined,
          textShadow: s.glow ? `0 0 8px ${s.glow}, 0 0 14px ${s.glow}` : s.shadow ? '0 1px 4px rgba(0,0,0,.6)' : 'none',
        }}>{pr.sample}</span>
      </Card>
    );
  };

  let body = null;
  switch (tab) {
    case 'media':
      body = cat === 'local' ? (<>
        <div className="panel-title">Mídia local
          <button className="btn" onClick={() => openPicker('video/*,image/*,audio/*')}><Icon name="upload" size={14} /> Importar</button>
        </div>
        {missingCount > 0 && (
          <div className="hint" style={{ marginBottom: 10, color: 'var(--text)' }}>
            {missingCount} mídia(s) do projeto não estão neste computador.{' '}
            <button className="btn" style={{ marginTop: 6 }} onClick={() => openPicker('video/*,image/*,audio/*')}><Icon name="upload" size={14} /> Localizar arquivos</button>
          </div>
        )}
        {visualAssets.length === 0 ? (
          <div className="dropzone" onClick={() => openPicker('video/*,image/*,audio/*')}>
            <Icon name="upload" size={26} />
            <div><b style={{ color: 'var(--text)' }}>Importe vídeos e imagens</b><br />Clique ou arraste arquivos para a janela</div>
          </div>
        ) : <div className="asset-grid">{visualAssets.map(assetTile)}</div>}
        <div className="hint" style={{ marginTop: 14 }}>Arraste itens para uma faixa da linha do tempo — por exemplo, <b>Sobreposição</b> para picture‑in‑picture. Clique duplo adiciona ao final da faixa principal.</div>
      </>) : (<>
        <div className="panel-title">Fundos sólidos</div>
        <div className="swatches">{BG_COLORS.map((c) => <div key={c} className="swatch" style={{ background: c }} title="Adicionar fundo" onClick={() => onAddColor(c)} />)}</div>
      </>);
      break;
    case 'audio':
      body = cat === 'mine' ? (<>
        <div className="panel-title">Seus áudios
          <button className="btn" onClick={() => openPicker('audio/*')}><Icon name="upload" size={14} /> Importar</button>
        </div>
        {audioAssets.length === 0 ? empty('Nenhum áudio importado. Importe músicas (MP3, WAV, M4A…) ou use os efeitos sonoros.') : <div className="list">{audioAssets.map(audioRow)}</div>}
      </>) : (<>
        <div className="panel-title">{cat === 'sfx' ? 'Efeitos sonoros' : 'Trilhas'}</div>
        <div className="list">{SFX.filter((s) => (cat === 'music') === (s.dur > 4)).map(sfxRow)}</div>
      </>);
      break;
    case 'text': {
      if (cat === 'add' && !q) {
        body = (<>
          <div className="panel-title">Adicionar texto</div>
          <button className="add-text-btn" onClick={() => onAddText(TEXT_PRESETS[0])}><Icon name="plus" size={16} /> Texto padrão</button>
          <div className="section-label">Sugestões</div>
          <div className="card-grid">{TEXT_PRESETS.slice(1, 5).map(textCard)}</div>
        </>);
      } else {
        const list = pick(TEXT_PRESETS, 'text', () => 'styles');
        body = (<><div className="panel-title">{q ? 'Resultados' : cat === 'fav' ? 'Favoritos' : 'Efeitos de texto'}</div>
          {list.length ? <div className="card-grid">{list.map(textCard)}</div> : empty(cat === 'fav' ? 'Clique na estrela de um estilo para favoritá-lo.' : 'Nada encontrado.')}</>);
      }
      break;
    }
    case 'stickers': {
      const all = Object.entries(STICKER_CATS).flatMap(([c, l]) => l.map((e) => ({ id: e, name: e, cat: c })));
      const list = q ? [] : cat === 'fav' ? all.filter((s) => favs.has(`sticker:${s.id}`)) : all.filter((s) => s.cat === cat);
      body = (<>
        <div className="panel-title">{cat === 'fav' ? 'Favoritos' : cat}</div>
        {list.length ? (
          <div className="emoji-grid">
            {list.map((s) => (
              <div key={s.cat + s.id} className="emoji" onClick={() => onAddSticker(s.id)} onContextMenu={(e) => { e.preventDefault(); toggleFav(`sticker:${s.id}`); }}
                title="Clique para adicionar · botão direito para favoritar">
                <StickerIcon e={s.id} />{favs.has(`sticker:${s.id}`) && <span className="emoji-fav">★</span>}
              </div>
            ))}
          </div>
        ) : empty(cat === 'fav' ? 'Clique com o botão direito em um sticker para favoritá-lo.' : 'Nada encontrado.')}
      </>);
      break;
    }
    case 'effects': {
      const list = pick(EFFECTS, 'effect', (e) => e.cat);
      body = (<>
        <div className="panel-title">{q ? 'Resultados' : cat === 'fav' ? 'Favoritos' : cat === 'all' ? 'Populares' : cat}</div>
        {list.length ? (
          <div className="card-grid">
            {list.map((e) => (
              <Card key={e.id} title={e.name} onClick={() => onAddEffect(e.id)} drag={['text/effect', e.id]} {...favCard('effect', e.id)}>
                <FxThumb kind="effect" id={e.id} />
              </Card>
            ))}
          </div>
        ) : empty(cat === 'fav' ? 'Clique na estrela de um efeito para favoritá-lo.' : 'Nada encontrado.')}
        <div className="hint" style={{ marginTop: 14 }}>Efeitos entram na faixa <b>Efeitos</b> e afetam tudo o que está abaixo. Passe o mouse para ver a prévia.</div>
      </>);
      break;
    }
    case 'transitions': {
      const mine = cat === USER_TR_CAT && !q;
      const list = pick(TRANSITIONS, 'transition', (e) => e.cat);
      const act = (fn, e) => (ev) => { ev.stopPropagation(); fn(e.id); };
      body = (<>
        <div className="panel-title">{q ? 'Resultados' : cat === 'fav' ? 'Favoritos' : cat === 'all' ? 'Populares' : mine ? 'Minhas transições' : cat}</div>
        {mine && (
          <div className="tr-tools">
            <button className="btn btn-primary" onClick={() => trApi.onNew()}><Icon name="plus" size={14} /> Nova transição</button>
            <button className="btn" onClick={() => trFileRef.current.click()}><Icon name="upload" size={14} /> Importar</button>
            <input ref={trFileRef} type="file" hidden multiple accept=".json,application/json" onChange={(e) => { trApi.onImport([...e.target.files]); e.target.value = ''; }} />
          </div>
        )}
        {list.length ? (
          <div className="card-grid">
            {list.map((e) => (
              <Card key={e.id} title={e.name} onClick={() => onApplyTransition(e.id)} drag={['text/transition', e.id]} {...favCard('transition', e.id)}>
                <FxThumb key={`${e.id}:${trV}`} kind="transition" id={e.id} />
                {e.def && (
                  <span className="card-acts">
                    <button title={e.cat === USER_TR_CAT ? 'Editar' : 'Editar uma cópia'} onClick={act(trApi.onEdit, e)}><Icon name="pen" size={11} /></button>
                    {e.cat === USER_TR_CAT && <button title="Exportar (.json)" onClick={act(trApi.onExport, e)}><Icon name="download" size={11} /></button>}
                    {e.cat === USER_TR_CAT && <button title="Excluir" onClick={act(trApi.onDelete, e)}><Icon name="trash" size={11} /></button>}
                  </span>
                )}
              </Card>
            ))}
          </div>
        ) : empty(cat === 'fav' ? 'Clique na estrela de uma transição para favoritá-la.' : mine ? 'Você ainda não criou transições. Crie uma do zero, comece de um modelo (as da categoria Dinâmicas) ou importe um arquivo .json.' : 'Nada encontrado.')}
        <div className="hint" style={{ marginTop: 14 }}>Clique para aplicar no corte mais próximo do cursor, ou arraste até o ponto entre dois clipes da faixa <b>Principal</b>.</div>
      </>);
      break;
    }
    case 'captions':
      body = <CaptionsPanel cat={cat} {...captions} />;
      break;
    case 'filters': {
      const list = pick(FILTERS, 'filter', (f) => f.cat);
      body = (<>
        <div className="panel-title">{cat === 'fav' ? 'Favoritos' : cat === 'all' ? 'Filtros' : cat}</div>
        {!canFilter && <div className="hint" style={{ marginBottom: 12 }}>Selecione um clipe de vídeo, imagem ou fundo para aplicar um filtro.</div>}
        {list.length ? (
          <div className="card-grid" style={{ opacity: canFilter ? 1 : 0.5, pointerEvents: canFilter ? 'auto' : 'none' }}>
            {list.map((f) => (
              <Card key={f.id} title={f.name} active={canFilter && selected.props.filter === f.id} onClick={() => onApplyFilter(f)} {...favCard('filter', f.id)}>
                <div className="filter-img" style={{ backgroundImage: `url("${previewImg}")`, filter: filterCss({ ...BASE_PROPS, ...f.v }) }} />
              </Card>
            ))}
          </div>
        ) : empty(cat === 'fav' ? 'Clique na estrela de um filtro para favoritá-lo.' : 'Nada encontrado.')}
      </>);
      break;
    }
    case 'adjust':
      body = cat === 'custom' ? (<>
        <div className="panel-title">Ajustes</div>
        <button className="add-text-btn" onClick={() => onAddAdjust(ADJUST_PRESETS[0])}><Icon name="plus" size={16} /> Adicionar camada de ajuste</button>
        <div className="hint" style={{ marginTop: 12 }}>
          A camada de ajuste entra na faixa <b>Efeitos</b> e corrige a cor de tudo o que está abaixo dela: brilho, contraste, saturação, temperatura, vinheta… Todos os controles aceitam keyframes.
          <br /><br />Para ajustar só um clipe, selecione-o e use a aba <b>Ajustes</b> no painel da direita.
        </div>
      </>) : (<>
        <div className="panel-title">Predefinições</div>
        <div className="card-grid">
          {ADJUST_PRESETS.slice(1).map((pr) => (
            <Card key={pr.id} title={pr.name} onClick={() => onAddAdjust(pr)}>
              <AdjustThumb preset={pr} />
            </Card>
          ))}
        </div>
      </>);
      break;
    case 'templates': {
      const list = TEMPLATES.filter((t) => (q ? match(t.name) : cat === 'all' || t.cat === cat));
      body = (<>
        <div className="panel-title">Modelos</div>
        <div className="tpl-grid">
          {list.map((t) => (
            <div key={t.id} className="tpl" onClick={() => onApplyTemplate(t)}>
              <div className={`tpl-thumb ${t.ratio === '9:16' ? 'vertical' : ''}`} style={{ background: t.bg, color: t.fg }}>
                <span>{t.label}</span>
                <em>{t.dur ? fmtDur(t.dur) : 'auto'}</em>
              </div>
              <div className="card-title">{t.name}{t.ratio ? ` · ${t.ratio}` : ''}</div>
            </div>
          ))}
        </div>
        <div className="hint" style={{ marginTop: 14 }}>Os modelos são inseridos no cursor e ficam totalmente editáveis. Créditos, Gancho e Slideshow usam keyframes.</div>
      </>);
      break;
    }
  }

  return (
    <aside className="left">
      <div className="top-tabs-wrap">
        <nav className="top-tabs" ref={tabsRef}>
          <span className="top-ind" style={ind ? { transform: `translateX(${ind.x}px)`, width: ind.w } : { opacity: 0 }} />
          {TOP_TABS.map((t) => (
            <button key={t.id} className={`top-tab ${tab === t.id ? 'active' : ''}`} onClick={() => switchTab(t.id)}>
              <Icon name={t.icon} size={18} />{t.label}
            </button>
          ))}
        </nav>
        <button className="tabs-scroll" title="Mais" onClick={() => tabsRef.current.scrollBy({ left: 220, behavior: 'smooth' })}><Icon name="chevronR" size={14} /></button>
      </div>
      <div className="left-body">
        <nav className="sidebar">
          {SIDEBARS[tab].map((s, i) => s.group
            ? <div key={'g' + i} className="side-group">{s.group}<Icon name="chevronD" size={12} /></div>
            : <button key={s.id} className={`side-item ${cat === s.id && !q ? 'active' : ''}`} onClick={() => vt(() => { setCat(s.id); setQuery(''); })}>{s.label}</button>)}
        </nav>
        <div className="panel-body" key={tab + cat}>
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => { onImport([...e.target.files]); e.target.value = ''; }} />
          {SEARCHABLE.includes(tab) && (
            <div className="search">
              <Icon name="search" size={14} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Buscar em ${TOP_TABS.find((t) => t.id === tab).label.toLowerCase()}`} />
              {query && <button className="icon-btn" onClick={() => setQuery('')}><Icon name="x" size={12} /></button>}
            </div>
          )}
          {body}
        </div>
      </div>
    </aside>
  );
}

function AdjustThumb({ preset }) {
  const ref = useRef();
  useEffect(() => {
    const { a, S } = sampleImages();
    const cv = ref.current;
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d');
    ctx.drawImage(a, 0, 0);
    const src = tmpCanvas('adjThumb', S, S);
    src.getContext('2d').drawImage(a, 0, 0);
    gradeCanvas(cv, { ...BASE_PROPS, ...preset.v }, S / 360);
  }, [preset]);
  return <canvas ref={ref} className="fx-thumb" />;
}

/* ---------- Legendas ---------- */
const parseTime = (s) => { const m = s.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000 : 0; };
const srtTime = (t) => { const ms = Math.round((t % 1) * 1000); t = Math.floor(t); return `${pad(Math.floor(t / 3600))}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)},${String(ms).padStart(3, '0')}`; };
function parseSrt(text) {
  return text.replace(/\r/g, '').split(/\n\s*\n/).map((block) => {
    const lines = block.trim().split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) return null;
    const [a, b] = lines[i].split('-->');
    return { start: parseTime(a), end: parseTime(b), text: lines.slice(i + 1).join('\n') };
  }).filter((x) => x && x.text && x.end > x.start);
}
const toSrt = (caps) => caps.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.start + c.duration)}\n${c.props.text}\n`).join('\n');

function CaptionsPanel({ cat, list, time, onAdd, onUpdate, onRemove, onSeek, onImport, onScript, onStyle, styleId, onAuto, selMedia }) {
  const [script, setScript] = useState('');
  const [cps, setCps] = useState(15);
  const srtRef = useRef();
  const download = () => {
    const blob = new Blob([toSrt(list)], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'legendas.srt';
    a.click();
  };
  if (cat === 'auto') return <AutoCaptions onAuto={onAuto} hasCaptions={list.length > 0} time={time} selMedia={selMedia} />;
  if (cat === 'styles') {
    return (<>
      <div className="panel-title">Estilo das legendas</div>
      <div className="card-grid">
        {CAPTION_STYLES.map((s) => (
          <Card key={s.id} title={s.name} active={styleId === s.id} onClick={() => onStyle(s)}>
            <span className="text-sample" style={{
              fontFamily: `"${s.style.fontFamily}"`, fontWeight: s.style.bold ? 700 : 400, fontSize: 15, color: s.style.color,
              background: s.style.bg || 'transparent', padding: s.style.bg ? '2px 6px' : 0, borderRadius: 4,
              WebkitTextStroke: s.style.stroke ? `1px ${s.style.strokeColor}` : undefined, textShadow: s.style.glow ? `0 0 8px ${s.style.glow}` : 'none',
            }}>Legenda</span>
          </Card>
        ))}
      </div>
      <div className="hint" style={{ marginTop: 12 }}>O estilo é aplicado a todas as legendas e às próximas que você criar.</div>
    </>);
  }
  if (cat === 'script') {
    return (<>
      <div className="panel-title">Legendas a partir do roteiro</div>
      <textarea className="textarea" style={{ minHeight: 160 }} value={script} onChange={(e) => setScript(e.target.value)}
        placeholder="Cole aqui o roteiro ou a fala do vídeo. Cada frase vira uma legenda, distribuída a partir do cursor." spellCheck={false} />
      <Slider label="Velocidade de leitura (caracteres/s)" value={cps} min={6} max={30} onChange={setCps} />
      <button className="btn btn-primary" disabled={!script.trim()} onClick={() => { onScript(script, cps); setScript(''); }}>
        <Icon name="wand" size={15} /> Gerar legendas no cursor
      </button>
    </>);
  }
  return (<>
    <div className="panel-title">Legendas
      <span className="kbd">{list.length} itens</span>
    </div>
    <div className="row" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
      <button className="btn" onClick={onAdd}><Icon name="plus" size={14} /> Adicionar</button>
      <button className="btn" onClick={() => srtRef.current.click()}><Icon name="upload" size={14} /> Importar .srt</button>
      <button className="btn" disabled={!list.length} onClick={download}><Icon name="download" size={14} /> .srt</button>
      <input ref={srtRef} type="file" accept=".srt,text/plain" hidden onChange={async (e) => {
        const f = e.target.files[0];
        e.target.value = '';
        if (f) onImport(parseSrt(await f.text()));
      }} />
    </div>
    {!list.length && <div className="hint">Nenhuma legenda ainda. Adicione no cursor, importe um arquivo .SRT ou gere a partir do roteiro.</div>}
    <div className="cap-list">
      {list.map((c) => {
        const on = time >= c.start && time < c.start + c.duration;
        return (
          <div key={c.id} className={`cap-row ${on ? 'on' : ''}`}>
            <button className="cap-time" onClick={() => onSeek(c.start)} title="Ir para">{fmt(c.start)}</button>
            <textarea className="cap-text" rows={1} value={c.props.text} onChange={(e) => onUpdate(c.id, e.target.value)} spellCheck={false} />
            <button className="icon-btn" title="Excluir" onClick={() => onRemove(c.id)}><Icon name="x" size={12} /></button>
          </div>
        );
      })}
    </div>
  </>);
}

/* ---------- Legendas automáticas (transcrição) ---------- */
function AutoCaptions({ onAuto, hasCaptions, time, selMedia }) {
  const [scope, setScope] = useState('all');   // all | playhead | clip
  const [lang, setLang] = useState('portuguese');
  const [model, setModel] = useState('rapido');
  const [lines, setLines] = useState(1);
  const [karaoke, setKaraoke] = useState(true);
  const [hlMode, setHlMode] = useState('box');
  const [hlColor, setHlColor] = useState('#ffd23f');
  const [replace, setReplace] = useState(true);
  const [job, setJob] = useState(null);   // { stage, p } enquanto roda
  const run = async () => {
    setJob({ stage: 'Começando…', p: 0 });
    try { await onAuto({ scope, lang, model, lines, karaoke, hlMode, hlColor, replace }, (stage, p) => setJob({ stage, p })); }
    finally { setJob(null); }
  };
  return (<>
    <div className="panel-title">Legendas automáticas</div>
    <div className="hint" style={{ marginBottom: 12 }}>
      A fala do projeto é transcrita aqui mesmo no navegador (nada é enviado para servidores). O modelo é baixado só na primeira vez.
    </div>
    <div className="field">
      <div className="field-top"><label>O que legendar</label></div>
      <div className="seg">
        <button className={scope === 'all' ? 'on' : ''} disabled={!!job} onClick={() => setScope('all')}>Tudo</button>
        <button className={scope === 'playhead' ? 'on' : ''} disabled={!!job} onClick={() => setScope('playhead')} title="Da linha vermelha da linha do tempo até o fim">Da agulha</button>
        <button className={scope === 'clip' ? 'on' : ''} disabled={!!job} onClick={() => setScope('clip')} title="Só o trecho do clipe selecionado na linha do tempo">Clipe selecionado</button>
      </div>
      <div className="hint" style={{ marginTop: 6 }}>
        {scope === 'all' && 'A fala da linha do tempo inteira.'}
        {scope === 'playhead' && `A partir de ${fmt(time)} (linha vermelha) até o fim.`}
        {scope === 'clip' && (selMedia
          ? `Só ${selMedia.count > 1 ? `os ${selMedia.count} clipes selecionados` : `“${selMedia.name}”`}: ${fmt(selMedia.start)} – ${fmt(selMedia.end)}.`
          : 'Selecione na linha do tempo o clipe de vídeo ou áudio que quer legendar.')}
      </div>
    </div>
    <div className="field">
      <div className="field-top"><label>Idioma falado</label></div>
      <select className="select" value={lang ?? ''} onChange={(e) => setLang(e.target.value || null)} disabled={!!job}>
        {ASR_LANGS.map(([id, name]) => <option key={name} value={id ?? ''}>{name}</option>)}
      </select>
    </div>
    <div className="field">
      <div className="field-top"><label>Modelo</label></div>
      <div className="seg">
        {Object.entries(ASR_MODELS).map(([k, m]) => (
          <button key={k} className={model === k ? 'on' : ''} disabled={!!job} onClick={() => setModel(k)} title={m.size}>{m.name}</button>
        ))}
      </div>
    </div>
    <div className="field">
      <div className="field-top"><label>Linhas por legenda</label></div>
      <div className="seg">
        {[1, 2].map((n) => <button key={n} className={lines === n ? 'on' : ''} disabled={!!job} onClick={() => setLines(n)}>{n}</button>)}
      </div>
    </div>
    <label className="check-row"><input type="checkbox" checked={karaoke} disabled={!!job} onChange={(e) => setKaraoke(e.target.checked)} /> Destacar a palavra falada</label>
    {karaoke && (
      <div className="row" style={{ gap: 8, margin: '6px 0 4px' }}>
        <div className="seg" style={{ flex: 1 }}>
          <button className={hlMode === 'box' ? 'on' : ''} onClick={() => setHlMode('box')}>Caixa</button>
          <button className={hlMode === 'color' ? 'on' : ''} onClick={() => setHlMode('color')}>Cor</button>
        </div>
        <input type="color" className="color" value={hlColor} onChange={(e) => setHlColor(e.target.value)} title="Cor do destaque" />
      </div>
    )}
    {hasCaptions && <label className="check-row"><input type="checkbox" checked={replace} disabled={!!job} onChange={(e) => setReplace(e.target.checked)} /> {scope === 'all' ? 'Substituir as legendas atuais' : 'Substituir as legendas deste trecho'}</label>}
    {job ? (
      <div style={{ marginTop: 12 }}>
        <div className="progress"><div style={{ width: `${Math.round(job.p * 100)}%` }} /></div>
        <div className="hint" style={{ marginTop: 6 }}>{job.stage}</div>
      </div>
    ) : (
      <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={run} disabled={scope === 'clip' && !selMedia}><Icon name="wand" size={15} /> Gerar legendas automáticas</button>
    )}
  </>);
}
