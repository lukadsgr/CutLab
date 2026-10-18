/* =====================================================================
   Proxies de prévia (como a "mídia otimizada" do DaVinci / proxies do CapCut)
   Gravações de tela e vídeos de câmera costumam ter alta resolução, muitos
   quadros por segundo e quadros-chave espaçados: cada busca decodifica segundos
   de vídeo (0,7–2 s) e cortes rápidos deixam várias buscas disputando o
   decodificador com o que está tocando. O proxy é uma cópia leve só para a
   prévia: 540p, quadro-chave a cada meio segundo, áudio copiado sem recodificar.
   A exportação e a prévia "Completa" continuam usando o original.
   ===================================================================== */
const PROXY_SHORT = 540;

/** progresso dos proxies em geração (fora do React: só o cartão da mídia redesenha) */
const proxyProgress = { map: new Map(), subs: new Set(), set(id, v) { if (v == null) this.map.delete(id); else this.map.set(id, v); for (const f of this.subs) f(); } };
function useProxyProgress(id) {
  const [, setN] = useState(0);
  useEffect(() => { const f = () => setN((n) => n + 1); proxyProgress.subs.add(f); return () => { proxyProgress.subs.delete(f); }; }, []);
  return proxyProgress.map.get(id);
}

/** precisa de proxy? Vídeo MP4/MOV acima de 720p, acima de 30 qps ou com quadros-chave a mais de 1 s */
async function proxyNeed(file) {
  if (!window.VideoDecoder || !window.VideoEncoder) return false;
  let v;
  try { v = await MP4.index(file, 'vide'); } catch { return false; }   // WebM e afins: sem proxy
  const S = v.S, n = S.off.length;
  if (n < 2) return false;
  const span = Math.max(1e-3, (S.dts[n - 1] - S.dts[0]) / v.timescale);
  const keys = S.sync.reduce((a, b) => a + b, 0);
  return Math.min(v.width, v.height) > 720 || (n - 1) / span > 31 || span / Math.max(1, keys) > 1;
}

/**
 * gera o proxy (MP4) de um arquivo. `onProgress(0..1)`; `isCancelled()` interrompe.
 * Lança erro quando não dá (codec sem decodificador, áudio que o MP4 não aceita…): fica o original.
 */
async function makeProxy(file, { onProgress = () => {}, isCancelled = () => false } = {}) {
  const Mux = await loadMuxer();
  const v = await MP4.index(file, 'vide');
  let au = null;
  try { au = await MP4.index(file, 'soun'); } catch { /* sem áudio */ }
  const audioMux = au ? (/^mp4a\.40/.test(au.codec) ? 'aac' : au.codec === 'opus' ? 'opus' : null) : null;
  if (au && !audioMux) throw new Error('áudio em formato que o proxy não copia');

  const S = v.S, n = S.off.length;
  const pts = (i) => (S.dts[i] + S.cto[i] - (v.mediaTime || 0)) / v.timescale;
  const span = Math.max(1e-3, (S.dts[n - 1] - S.dts[0]) / v.timescale);
  const fps = Math.min(60, Math.max(1, Math.round((n - 1) / span)));
  const f = Math.min(1, PROXY_SHORT / Math.min(v.width, v.height));
  const PW = Math.max(2, Math.round((v.width * f) / 2) * 2), PH = Math.max(2, Math.round((v.height * f) / 2) * 2);
  const gop = Math.max(1, Math.round(fps / 2));

  const dcfg = { codec: v.codec, codedWidth: v.width, codedHeight: v.height, hardwareAcceleration: 'prefer-hardware', ...(v.description ? { description: v.description } : {}) };
  if (!(await VideoDecoder.isConfigSupported(dcfg)).supported) { delete dcfg.hardwareAcceleration; if (!(await VideoDecoder.isConfigSupported(dcfg)).supported) throw new Error('sem decodificador para ' + v.codec); }
  const enc0 = await pickVideoCodec(PW, PH, fps, PW * PH * fps * 0.12);
  if (!enc0) throw new Error('sem codificador de vídeo');

  const target = new Mux.ArrayBufferTarget();
  const muxer = new Mux.Muxer({
    target, fastStart: 'in-memory', firstTimestampBehavior: 'cross-track-offset',
    video: { codec: enc0.mux, width: PW, height: PH, frameRate: fps },
    ...(au ? { audio: { codec: audioMux, numberOfChannels: au.numberOfChannels, sampleRate: au.sampleRate } } : {}),
  });

  // áudio: as amostras originais vão direto para o proxy (sem perda e quase sem custo)
  if (au) {
    const A = au.S, m = A.off.length, at = (i) => (A.dts[i] - (au.mediaTime || 0)) / au.timescale;
    const meta = { decoderConfig: { codec: au.codec, sampleRate: au.sampleRate, numberOfChannels: au.numberOfChannels, ...(au.description ? { description: au.description } : {}) } };
    let first = true;
    for (let i = 0; i < m;) {
      let j = i;
      while (j + 1 < m && A.off[j + 1] >= A.off[i] && A.off[j + 1] + A.size[j + 1] - A.off[i] < 8e6) j++;
      const lo = A.off[i], hi = Math.max(...Array.from({ length: j - i + 1 }, (_, q) => A.off[i + q] + A.size[i + q]));
      const buf = new Uint8Array(await file.slice(lo, hi).arrayBuffer());
      for (let k = i; k <= j; k++) {
        const ts = at(k);
        if (ts < 0) continue;
        const dur = k + 1 < m ? at(k + 1) - ts : k > 0 ? ts - at(k - 1) : 0.02;
        muxer.addAudioChunkRaw(buf.slice(A.off[k] - lo, A.off[k] - lo + A.size[k]), 'key', Math.round(ts * 1e6), Math.round(dur * 1e6), first ? meta : undefined);
        first = false;
      }
      i = j + 1;
      if (isCancelled()) throw new DOMException('cancelado', 'AbortError');
    }
  }

  // vídeo: decodifica em ordem, reduz para 540p e recodifica com quadro-chave a cada meio segundo
  let failure = null, out = 0;
  const enc = new VideoEncoder({ output: (ch, meta) => muxer.addVideoChunk(ch, meta), error: (e) => { failure = e; } });
  enc.configure(enc0.cfg);
  const oc = new OffscreenCanvas(PW, PH), ox = oc.getContext('2d');
  const dec = new VideoDecoder({
    output: (fr) => {
      try {
        if (fr.timestamp < 0) return;   // pré-rolagem de lista de edição
        ox.drawImage(fr, 0, 0, PW, PH);
        const vf = new VideoFrame(oc, { timestamp: fr.timestamp, duration: fr.duration ?? Math.round(1e6 / fps) });
        enc.encode(vf, { keyFrame: out % gop === 0 });
        vf.close();
        out++;
      } finally { fr.close(); }
    },
    error: (e) => { failure = e; },
  });
  dec.configure(dcfg);
  for (let i = 0; i < n && !failure;) {
    // blocos contíguos de até 16 MB (vídeo e áudio vêm intercalados no arquivo)
    let j = i, hi = S.off[i] + S.size[i];
    while (j + 1 < n && S.off[j + 1] >= S.off[i] && S.off[j + 1] + S.size[j + 1] - S.off[i] < 16e6) { j++; hi = Math.max(hi, S.off[j] + S.size[j]); }
    const lo = S.off[i];
    const buf = new Uint8Array(await file.slice(lo, hi).arrayBuffer());
    for (let k = i; k <= j && !failure; k++) {
      dec.decode(new EncodedVideoChunk({ type: S.sync[k] ? 'key' : 'delta', timestamp: Math.round(pts(k) * 1e6), data: buf.subarray(S.off[k] - lo, S.off[k] - lo + S.size[k]) }));
      // sem pressa: deixa o navegador (e a reprodução) respirar entre lotes
      while (!failure && (dec.decodeQueueSize > 4 || enc.encodeQueueSize > 4)) await new Promise((r) => setTimeout(r, 0));
      if (isCancelled()) { try { dec.close(); enc.close(); } catch { /* já fechados */ } throw new DOMException('cancelado', 'AbortError'); }
    }
    onProgress(Math.min(0.99, (j + 1) / n));
    i = j + 1;
  }
  if (!failure) await dec.flush().catch((e) => { failure = e; });
  if (!failure) await enc.flush().catch((e) => { failure = e; });
  try { dec.close(); enc.close(); } catch { /* já fechados */ }
  if (failure) throw failure;
  muxer.finalize();
  onProgress(1);
  return new Blob([target.buffer], { type: 'video/mp4' });
}
