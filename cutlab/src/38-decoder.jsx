/* =====================================================================
   Motor quadro a quadro (WebCodecs)
   Para clipes com velocidade alterada, o vídeo não é mais "tocado" por um
   <video> com playbackRate variável: para cada quadro de saída calculamos o
   tempo exato na mídia e decodificamos exatamente aquele quadro.
   - Índice MP4 próprio: lê só cabeçalhos de caixas + moov/moof (arquivos de
     horas não são carregados na memória); suporta MP4 normal e fragmentado.
   - Codecs: H.264 (avc1/avc3), H.265 (hvc1/hev1), AV1 (av01), VP9 (vp09).
   ===================================================================== */
const MP4 = (() => {
  const T = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  function* kids(dv, start, end) {
    let o = start;
    while (o + 8 <= end) {
      let size = dv.getUint32(o), hdr = 8;
      const t = T(dv, o + 4);
      if (size === 1) { size = Number(dv.getBigUint64(o + 8)); hdr = 16; } else if (size === 0) size = end - o;
      if (size < hdr) break;
      yield { t, o, body: o + hdr, end: Math.min(o + size, end) };
      o += size;
    }
  }
  const find = (dv, b, t) => { for (const k of kids(dv, b.body, b.end)) if (k.t === t) return k; return null; };
  const path = (dv, b, ...ts) => { let c = b; for (const t of ts) { c = c && find(dv, c, t); } return c; };
  const hex = (v) => v.toString(16).padStart(2, '0');
  const pad2 = (v) => String(v).padStart(2, '0');

  async function topLevel(file) {
    const boxes = [];
    let pos = 0;
    while (pos + 8 <= file.size) {
      const h = new DataView(await file.slice(pos, pos + 16).arrayBuffer());
      let size = h.getUint32(0), hdr = 8;
      const t = T(h, 4);
      if (size === 1) { size = Number(h.getBigUint64(8)); hdr = 16; } else if (size === 0) size = file.size - pos;
      if (size < 8 || !/^[\x20-\x7e]{4}$/.test(t)) break;
      boxes.push({ t, pos, size, hdr });
      pos += size;
    }
    return boxes;
  }
  async function readBox(file, b) {
    const buf = await file.slice(b.pos, b.pos + b.size).arrayBuffer();
    const dv = new DataView(buf);
    return { dv, root: { t: b.t, o: 0, body: b.hdr, end: buf.byteLength } };
  }

  function codecOf(dv, entry) {
    const st = entry.t;
    for (const k of kids(dv, entry.body + 78, entry.end)) {
      const bytes = new Uint8Array(dv.buffer, dv.byteOffset + k.body, k.end - k.body);
      if (k.t === 'avcC') return { codec: `${st}.${hex(bytes[1])}${hex(bytes[2])}${hex(bytes[3])}`, description: bytes.slice() };
      if (k.t === 'hvcC') {
        const space = bytes[1] >> 6, tier = (bytes[1] >> 5) & 1, prof = bytes[1] & 31;
        const compat = ((bytes[2] << 24) | (bytes[3] << 16) | (bytes[4] << 8) | bytes[5]) >>> 0;
        let rev = 0;
        for (let i = 0; i < 32; i++) if (compat & (1 << i)) rev |= 1 << (31 - i);
        const cons = [6, 7, 8, 9, 10, 11].map((i) => bytes[i]);
        while (cons.length && !cons[cons.length - 1]) cons.pop();
        return { codec: [st, ['', 'A', 'B', 'C'][space] + prof, (rev >>> 0).toString(16), (tier ? 'H' : 'L') + bytes[12], ...cons.map((c) => c.toString(16))].join('.'), description: bytes.slice() };
      }
      if (k.t === 'av1C') {
        const prof = bytes[1] >> 5, lvl = bytes[1] & 31, tier = bytes[2] >> 7, hi = (bytes[2] >> 6) & 1, tw = (bytes[2] >> 5) & 1;
        return { codec: `av01.${prof}.${pad2(lvl)}${tier ? 'H' : 'M'}.${pad2(hi ? (tw ? 12 : 10) : 8)}` };
      }
      if (k.t === 'vpcC') return { codec: `vp09.${pad2(bytes[4])}.${pad2(bytes[5])}.${pad2(bytes[6] >> 4)}` };
    }
    return null;
  }

  /** configuração do AudioDecoder a partir de uma entrada mp4a (AAC/MP3 dentro de MP4) */
  function audioCodecOf(dv, entry) {
    if (entry.t !== 'mp4a') return null;
    const ver = dv.getUint16(entry.body + 8);
    const channels = dv.getUint16(entry.body + 16), sampleRate = dv.getUint32(entry.body + 24) >>> 16;
    const esds = [...kids(dv, entry.body + 28 + (ver === 1 ? 16 : ver === 2 ? 36 : 0), entry.end)].find((k) => k.t === 'esds');
    if (!esds) return { codec: 'mp4a.40.2', sampleRate, numberOfChannels: channels };
    // descritores MPEG-4: ES (3) → DecoderConfig (4) → DecoderSpecificInfo (5)
    let o = esds.body + 4, oti = 0x40, asc = null;
    const end = esds.end;
    const len = () => { let n = 0; for (let i = 0; i < 4; i++) { const b = dv.getUint8(o++); n = (n << 7) | (b & 0x7f); if (!(b & 0x80)) break; } return n; };
    while (o < end - 2) {
      const tag = dv.getUint8(o++), n = len();
      if (tag === 3) { const fl = dv.getUint8(o + 2); o += 3; if (fl & 0x80) o += 2; if (fl & 0x40) o += 1 + dv.getUint8(o); if (fl & 0x20) o += 2; }
      else if (tag === 4) { oti = dv.getUint8(o); o += 13; }
      else if (tag === 5) { asc = new Uint8Array(dv.buffer, dv.byteOffset + o, n).slice(); break; }
      else o += n;
    }
    if (oti === 0x69 || oti === 0x6b) return { codec: 'mp3', sampleRate, numberOfChannels: channels };
    let aot = asc ? asc[0] >> 3 : 2;
    if (aot === 31 && asc) aot = 32 + (((asc[0] & 7) << 3) | (asc[1] >> 5));
    return { codec: `mp4a.40.${aot}`, sampleRate, numberOfChannels: channels, ...(asc ? { description: asc } : {}) };
  }

  /** extrai a tabela de amostras do primeiro trak do tipo pedido ('vide' ou 'soun') */
  function parseMoov(dv, root, kind = 'vide') {
    let trex = {};
    const mvex = find(dv, root, 'mvex');
    if (mvex) for (const k of kids(dv, mvex.body, mvex.end)) if (k.t === 'trex') {
      trex[dv.getUint32(k.body + 4)] = { dur: dv.getUint32(k.body + 12), size: dv.getUint32(k.body + 16), flags: dv.getUint32(k.body + 20) };
    }
    for (const trak of kids(dv, root.body, root.end)) {
      if (trak.t !== 'trak') continue;
      const hdlr = path(dv, trak, 'mdia', 'hdlr');
      if (!hdlr || T(dv, hdlr.body + 8) !== kind) continue;
      const tkhd = find(dv, trak, 'tkhd');
      const trackId = dv.getUint8(tkhd.body) ? dv.getUint32(tkhd.body + 20) : dv.getUint32(tkhd.body + 12);
      const mdhd = path(dv, trak, 'mdia', 'mdhd');
      const timescale = dv.getUint8(mdhd.body) ? dv.getUint32(mdhd.body + 20) : dv.getUint32(mdhd.body + 12);
      let mediaTime = 0;
      const elst = path(dv, trak, 'edts', 'elst');
      if (elst) {
        const v = dv.getUint8(elst.body), cnt = dv.getUint32(elst.body + 4);
        let o = elst.body + 8;
        for (let i = 0; i < cnt; i++) {
          const mt = v ? Number(dv.getBigInt64(o + 8)) : dv.getInt32(o + 4);
          o += v ? 20 : 12;
          if (mt >= 0) { mediaTime = mt; break; }
        }
      }
      const stbl = path(dv, trak, 'mdia', 'minf', 'stbl');
      const stsd = find(dv, stbl, 'stsd');
      const entry = kids(dv, stsd.body + 8, stsd.end).next().value;
      const audio = kind === 'soun';
      const width = audio ? 0 : dv.getUint16(entry.body + 24), height = audio ? 0 : dv.getUint16(entry.body + 26);
      const cc = audio ? audioCodecOf(dv, entry) : codecOf(dv, entry);
      if (!cc) throw new Error(`Codec ${audio ? 'de áudio' : 'de vídeo'} não suportado (${entry.t})`);

      const S = { off: [], size: [], dts: [], cto: [], sync: [] };
      const stsz = find(dv, stbl, 'stsz');
      const count = stsz ? dv.getUint32(stsz.body + 8) : 0;
      if (count) {
        const fixed = dv.getUint32(stsz.body + 4);
        for (let i = 0; i < count; i++) S.size.push(fixed || dv.getUint32(stsz.body + 12 + i * 4));
        const stts = find(dv, stbl, 'stts');
        let t = 0;
        for (let i = 0, n = dv.getUint32(stts.body + 4), o = stts.body + 8; i < n; i++, o += 8) {
          const c = dv.getUint32(o), d = dv.getUint32(o + 4);
          for (let j = 0; j < c; j++) { S.dts.push(t); t += d; }
        }
        const ctts = find(dv, stbl, 'ctts');
        if (ctts) for (let i = 0, n = dv.getUint32(ctts.body + 4), o = ctts.body + 8; i < n; i++, o += 8) {
          const c = dv.getUint32(o), d = dv.getInt32(o + 4);
          for (let j = 0; j < c; j++) S.cto.push(d);
        }
        while (S.cto.length < count) S.cto.push(0);
        const stco = find(dv, stbl, 'stco'), co64 = find(dv, stbl, 'co64');
        const chunks = [];
        if (stco) for (let i = 0, n = dv.getUint32(stco.body + 4); i < n; i++) chunks.push(dv.getUint32(stco.body + 8 + i * 4));
        else for (let i = 0, n = dv.getUint32(co64.body + 4); i < n; i++) chunks.push(Number(dv.getBigUint64(co64.body + 8 + i * 8)));
        const stsc = find(dv, stbl, 'stsc');
        const rows = [];
        for (let i = 0, n = dv.getUint32(stsc.body + 4), o = stsc.body + 8; i < n; i++, o += 12) rows.push([dv.getUint32(o), dv.getUint32(o + 4)]);
        let s = 0;
        for (let r = 0; r < rows.length; r++) {
          const first = rows[r][0] - 1, last = r + 1 < rows.length ? rows[r + 1][0] - 1 : chunks.length;
          for (let ch = first; ch < last && s < count; ch++) {
            let o = chunks[ch];
            for (let j = 0; j < rows[r][1] && s < count; j++, s++) { S.off.push(o); o += S.size[s]; }
          }
        }
        const stss = find(dv, stbl, 'stss');
        if (stss) {
          S.sync = new Array(count).fill(0);
          for (let i = 0, n = dv.getUint32(stss.body + 4); i < n; i++) S.sync[dv.getUint32(stss.body + 8 + i * 4) - 1] = 1;
        } else S.sync = new Array(count).fill(1);
      }
      return { trackId, timescale, mediaTime, width, height, ...cc, S, trex: trex[trackId] || { dur: 0, size: 0, flags: 0 } };
    }
    throw new Error(kind === 'soun' ? 'Nenhuma faixa de áudio no arquivo' : 'Nenhuma faixa de vídeo no arquivo');
  }

  /** acrescenta as amostras de um moof (MP4 fragmentado) */
  function parseMoof(dv, root, moofPos, info) {
    const S = info.S;
    for (const traf of kids(dv, root.body, root.end)) {
      if (traf.t !== 'traf') continue;
      const tfhd = find(dv, traf, 'tfhd');
      const fl = dv.getUint32(tfhd.body) & 0xffffff;
      if (dv.getUint32(tfhd.body + 4) !== info.trackId) continue;
      let p = tfhd.body + 8, base = moofPos, dDur = info.trex.dur, dSize = info.trex.size, dFlags = info.trex.flags;
      if (fl & 1) { base = Number(dv.getBigUint64(p)); p += 8; }
      if (fl & 2) p += 4;
      if (fl & 8) { dDur = dv.getUint32(p); p += 4; }
      if (fl & 0x10) { dSize = dv.getUint32(p); p += 4; }
      if (fl & 0x20) { dFlags = dv.getUint32(p); p += 4; }
      const tfdt = find(dv, traf, 'tfdt');
      let t = tfdt ? (dv.getUint8(tfdt.body) ? Number(dv.getBigUint64(tfdt.body + 4)) : dv.getUint32(tfdt.body + 4)) : (S.dts.length ? S.dts[S.dts.length - 1] + dDur : 0);
      for (const trun of kids(dv, traf.body, traf.end)) {
        if (trun.t !== 'trun') continue;
        const tf = dv.getUint32(trun.body) & 0xffffff, n = dv.getUint32(trun.body + 4);
        let q = trun.body + 8, off = base, firstFlags = null;
        if (tf & 1) { off = base + dv.getInt32(q); q += 4; }
        if (tf & 4) { firstFlags = dv.getUint32(q); q += 4; }
        for (let i = 0; i < n; i++) {
          let dur = dDur, size = dSize, flags = i === 0 && firstFlags != null ? firstFlags : dFlags, cto = 0;
          if (tf & 0x100) { dur = dv.getUint32(q); q += 4; }
          if (tf & 0x200) { size = dv.getUint32(q); q += 4; }
          if (tf & 0x400) { flags = dv.getUint32(q); q += 4; }
          if (tf & 0x800) { cto = dv.getInt32(q); q += 4; }
          S.off.push(off); S.size.push(size); S.dts.push(t); S.cto.push(cto); S.sync.push(((flags >> 16) & 1) ? 0 : 1);
          off += size; t += dur;
        }
      }
    }
  }

  async function index(file, kind = 'vide') {
    const top = await topLevel(file);
    const moovB = top.find((b) => b.t === 'moov');
    if (!moovB) throw new Error('Arquivo sem índice (moov)');
    const { dv, root } = await readBox(file, moovB);
    const info = parseMoov(dv, root, kind);
    for (const b of top) if (b.t === 'moof') { const m = await readBox(file, b); parseMoof(m.dv, m.root, b.pos, info); }
    if (!info.S.off.length) throw new Error(kind === 'soun' ? 'Nenhuma amostra de áudio encontrada' : 'Nenhuma amostra de vídeo encontrada');
    return info;
  }
  return { index };
})();

/** quadros por segundo de um vídeo MP4 (pelo índice: nº de quadros ÷ duração); null se não der para ler */
async function mediaFps(file) {
  try {
    const { S, timescale } = await MP4.index(file, 'vide');
    const n = S.dts.length;
    if (n < 2) return null;
    const span = (S.dts[n - 1] - S.dts[0]) / timescale;
    return span > 0 ? Math.round(((n - 1) / span) * 100) / 100 : null;
  } catch { return null; }
}
/** taxa de exportação sugerida: a do vídeo mais fluido do projeto, arredondada para um padrão → { suggest, source } */
async function projectFps(clips, assetMap, ts = {}) {
  let best = 0;
  for (const c of expandMedia(clips, ts)) {
    const a = c.type === 'video' && assetMap[c.assetId];
    if (!a) continue;
    if (a.fps == null && a.file) a.fps = await mediaFps(a.file);   // projetos antigos: calcula agora
    best = Math.max(best, a.fps || 0);
  }
  if (!best) return { suggest: 30, source: null };
  return { suggest: EXPORT_FPS.reduce((p, f) => (Math.abs(f - best) < Math.abs(p - best) ? f : p), 30), source: best };
}
const EXPORT_FPS = [24, 25, 30, 50, 60];

/**
 * Áudio de um MP4 pelo índice próprio + AudioDecoder (WebCodecs), só no trecho [from, to] em segundos.
 * Plano B para quando decodeAudioData recusa o arquivo (MP4 fragmentado de gravadores de tela,
 * arquivos muito grandes…). Devolve { sampleRate, channels: Float32Array[], offset } ou null sem áudio.
 */
async function decodeMp4Audio(file, from = 0, to = Infinity) {
  if (typeof AudioDecoder === 'undefined') return null;
  let info;
  try { info = await MP4.index(file, 'soun'); } catch { return null; }
  const { S, timescale } = info;
  const t0 = info.mediaTime || 0;
  const sec = (i) => (S.dts[i] - t0) / timescale;
  const cfg = { codec: info.codec, sampleRate: info.sampleRate, numberOfChannels: info.numberOfChannels, ...(info.description ? { description: info.description } : {}) };
  if (!(await AudioDecoder.isConfigSupported(cfg).catch(() => ({}))).supported) return null;
  // amostras do trecho (com folga: o AAC precisa de um quadro antes para aquecer)
  let a = 0, b = S.off.length;
  while (a < b - 1 && sec(a + 1) <= from - 0.1) a++;
  while (b > a + 1 && sec(b - 1) > to + 0.1) b--;
  const parts = [];
  let total = 0, rate = info.sampleRate, nch = info.numberOfChannels, firstTs = null, failed = null;
  const dec = new AudioDecoder({
    output: (d) => {
      rate = d.sampleRate; nch = d.numberOfChannels;
      if (firstTs == null) firstTs = d.timestamp / 1e6;
      const ch = [];
      for (let c = 0; c < nch; c++) { const arr = new Float32Array(d.numberOfFrames); d.copyTo(arr, { planeIndex: c, format: 'f32-planar' }); ch.push(arr); }
      parts.push(ch); total += d.numberOfFrames;
      d.close();
    },
    error: (e) => { failed = e; },
  });
  dec.configure(cfg);
  // lê em blocos contíguos de até 8 MB (áudio e vídeo costumam vir intercalados)
  for (let i = a; i < b && !failed;) {
    let j = i, end = S.off[i] + S.size[i];
    while (j + 1 < b && S.off[j + 1] >= S.off[i] && S.off[j + 1] + S.size[j + 1] - S.off[i] < 8e6) { j++; end = Math.max(end, S.off[j] + S.size[j]); }
    const buf = new Uint8Array(await file.slice(S.off[i], end).arrayBuffer());
    for (let k = i; k <= j; k++) {
      const o = S.off[k] - S.off[i];
      dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round(sec(k) * 1e6), data: buf.subarray(o, o + S.size[k]) }));
    }
    i = j + 1;
    if (dec.decodeQueueSize > 200) await new Promise((r) => setTimeout(r, 0));
  }
  if (!failed) await dec.flush().catch((e) => { failed = e; });
  dec.close?.();
  if (failed || !total) return null;
  const channels = Array.from({ length: nch }, () => new Float32Array(total));
  let w = 0;
  for (const ch of parts) { for (let c = 0; c < nch; c++) channels[c].set(ch[c], w); w += ch[0].length; }
  return { sampleRate: rate, channels, offset: Math.max(0, firstTs ?? sec(a)) };
}

/** fonte de quadros exata por tempo, com cache de ImageBitmap e decodificação antecipada */
class FrameSource {
  constructor(file) {
    this.file = file;
    this.state = 'loading';
    this.frames = new Map();
    this.target = -1;
    this.keepLo = 0;
    this.keepHi = -1;
    this.busy = false;
    this.playing = false;
    this.stride = 1;   // acelerado: só um a cada `stride` quadros vira imagem (ver want)
    this.init().catch((e) => { this.state = 'error'; this.error = e?.message || String(e); });
  }
  async init() {
    if (!window.VideoDecoder || !window.EncodedVideoChunk) throw new Error('WebCodecs indisponível neste navegador');
    const info = await MP4.index(this.file);
    const cfg = { codec: info.codec, codedWidth: info.width, codedHeight: info.height, hardwareAcceleration: 'prefer-hardware', optimizeForLatency: true };
    if (info.description) cfg.description = info.description;
    let sup = await VideoDecoder.isConfigSupported(cfg);
    if (!sup.supported) { delete cfg.hardwareAcceleration; sup = await VideoDecoder.isConfigSupported(cfg); }
    if (!sup.supported) throw new Error(`Codec ${info.codec} não suportado pelo decodificador`);
    const { S, timescale, mediaTime } = info;
    const n = S.off.length;
    this.n = n;
    this.cfg = cfg;
    this.codec = info.codec;
    this.width = info.width;
    this.height = info.height;
    [this.outW, this.outH] = capSize(info.width, info.height, 1920);
    this.off = Float64Array.from(S.off);
    this.size = Uint32Array.from(S.size);
    this.sync = Uint8Array.from(S.sync);
    this.pts = Float64Array.from({ length: n }, (_, i) => (S.dts[i] + S.cto[i] - mediaTime) / timescale);
    this.tsUs = Float64Array.from(this.pts, (p) => Math.round(p * 1e6));
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => this.pts[a] - this.pts[b]);
    this.presToDec = Int32Array.from(order);
    this.decToPres = new Int32Array(n);
    order.forEach((d, p) => { this.decToPres[d] = p; });
    this.presPts = Float64Array.from(order, (d) => this.pts[d]);
    this.tsToPres = new Map();
    order.forEach((d, p) => this.tsToPres.set(this.tsUs[d], p));
    this.duration = this.presPts[n - 1] + (n > 1 ? this.presPts[n - 1] - this.presPts[n - 2] : 1 / 30);
    this.fps = n > 1 ? (n - 1) / Math.max(1e-3, this.presPts[n - 1] - this.presPts[0]) : 30;
    this.makeDecoder();
    this.state = 'ready';
  }
  makeDecoder() {
    try { this.dec?.close(); } catch { /* já fechado */ }
    this.dec = new VideoDecoder({
      output: (f) => this.onFrame(f),
      error: () => { this.needKey = true; setTimeout(() => this.makeDecoder(), 0); },
    });
    this.dec.configure(this.cfg);
    this.fed = -1;
    this.needKey = true;
  }
  onFrame(f) {
    const pi = this.tsToPres.get(f.timestamp);
    if (pi == null || pi < this.keepLo || pi > this.keepHi || this.frames.has(pi)) { f.close(); return; }
    // acelerado: quadro que não chega a aparecer não vira imagem (o mais caro aqui é o createImageBitmap)
    if (this.stride > 1 && pi % this.stride && pi !== this.target) { f.close(); return; }
    this.pending = (this.pending || 0) + 1;
    createImageBitmap(f, { resizeWidth: this.outW, resizeHeight: this.outH, resizeQuality: 'medium' })
      .then((bm) => { if (this.frames.has(pi)) bm.close(); else { this.frames.set(pi, bm); this.evict(); } })
      .catch(() => {})
      .finally(() => { f.close(); this.pending--; });
  }
  evict() {
    const MAX = 72;
    if (this.frames.size <= MAX) return;
    const keys = [...this.frames.keys()].sort((a, b) => this.dist(b) - this.dist(a));
    for (const k of keys.slice(0, this.frames.size - MAX)) { this.frames.get(k).close(); this.frames.delete(k); }
  }
  dist(p) { return p < this.keepLo ? this.keepLo - p + 1000 : p > this.keepHi ? p - this.keepHi + 1000 : Math.abs(p - this.target); }
  /** índice de apresentação do último quadro com tempo ≤ s */
  presAt(s) {
    let lo = 0, hi = this.n - 1;
    if (s <= this.presPts[0]) return 0;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.presPts[mid] <= s + 1e-6) lo = mid; else hi = mid - 1; }
    return lo;
  }
  /** pede o quadro do tempo s; decodifica à frente conforme a velocidade */
  /** `stride` > 1: só guarda um a cada `stride` quadros (acelerado na prévia: os outros nunca aparecem) */
  want(s, rate, playing, blurSpan = 0, stride = 1) {
    if (this.state !== 'ready') return;
    const p = this.presAt(s);
    this.playing = playing;
    this.stride = stride;
    const back = Math.ceil(blurSpan * this.fps / 2) + 2;
    // a janela à frente cabe no cache (72): maior que ele, os quadros da frente eram descartados antes de
    // aparecer e tudo voltava a ser decodificado a partir do quadro-chave — o engasgo em 4×, 8×…
    const ahead = playing ? Math.min(56 * stride, Math.ceil(clamp(rate, 0.05, 16) * this.fps * 0.45 + blurSpan * this.fps / 2) + 3) : 2;
    this.target = p;
    this.keepLo = p - back;
    this.keepHi = Math.min(this.n - 1, p + ahead);
    if (!this.busy) this.pump();
  }
  async readBatch(i, j) {
    const a = this.off[i], b = this.off[j] + this.size[j];
    if (b > a && b - a < 24e6) {
      const buf = new Uint8Array(await this.file.slice(a, b).arrayBuffer());
      return (k) => buf.subarray(this.off[k] - a, this.off[k] - a + this.size[k]);
    }
    const parts = await Promise.all(Array.from({ length: j - i + 1 }, (_, q) => this.file.slice(this.off[i + q], this.off[i + q] + this.size[i + q]).arrayBuffer()));
    return (k) => new Uint8Array(parts[k - i]);
  }
  keyBefore(d) { while (d > 0 && !this.sync[d]) d--; return d; }
  /** há imagem para mostrar no quadro p? (com `stride`, vale a guardada logo antes dele) */
  shown(p) { for (let q = p; q > p - this.stride && q >= 0; q--) if (this.frames.has(q)) return true; return false; }
  async pump() {
    this.busy = true;
    try {
      for (let guard = 0; guard < 400; guard++) {
        const p = this.target;
        if (p < 0 || this.state !== 'ready') break;
        const hi = this.keepHi;
        const dWant = this.presToDec[p];
        let dEnd = 0;
        for (let q = p; q <= hi; q++) dEnd = Math.max(dEnd, this.presToDec[q]);
        dEnd = Math.min(this.n - 1, dEnd + 3);
        const have = this.shown(p) && (this.stride > 1 || p + 1 > hi || this.frames.has(p + 1));
        if (have && this.fed >= dEnd) break;
        // precisa recomeçar de um quadro-chave? (início, salto para trás, salto grande à frente,
        // ou o quadro já passou pelo decodificador e foi descartado)
        const k = this.keyBefore(dWant);
        const lost = this.fed >= dWant + 8 && !this.shown(p) && this.dec.decodeQueueSize === 0 && !this.pending;
        if (this.needKey || this.fed < k - 1 || this.fed - dEnd > 120 || lost) {
          this.dec.reset();
          this.dec.configure(this.cfg);
          this.fed = k - 1;
          this.needKey = false;
        }
        if (this.fed < dEnd) {
          const i = this.fed + 1, j = Math.min(dEnd, i + 23);
          const get = await this.readBatch(i, j);
          if (this.target !== p && Math.abs(this.target - p) > 240) continue;
          for (let d = i; d <= j; d++) {
            while (this.dec.decodeQueueSize > 12) await new Promise((r) => setTimeout(r, 2));
            this.dec.decode(new EncodedVideoChunk({ type: this.sync[d] ? 'key' : 'delta', timestamp: this.tsUs[d], data: get(d) }));
            this.fed = d;
          }
        } else if (!this.playing && !this.frames.has(p)) {
          // pausado: força a saída dos quadros retidos para reordenação
          await this.dec.flush().catch(() => {});
          this.needKey = true;
          await new Promise((r) => setTimeout(r, 0));
          if (!this.frames.has(p)) break;
        } else {
          await new Promise((r) => setTimeout(r, 4));
        }
      }
    } catch (e) {
      this.needKey = true;
    } finally {
      this.busy = false;
    }
  }
  /** quadros vizinhos de s: A (≤ s) e B (seguinte) com o fator de mistura */
  pair(s) {
    const p = this.presAt(s);
    let a = p;
    while (a > p - 90 && a >= 0 && !this.frames.has(a)) a--;
    if (a < 0 || !this.frames.has(a)) return null;
    const A = this.frames.get(a), B = a === p ? this.frames.get(p + 1) : null;
    const tA = this.presPts[a], tB = a + 1 < this.n ? this.presPts[a + 1] : tA + 1 / this.fps;
    return { A, B, a, exact: a === p, t: B ? clamp((s - tA) / Math.max(1e-6, tB - tA), 0, 1) : 0 };
  }
  close() {
    try { this.dec?.close(); } catch { /* ok */ }
    for (const b of this.frames.values()) b.close();
    this.frames.clear();
    this.state = 'closed';
  }
}
