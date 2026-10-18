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
  if (peak < 0.01) throw new Error('Não há áudio audível no trecho (verifique se as faixas não estão mudas)');
  onStage(`Baixando o modelo ${ASR_MODELS[model].name} (${ASR_MODELS[model].size}, só na primeira vez)…`, 0);
  const asr = await loadAsr(model, (f) => onStage(`Baixando o modelo ${ASR_MODELS[model].name}… ${Math.round(f * 100)}%`, f * 0.4));
  onStage('Ouvindo e transcrevendo… (pode levar um pouco)', 0.45);
  const r = await asr(pcm, { return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5, task: 'transcribe', ...(lang ? { language: lang } : {}) });
  const words = (r.chunks || [])
    .map((c) => ({ w: c.text.trim(), s: from + (c.timestamp[0] ?? 0), e: from + (c.timestamp[1] ?? c.timestamp[0] ?? 0) }))
    .filter((x) => x.w);
  // palavras sem fim ou fim antes do início (acontece no fim de blocos): usa o início da próxima
  words.forEach((x, i) => { if (!(x.e > x.s)) x.e = words[i + 1]?.s ?? x.s + 0.3; });
  onStage('Pronto', 1);
  return words;
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
