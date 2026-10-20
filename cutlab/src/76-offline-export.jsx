/* =====================================================================
   Exportação offline (WebCodecs): quadro a quadro, sem tocar em tempo real
   - vídeo: cada quadro é renderizado com as fontes já no instante exato e
     codificado com VideoEncoder (H.264; VP9/AV1 se não houver)
   - áudio: mixado de uma vez num OfflineAudioContext e codificado (AAC/Opus)
   - contêiner: MP4 montado pelo mp4-muxer (carregado sob demanda)
   ===================================================================== */
const MUXER_URL = 'https://unpkg.com/mp4-muxer@5.1.3/build/mp4-muxer.js';
let muxerP = null;
const loadMuxer = () => (muxerP ||= new Promise((res, rej) => {
  if (window.Mp4Muxer) return res(window.Mp4Muxer);
  const s = document.createElement('script');
  s.src = MUXER_URL;
  s.onload = () => (window.Mp4Muxer ? res(window.Mp4Muxer) : rej(new Error('Gerador de MP4 inválido')));
  s.onerror = () => { muxerP = null; s.remove(); rej(new Error('Não foi possível carregar o gerador de MP4 (sem internet?)')); };
  document.head.appendChild(s);
}));

const offlineExportSupported = () => !!(window.VideoEncoder && window.VideoFrame && window.OfflineAudioContext);

/** cede a vez ao navegador sem o atraso mínimo de setTimeout (que é limitado em abas ocultas) */
const yieldNow = () => new Promise((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });

async function pickVideoCodec(w, h, fps, bitrate) {
  const cands = [['avc1.640033', 'avc'], ['avc1.4d0033', 'avc'], ['avc1.42003e', 'avc'], ['vp09.00.40.08', 'vp9'], ['av01.0.08M.08', 'av1']];
  for (const [codec, mux] of cands) {
    const cfg = { codec, width: w, height: h, bitrate, framerate: fps, ...(mux === 'avc' ? { avc: { format: 'avc' } } : {}) };
    try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return { cfg, mux }; } catch { /* tenta o próximo */ }
  }
  return null;
}
/** como a exportação rápida vai gravar o áudio neste navegador: 'aac' (ideal), 'opus' ou null (sem áudio) */
async function offlineAudioSupport() { return (await pickAudioCodec(48000))?.mux ?? null; }
async function pickAudioCodec(sr) {
  if (!window.AudioEncoder) return null;
  for (const [codec, mux] of [['mp4a.40.2', 'aac'], ['opus', 'opus']]) {
    const cfg = { codec, sampleRate: sr, numberOfChannels: 2, bitrate: 192000 };
    try { if ((await AudioEncoder.isConfigSupported(cfg)).supported) return { cfg, mux }; } catch { /* tenta o próximo */ }
  }
  return null;
}

/** mistura todo o áudio do projeto (inclusive de dentro dos compostos) num AudioBuffer */
async function mixProjectAudio(clips, assetMap, ts, dur, sr) {
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(dur * sr)), sr);
  const cache = new Map();
  const media = expandMedia(clips, ts).filter(isMedia);
  // trecho da mídia (s) que o projeto usa de cada arquivo: o plano B decodifica só isso
  const span = new Map();
  for (const c of media) {
    const [x, y] = span.get(c.assetId) || [Infinity, -Infinity];
    span.set(c.assetId, [Math.min(x, srcTimeAt(c, 0)), Math.max(y, srcTimeAt(c, c.duration))]);
  }
  const unread = new Set();
  const viaMp4 = async (a, file) => {
    const [x, y] = span.get(a.id);
    const r = await decodeMp4Audio(file, x, y).catch(() => null);
    if (!r) return null;
    const buf = new AudioBuffer({ length: r.channels[0].length, numberOfChannels: r.channels.length, sampleRate: r.sampleRate });
    r.channels.forEach((ch, i) => buf.copyToChannel(ch, i));
    return { buf, offset: r.offset };
  };
  /**
   * Último recurso: toca o trecho num elemento de mídia (sem som nos alto-falantes) e grava a saída.
   * Funciona em qualquer navegador que consiga tocar o arquivo, mesmo sem suporte do Web Audio/WebCodecs
   * ao codec (ex.: AAC no Opera). Sem correção de tom, o trecho gravado é o áudio comprimido no tempo.
   */
  const viaElement = async (a) => {
    const [x, y] = span.get(a.id);
    // transcrição (16 kHz) aceita 4× (som até 6 kHz); na exportação grava em tempo real, com qualidade total
    const SPEED = sr <= 16000 ? 4 : 1, rt = new AudioContext();
    const el = document.createElement('video');
    el.src = a.url; el.preload = 'auto'; el.playsInline = true;
    el.preservesPitch = false; el.mozPreservesPitch = false; el.webkitPreservesPitch = false;
    try {
      await new Promise((res, rej) => { el.onloadedmetadata = res; el.onerror = rej; setTimeout(rej, 15000); });
      const from = Math.max(0, x - 0.05), to = Math.min(el.duration || y, y + 0.05);
      el.currentTime = from;
      await new Promise((res) => { el.onseeked = res; setTimeout(res, 5000); });
      const srcNode = rt.createMediaElementSource(el);   // desvia o som dos alto-falantes
      const proc = rt.createScriptProcessor(4096, 2, 2);
      const chunks = [[], []];
      let startAt = null;
      proc.onaudioprocess = (e) => {
        if (el.paused || el.currentTime < from) return;
        if (startAt == null) startAt = el.currentTime - e.inputBuffer.duration * SPEED;   // início aproximado do primeiro bloco
        for (let c = 0; c < 2; c++) chunks[c].push(e.inputBuffer.getChannelData(Math.min(c, e.inputBuffer.numberOfChannels - 1)).slice());
      };
      const mute = rt.createGain(); mute.gain.value = 0;
      srcNode.connect(proc).connect(mute).connect(rt.destination);
      await rt.resume();
      el.playbackRate = SPEED;
      await el.play();
      await new Promise((res) => { const tick = () => (el.ended || el.currentTime >= to ? res() : setTimeout(tick, 50)); tick(); setTimeout(res, ((to - from) / SPEED + 10) * 1000); });
      el.pause();
      const n = chunks[0].reduce((s, b) => s + b.length, 0);
      if (!n) return null;
      const buf = new AudioBuffer({ length: n, numberOfChannels: 2, sampleRate: rt.sampleRate / SPEED });   // 4 s de mídia em 1 s gravado: 1/4 das amostras por segundo
      for (let c = 0; c < 2; c++) { let o = 0; for (const b of chunks[c]) { buf.copyToChannel(b, c, o); o += b.length; } }
      return { buf, offset: Math.max(0, startAt ?? from) };
    } catch { return null; }
    finally { el.pause(); el.removeAttribute('src'); el.load(); rt.close(); }
  };
  /** { buf, offset } — offset = tempo da mídia onde o buffer começa */
  const bufOf = (a) => {
    if (!cache.has(a.id)) cache.set(a.id, (async () => {
      const file = a.file || await fetch(a.url).then((r) => r.blob()).catch(() => null);
      if (!file) return null;
      const big = file.size > 150e6;   // decodeAudioData decodificaria o arquivo inteiro na memória
      const mp4 = a.type === 'video' && (await MP4.index(file, 'vide').then(() => true, () => false));
      // vídeo MP4 sem faixa de áudio (gravação de tela sem som…): nada a ler. Antes caía no último
      // recurso, que toca o arquivo em tempo real — 1 min de vídeo = 1 min a mais de exportação
      if (mp4 && !(await MP4.index(file, 'soun').then(() => true, () => false))) return null;
      // MP4: só o trecho usado, pelo índice próprio (decodeAudioData decodificaria o arquivo inteiro)
      if (mp4) { const r = await viaMp4(a, file); if (r) return r; }
      try { if (big && mp4) throw 0; return { buf: await ctx.decodeAudioData(await file.arrayBuffer()), offset: 0 }; }
      catch {
        // formatos sem decodificador de áudio próprio: toca o trecho e grava (tempo real)
        const r = a.url ? await viaElement(a) : null;
        if (!r && a.type === 'video' && (await MP4.index(file, 'soun').then(() => true, () => false))) unread.add(a.name);
        return r;
      }
    })());
    return cache.get(a.id);
  };
  const solo = soloOn(ts);
  for (const c of media) {
    const muted = c._sub ? c._muted : (ts[clipRow(c)]?.muted || (solo && !ts[clipRow(c)]?.solo));
    const a = assetMap[c.assetId];
    if (muted || !a || a.loading) continue;
    const got = await bufOf(a);
    if (!got) continue;
    const { buf, offset } = got;
    const t0 = Math.max(c.start, c._win ? c._win[0] : 0), t1 = Math.min(c.start + c.duration, c._win ? c._win[1] : Infinity, dur);
    if (t1 - t0 < 1e-3) continue;
    const rate = srcSpan(c) / c.duration;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    // volume (com keyframes), fades e ganho herdado do composto, amostrados a 30 Hz
    const n = Math.ceil((t1 - t0) * 30);
    for (let i = 0; i <= n; i++) {
      const t = Math.min(t1, t0 + i / 30);
      const v = Math.max(0, (propAt(c, 'volume', t - c.start) / 100) * audioFade(c, t) * (c._gain ?? 1));
      if (i === 0) g.gain.setValueAtTime(v, t); else g.gain.linearRampToValueAtTime(v, t);
    }
    src.connect(g).connect(ctx.destination);
    const at = srcTimeAt(c, t0 - c.start) - offset;
    // o buffer parcial pode começar um pouco depois do ponto pedido: atrasa o início em vez de cortar
    src.start(t0 + Math.max(0, -at) / rate, Math.max(0, at), (t1 - t0) * rate);
  }
  const out = await ctx.startRendering();
  out.unread = [...unread];   // vídeos com faixa de áudio que não conseguimos ler
  return out;
}

/**
 * gera o MP4. `onProgress(fração, etapa, { i, N, canvas })`; `isCancelled()` interrompe; `bitrate` do vídeo em bps.
 * Retorna { blob, ext, codec, seconds }.
 */
async function exportOffline({ clips, assetMap, trackState, W, H, fps, duration, bitrate, onProgress, isCancelled }) {
  const started = performance.now();
  W -= W % 2; H -= H % 2;   // H.264 exige dimensões pares
  onProgress(0, 'Preparando…');
  const Mux = await loadMuxer();
  const v = await pickVideoCodec(W, H, fps, bitrate || (W * H >= 1800000 ? 16e6 : 9e6));
  if (!v) throw new Error('Este navegador não consegue codificar vídeo');
  const sr = 48000;
  const aud = await pickAudioCodec(sr);
  // o áudio é mixado e codificado AO MESMO TEMPO que o vídeo é renderizado (como nos editores de
  // desktop: cada etapa no seu ritmo). Antes a exportação esperava a mixagem inteira para só então
  // começar o primeiro quadro
  const audioP = aud ? (async () => {
    const mix = await mixProjectAudio(clips, assetMap, trackState, duration, sr);
    if (!mix) return null;
    const chunks = [];
    let err = null;
    const aenc = new AudioEncoder({ output: (ch, meta) => chunks.push([ch, meta]), error: (e) => { err = e; } });
    aenc.configure(aud.cfg);
    const L = mix.getChannelData(0), R = mix.numberOfChannels > 1 ? mix.getChannelData(1) : L;
    for (let o = 0; o < mix.length; o += sr) {
      const n = Math.min(sr, mix.length - o), data = new Float32Array(n * 2);
      data.set(L.subarray(o, o + n), 0);
      data.set(R.subarray(o, o + n), n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((o / sr) * 1e6), data });
      aenc.encode(ad);
      ad.close();
    }
    await aenc.flush();
    aenc.close();
    if (err) throw err;
    return chunks;
  })() : Promise.resolve(null);
  audioP.catch(() => {});   // o erro é tratado lá embaixo (ou a exportação foi cancelada antes)

  // os quadros codificados ficam guardados e o MP4 é montado no fim, quando já se sabe se há áudio
  const vChunks = [];
  let failure = null;
  const venc = new VideoEncoder({ output: (ch, meta) => vChunks.push([ch, meta]), error: (e) => { failure = e; } });
  venc.configure(v.cfg);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const N = Math.max(1, Math.round(duration * fps));
  engine.beginOffline();
  engine.outFps = fps;   // desfoque de movimento e tolerância de sincronia seguem a taxa de saída
  try {
    onProgress(0, 'Abrindo os vídeos…');
    await engine.warmSources(clips, assetMap);
    await preloadStickers(clips);
    let shown = 0;
    for (let i = 0; i < N; i++) {
      if (isCancelled()) throw new DOMException('cancelado', 'AbortError');
      if (failure) throw failure;
      const t = i / fps;
      await engine.prepareFrame(t, clips, assetMap, trackState);
      engine.render(ctx, W, H, t, clips, assetMap, trackState);
      const frame = new VideoFrame(cv, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      venc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      // fila do codificador cheia: espera ele liberar uma vaga (antes girava em falso sem parar)
      while (venc.encodeQueueSize > 8 && !failure) await drained(venc);
      // progresso 4×/s: cada atualização redesenha a interface inteira (antes era a cada 3 quadros)
      const now = performance.now();
      if (now - shown > 250) { shown = now; onProgress(i / N, `Renderizando quadro ${i + 1} de ${N}`, { i, N, canvas: cv }); await yieldNow(); }
    }
    await venc.flush();
    if (failure) throw failure;
  } finally {
    engine.endOffline();
    engine.outFps = null;
    try { venc.close(); } catch { /* já fechado */ }
  }
  onProgress(1, 'Finalizando o áudio…');
  const aChunks = await audioP;
  if (isCancelled()) throw new DOMException('cancelado', 'AbortError');
  onProgress(1, 'Finalizando…');
  const target = new Mux.ArrayBufferTarget();
  const muxer = new Mux.Muxer({
    target, fastStart: 'in-memory', firstTimestampBehavior: 'offset',
    video: { codec: v.mux, width: W, height: H, frameRate: fps },
    ...(aChunks ? { audio: { codec: aud.mux, numberOfChannels: 2, sampleRate: sr } } : {}),
  });
  for (const [ch, meta] of vChunks) muxer.addVideoChunk(ch, meta);
  for (const [ch, meta] of aChunks || []) muxer.addAudioChunk(ch, meta);
  muxer.finalize();
  return { blob: new Blob([target.buffer], { type: 'video/mp4' }), ext: 'mp4', codec: v.cfg.codec, audio: aChunks ? aud.mux : null, seconds: (performance.now() - started) / 1000 };
}
