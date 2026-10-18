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

  /** extrai a tabela de amostras do primeiro trak de vídeo */
  function parseMoov(dv, root) {
    let trex = {};
    const mvex = find(dv, root, 'mvex');
    if (mvex) for (const k of kids(dv, mvex.body, mvex.end)) if (k.t === 'trex') {
      trex[dv.getUint32(k.body + 4)] = { dur: dv.getUint32(k.body + 12), size: dv.getUint32(k.body + 16), flags: dv.getUint32(k.body + 20) };
    }
    for (const trak of kids(dv, root.body, root.end)) {
      if (trak.t !== 'trak') continue;
      const hdlr = path(dv, trak, 'mdia', 'hdlr');
      if (!hdlr || T(dv, hdlr.body + 8) !== 'vide') continue;
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
      const width = dv.getUint16(entry.body + 24), height = dv.getUint16(entry.body + 26);
      const cc = codecOf(dv, entry);
      if (!cc) throw new Error(`Codec de vídeo não suportado (${entry.t})`);

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
    throw new Error('Nenhuma faixa de vídeo no arquivo');
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

  async function index(file) {
    const top = await topLevel(file);
    const moovB = top.find((b) => b.t === 'moov');
    if (!moovB) throw new Error('Arquivo sem índice (moov)');
    const { dv, root } = await readBox(file, moovB);
    const info = parseMoov(dv, root);
    for (const b of top) if (b.t === 'moof') { const m = await readBox(file, b); parseMoof(m.dv, m.root, b.pos, info); }
    if (!info.S.off.length) throw new Error('Nenhuma amostra de vídeo encontrada');
    return info;
  }
  return { index };
})();

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
  want(s, rate, playing, blurSpan = 0) {
    if (this.state !== 'ready') return;
    const p = this.presAt(s);
    this.playing = playing;
    const back = Math.ceil(blurSpan * this.fps / 2) + 2;
    const ahead = playing ? Math.ceil(clamp(rate, 0.05, 16) * this.fps * 0.45 + blurSpan * this.fps / 2) + 3 : 2;
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
        const have = this.frames.has(p) && (p + 1 > hi || this.frames.has(p + 1));
        if (have && this.fed >= dEnd) break;
        // precisa recomeçar de um quadro-chave? (início, salto para trás, salto grande à frente,
        // ou o quadro já passou pelo decodificador e foi descartado)
        const k = this.keyBefore(dWant);
        const lost = this.fed >= dWant + 8 && !this.frames.has(p) && this.dec.decodeQueueSize === 0 && !this.pending;
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
