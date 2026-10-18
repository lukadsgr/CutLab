/* =====================================================================
   Modelos prontos
   build({ make, assets, t0 }) → { clips, ratio? }
   make(type, start, duration, props, opts) cria um clipe com início absoluto
   ===================================================================== */
const TEMPLATES = [
  { id: 'intro-neon', name: 'Intro neon', cat: 'Intro', dur: 5, bg: 'linear-gradient(135deg,#0b0b1a,#1d1240)', fg: '#c9fffb', label: 'NEON',
    build: ({ make, t0 }) => ({ clips: [
      make('color', t0, 5, { color: '#0b0b1a' }),
      make('text', t0 + 0.2, 4.8, { text: 'SEU CANAL', fontFamily: 'Montserrat', fontSize: 96, color: '#e9fffd', glow: '#1fd6cb', shadow: false, animIn: 'zoomIn', fadeOut: 0.5 }),
      make('text', t0 + 1, 4, { text: 'novo vídeo toda semana', fontSize: 30, bold: false, color: '#9fe8ff', shadow: false, y: 22, animIn: 'type', fadeOut: 0.5 }),
      make('effect', t0, 5, { effect: 'bokeh', intensity: 80 }),
    ] }) },
  { id: 'countdown', name: 'Contagem', cat: 'Intro', dur: 4, bg: 'linear-gradient(135deg,#ff4d8d,#7b5cff)', fg: '#fff', label: '3·2·1',
    build: ({ make, t0 }) => {
      const cols = ['#ff4d8d', '#7b5cff', '#4f8cff', '#1fd6cb'];
      const clips = [];
      ['3', '2', '1', 'VAMOS!'].forEach((txt, i) => {
        const bg = make('color', t0 + i, 1, { color: cols[i] });
        if (i > 0) bg.transition = { type: 'zoomout', duration: 0.4 };
        clips.push(bg, make('text', t0 + i, 1, { text: txt, fontFamily: 'Anton', fontSize: i < 3 ? 260 : 150, bold: false, animIn: 'pop' }));
      });
      clips.push(make('effect', t0 + 3, 1, { effect: 'shake', intensity: 70 }));
      return { clips };
    } },
  { id: 'chapter', name: 'Capítulo', cat: 'Vídeo', dur: 5, bg: 'linear-gradient(135deg,#111,#2d2d2d)', fg: '#fff', label: 'Capítulo 1',
    build: ({ make, t0 }) => ({ clips: [
      make('color', t0, 5, { color: '#111114' }),
      make('text', t0 + 0.3, 4.4, { text: 'CAPÍTULO 1', fontFamily: 'Bebas Neue', fontSize: 120, bold: false, y: -8, animIn: 'slideU', fadeOut: 0.6 }),
      make('text', t0 + 1.1, 3.6, { text: 'O começo de tudo', fontFamily: 'Playfair Display', italic: true, bold: false, fontSize: 40, y: 20, color: '#d8d8e0', animIn: 'type', fadeOut: 0.6 }),
      make('effect', t0, 5, { effect: 'bars', intensity: 100 }),
      make('effect', t0, 5, { effect: 'grain', intensity: 40 }),
    ] }) },
  { id: 'credits', name: 'Créditos finais', cat: 'Vídeo', dur: 8, bg: 'linear-gradient(180deg,#000,#1a1a24)', fg: '#ddd', label: 'Créditos',
    build: ({ make, t0 }) => {
      const roll = make('text', t0, 8, {
        text: 'DIREÇÃO\nSeu Nome\n\nEDIÇÃO\nCutLab\n\nMÚSICA\nTrilha original\n\nObrigado por assistir!',
        fontSize: 36, bold: false, color: '#ffffff', shadow: false,
      });
      // keyframes: o bloco de texto sobe pela tela
      roll.keyframes = { y: [{ t: 0, v: 140, ease: 'linear' }, { t: 8, v: -140, ease: 'linear' }] };
      return { clips: [make('color', t0, 8, { color: '#000000' }), roll] };
    } },
  { id: 'story', name: 'Story vertical', cat: 'Social', dur: 6, bg: 'linear-gradient(160deg,#ff9a5a,#e2557d)', fg: '#fff', label: 'STORY', ratio: '9:16',
    build: ({ make, t0 }) => ({ ratio: '9:16', clips: [
      make('color', t0, 6, { color: '#e2557d' }),
      make('text', t0 + 0.2, 5.8, { text: 'NOVIDADE', fontFamily: 'Anton', fontSize: 120, bold: false, y: -55, animIn: 'pop' }),
      make('text', t0 + 0.8, 5.2, { text: 'arraste para cima', fontSize: 34, color: '#111', bg: '#ffe14d', shadow: false, y: 60, animIn: 'slideU' }),
      make('text', t0 + 1.2, 4.8, { text: '🔥', fontSize: 200, shadow: false, bold: false, animIn: 'pop' }, { name: 'Sticker' }),
      make('effect', t0, 6, { effect: 'confetti', intensity: 60 }),
    ] }) },
  { id: 'reels-hook', name: 'Gancho Reels', cat: 'Social', dur: 3, bg: 'linear-gradient(160deg,#111,#3b1c4a)', fg: '#ffe14d', label: 'ESPERA!', ratio: '9:16',
    build: ({ make, t0 }) => {
      const t = make('text', t0, 3, { text: 'ESPERA\nATÉ O FIM 👀', fontFamily: 'Anton', fontSize: 100, bold: false, color: '#ffe14d', stroke: 6, strokeColor: '#000' });
      t.keyframes = { scale: [{ t: 0, v: 70, ease: 'out' }, { t: 0.4, v: 110, ease: 'smooth' }, { t: 3, v: 100, ease: 'linear' }], rotation: [{ t: 0, v: -8, ease: 'out' }, { t: 0.4, v: 3, ease: 'smooth' }, { t: 1, v: 0, ease: 'linear' }] };
      return { ratio: '9:16', clips: [make('color', t0, 3, { color: '#3b1c4a' }), t, make('effect', t0, 0.5, { effect: 'flash', intensity: 90 })] };
    } },
  { id: 'slideshow', name: 'Slideshow', cat: 'Vídeo', dur: 0, bg: 'linear-gradient(135deg,#ff2d46,#3a0610)', fg: '#fff', label: 'Fotos', needsMedia: true,
    build: ({ make, t0, assets }) => {
      const vis = assets.filter((a) => a.type === 'image' || a.type === 'video').filter((a) => !a.loading && !a.error);
      if (!vis.length) return { error: 'Importe fotos ou vídeos na aba Mídia para usar este modelo.' };
      let t = t0;
      const clips = vis.map((a, i) => {
        const d = a.type === 'image' ? 3 : Math.min(a.duration, 5);
        const c = make(a.type, t, d, {}, { assetId: a.id, name: a.name });
        // efeito Ken Burns com keyframes de escala e posição
        c.keyframes = { scale: [{ t: 0, v: 100, ease: 'linear' }, { t: d, v: 118, ease: 'linear' }], x: [{ t: 0, v: i % 2 ? -4 : 4, ease: 'linear' }, { t: d, v: i % 2 ? 4 : -4, ease: 'linear' }] };
        if (i > 0) c.transition = { type: 'mix', duration: 0.6 };
        t += d;
        return c;
      });
      return { clips: [...clips, make('effect', t0, t - t0, { effect: 'vignette', intensity: 50 })] };
    } },
];
