/* =====================================================================
   Proxies de prévia (como a "mídia otimizada" do DaVinci / proxies do CapCut)
   Gravações de tela e vídeos de câmera costumam ter alta resolução, muitos
   quadros por segundo e quadros-chave espaçados: cada busca decodifica segundos
   de vídeo (0,7–2 s) e cortes rápidos deixam várias buscas disputando o
   decodificador com o que está tocando. O proxy é uma cópia leve só para a
   prévia: 540p, quadro-chave a cada meio segundo, áudio copiado sem recodificar.
   Só dos trechos que a linha do tempo usa (não do arquivo bruto inteiro): cada
   trecho vira um proxy próprio, e editar só gera o pedaço que ainda falta.
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
 * gera o proxy (MP4) do trecho [from, to] (segundos do arquivo original). `onProgress(0..1)`;
 * `isCancelled()` interrompe. Devolve { blob, off }: o instante 0 do proxy corresponde a `off`
 * no original. Lança erro quando não dá (codec sem decodificador, áudio que o MP4 não aceita…).
 */
async function makeProxy(file, { from = 0, to = Infinity, onProgress = () => {}, isCancelled = () => false } = {}) {
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
  from = Math.max(0, from);
  const fromUs = Math.round(from * 1e6), toUs = isFinite(to) ? Math.round(to * 1e6) : Infinity;

  // amostras a decodificar: do quadro-chave anterior ao início até um pouco depois do fim
  // (as anteriores ao início só servem de referência e são descartadas)
  let k0 = 0;
  for (let i = 0; i < n; i++) { if (pts(i) > from + 1e-4) break; if (S.sync[i]) k0 = i; }
  let k1 = n - 1;
  if (isFinite(to)) for (let i = k0; i < n; i++) if (pts(i) > to + 0.3) { k1 = Math.min(n - 1, i + 16); break; }

  const dcfg = { codec: v.codec, codedWidth: v.width, codedHeight: v.height, hardwareAcceleration: 'prefer-hardware', ...(v.description ? { description: v.description } : {}) };
  if (!(await VideoDecoder.isConfigSupported(dcfg)).supported) { delete dcfg.hardwareAcceleration; if (!(await VideoDecoder.isConfigSupported(dcfg)).supported) throw new Error('sem decodificador para ' + v.codec); }
  const enc0 = await pickVideoCodec(PW, PH, fps, PW * PH * fps * 0.12);
  if (!enc0) throw new Error('sem codificador de vídeo');
  // codificador da placa de vídeo quando houver (no software o proxy levava minutos)
  const hw = { ...enc0.cfg, hardwareAcceleration: 'prefer-hardware' };
  if ((await VideoEncoder.isConfigSupported(hw).catch(() => ({}))).supported) enc0.cfg = hw;

  const target = new Mux.ArrayBufferTarget();
  // o gerador desloca as duas faixas juntas para começar em 0: o deslocamento volta em `off`
  const muxer = new Mux.Muxer({
    target, fastStart: 'in-memory', firstTimestampBehavior: 'cross-track-offset',
    video: { codec: enc0.mux, width: PW, height: PH, frameRate: fps },
    ...(au ? { audio: { codec: audioMux, numberOfChannels: au.numberOfChannels, sampleRate: au.sampleRate } } : {}),
  });
  let minTs = Infinity;

  // áudio: as amostras originais do trecho vão direto para o proxy (sem perda e quase sem custo)
  if (au) {
    const A = au.S, m = A.off.length, at = (i) => (A.dts[i] - (au.mediaTime || 0)) / au.timescale;
    const meta = { decoderConfig: { codec: au.codec, sampleRate: au.sampleRate, numberOfChannels: au.numberOfChannels, ...(au.description ? { description: au.description } : {}) } };
    let a0 = 0, a1 = m - 1, first = true;
    while (a0 < m - 1 && at(a0 + 1) <= from) a0++;
    if (isFinite(to)) while (a1 > a0 && at(a1) > to) a1--;
    for (let i = a0; i <= a1;) {
      let j = i;
      while (j + 1 <= a1 && A.off[j + 1] >= A.off[i] && A.off[j + 1] + A.size[j + 1] - A.off[i] < 8e6) j++;
      const lo = A.off[i], hi = Math.max(...Array.from({ length: j - i + 1 }, (_, q) => A.off[i + q] + A.size[i + q]));
      const buf = new Uint8Array(await file.slice(lo, hi).arrayBuffer());
      for (let k = i; k <= j; k++) {
        const ts = Math.round(at(k) * 1e6) - fromUs;
        if (ts < 0) continue;
        const dur = k + 1 < m ? at(k + 1) - at(k) : k > 0 ? at(k) - at(k - 1) : 0.02;
        muxer.addAudioChunkRaw(buf.slice(A.off[k] - lo, A.off[k] - lo + A.size[k]), 'key', ts, Math.round(dur * 1e6), first ? meta : undefined);
        minTs = Math.min(minTs, ts);
        first = false;
      }
      i = j + 1;
      if (isCancelled()) throw new DOMException('cancelado', 'AbortError');
    }
  }

  // vídeo: decodifica em ordem, reduz para 540p e recodifica com quadro-chave a cada meio segundo
  let failure = null, out = 0;
  const enc = new VideoEncoder({ output: (ch, meta) => { minTs = Math.min(minTs, ch.timestamp); muxer.addVideoChunk(ch, meta); }, error: (e) => { failure = e; } });
  enc.configure(enc0.cfg);
  const oc = new OffscreenCanvas(PW, PH), ox = oc.getContext('2d');
  const dec = new VideoDecoder({
    output: (fr) => {
      try {
        // fora do trecho (referências antes do início, sobra depois do fim, pré-rolagem): descarta
        if (fr.timestamp < fromUs - 100 || fr.timestamp > toUs + 100) return;
        ox.drawImage(fr, 0, 0, PW, PH);
        const vf = new VideoFrame(oc, { timestamp: Math.max(0, fr.timestamp - fromUs), duration: fr.duration ?? Math.round(1e6 / fps) });
        enc.encode(vf, { keyFrame: out % gop === 0 });
        vf.close();
        out++;
      } finally { fr.close(); }
    },
    error: (e) => { failure = e; },
  });
  dec.configure(dcfg);
  for (let i = k0; i <= k1 && !failure;) {
    // blocos contíguos de até 16 MB (vídeo e áudio vêm intercalados no arquivo)
    let j = i, hi = S.off[i] + S.size[i];
    while (j + 1 <= k1 && S.off[j + 1] >= S.off[i] && S.off[j + 1] + S.size[j + 1] - S.off[i] < 16e6) { j++; hi = Math.max(hi, S.off[j] + S.size[j]); }
    const lo = S.off[i];
    const buf = new Uint8Array(await file.slice(lo, hi).arrayBuffer());
    for (let k = i; k <= j && !failure; k++) {
      dec.decode(new EncodedVideoChunk({ type: S.sync[k] ? 'key' : 'delta', timestamp: Math.round(pts(k) * 1e6), data: buf.subarray(S.off[k] - lo, S.off[k] - lo + S.size[k]) }));
      // fila cheia: espera o decodificador/codificador liberar uma vaga (evento 'dequeue'). Antes era
      // setTimeout(0) com fila de 4 — cada espera custava ≥ 4 ms (e 1 s com a janela em segundo plano),
      // e o decodificador de hardware ficava ocioso a maior parte do tempo
      while (!failure && (dec.decodeQueueSize > 12 || enc.encodeQueueSize > 8)) await drained(dec.decodeQueueSize > 12 ? dec : enc);
      // e cede a vez de tempos em tempos, sem o atraso mínimo do setTimeout: a reprodução continua lisa
      if ((k & 15) === 0) await yieldNow();
      if (isCancelled()) { try { dec.close(); enc.close(); } catch { /* já fechados */ } throw new DOMException('cancelado', 'AbortError'); }
    }
    onProgress(Math.min(0.99, (j + 1 - k0) / (k1 - k0 + 1)));
    i = j + 1;
  }
  if (!failure) await dec.flush().catch((e) => { failure = e; });
  if (!failure) await enc.flush().catch((e) => { failure = e; });
  try { dec.close(); enc.close(); } catch { /* já fechados */ }
  if (failure) throw failure;
  if (!out) throw new Error('trecho sem quadros');
  muxer.finalize();
  onProgress(1);
  return { blob: new Blob([target.buffer], { type: 'video/mp4' }), off: from + (isFinite(minTs) ? minTs : 0) / 1e6 };
}

/** espera o decodificador/codificador tirar algo da fila (com limite: navegadores sem o evento 'dequeue') */
const drained = (codec) => new Promise((r) => {
  const done = () => { codec.removeEventListener?.('dequeue', done); clearTimeout(to); r(); };
  const to = setTimeout(done, 20);
  codec.addEventListener?.('dequeue', done);
});

/* ---------- trechos usados na linha do tempo ---------- */
const PROXY_PAD = 2;     // margem de cada lado: aparar um pouco o corte não exige proxy novo
/**
 * trechos de cada vídeo usados pelos clipes (inclusive dentro de compostos), em s do arquivo:
 * [from, to, núcleoDe, núcleoAté]. O núcleo é o que os clipes usam de fato (pedaços que continuam um
 * no outro viram um só, para o corte entre eles herdar o mesmo player); from/to levam a margem.
 * Só núcleo sem proxy dispara geração — e só daquele trecho, não dos vizinhos.
 */
function usedRanges(clips) {
  const by = new Map();
  for (const c of expandMedia(clips, {})) {
    if (c.type !== 'video' || !c.assetId) continue;
    const a = srcTimeAt(c, 0), b = srcTimeAt(c, c.duration);
    if (!by.has(c.assetId)) by.set(c.assetId, []);
    by.get(c.assetId).push([Math.min(a, b), Math.max(a, b)]);
  }
  for (const [id, rs] of by) {
    rs.sort((x, y) => x[0] - y[0]);
    const core = [];
    for (const r of rs) { const l = core[core.length - 1]; if (l && r[0] <= l[1] + 0.05) l[1] = Math.max(l[1], r[1]); else core.push([...r]); }
    by.set(id, core.map(([x, y]) => [Math.max(0, x - PROXY_PAD), y + PROXY_PAD, x, y]));
  }
  return by;
}
/** trecho de proxy que cobre o intervalo [a, b] do arquivo, se houver */
const proxyCovering = (segs, a, b) => (segs || []).find((s) => s.from <= a + 1e-3 && s.to >= b - 1e-3) || null;
