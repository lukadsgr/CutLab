/* =====================================================================
   Motor de renderização / reprodução
   ===================================================================== */
const ANIM_T = 0.5;
/** texto feito só de emojis (stickers) */
const EMOJI_ONLY = /^[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️\s]+$/u;
const isSticker = (p) => !p.bg && EMOJI_ONLY.test(p.text || '');

/*
 * Stickers são desenhados como imagem, não como fonte: em várias GPUs o Chrome/Opera
 * para de aumentar o emoji do sistema acima de ~250px ou o desenha como um borrão
 * que cobre o quadro. Twemoji em SVG fica nítido em qualquer tamanho; enquanto
 * carrega (ou sem internet) usamos um bitmap pequeno ampliado, que não sofre do bug.
 */
const TWEMOJI = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg/';
const graphemes = (s) => (Intl.Segmenter ? [...new Intl.Segmenter().segment(s)].map((g) => g.segment) : [...s]);
function emojiUrl(e) {
  const cps = [...e].map((ch) => ch.codePointAt(0).toString(16));
  return `${TWEMOJI}${(e.includes('‍') ? cps : cps.filter((c) => c !== 'fe0f')).join('-')}.svg`;
}
const EMOJI_IMG = new Map();
function emojiImage(e) {
  let r = EMOJI_IMG.get(e);
  if (!r) {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // sem isso o canvas fica "sujo" e a exportação falha
    r = { img, ok: false, done: null };
    r.done = new Promise((res) => { img.onload = () => { r.ok = true; res(); }; img.onerror = () => res(); });
    img.src = emojiUrl(e);
    EMOJI_IMG.set(e, r);
  }
  return r;
}
const EMOJI_BMP = new Map();
function emojiBitmap(e) {
  let cv = EMOJI_BMP.get(e);
  if (!cv) {
    const S = 128;
    cv = document.createElement('canvas');
    cv.width = cv.height = S * 1.25;
    const x = cv.getContext('2d');
    x.font = `${S}px sans-serif`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(e, cv.width / 2, cv.height / 2 + S * 0.06);
    EMOJI_BMP.set(e, cv);
  }
  return cv;
}
/** espera as imagens dos stickers (exportação offline desenha cada quadro uma vez só) */
function preloadStickers(clips) {
  const out = [];
  const walk = (cs) => cs.forEach((c) => {
    if (c.children) walk(c.children);
    if (c.type === 'text' && isSticker(c.props || {})) for (const e of graphemes(c.props.text).filter((g) => g.trim())) out.push(emojiImage(e).done);
  });
  walk(clips);
  return Promise.race([Promise.all(out), new Promise((r) => setTimeout(r, 8000))]);
}
/** desenha o sticker centrado na origem; devolve a caixa [w, h] */
function drawSticker(ctx, p, size) {
  const rows = (p.text || '').split('\n').map((l) => graphemes(l).filter((g) => g.trim()));
  const cell = size * 1.05;
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const w = cols * cell, h = rows.length * cell;
  rows.forEach((row, ri) => row.forEach((e, ci) => {
    const x = -row.length * cell / 2 + ci * cell, y = -h / 2 + ri * cell;
    const r = emojiImage(e);
    if (r.ok) ctx.drawImage(r.img, x + cell * 0.04, y + cell * 0.04, cell * 0.92, cell * 0.92);
    else ctx.drawImage(emojiBitmap(e), x - cell * 0.1, y - cell * 0.1, cell * 1.2, cell * 1.2);
  }));
  return [w, h];
}
const easeBack = (p) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); };

function fadeFactor(c, t) {
  const p = c.props;
  let f = 1;
  if (p.fadeIn > 0) f = Math.min(f, (t - c.start) / p.fadeIn);
  if (p.fadeOut > 0) f = Math.min(f, (c.start + c.duration - t) / p.fadeOut);
  return clamp(f, 0, 1);
}
const fit = (sw, sh, W, H) => { const r = Math.min(W / sw, H / sh); return [sw * r, sh * r]; };

/** pares de clipes encostados na mesma linha e ligados por transição (a transição fica no clipe B, no início dele) */
const canTransition = (c) => c.type !== 'audio' && c.type !== 'effect' && c.type !== 'adjust';
function transitionPairs(clips) {
  const rows = new Map();
  for (const c of clips) if (canTransition(c)) { const k = clipRow(c); if (!rows.has(k)) rows.set(k, []); rows.get(k).push(c); }
  const out = [];
  for (const [row, list] of rows) for (const B of list) {
    if (!B.transition) continue;
    const A = list.find((a) => a !== B && Math.abs(a.start + a.duration - B.start) < 0.05);
    if (!A) continue;
    const d = Math.min(B.transition.duration, A.duration, B.duration);
    out.push({ A, B, row, type: B.transition.type, d, from: B.start - d / 2, to: B.start + d / 2 });
  }
  return out;
}

class Engine {
  constructor() {
    this.media = new Map();
    this.images = new Map();
    this.erase = new Map();
    this.hold = new Map();    // último quadro bom de cada vídeo (mostrado durante buscas)
    this.frames = new Map();  // quadros recentes para interpolação em câmera lenta
    this.rates = new Map();   // taxa atual e estado de reprodução por clipe
    this.sources = new Map(); // FrameSource (WebCodecs) por arquivo de vídeo
    this.t = 0;
    this.gains = new Map();
    this.ac = null;
    this.dest = null;
    this._pc = null;
    this._pairs = [];
  }
  pairs(clips) {
    if (clips !== this._pc) { this._pc = clips; this._pairs = transitionPairs(clips); }
    return this._pairs;
  }
  ensureAudio() {
    if (!this.ac) {
      this.ac = new (window.AudioContext || window.webkitAudioContext)();
      this.dest = this.ac.createMediaStreamDestination();
      // silêncio contínuo: sem nenhum som tocando, a faixa de áudio fica sem amostras e o
      // gravador MP4 descarta o vídeo à espera delas (a exportação saía só com o final)
      const hum = this.ac.createConstantSource();
      hum.offset.value = 0;
      hum.connect(this.dest);
      hum.start();
      for (const [id, el] of this.media) this.attach(id, el);
    }
    if (this.ac.state === 'suspended') this.ac.resume();
  }
  attach(id, el) {
    try {
      const src = this.ac.createMediaElementSource(el);
      const g = this.ac.createGain();
      src.connect(g);
      g.connect(this.ac.destination);
      g.connect(this.dest);
      this.gains.set(id, g);
    } catch (e) { /* elemento já conectado */ }
  }
  getMedia(clip, asset) {
    let el = this.media.get(clip.id);
    if (!el) {
      el = document.createElement(asset.type === 'audio' ? 'audio' : 'video');
      el.preload = 'auto';
      el.playsInline = true;
      el.src = asset.url;
      this.media.set(clip.id, el);
      if (this.ac) this.attach(clip.id, el);
      if (el.tagName === 'VIDEO') this.watchFrames(clip.id, el);
    }
    return el;
  }
  getImage(asset) {
    let img = this.images.get(asset.id);
    if (!img) { img = new Image(); img.src = asset.url; this.images.set(asset.id, img); }
    return img;
  }
  prune(clips) {
    const ids = allClipIds(clips);
    for (const [id, el] of this.media) {
      if (ids.has(id)) continue;
      el.pause();
      el.removeAttribute('src');
      el.load();
      this.media.delete(id);
      this.hold.delete(id);
      this.frames.delete(id);
      this.rates.delete(id);
      const g = this.gains.get(id);
      if (g) { g.disconnect(); this.gains.delete(id); }
    }
  }
  setVolume(id, el, v) {
    const g = this.gains.get(id);
    if (g) { g.gain.value = v; if (el.volume !== 1) el.volume = 1; }
    else el.volume = clamp(v, 0, 1);
  }
  sync(t, playing, clips0, assetMap, trackState) {
    // compostos: os clipes de mídia de dentro deles entram com tempo absoluto
    if (clips0 !== this._sIn || trackState !== this._sTs) { this._sIn = clips0; this._sTs = trackState; this._sOut = clips0.some(isCompound) ? expandMedia(clips0, trackState) : clips0; }
    const clips = this._sOut;
    const pairs = this.pairs(clips);
    // elementos comandados neste quadro: qualquer outro é pausado no fim (ver abaixo)
    const driven = this._driven || (this._driven = new Set());
    driven.clear();
    for (const c of clips) {
      if (!isMedia(c)) continue;
      // id repetido: um elemento só pode seguir um clipe (dois comandos brigariam a cada quadro)
      if (driven.has(c.id)) continue;
      const a = assetMap[c.assetId];
      if (!a || a.loading) continue;
      const el = this.getMedia(c, a);
      driven.add(c.id);
      const end = c.start + c.duration;
      let state = null;
      const inWin = !c._win || (t >= c._win[0] && t < c._win[1]);
      if (t >= c.start && t < end && inWin) state = { src: srcTimeAt(c, t - c.start), play: playing, active: true, rate: rateAt(c, t - c.start) };
      else for (const p of pairs) {
        if (p.A === c && t >= end && t < p.to) state = { src: srcTimeAt(c, c.duration - FRAME), play: false };
        if (p.B === c && t < c.start && t >= p.from) state = { src: c.in, play: false };
      }
      if (state) {
        const rate = clamp(state.rate || c.speed, 0.0625, 16);
        this.rates.set(c.id, { rate, playing: !!state.play });
        const muted = (c._sub ? c._muted : trackState[c.track]?.muted || trackState[clipRow(c)]?.muted || (soloOn(trackState) && !trackState[clipRow(c)]?.solo)) || !state.active;
        const vol = propAt(c, 'volume', clamp(t - c.start, 0, c.duration));
        this.setVolume(c.id, el, muted ? 0 : (vol / 100) * audioFade(c, t) * (c._gain ?? 1));
        if (state.play) {
          if (el.paused) {
            this.seek(c.id, el, state.src);
            el.playbackRate = rate;
            el.play().catch(() => {});
          } else if (!el.seeking) {
            // erro positivo = vídeo atrasado em relação à linha do tempo
            const err = state.src - el.currentTime;
            const fast = rate > 2;
            if (Math.abs(err) > (fast ? rate * 0.6 : 0.3)) {
              // salto grande (travada, decodificador que não acompanha 10×): busca um pouco à frente
              this.seek(c.id, el, state.src + Math.min(0.3, rate * 0.05));
              el.playbackRate = rate;
            } else if (Math.abs(err) < 0.03) {
              // sincronizado: velocidade exata. Mudar a velocidade estica o som (preservesPitch)
              // e, mantida, soa como eco/voz dobrada — então só corrige quando precisa
              if (el.playbackRate !== rate) el.playbackRate = rate;
            } else {
              // fora do tom (30 ms ou mais): ajuste pequeno, no máximo 4% (inaudível), até alcançar
              const target = clamp(rate * (1 + clamp(err * 0.5, fast ? -0.3 : -0.04, fast ? 0.3 : 0.04)), 0.0625, 16);
              if (Math.abs(el.playbackRate - target) > rate * 0.005) el.playbackRate = target;
            }
          }
        } else {
          if (!el.paused) el.pause();
          if (!el.seeking && Math.abs(el.currentTime - state.src) > 0.03) this.seek(c.id, el, state.src);
        }
      } else {
        if (!el.paused) el.pause();
        // pré-posiciona o próximo clipe para evitar quadro preto
        if (c.start > t && c.start - t < 1.5 && !el.seeking && Math.abs(el.currentTime - c.in) > 0.05) el.currentTime = c.in;
      }
    }
    // nenhum elemento toca sem comando: clipes de outro nível (composto aberto), mídia
    // recarregando ou clipes que acabaram de sair da linha do tempo ficariam tocando sozinhos,
    // somando-se ao som atual (áudio "duplicado")
    for (const [id, el] of this.media) {
      if (driven.has(id) || el.paused) continue;
      el.pause();
      this.rates.delete(id);
    }
  }
  render(ctx, W, H, t, clips, assetMap, trackState, nested = false) {
    this.t = t;
    if (nested) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H); ctx.restore(); } else clearBlack(ctx, W, H);
    this._r = { W, H, assetMap };
    const k = Math.min(W, H) / 720;
    const boxes = [];
    // camadas de baixo para cima; linhas ocultas ficam de fora
    const at = (tid) => clips.filter((c) => c.track === tid && t >= c.start && t < c.start + c.duration && !trackState[clipRow(c)]?.hidden)
      .sort((a, b) => laneOf(a) - laneOf(b) || a.start - b.start);

    if (!trackState.main?.hidden && (!soloOn(trackState) || trackState.main?.solo)) {
      const tr = this.pairs(clips).find((p) => p.row === 'main' && t >= p.from && t < p.to);
      let list = at('main');
      if (tr) {
        const p = (t - tr.from) / (tr.to - tr.from);
        const A = tmpCanvas('trA', W, H), B = tmpCanvas('trB', W, H);
        for (const [cv, clip, tc] of [[A, tr.A, Math.min(t, tr.A.start + tr.A.duration - 1e-3)], [B, tr.B, Math.max(t, tr.B.start)]]) {
          const x = cv.getContext('2d');
          clearBlack(x, W, H);
          this.drawClip(x, clip, assetMap[clip.assetId], tc, W, H, k);
        }
        ctx.save();
        (TRANSITION_MAP[tr.type] || TRANSITIONS[0]).fn(ctx, A, B, p, W, H, tr.d);
        ctx.restore();
        list = list.filter((c) => c !== tr.A && c !== tr.B);
      }
      for (const c of list) boxes.push(this.drawClip(ctx, c, assetMap[c.assetId], t, W, H, k));
    }
    this.renderLayers(ctx, W, H, t, clips, assetMap, trackState, k, boxes);
    if (!trackState.effect?.hidden) {
      for (const c of at('effect')) {
        const src = tmpCanvas('fxSrc', W, H);
        const sx = src.getContext('2d');
        sx.globalCompositeOperation = 'source-over';
        sx.drawImage(ctx.canvas, 0, 0);
        const local = t - c.start;
        const p = resolveProps(c, local);
        const f = fadeFactor(c, t);
        ctx.save();
        if (c.type === 'effect') EFFECT_MAP[p.effect]?.fn(ctx, src, W, H, local * p.fxSpeed, (p.intensity / 100) * f, k);
        else {
          // camada de ajuste: correção de cor completa sobre o quadro inteiro
          const G = copyTo('adjG', src);
          gradeCanvas(G, p, k, local);
          if (p.brightness !== 100 || p.contrast !== 100 || p.saturation !== 100 || p.hue || p.sepia || p.blur) {
            const G2 = copyTo('adjG2', G), gx = G.getContext('2d');
            gx.save(); gx.filter = filterCss(p, k); gx.globalCompositeOperation = 'copy'; gx.drawImage(G2, 0, 0); gx.restore();
          }
          ctx.globalAlpha = f;
          ctx.drawImage(G, 0, 0);
        }
        ctx.restore();
      }
    }
    return boxes;
  }
  /**
   * desfoque de movimento pela animação: o clipe é desenhado uma vez num canvas próprio e
   * repetido ao longo do caminho que ele percorre durante o obturador (keyframes, animações, wiggle).
   */
  drawClip(ctx, c, a, t, W, H, k, pm = null) {
    const amt = (c.keyframes?.animBlur ? propAt(c, 'animBlur', t - c.start) : c.props.animBlur) || 0;
    const span = (clamp(amt, 0, 100) / 100) / (this.outFps || FPS);   // 50 = obturador de 180°
    if (span <= 0) return this.drawClipOnce(ctx, c, a, t, W, H, k, pm);
    // caminho do clipe em unidades de altura: amostras da matriz dentro da janela do obturador
    const U = (tt) => clipMatrixU(c, clamp(tt, c.start, c.start + c.duration - 1e-4), W, H);
    const U0 = U(t - span / 2), U1 = U(t + span / 2), hw = W / H / 2;
    let moved = 0;
    for (const [x, y] of [[-hw, -0.5], [hw, -0.5], [hw, 0.5], [-hw, 0.5]]) {
      const q0 = U0.transformPoint({ x, y }), q1 = U1.transformPoint({ x, y });
      moved = Math.max(moved, Math.hypot(q1.x - q0.x, q1.y - q0.y) * H);
    }
    if (moved < 1) return this.drawClipOnce(ctx, c, a, t, W, H, k, pm);
    const Ut = U(t);
    const det = Ut.a * Ut.d - Ut.b * Ut.c;
    if (!(Math.abs(det) > 1e-9)) return this.drawClipOnce(ctx, c, a, t, W, H, k, pm);
    const L = tmpCanvas('mbL', W, H), A = tmpCanvas('mbA', W, H);
    const lx = L.getContext('2d'), ax = A.getContext('2d');
    lx.setTransform(1, 0, 0, 1, 0, 0); lx.clearRect(0, 0, W, H);
    const box = this.drawClipOnce(lx, c, a, t, W, H, k, pm, true);
    // cada amostra = deslocamento entre a pose no instante dela e a pose desenhada (em px, já com o pai)
    const n = clamp(Math.ceil(moved / 2.5), 3, 32);
    const toPx = new DOMMatrix().scale(H), fromPx = new DOMMatrix().scale(1 / H), inv = Ut.inverse();
    const P = pm ? new DOMMatrix([pm.a, pm.b, pm.c, pm.d, pm.e, pm.f]) : null;
    ax.setTransform(1, 0, 0, 1, 0, 0); ax.clearRect(0, 0, W, H);
    ax.globalCompositeOperation = 'lighter';   // soma das amostras = média exata (alfa pré-multiplicado)
    ax.globalAlpha = 1 / n;
    for (let i = 0; i < n; i++) {
      let D = toPx.multiply(U(t - span / 2 + (span * i) / (n - 1))).multiply(inv).multiply(fromPx);
      if (P) D = P.multiply(D).multiply(P.inverse());
      ax.setTransform(D.a, D.b, D.c, D.d, D.e, D.f);
      ax.drawImage(L, 0, 0);
    }
    ax.setTransform(1, 0, 0, 1, 0, 0); ax.globalAlpha = 1; ax.globalCompositeOperation = 'source-over';
    const p = resolveProps(c, clamp(t - c.start, 0, c.duration));
    ctx.save();
    ctx.globalCompositeOperation = p.blendOn ? BLEND_OP[p.blend] || 'source-over' : 'source-over';
    ctx.drawImage(A, 0, 0);
    ctx.restore();
    return box;
  }
  /** desenha o clipe na pose do instante t. plain: sem modo de mesclagem (vai para um canvas intermediário) */
  drawClipOnce(ctx, c, a, t, W, H, k, pm = null, plain = false) {
    const local = t - c.start;
    const p = resolveProps(c, local);
    // animações de entrada/saída/combinação
    const T = animTransform(c, p, local, W / H);
    // em vídeo e composto o fade fica na aba Áudio: só mexe no volume, não na imagem
    const fade = c.type === 'video' || c.type === 'compound' ? 1 : fadeFactor(c, t);
    const alpha = ((p.blendOn ? p.opacity : 100) / 100) * fade * T.a;
    const sc = (p.scale / 100) * T.s;
    const cx = W / 2 + (p.x / 100) * (W / 2) + T.x * W;
    const cy = H / 2 + (p.y / 100) * (H / 2) + T.y * H;
    const rot = ((p.rotation + T.r) * Math.PI) / 180;
    ctx.save();
    if (pm) ctx.transform(pm.a, pm.b, pm.c, pm.d, pm.e, pm.f); // herdado da camada-pai
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.globalCompositeOperation = p.blendOn && !plain ? BLEND_OP[p.blend] || 'source-over' : 'source-over';
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    const fx = (p.scaleX ?? 100) / 100, fy = (p.scaleY ?? 100) / 100; // esticar livremente (alças laterais)
    ctx.scale(sc * T.sx * fx, sc * T.sy * fy);
    const extra = (T.blur ? ` blur(${T.blur * k}px)` : '') + (T.bright !== 1 || (c.type === 'text' && T.flash) ? ` brightness(${T.bright * (c.type === 'text' ? 1 + T.flash * 3 : 1)})` : '');
    if (c.type !== 'text') ctx.filter = filterCss(p, k) + extra;
    else if (extra) ctx.filter = extra.trim();
    let w = 0, h = 0;
    if (c.type === 'text') {
      if (T.wipe || T.iris != null || T.blinds != null) { const [mw, mh] = this.measureText(ctx, p, k); animClip(ctx, T, mw, mh); }
      [w, h] = this.drawText(ctx, c, p, local, k);
    } else {
      const { src, sw, sh, ready } = this.source(c, a, p, t);
      if (sw) [w, h] = c.type === 'color' ? [W, H] : fit(sw, sh, W, H);
      animClip(ctx, T, w, h);
      if (ready) {
        const live = this.erase.get(c.id)?.live;
        const speedI = isMedia(c) ? speedFxAmount(c, p, local) : 0;
        if (needsProcessing(p, live) || gradeActive(p) || gradeSpatial(p) || speedI > 0 || T.rgb > 0.01 || T.glitch > 0.01) {
          const erase = p.eraseOn || live ? this.eraseCanvas(c) : null;
          ctx.drawImage(processClip(p, src, w, h, k, erase, { t, local, speedI, T, pen: p.maskType === 'pen' ? penAt(c, local) : null }), -w / 2, -h / 2, w, h);
        } else if (src) ctx.drawImage(src, -w / 2, -h / 2, w, h);
        else { ctx.fillStyle = p.color; ctx.fillRect(-w / 2, -h / 2, w, h); }
        if (T.flash > 0.01) {
          ctx.filter = 'none';
          ctx.globalAlpha = clamp(alpha * T.flash, 0, 1);
          ctx.globalCompositeOperation = 'screen';
          ctx.fillStyle = '#fff';
          ctx.fillRect(-w / 2, -h / 2, w, h);
        }
      }
    }
    ctx.restore();
    const box = { id: c.id, row: clipRow(c), cx, cy, w: w * sc * Math.abs(T.sx * fx), h: h * sc * Math.abs(T.sy * fy), rot };
    if (pm) {
      // caixa em coordenadas do quadro, já com a transformação do pai
      const q = pm.transformPoint({ x: cx, y: cy });
      Object.assign(box, { cx: q.x, cy: q.y, w: box.w * Math.hypot(pm.a, pm.b), h: box.h * Math.hypot(pm.c, pm.d), rot: rot + Math.atan2(pm.b, pm.a), pm });
    }
    return box;
  }
  measureText(ctx, p, k) {
    const size = p.fontSize * k;
    ctx.font = `${p.italic ? 'italic ' : ''}${p.bold ? 700 : 400} ${size}px "${p.fontFamily}", sans-serif`;
    const lines = (p.text || ' ').split('\n');
    const maxW = Math.max(1, ...lines.map((l) => ctx.measureText(l).width));
    if (isSticker(p)) {
      const rows = lines.map((l) => graphemes(l).filter((g) => g.trim()).length);
      return [Math.max(1, ...rows) * size * 1.05, lines.length * size * 1.05];
    }
    return [maxW + size * 0.8, size * 1.22 * lines.length + size * 0.44];
  }
  /** desenha a linha do tempo interna do composto num canvas próprio (transparente onde não há nada) */
  nested(c, t) {
    const { W, H, assetMap } = this._r;
    this.nest ||= new Map();
    let cv = this.nest.get(c.id);
    if (!cv) { cv = document.createElement('canvas'); this.nest.set(c.id, cv); }
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const saved = { t: this.t, r: this._r, pc: this._pc, pairs: this._pairs };
    TMP_DEPTH++;
    try { this.render(cv.getContext('2d'), W, H, c.in + clamp(t - c.start, 0, c.duration), c.children, assetMap, c.trackState || {}, true); }
    finally { TMP_DEPTH--; this.t = saved.t; this._r = saved.r; this._pc = saved.pc; this._pairs = saved.pairs; }
    return cv;
  }
  /** fonte de pixels do clipe (vídeo, imagem ou cor sólida) */
  source(c, a, p, t = this.t) {
    if (c.type === 'compound') return { src: this.nested(c, t), sw: this._r.W, sh: this._r.H, ready: true };
    if (c.type === 'video') {
      // velocidade alterada: motor quadro a quadro (exato, com interpolação e desfoque de movimento)
      const precise = this.precise(c, a, p);
      if (precise) return precise;
      const el = this.media.get(c.id);
      const live = el && el.readyState >= 2 && el.videoWidth && !el.seeking;
      if (live) {
        const blended = this.blendFrame(c, p, el);
        return { src: blended || el, sw: el.videoWidth, sh: el.videoHeight, ready: true };
      }
      // durante uma busca o vídeo não tem quadro: mostra o último bom em vez de tela preta
      const h = this.hold.get(c.id) || this.frames.get(c.id)?.b;
      if (h && h.width > 1) return { src: h, sw: el?.videoWidth || h.width, sh: el?.videoHeight || h.height, ready: true };
      return { src: null, sw: a?.width || 16, sh: a?.height || 9, ready: false };
    }
    if (c.type === 'image' && a) {
      const img = this.getImage(a);
      return { src: img, sw: a.width || 16, sh: a.height || 9, ready: img.complete && img.naturalWidth > 0 };
    }
    if (c.type === 'color') return { src: null, sw: 16, sh: 9, ready: true };
    return { src: null, sw: 0, sh: 0, ready: false };
  }
  /** fonte de quadros WebCodecs do arquivo (criada sob demanda) */
  frameSource(a) {
    if (!a?.file || !window.VideoDecoder) return null;
    let fs = this.sources.get(a.id);
    if (!fs) { fs = new FrameSource(a.file); this.sources.set(a.id, fs); }
    return fs;
  }
  /** usa o motor exato quando a velocidade do clipe foi alterada */
  usesPrecise(c, p) { return c.type === 'video' && (c.speedCurve || Math.abs(c.speed - 1) > 1e-3) && p.precise !== false; }
  precise(c, a, p) {
    // na exportação offline todo vídeo com decodificador WebCodecs usa o quadro exato
    if (!(this.offline ? c.type === 'video' : this.usesPrecise(c, p))) return null;
    const fs = this.frameSource(a);
    if (!fs || fs.state !== 'ready') return null;
    const local = clamp(this.t - c.start, 0, c.duration);
    const s = srcTimeAt(c, local), rate = rateAt(c, local);
    const playing = this.offline || !!this.rates.get(c.id)?.playing;
    // desfoque de movimento: janela de tempo da mídia coberta por um quadro de saída (obturador de 180°)
    const mb = (p.motionBlur ?? 0) / 100;
    const blurSpan = rate > 1.25 && mb > 0 ? Math.min(0.5, (rate / (this.outFps || FPS)) * mb) : 0;
    fs.want(s, rate, playing, blurSpan);
    const pr = fs.pair(s);
    if (!pr) return null;
    const w = fs.outW, h = fs.outH;
    let img = pr.A;
    if (blurSpan > 0) {
      // janela curta (até ~2 quadros da mídia): poucos quadros reais para fazer a média,
      // então o fluxo sintetiza o rastro entre A e B; janelas maiores usam os quadros reais
      const span = blurSpan * fs.fps;
      const viaFlow = span < 2 && p.frameInterp === 'flow' && pr.exact && pr.B;
      img = (viaFlow && flowGL().interp(pr.A, pr.B, `${a.id}:${pr.a}`, pr.t, w, h, span)) || this.motionBlur(c.id, fs, s, blurSpan, w, h) || img;
    } else if (rate < 0.99 && pr.exact && pr.B && pr.t > 0.02 && pr.t < 0.98 && p.frameInterp !== 'none') {
      const key = `${a.id}:${pr.a}`;
      img = (p.frameInterp === 'flow' && flowGL().interp(pr.A, pr.B, key, pr.t, w, h)) || this.blend(c.id, pr.A, pr.B, pr.t, w, h);
    }
    return { src: img, sw: fs.width, sh: fs.height, ready: true };
  }
  outCanvas(id, w, h) {
    let o = this._outs?.get(id);
    if (!o) { (this._outs ||= new Map()).set(id, (o = document.createElement('canvas'))); }
    if (o.width !== w || o.height !== h) { o.width = w; o.height = h; }
    return o;
  }
  blend(id, A, B, t, w, h) {
    const o = this.outCanvas(id, w, h), x = o.getContext('2d');
    x.globalAlpha = 1; x.drawImage(A, 0, 0, w, h);
    x.globalAlpha = t; x.drawImage(B, 0, 0, w, h);
    x.globalAlpha = 1;
    return o;
  }
  /** média dos quadros reais dentro da janela do obturador (como câmera com obturador aberto) */
  motionBlur(id, fs, s, span, w, h) {
    const p0 = fs.presAt(s - span / 2), p1 = fs.presAt(s + span / 2);
    const got = [];
    const step = Math.max(1, Math.floor((p1 - p0 + 1) / 8));
    for (let q = p0; q <= p1; q += step) if (fs.frames.has(q)) got.push(fs.frames.get(q));
    if (got.length < 2) return null;
    const o = this.outCanvas(id, w, h), x = o.getContext('2d');
    got.forEach((f, i) => { x.globalAlpha = 1 / (i + 1); x.drawImage(f, 0, 0, w, h); });
    x.globalAlpha = 1;
    return o;
  }
  /* ---------- exportação offline: as fontes são posicionadas antes de cada quadro ---------- */
  beginOffline() {
    this.offline = true;
    for (const el of this.media.values()) if (!el.paused) el.pause();
  }
  endOffline() { this.offline = false; }
  /** abre os decodificadores dos vídeos e espera ficarem prontos (ou falharem: aí usa o <video>) */
  async warmSources(clips, assetMap) {
    const assets = new Set(expandMedia(clips, {}).filter((c) => c.type === 'video').map((c) => assetMap[c.assetId]).filter(Boolean));
    const fss = [...assets].map((a) => this.frameSource(a)).filter(Boolean);
    const t0 = performance.now();
    while (fss.some((f) => f.state === 'loading') && performance.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 20));
  }
  /** deixa cada vídeo visível em `t` (com margem para transições) exatamente no quadro certo */
  async prepareFrame(t, clips, assetMap, ts) {
    this.t = t;
    const waits = [];
    const all = expandMedia(clips, ts);
    for (const c of all) {
      if (c.type !== 'video') continue;
      const a = assetMap[c.assetId];
      if (!a || a.loading) continue;
      const lo = Math.max(c.start, c._win ? c._win[0] : -Infinity), hi = Math.min(c.start + c.duration, c._win ? c._win[1] : Infinity);
      // fora do clipe só interessa durante uma transição com o vizinho
      const before = c.transition ? c.transition.duration : 0;
      const nb = all.find((x) => x.transition && x !== c && clipRow(x) === clipRow(c) && Math.abs(x.start - (c.start + c.duration)) < 0.05);
      const after = nb ? nb.transition.duration : 0;
      if (t < lo - before || t >= hi + after) continue;
      const local = clamp(t - c.start, 0, Math.max(0, c.duration - 1e-3));
      const s = srcTimeAt(c, local);
      const fs = this.frameSource(a);
      waits.push(fs && fs.state === 'ready' ? this.waitExact(fs, s, rateAt(c, local)) : this.waitElement(c, a, s));
    }
    await Promise.all(waits);
  }
  async waitExact(fs, s, rate) {
    const t0 = performance.now();
    while (performance.now() - t0 < 3000 && fs.state === 'ready') {
      // decodificando à frente; se o quadro não sai (fim do arquivo, quadros retidos para reordenar), força o flush
      fs.want(s, rate, performance.now() - t0 < 120);
      if (fs.pair(s)?.exact) return;
      await yieldNow();
    }
  }
  /** formatos sem decodificador próprio: busca o quadro no <video> e espera chegar */
  async waitElement(c, a, s) {
    const el = this.getMedia(c, a);
    if (!el.paused) el.pause();
    const once = (ev, ms) => new Promise((res) => {
      const done = () => { el.removeEventListener(ev, done); clearTimeout(to); res(); };
      const to = setTimeout(done, ms);
      el.addEventListener(ev, done);
    });
    if (el.readyState < 1) await once('loadedmetadata', 5000);
    if (el.readyState >= 2 && !el.seeking && Math.abs(el.currentTime - s) < 0.5 / (this.outFps || FPS)) return;
    const seeked = once('seeked', 5000);
    el.currentTime = Math.max(0, s);
    await seeked;
    if (el.readyState < 2) await once('loadeddata', 3000);
  }
  /** situação do motor exato para a interface */
  preciseInfo(c, a) {
    if (c.type !== 'video') return null;
    if (!window.VideoDecoder) return { state: 'error', error: 'WebCodecs indisponível neste navegador' };
    if (!a?.file) return { state: 'error', error: 'Reimporte o arquivo para usar o motor exato' };
    const fs = this.frameSource(a);
    return { state: fs.state, error: fs.error, codec: fs.codec, w: fs.width, h: fs.height, fps: fs.fps, cached: fs.frames?.size || 0 };
  }
  /** guarda o quadro atual e então busca — evita quadro preto enquanto o decodificador procura */
  seek(id, el, t) {
    if (el.readyState >= 2 && el.videoWidth && !el.seeking) {
      let h = this.hold.get(id);
      if (!h) { h = document.createElement('canvas'); this.hold.set(id, h); }
      const [w, hh] = capSize(el.videoWidth, el.videoHeight, 1280);
      if (h.width !== w || h.height !== hh) { h.width = w; h.height = hh; }
      h.getContext('2d').drawImage(el, 0, 0, w, hh);
    }
    el.currentTime = Math.max(0, t);
  }
  /** registra cada quadro apresentado (requestVideoFrameCallback) para interpolar câmera lenta */
  watchFrames(id, el) {
    if (!el.requestVideoFrameCallback) return;
    const st = { a: document.createElement('canvas'), b: document.createElement('canvas'), out: document.createElement('canvas'), tA: 0, tB: 0, n: 0, want: false };
    this.frames.set(id, st);
    const cb = (now) => {
      if (this.media.get(id) !== el) return;
      if (st.want && el.videoWidth) {
        const [w, h] = capSize(el.videoWidth, el.videoHeight, 1280);
        const t = st.a; st.a = st.b; st.b = t;
        st.tA = st.tB;
        if (st.b.width !== w || st.b.height !== h) { st.b.width = w; st.b.height = h; }
        st.b.getContext('2d').drawImage(el, 0, 0, w, h);
        st.tB = now;
        st.n++;
      }
      el.requestVideoFrameCallback(cb);
    };
    el.requestVideoFrameCallback(cb);
  }
  /** em câmera lenta, funde o quadro anterior com o atual conforme o tempo passa (movimento suave) */
  blendFrame(c, p, el) {
    const st = this.frames.get(c.id), r = this.rates.get(c.id);
    if (!st) return null;
    st.want = p.frameBlend !== false && !!r?.playing && r.rate < 0.85;
    if (!st.want) { st.n = 0; return null; }
    const gap = st.tB - st.tA;
    if (st.n < 2 || gap <= 0 || gap > 1200 || st.a.width !== st.b.width) return null;
    const f = clamp((performance.now() - st.tB) / gap, 0, 1);
    if (p.frameInterp === 'flow') {
      const fl = flowGL().interp(st.a, st.b, `${c.id}:el:${st.n}`, f, st.b.width, st.b.height);
      if (fl) return fl;
    }
    const o = st.out;
    if (o.width !== st.b.width || o.height !== st.b.height) { o.width = st.b.width; o.height = st.b.height; }
    const x = o.getContext('2d');
    x.globalAlpha = 1;
    x.drawImage(st.a, 0, 0);
    x.globalAlpha = f;
    x.drawImage(st.b, 0, 0);
    x.globalAlpha = 1;
    return o;
  }
  /** máscara de pinceladas da remoção personalizada (carregada do dataURL salvo no clipe) */
  eraseCanvas(c) {
    let e = this.erase.get(c.id);
    if (e?.live) return e.canvas;
    const url = c.props.eraseMask;
    if (!url) return null;
    if (!e || e.src !== url) {
      e = e || { canvas: document.createElement('canvas') };
      e.src = url;
      e.ready = false;
      this.erase.set(c.id, e);
      const img = new Image();
      img.onload = () => {
        if (e.src !== url) return;
        e.canvas.width = img.width;
        e.canvas.height = img.height;
        const x = e.canvas.getContext('2d');
        x.clearRect(0, 0, img.width, img.height);
        x.drawImage(img, 0, 0);
        e.ready = true;
      };
      img.src = url;
    }
    return e.ready ? e.canvas : null;
  }
  /** canvas de pinceladas para edição ao vivo (cria um em branco se preciso) */
  editableErase(c, aspect) {
    let e = this.erase.get(c.id);
    const url = c.props.eraseMask;
    if (!e || (!e.ready && !e.live) || (e.src !== url && !e.live)) {
      e = { canvas: document.createElement('canvas'), src: url, ready: true };
      const S = 640;
      e.canvas.width = aspect >= 1 ? S : Math.round(S * aspect);
      e.canvas.height = aspect >= 1 ? Math.round(S / aspect) : S;
      if (url) { const img = new Image(); img.src = url; e.canvas.getContext('2d').drawImage(img, 0, 0, e.canvas.width, e.canvas.height); }
      this.erase.set(c.id, e);
    }
    return e;
  }
  drawText(ctx, c, p, local, k) {
    const size = p.fontSize * k;
    if (isSticker(p)) return drawSticker(ctx, p, size);
    ctx.font = `${p.italic ? 'italic ' : ''}${p.bold ? 700 : 400} ${size}px "${p.fontFamily}", sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const lines = (p.text || ' ').split('\n');
    const lh = size * 1.22;
    const widths = lines.map((l) => ctx.measureText(l).width);
    const maxW = Math.max(1, ...widths);
    const th = lh * lines.length;
    const pc = (v, d) => (v ?? d) / 100;
    const padX = size * pc(p.bgPadX, 40), padY = size * pc(p.bgPadY, 22);
    const bw = maxW + padX * 2, bh = th + padY * 2;
    // sombra e brilho do canvas não seguem a transformação: compensa a escala atual
    const m = ctx.getTransform(), ds = Math.hypot(m.a, m.b) || 1;
    if (p.bg) {
      ctx.save();
      ctx.globalAlpha *= pc(p.bgOpacity, 100);
      ctx.fillStyle = p.bg;
      ctx.beginPath();
      ctx.roundRect(-bw / 2, -bh / 2, bw, bh, (Math.min(bw, bh) / 2) * clamp(pc(p.bgRadius, 26), 0, 1));
      ctx.fill();
      ctx.restore();
    }
    let remaining = Infinity;
    // destaque da palavra falada (legendas automáticas): qual palavra, em qual linha
    let hot = null;
    if (p.karaoke && p.words?.length) {
      const ai = p.words.findIndex((w, j) => local >= w.s && local < (p.words[j + 1]?.s ?? Infinity));
      const toks = lines.map((l) => l.split(' ').filter(Boolean));
      // só destaca se o texto ainda casa com as palavras transcritas (o usuário pode ter editado)
      if (ai >= 0 && toks.flat().length === p.words.length) {
        let g = 0;
        toks.forEach((ts, li) => { if (!hot && ai < g + ts.length) hot = { li, k: ai - g, toks: ts }; g += ts.length; });
      }
    }
    if (p.animIn === 'type') {
      const total = (p.text || '').length;
      const typeDur = Math.max(0.4, Math.min(c.duration * 0.7, total * 0.06));
      remaining = Math.floor(clamp(local / typeDur, 0, 1) * total);
    }
    lines.forEach((line, i) => {
      const lw = widths[i];
      const x = p.align === 'left' ? -maxW / 2 : p.align === 'right' ? maxW / 2 - lw : -lw / 2;
      const y = -th / 2 + lh * (i + 0.5);
      const vis = line.slice(0, Math.max(0, remaining));
      remaining -= line.length + 1;
      if (!vis) return;
      if (p.stroke > 0) {
        ctx.save();
        ctx.lineWidth = p.stroke * k * 2;
        ctx.strokeStyle = p.strokeColor;
        ctx.lineJoin = 'round';
        ctx.strokeText(vis, x, y);
        ctx.restore();
      }
      ctx.fillStyle = p.color;
      if (p.shadow) {
        // ângulo na tela (a luz não gira junto com o texto)
        const a = ((p.shadowAngle ?? 90) * Math.PI) / 180, d = size * pc(p.shadowDist, 5) * ds;
        ctx.save();
        ctx.shadowColor = rgbaOf(p.shadowColor || '#000000', pc(p.shadowOpacity, 60));
        ctx.shadowBlur = size * pc(p.shadowBlur, 16) * ds;
        ctx.shadowOffsetX = Math.cos(a) * d;
        ctx.shadowOffsetY = Math.sin(a) * d;
        ctx.fillText(vis, x, y);
        ctx.restore();
      }
      if (p.glow) {
        // neon: cada passada soma intensidade; a dispersão é o raio do brilho
        const total = Math.max(0.05, pc(p.glowStrength, 100) * 2), a0 = ctx.globalAlpha;
        ctx.save();
        ctx.shadowColor = p.glow;
        ctx.shadowBlur = size * pc(p.glowSpread, 60) * ds;
        for (let i = 0; i < Math.ceil(total); i++) { ctx.globalAlpha = a0 * Math.min(1, total - i); ctx.fillText(vis, x, y); }
        ctx.restore();
        ctx.fillText(vis, x, y);
      }
      if (!p.shadow && !p.glow) ctx.fillText(vis, x, y);
      if (hot && hot.li === i && p.animIn !== 'type') {
        const pre = hot.toks.slice(0, hot.k).join(' ') + (hot.k ? ' ' : '');
        const word = hot.toks[hot.k];
        const wx = x + ctx.measureText(pre).width, ww = ctx.measureText(word).width;
        ctx.save();
        ctx.shadowColor = 'transparent';
        if (p.hlMode === 'box') {
          const px = size * 0.14, py = size * 0.08;
          ctx.fillStyle = p.hlColor || '#ffd23f';
          ctx.beginPath();
          ctx.roundRect(wx - px, y - lh / 2 + py, ww + px * 2, lh - py * 2, size * 0.16);
          ctx.fill();
          // texto escuro ou claro conforme o brilho da caixa
          const [r, g, b] = rgbOf(p.hlColor || '#ffd23f');
          ctx.fillStyle = r * 0.3 + g * 0.59 + b * 0.11 > 150 ? '#111111' : '#ffffff';
        } else {
          if (p.stroke > 0) { ctx.lineWidth = p.stroke * k * 2; ctx.strokeStyle = p.strokeColor; ctx.lineJoin = 'round'; ctx.strokeText(word, wx, y); }
          ctx.fillStyle = p.hlColor || '#ffd23f';
        }
        ctx.fillText(word, wx, y);
        ctx.restore();
      }
    });
    return [bw, bh];
  }
}
const engine = new Engine();
