/* =====================================================================
   Legendas automáticas: transcrição da fala no próprio navegador (Whisper)
   - modelo baixado uma vez do Hugging Face e guardado no cache do navegador
   - WebGPU quando disponível; senão WebAssembly (mais lento)
   - tempo de cada palavra → legendas com destaque palavra por palavra
   ===================================================================== */
const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2';
const ASR_MODELS = {
  rapido: { id: 'onnx-community/whisper-base_timestamped', name: 'Rápido', size: '≈ 80 MB' },
  preciso: { id: 'onnx-community/whisper-small_timestamped', name: 'Preciso', size: '≈ 250 MB' },
};
const ASR_LANGS = [['portuguese', 'Português'], ['english', 'Inglês'], ['spanish', 'Espanhol'], ['french', 'Francês'], ['italian', 'Italiano'], ['german', 'Alemão'], [null, 'Detectar']];

const _asr = new Map();
/** pipeline de transcrição (carregado uma vez por modelo); onProgress recebe 0..1 do download */
async function loadAsr(modelKey, onProgress) {
  if (_asr.has(modelKey)) return _asr.get(modelKey);
  const p = (async () => {
    const T = await import(TRANSFORMERS_URL);
    const files = new Map();
    const progress_callback = (e) => {
      if (e.status === 'progress' && e.total) {
        files.set(e.file, [e.loaded, e.total]);
        let a = 0, b = 0;
        for (const [l, t] of files.values()) { a += l; b += t; }
        onProgress?.(b ? a / b : 0);
      }
    };
    const gpu = !!navigator.gpu && !!(await navigator.gpu.requestAdapter().catch(() => null));
    const opts = gpu
      ? { device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, progress_callback }
      : { device: 'wasm', dtype: 'q8', progress_callback };
    return T.pipeline('automatic-speech-recognition', ASR_MODELS[modelKey].id, opts);
  })();
  _asr.set(modelKey, p);
  p.catch(() => _asr.delete(modelKey));
  return p;
}

/** áudio do projeto (mesma mixagem da exportação) em mono 16 kHz, como o Whisper espera */
async function projectSpeech(clips, assetMap, ts, from, to) {
  const buf = await mixProjectAudio(clips, assetMap, ts, to, 16000);
  const a = Math.floor(from * 16000), L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const out = new Float32Array(Math.max(0, L.length - a));
  for (let i = 0; i < out.length; i++) out[i] = (L[a + i] + R[a + i]) / 2;
  out.unread = buf.unread || [];
  return out;
}

/**
 * transcreve e devolve palavras { w, s, e } em segundos do projeto.
 * onStage(texto, fração 0..1) informa o andamento.
 */
async function transcribeProject({ clips, assetMap, trackState, from = 0, to, lang, model, onStage }) {
  onStage('Preparando o áudio…', 0);
  const pcm = await projectSpeech(clips, assetMap, trackState, from, to);
  let peak = 0;
  for (let i = 0; i < pcm.length; i += 64) peak = Math.max(peak, Math.abs(pcm[i]));
  if (peak < 0.01) {
    if (pcm.unread.length) throw new Error(`não consegui ler o áudio de “${pcm.unread.join('”, “')}” neste navegador (formato de áudio não suportado)`);
    throw new Error('Não há áudio audível no trecho (verifique se as faixas não estão mudas)');
  }
  onStage(`Baixando o modelo ${ASR_MODELS[model].name} (${ASR_MODELS[model].size}, só na primeira vez)…`, 0);
  const asr = await loadAsr(model, (f) => onStage(`Baixando o modelo ${ASR_MODELS[model].name}… ${Math.round(f * 100)}%`, f * 0.4));
  // O Whisper "puxa" as palavras para o começo quando há silêncio antes da fala:
  // transcrevemos só os trechos com voz, cada um com o seu deslocamento real.
  const { voiced, regions } = speechRegions(pcm, 16000);
  if (!regions.length) throw new Error('Não há fala audível no trecho');
  const words = [];
  for (let i = 0; i < regions.length; i++) {
    const [a, b] = regions[i];
    onStage(`Ouvindo e transcrevendo… ${regions.length > 1 ? `(trecho ${i + 1} de ${regions.length})` : '(pode levar um pouco)'}`, 0.45 + 0.5 * (i / regions.length));
    const r = await asr(pcm.subarray(Math.floor(a * 16000), Math.ceil(b * 16000)),
      { return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5, task: 'transcribe', ...(lang ? { language: lang } : {}) });
    for (const c of r.chunks || []) {
      const w = c.text.trim();
      if (w) words.push({ w, s: a + (c.timestamp[0] ?? 0), e: a + (c.timestamp[1] ?? c.timestamp[0] ?? 0) });
    }
  }
  // palavras sem fim ou fim antes do início (acontece no fim de blocos): usa o início da próxima
  words.forEach((x, i) => { if (!(x.e > x.s)) x.e = words[i + 1]?.s ?? x.s + 0.3; });
  // início que caiu no silêncio (ou no fim da palavra anterior): avança até o próximo
  // começo de som dentro da palavra — um trecho com voz depois de ≥ 0,16 s de silêncio
  const F = 0.02;
  words.forEach((x, i) => {
    // procura até o começo da palavra seguinte: às vezes o Whisper põe a palavra inteira dentro da pausa
    const f0 = Math.floor(x.s / F), f1 = Math.min(voiced.length, Math.ceil(Math.max(x.e, words[i + 1]?.s ?? x.e) / F));
    let quiet = 0, onset = -1, silent = 0;
    for (let f = f0; f < f1; f++) {
      if (!voiced[f]) { quiet++; silent++; continue; }
      // silêncio longo, ou só silêncio desde o início da palavra (sem continuar o som da anterior)
      // (estalos curtos, < 80 ms de som, não contam como começo)
      let run = 0;
      while (run < 4 && voiced[f + run]) run++;
      if (run >= 4 && (quiet >= 8 || (quiet === f - f0 && (f > f0 || !voiced[f0 - 1])))) { onset = f; break; }
      quiet = 0;
    }
    // só move se antes do novo início houver no máximo 0,25 s de som (o rabo da palavra anterior)
    if (onset > f0 && onset - f0 - silent <= 12) {
      x.s = onset * F;
      if (x.e < x.s + 0.15) x.e = Math.min(x.s + 0.3, words[i + 1]?.s ?? Infinity);
    }
  });
  for (const x of words) { x.s += from; x.e += from; }
  onStage('Pronto', 1);
  return words;
}

/**
 * Trechos com voz, por energia em janelas de 20 ms: limiar relativo ao volume da fala,
 * pausas de até 2 s não separam trechos, margem de 0,25 s e no máximo ~28 s cada.
 * Devolve { voiced: bool por janela, regions: [[início, fim], …] em segundos }.
 */
function speechRegions(pcm, sr) {
  const hop = Math.round(sr * 0.02), n = Math.floor(pcm.length / hop);
  const rms = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let s = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) s += pcm[i] * pcm[i];
    rms[f] = Math.sqrt(s / hop);
  }
  const sorted = [...rms].sort((x, y) => x - y);
  const loud = sorted[Math.floor(n * 0.95)] || 0, floor = sorted[Math.floor(n * 0.1)] || 0;
  const thr = Math.max(0.004, floor * 2, loud * 0.08);
  const voiced = Array.from(rms, (v) => v > thr);
  const regions = [];
  let start = -1, lastOn = -1;
  const pad = 0.25, dur = pcm.length / sr;
  const push = () => regions.push([Math.max(0, start * 0.02 - pad), Math.min(dur, (lastOn + 1) * 0.02 + pad)]);
  for (let f = 0; f < n; f++) {
    if (!voiced[f]) continue;
    if (start < 0) start = f;
    else if ((f - lastOn) * 0.02 > 2 || (f - start) * 0.02 > 28) { push(); start = f; }
    lastOn = f;
  }
  if (start >= 0) push();
  // margens não podem se sobrepor
  for (let i = 1; i < regions.length; i++) if (regions[i][0] < regions[i - 1][1]) regions[i][0] = regions[i - 1][1] = (regions[i][0] + regions[i - 1][1]) / 2;
  return { voiced, regions: regions.filter(([a, b]) => b - a > 0.3) };
}

/**
 * uma legenda por palavra: cada uma fica na tela até a próxima começar
 * (pausas curtas não piscam), com no mínimo ~0,2 s para dar tempo de ler.
 */
function wordsToSingleCaptions(words, { gap = 0.5, minDur = 0.2 } = {}) {
  return words.map((w, i) => {
    const next = words[i + 1]?.s ?? Infinity;
    let end = Math.max(w.e, w.s + minDur);
    if (next - end < gap) end = next;            // emenda na próxima se a pausa for curta
    else end = Math.min(end + 0.15, next);
    return { start: w.s, end: Math.max(end, w.s + 0.05), text: w.w };
  });
}

/**
 * agrupa palavras em legendas: quebra em pausas, pontuação final, limite de caracteres e de duração.
 * Cada legenda guarda as palavras com tempo relativo ao início dela (para o destaque).
 */
function wordsToCaptions(words, { maxChars = 32, maxDur = 3.2, gap = 0.6, lines = 1 } = {}) {
  const out = [];
  let cur = [];
  const flush = () => {
    if (!cur.length) return;
    const start = cur[0].s, end = Math.max(cur[cur.length - 1].e, start + 0.4);
    let text = cur.map((x) => x.w).join(' ');
    if (lines > 1 && text.length > maxChars / 2) {
      // quebra em duas linhas no espaço mais próximo do meio
      const mid = text.length / 2;
      let best = -1;
      for (let i = 0; i < text.length; i++) if (text[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
      if (best > 0) text = text.slice(0, best) + '\n' + text.slice(best + 1);
    }
    out.push({ start, end, text, words: cur.map((x) => ({ w: x.w, s: x.s - start, e: x.e - start })) });
    cur = [];
  };
  for (const w of words) {
    if (cur.length) {
      const last = cur[cur.length - 1];
      const len = cur.map((x) => x.w).join(' ').length + 1 + w.w.length;
      const soft = /[,;:]$/.test(last.w) && len > maxChars * lines * 0.5;   // vírgula com a linha já pela metade
      if (w.s - last.e > gap || len > maxChars * lines || w.e - cur[0].s > maxDur || /[.!?…]$/.test(last.w) || soft) flush();
    }
    cur.push(w);
  }
  flush();
  // sem sobreposição: cada legenda termina no máximo onde a próxima começa
  for (let i = 0; i < out.length - 1; i++) out[i].end = Math.min(out[i].end + 0.25, out[i + 1].start);
  return out;
}
