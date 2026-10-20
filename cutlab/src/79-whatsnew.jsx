/* =====================================================================
   Novidades e tutorial
   - Novidades: a cada versão nova (CHANGELOG[0]) a janela abre sozinha uma vez,
     listando o que entrou, melhorou, foi corrigido ou saiu. Menu › Novidades reabre.
   - Tutorial: um passeio guiado pelas partes principais do CutLab, destacando cada
     uma na tela. Abre sozinho na primeira visita; Menu › Tutorial rápido reabre.
   AO PUBLICAR: acrescente uma entrada no topo de CHANGELOG (id novo = aviso novo).
   AO LANÇAR O PROGRAMA (tag v*): marque a entrada mais nova com desktop: 'x.y.z'. As notas da versão
   no GitHub (que o programa mostra no aviso de atualização) são as entradas desde a marca anterior.
   ===================================================================== */
const CHANGELOG = [
  {
    id: '2026-10-20.1', date: '20/10/2026', title: 'Clipes acelerados lisos e proxies mais rápidos',
    items: [
      ['correção', 'Clipes com velocidade alterada (2×, 4×…) engasgavam e pulavam quadros: decodificavam o vídeo original, mesmo com o proxy pronto. Agora usam o proxy na prévia (a exportação continua com o original).'],
      ['melhoria', 'Em alta velocidade só os quadros que aparecem na tela são preparados, e o cache não descarta mais os quadros da frente antes de mostrá-los.'],
      ['melhoria', 'Os proxies são gerados bem mais rápido: o decodificador e o codificador da placa de vídeo trabalham sem pausas desnecessárias.'],
      ['correção', 'No programa para Windows, os proxies e a exportação quase paravam com a janela minimizada ou atrás de outra.'],
    ],
  },
  {
    id: '2026-10-18.6', date: '18/10/2026', desktop: '0.3.0', title: 'Janela de atalhos cabe na tela',
    items: [
      ['correção', 'A janela de atalhos de teclado passava da altura da tela; agora a lista rola por dentro e o botão Fechar fica sempre visível.'],
      ['melhoria', 'A lista de atalhos inclui os do editor de keyframes e o Delete da biblioteca.'],
    ],
  },
  {
    id: '2026-10-18.5', date: '18/10/2026', title: 'Editor de keyframes e Ctrl+Z confiável',
    items: [
      ['novo', 'Editor de keyframes (tecla G ou o botão de curva na barra da linha do tempo): uma linha por propriedade animada, com seleção múltipla, caixa de seleção, arrastar, clique duplo para criar e Animar propriedade.'],
      ['novo', 'Interpolação como no After Effects: Easy Ease (F9), suavizar entrada (Shift+F9), suavizar saída (Ctrl+Shift+F9), Linear, Congelar e Mola. O desenho do keyframe mostra a curva de cada lado.'],
      ['novo', 'Copiar e colar keyframes (Ctrl+C / Ctrl+V no cursor, até entre clipes), Ctrl+A seleciona todos, Alt+←/→ empurra um quadro, e campos para digitar tempo e valor exatos.'],
      ['novo', 'Modo Gráfico no mesmo editor: curva de valor × tempo com alças Bézier.'],
      ['melhoria', 'Os keyframes aparecem sempre nos clipes da linha do tempo, não só no clipe selecionado. Clique duplo num deles abre o editor.'],
      ['correção', 'Ctrl+Z não funcionava depois de mexer num slider (o foco ficava nele). Ajustes no mesmo controle em momentos diferentes viravam um passo só; agora cada um é desfeito separadamente.'],
      ['correção', 'Ocultar ou silenciar a camada 1 de uma faixa (ex.: Sobreposição 1) ocultava/silenciava todas as camadas daquela faixa.'],
    ],
  },
  {
    id: '2026-10-18.4', date: '18/10/2026', title: 'Excluir mídias da biblioteca',
    items: [
      ['correção', 'O selo PROXY cobria o X de excluir nos vídeos importados; agora fica embaixo da duração.'],
      ['novo', 'Selecione mídias na biblioteca com um clique (Ctrl soma, Shift pega um intervalo) e aperte Delete para excluí-las.'],
      ['novo', 'Antes de excluir, uma janela pede confirmação e avisa quantos clipes da linha do tempo usam aqueles itens.'],
    ],
  },
  {
    id: '2026-10-18.3', date: '18/10/2026', desktop: '0.2.0', title: 'Camadas em ordem, agulha com cabeça e novidades',
    items: [
      ['novo', 'Arraste o cabeçalho de uma camada para mudar a ordem. Acima da Principal ficam sobreposições, textos, legendas e efeitos; abaixo, o Áudio. A Principal não se move.'],
      ['novo', 'Um efeito ou camada de ajuste vale para tudo o que está abaixo dele: coloque-o entre as camadas para afetar só as de baixo.'],
      ['novo', 'A agulha da linha do tempo ganhou uma cabeça na régua, sempre visível.'],
      ['novo', 'Arrastando a agulha (ou um clipe) até a borda, a linha do tempo rola sozinha: quanto mais longe você leva o mouse, mais rápido, até um limite.'],
      ['novo', 'Esta janela de novidades e um tutorial rápido (Menu › Tutorial rápido).'],
    ],
  },
  {
    id: '2026-10-18.2', date: '18/10/2026', title: 'Barra de espaço, réguas e menu mais limpo',
    items: [
      ['correção', 'Espaço toca/pausa sempre, mesmo com um botão ou slider focado. Só não toca enquanto você digita; Enter, Esc ou um clique fora encerram a edição.'],
      ['correção', 'As réguas do reprodutor estavam ~5% menores que a tela e as marcas não batiam com o quadro.'],
      ['melhoria', 'Seta para a esquerda nas abas do painel esquerdo.'],
      ['melhoria', 'Nome do projeto centralizado na barra de cima.'],
      ['removido', 'Itens de edição com atalho saíram do Menu; estão todos em Menu › Atalhos de teclado.'],
      ['removido', 'Proporção da tela e lista de atalhos saíram do painel Projeto (a proporção fica no reprodutor).'],
    ],
  },
  {
    id: '2026-10-18.1', date: '18/10/2026', desktop: '0.1.0', title: 'Programa para Windows e reprodução mais leve',
    items: [
      ['novo', 'CutLab para Windows (.exe), com aviso de atualização dentro do programa.'],
      ['novo', 'Proxies de prévia para vídeos pesados, gerados só dos trechos usados.'],
      ['novo', 'Diagnóstico de reprodução (Ctrl+Shift+D).'],
      ['melhoria', 'A música vira o relógio da reprodução: sem pulos no áudio nos cortes.'],
      ['melhoria', 'Cortes entre clipes sem congelar e prévia em resolução reduzida, como no CapCut.'],
    ],
  },
];
const CHANGE_KINDS = {
  novo: { label: 'Novo' },
  melhoria: { label: 'Melhoria' },
  correção: { label: 'Correção' },
  removido: { label: 'Removido' },
};

const SEEN_KEY = 'cutlab.changelogSeen';
const openWhatsNew = () => window.dispatchEvent(new Event('cutlab-whatsnew'));
const openTour = () => window.dispatchEvent(new Event('cutlab-tour'));
const storeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const storeSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

/** abre sozinho o que for preciso ao carregar: tutorial na primeira visita, novidades quando há versão nova */
function Onboarding() {
  const [news, setNews] = useState(false);
  const [tour, setTour] = useState(false);
  useEffect(() => {
    const seen = storeGet(SEEN_KEY), latest = CHANGELOG[0].id;
    if (!seen) setTour(true);
    else if (seen !== latest) setNews(true);
    storeSet(SEEN_KEY, latest);
    const n = () => setNews(true), t = () => { setNews(false); setTour(true); };
    window.addEventListener('cutlab-whatsnew', n);
    window.addEventListener('cutlab-tour', t);
    return () => { window.removeEventListener('cutlab-whatsnew', n); window.removeEventListener('cutlab-tour', t); };
  }, []);
  return (<>
    {news && <WhatsNew onClose={() => setNews(false)} />}
    {tour && <Tour onClose={() => setTour(false)} />}
  </>);
}

function WhatsNew({ onClose }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal news-modal">
        <div className="news-head"><Icon name="sparkles" size={18} /><h2>Novidades do CutLab</h2></div>
        <div className="news-list">
          {CHANGELOG.map((v, i) => (
            <section key={v.id} className={`news-ver ${i === 0 ? 'latest' : ''}`}>
              <div className="news-title"><b>{v.title}</b><span>{v.date}{i === 0 ? ' · mais recente' : ''}</span></div>
              <ul>
                {v.items.map(([kind, text], j) => (
                  <li key={j}><span className={`news-tag ${kind}`}>{CHANGE_KINDS[kind]?.label ?? kind}</span><span>{text}</span></li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="actions">
          <button className="btn" onClick={openTour}>Ver tutorial rápido</button>
          <button className="btn btn-primary" onClick={onClose}>Entendi</button>
        </div>
      </div>
    </div>
  );
}

/* passos do tutorial: `sel` é a parte da tela destacada (sem ela, o cartão fica no centro) */
const TOUR = [
  { title: 'Bem-vindo ao CutLab', text: 'Um editor de vídeo que roda inteiro no seu computador: seus arquivos não saem daqui. Em um minuto você conhece as partes principais. Use as setas do teclado ou os botões para navegar.' },
  { sel: '.left', title: 'Biblioteca', text: 'Importe vídeos, fotos e músicas em Mídia. As outras abas trazem áudio, textos, stickers, efeitos, transições, legendas automáticas e filtros: arraste qualquer item para a linha do tempo ou clique para adicionar no cursor.' },
  { sel: '.player', title: 'Reprodutor', text: 'Mostra o quadro da agulha. Clique num item para movê-lo e redimensioná-lo direto na tela. Em cima você troca a proporção (16:9, 9:16…); embaixo, a qualidade da prévia, o zoom e as réguas (Shift+R).' },
  { sel: '.tl-toolbar', title: 'Ferramentas de edição', text: 'Dividir no cursor (C), lâmina (B), excluir à esquerda/direita (Q/W), congelar quadro, keyframes (K), marcadores (M) e agrupar. À direita ficam o ímã, o encaixe automático, a vinculação e o zoom da linha do tempo.' },
  { sel: '.tl-scroll', title: 'Linha do tempo', text: 'A Principal é a base do vídeo. Acima dela ficam sobreposições, textos e efeitos; abaixo, o áudio. Arraste a agulha pela régua — perto das bordas a linha do tempo rola sozinha. Espaço toca e pausa.' },
  { sel: '.ae-head.movable', title: 'Camadas', text: 'Arraste o cabeçalho de uma camada para mudar a ordem. Aqui também ficam olho, som, solo e cadeado, a cor do rótulo, o fosco de trilha (TrkMat) e o vínculo (Pai), como no After Effects. A setinha abre as propriedades com keyframes.' },
  { sel: '.inspector', title: 'Propriedades', text: 'Com um clipe selecionado, este painel mostra tudo dele: transformação, animação, cor, máscara, velocidade, áudio e mais. Sem seleção, mostra o resumo do projeto.' },
  { sel: '.topbar .btn-primary', title: 'Exportar', text: 'Quando terminar, exporte o vídeo em MP4 ou WebM (Ctrl+E). O projeto é salvo sozinho neste navegador.' },
  { sel: '.menu-btn', title: 'Menu', text: 'Salvar e abrir projetos, importar mídia, a lista de atalhos de teclado, as novidades de cada versão e este tutorial, sempre que quiser rever.' },
];

function Tour({ onClose }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null);
  const step = TOUR[i], last = i === TOUR.length - 1;
  const go = (d) => setI((v) => clamp(v + d, 0, TOUR.length - 1));
  // acompanha a posição da parte destacada (a janela pode mudar de tamanho)
  useLayoutEffect(() => {
    const measure = () => {
      const el = step.sel && document.querySelector(step.sel);
      const r = el?.getBoundingClientRect();
      setRect(r && r.width ? { x: r.left, y: r.top, w: r.width, h: r.height } : null);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [i]);
  useEffect(() => {
    const k = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); last ? onClose() : go(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [i]);
  // cartão ao lado da área destacada, onde couber; sem área, no centro
  const CW = 340, vw = window.innerWidth, vh = window.innerHeight, M = 14;
  let pos = { left: (vw - CW) / 2, top: vh / 2 - 110 };
  if (rect) {
    const roomR = vw - (rect.x + rect.w), roomL = rect.x, roomB = vh - (rect.y + rect.h);
    if (roomR >= CW + 2 * M) pos = { left: rect.x + rect.w + M, top: rect.y + 8 };
    else if (roomL >= CW + 2 * M) pos = { left: rect.x - CW - M, top: rect.y + 8 };
    else if (roomB >= 230) pos = { left: rect.x + rect.w / 2 - CW / 2, top: rect.y + rect.h + M };
    else pos = { left: rect.x + rect.w / 2 - CW / 2, top: rect.y - 230 - M };
    pos.left = clamp(pos.left, M, vw - CW - M);
    pos.top = clamp(pos.top, M, vh - 240);
  }
  return (
    <div className="tour-back" onPointerDown={(e) => e.target === e.currentTarget && e.preventDefault()}>
      {rect ? <div className="tour-spot" style={{ left: rect.x - 6, top: rect.y - 6, width: rect.w + 12, height: rect.h + 12 }} />
        : <div className="tour-dim" />}
      <div className="tour-card" style={{ ...pos, width: CW }} key={i}>
        <div className="tour-step">{i + 1} de {TOUR.length}</div>
        <h3>{step.title}</h3>
        <p>{step.text}</p>
        <div className="tour-dots">{TOUR.map((_, j) => <button key={j} className={j === i ? 'on' : ''} onClick={() => setI(j)} aria-label={`Passo ${j + 1}`} />)}</div>
        <div className="tour-actions">
          <button className="btn" onClick={onClose}>Pular</button>
          <div className="spacer" />
          {i > 0 && <button className="btn" onClick={() => go(-1)}>Voltar</button>}
          <button className="btn btn-primary" onClick={() => (last ? onClose() : go(1))}>{last ? 'Começar a editar' : 'Próximo'}</button>
        </div>
      </div>
    </div>
  );
}
