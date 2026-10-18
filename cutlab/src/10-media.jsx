/* =====================================================================
   Mídia: análise de arquivos, miniaturas, forma de onda, efeitos sonoros
   ===================================================================== */
function computePeaks(buffer, n = 400) {
  const data = buffer.getChannelData(0);
  const block = Math.max(1, Math.floor(data.length / n));
  const stride = Math.max(1, Math.floor(block / 64));
  const out = [];
  let max = 0;
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let j = i * block; j < (i + 1) * block && j < data.length; j += stride) m = Math.max(m, Math.abs(data[j]));
    out.push(m);
    max = Math.max(max, m);
  }
  return out.map((v) => (max ? v / max : 0));
}

async function analyzeFile(type, url, file) {
  if (type === 'image') {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res({ width: img.naturalWidth, height: img.naturalHeight, duration: 5, thumb: url });
      img.onerror = rej;
      img.src = url;
    });
  }
  if (type === 'video') {
    const fps = file ? mediaFps(file) : Promise.resolve(null);   // em paralelo com a miniatura
    return new Promise((res, rej) => {
      const v = document.createElement('video');
      v.preload = 'auto';
      v.muted = true;
      let done = false;
      v.onloadedmetadata = () => { v.currentTime = Math.min(1, (isFinite(v.duration) ? v.duration : 1) / 3); };
      v.onseeked = () => {
        if (done) return;
        done = true;
        const h = 90, w = Math.round((h * v.videoWidth) / v.videoHeight) || 160;
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(v, 0, 0, w, h);
        const meta = { duration: isFinite(v.duration) ? v.duration : 10, width: v.videoWidth, height: v.videoHeight, thumb: c.toDataURL('image/jpeg', 0.7) };
        fps.then((f) => res({ ...meta, fps: f }));
      };
      v.onerror = () => !done && rej(new Error('vídeo inválido'));
      v.src = url;
    });
  }
  // áudio
  const buf = await file.arrayBuffer();
  const ac = new OfflineAudioContext(1, 1, 44100);
  const audio = await ac.decodeAudioData(buf);
  return { duration: audio.duration, peaks: computePeaks(audio) };
}

function encodeWav(buffer) {
  const ch = buffer.numberOfChannels, sr = buffer.sampleRate, len = buffer.length;
  const view = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const w = (o, s) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); view.setUint32(4, 36 + len * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, ch, true);
  view.setUint32(24, sr, true); view.setUint32(28, sr * ch * 2, true); view.setUint16(32, ch * 2, true);
  view.setUint16(34, 16, true); w(36, 'data'); view.setUint32(40, len * ch * 2, true);
  const chans = [...Array(ch)].map((_, i) => buffer.getChannelData(i));
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) { view.setInt16(o, clamp(chans[c][i], -1, 1) * 0x7fff, true); o += 2; }
  return new Blob([view], { type: 'audio/wav' });
}

const env = (ctx, g, t0, a, peak, d) => {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
};
const tone = (ctx, type, f0, f1, t0, dur, peak, dest = ctx.destination) => {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  env(ctx, g, t0, 0.005, peak, dur);
  o.connect(g).connect(dest);
  o.start(t0); o.stop(t0 + dur + 0.05);
};
const noise = (ctx, t0, dur, peak, filterType, f0, f1, q = 1) => {
  const b = ctx.createBuffer(1, Math.ceil(dur * ctx.sampleRate), ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = ctx.createBufferSource(); s.buffer = b;
  const f = ctx.createBiquadFilter(); f.type = filterType; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t0);
  if (f1) f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + dur * 0.5);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(f).connect(g).connect(ctx.destination);
  s.start(t0);
};
const SFX = [
  { id: 'pop', name: 'Pop', dur: 0.25, build: (c) => tone(c, 'sine', 700, 120, 0, 0.18, 0.7) },
  { id: 'beep', name: 'Bipe', dur: 0.4, build: (c) => tone(c, 'sine', 880, 0, 0, 0.3, 0.4) },
  { id: 'ding', name: 'Ding', dur: 1.6, build: (c) => { tone(c, 'sine', 1318.5, 0, 0, 1.5, 0.45); tone(c, 'sine', 2637, 0, 0, 0.9, 0.12); } },
  { id: 'whoosh', name: 'Whoosh', dur: 0.9, build: (c) => noise(c, 0, 0.85, 0.6, 'bandpass', 250, 4000, 2) },
  { id: 'kick', name: 'Impacto', dur: 0.8, build: (c) => { tone(c, 'sine', 160, 38, 0, 0.6, 1); noise(c, 0, 0.25, 0.3, 'lowpass', 2000, 200); } },
  { id: 'lofi', name: 'Batida lo-fi (8s)', dur: 8, build: (c) => {
    for (let b = 0; b < 16; b++) {
      const t = b * 0.5;
      if (b % 2 === 0) tone(c, 'sine', 140, 42, t, 0.4, 0.9);
      else noise(c, t, 0.2, 0.35, 'highpass', 1800, 0);
      noise(c, t + 0.25, 0.06, 0.12, 'highpass', 7000, 0);
    }
    const pad = c.createGain(); pad.gain.value = 0.05; pad.connect(c.destination);
    [[220, 261.6, 329.6], [196, 246.9, 293.7], [174.6, 220, 261.6], [196, 246.9, 329.6]].forEach((ch, i) =>
      ch.forEach((f) => { const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f; const g = c.createGain(); env(c, g, i * 2, 0.3, 1, 1.6); o.connect(g).connect(pad); o.start(i * 2); o.stop(i * 2 + 2); }));
  } },
  { id: 'pad', name: 'Trilha ambiente (12s)', dur: 12, build: (c) => {
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; lp.connect(c.destination);
    [220, 277.18, 329.63, 440, 554.37].forEach((f, i) => {
      const o = c.createOscillator(); o.type = i % 2 ? 'sine' : 'triangle'; o.frequency.value = f; o.detune.value = (i - 2) * 4;
      const g = c.createGain(); g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(0.07, 2.5); g.gain.setValueAtTime(0.07, 9.5); g.gain.linearRampToValueAtTime(0, 12);
      o.connect(g).connect(lp); o.start(0); o.stop(12);
    });
  } },
];
async function renderSfx(def) {
  const sr = 44100;
  const ctx = new OfflineAudioContext(2, Math.ceil(def.dur * sr), sr);
  def.build(ctx);
  const buf = await ctx.startRendering();
  return { url: URL.createObjectURL(encodeWav(buf)), duration: def.dur, peaks: computePeaks(buf) };
}


/** captura um quadro do vídeo (tempo na mídia de origem) em PNG */
function grabFrame(url, time) {
  return new Promise((res, rej) => {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.onloadedmetadata = () => { v.currentTime = clamp(time, 0, Math.max(0, (isFinite(v.duration) ? v.duration : time) - 0.001)); };
    v.onseeked = () => {
      const c = document.createElement('canvas');
      c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0);
      c.toBlob((b) => (b ? res({ blob: b, width: c.width, height: c.height }) : rej(new Error('falha ao gerar a imagem'))), 'image/png');
    };
    v.onerror = () => rej(new Error('vídeo inválido'));
    v.src = url;
  });
}
