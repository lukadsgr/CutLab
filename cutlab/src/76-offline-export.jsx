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
  const bufOf = (a) => {
    if (!cache.has(a.id)) cache.set(a.id, (async () => {
      try { return await ctx.decodeAudioData(await (a.file ? a.file.arrayBuffer() : fetch(a.url).then((r) => r.arrayBuffer()))); }
      catch { return null; }   // vídeo sem trilha de áudio
    })());
    return cache.get(a.id);
  };
  const solo = soloOn(ts);
  for (const c of expandMedia(clips, ts)) {
    if (!isMedia(c)) continue;
    const muted = c._sub ? c._muted : (ts[c.track]?.muted || ts[clipRow(c)]?.muted || (solo && !ts[clipRow(c)]?.solo));
    const a = assetMap[c.assetId];
    if (muted || !a || a.loading) continue;
    const buf = await bufOf(a);
    if (!buf) continue;
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
      const v = Math.max(0, (propAt(c, 'volume', t - c.start) / 100) * fadeFactor(c, t) * (c._gain ?? 1));
      if (i === 0) g.gain.setValueAtTime(v, t); else g.gain.linearRampToValueAtTime(v, t);
    }
    src.connect(g).connect(ctx.destination);
    src.start(t0, srcTimeAt(c, t0 - c.start), (t1 - t0) * rate);
  }
  return ctx.startRendering();
}

/**
 * gera o MP4. `onProgress(fração, etapa)`; `isCancelled()` interrompe.
 * Retorna { blob, ext, codec, seconds }.
 */
async function exportOffline({ clips, assetMap, trackState, W, H, fps, duration, onProgress, isCancelled }) {
  const started = performance.now();
  W -= W % 2; H -= H % 2;   // H.264 exige dimensões pares
  onProgress(0, 'Preparando…');
  const Mux = await loadMuxer();
  const v = await pickVideoCodec(W, H, fps, W * H >= 1800000 ? 16e6 : 9e6);
  if (!v) throw new Error('Este navegador não consegue codificar vídeo');
  const sr = 48000;
  const aud = await pickAudioCodec(sr);
  onProgress(0, 'Mixando o áudio…');
  const mix = aud ? await mixProjectAudio(clips, assetMap, trackState, duration, sr) : null;
  if (isCancelled()) throw new DOMException('cancelado', 'AbortError');

  const target = new Mux.ArrayBufferTarget();
  const muxer = new Mux.Muxer({
    target, fastStart: 'in-memory', firstTimestampBehavior: 'offset',
    video: { codec: v.mux, width: W, height: H, frameRate: fps },
    ...(mix ? { audio: { codec: aud.mux, numberOfChannels: 2, sampleRate: sr } } : {}),
  });
  let failure = null;

  if (mix) {
    const aenc = new AudioEncoder({ output: (ch, meta) => muxer.addAudioChunk(ch, meta), error: (e) => { failure = e; } });
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
  }

  const venc = new VideoEncoder({ output: (ch, meta) => muxer.addVideoChunk(ch, meta), error: (e) => { failure = e; } });
  venc.configure(v.cfg);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const N = Math.max(1, Math.round(duration * fps));
  engine.beginOffline();
  try {
    onProgress(0, 'Abrindo os vídeos…');
    await engine.warmSources(clips, assetMap);
    for (let i = 0; i < N; i++) {
      if (isCancelled()) throw new DOMException('cancelado', 'AbortError');
      if (failure) throw failure;
      const t = i / fps;
      await engine.prepareFrame(t, clips, assetMap, trackState);
      engine.render(ctx, W, H, t, clips, assetMap, trackState);
      const frame = new VideoFrame(cv, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      venc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      while (venc.encodeQueueSize > 6) await yieldNow();
      if (i % 3 === 0) { onProgress(i / N, `Renderizando quadro ${i + 1} de ${N}`); await yieldNow(); }
    }
    await venc.flush();
    if (failure) throw failure;
  } finally {
    engine.endOffline();
    try { venc.close(); } catch { /* já fechado */ }
  }
  onProgress(1, 'Finalizando…');
  muxer.finalize();
  return { blob: new Blob([target.buffer], { type: 'video/mp4' }), ext: 'mp4', codec: v.cfg.codec, seconds: (performance.now() - started) / 1000 };
}
