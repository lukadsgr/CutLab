/* =====================================================================
   Projeto: salvamento automático (IndexedDB) e arquivo .cutlab
   ===================================================================== */
const PROJECT_VERSION = 1;
const DB_NAME = 'cutlab';
const CUTLAB_MAGIC = 'CUTL';
// Mídias maiores que isto não são copiadas para o armazenamento do navegador: o projeto guarda só um
// atalho para o arquivo original. Copiar duplicava cada vídeo no disco do usuário (10 GB de vídeos = +10 GB).
const COPY_MAX = 150 * 1048576;

let dbPromise = null;
function openDb() {
  if (!window.indexedDB) return Promise.reject(new Error('IndexedDB indisponível'));
  return (dbPromise ||= new Promise((res, rej) => {
    const rq = indexedDB.open(DB_NAME, 2);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects');
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
      if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles');   // atalhos para os arquivos originais
    };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => { dbPromise = null; rej(rq.error); };
  }));
}
/** executa `fn(stores)` numa transação e resolve quando ela termina */
async function dbTx(names, mode, fn) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(names, mode);
    const stores = Object.fromEntries(names.map((n) => [n, tx.objectStore(n)]));
    let out;
    Promise.resolve(fn(stores)).then((v) => { out = v; });
    tx.oncomplete = () => res(out);
    tx.onerror = tx.onabort = () => rej(tx.error);
  });
}
const reqP = (rq) => new Promise((res, rej) => { rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });

/** campos da mídia que vão para o JSON (url/arquivo são recriados ao abrir) */
const assetMeta = ({ url, file, loading, missing, reconnect, proxies, ...rest }) => (rest.type === 'image' ? { ...rest, thumb: undefined } : rest);
const assetBlob = async (a) => a.file || (await fetch(a.url)).blob();
/** reconstrói uma mídia a partir dos metadados salvos e do conteúdo */
const restoreAsset = (meta, blob) => {
  const file = blob instanceof File ? blob : new File([blob], meta.name || 'midia', { type: blob.type });
  const url = URL.createObjectURL(file);
  return { ...meta, url, file, ...(meta.type === 'image' ? { thumb: url } : {}), loading: false };
};
/** mídia cujo arquivo não está à mão: fica na biblioteca até o usuário importar o arquivo de novo
    (`reconnect`: há um atalho guardado; basta um clique em "Reconectar" para dar a permissão de novo) */
const missingAsset = (meta, reconnect = false) => ({ ...meta, ...(meta.type === 'image' ? { thumb: undefined } : {}), missing: true, reconnect, loading: false });
const mediaKind = (f) => (f.type.startsWith('video') ? 'video' : f.type.startsWith('audio') ? 'audio' : f.type.startsWith('image') ? 'image' : null);
/** a mídia que falta e que corresponde a este arquivo (mesmo nome e tamanho; na falta, só o nome) */
function missingMatch(assets, f) {
  const miss = assets.filter((a) => a.missing && a.type === mediaKind(f));
  const nm = (a) => a.ref?.name || a.name;
  return miss.find((a) => nm(a) === f.name && a.ref?.size === f.size) || miss.find((a) => nm(a) === f.name);
}

/** documento do projeto (só dados serializáveis) */
function projectDoc(p) {
  return {
    version: PROJECT_VERSION, savedAt: Date.now(),
    name: p.name, ratio: p.ratio, resolution: p.resolution,
    clips: p.clips, markers: p.markers, trackState: p.trackState, guides: p.guides, capStyle: p.capStyle?.id || null,
    transitions: usedUserTransitions(p.clips),   // as personalizadas vão junto, para abrir em outro navegador
    assets: p.assets.filter((a) => !a.loading && !a.error).map(assetMeta),
  };
}

/* ---------- atalhos para os arquivos originais (File System Access: Chrome, Edge, Brave e o programa) ----------
   Um atalho (FileSystemFileHandle) ocupa poucos bytes e reabre o arquivo direto do disco, sem cópia. */
const canLinkFiles = typeof window.showOpenFilePicker === 'function';
const fileHandles = new Map();       // id da mídia → atalho
const handleOfFile = new WeakMap();  // arquivo importado → atalho (preenchido ao escolher ou soltar o arquivo)
const MEDIA_ACCEPT = {
  video: { 'video/*': ['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi'] },
  image: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif'] },
  audio: { 'audio/*': ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.opus', '.flac'] },
};
/** janela de escolher arquivos que devolve também os atalhos; `accept` como no <input> ("video/*,audio/*") */
async function pickMediaFiles(accept = 'video/*,image/*,audio/*') {
  const kinds = Object.keys(MEDIA_ACCEPT).filter((k) => accept.includes(k));
  const handles = await window.showOpenFilePicker({
    multiple: true, types: [{ description: 'Vídeos, imagens e áudios', accept: Object.assign({}, ...kinds.map((k) => MEDIA_ACCEPT[k])) }],
  });
  return Promise.all(handles.map(async (h) => { const f = await h.getFile(); handleOfFile.set(f, h); return f; }));
}
/** arrastar e soltar: os atalhos precisam ser pedidos durante o evento (depois dele não existem mais) */
const dropHandles = (dt) => Promise.all([...(dt?.items || [])]
  .filter((i) => i.kind === 'file' && typeof i.getAsFileSystemHandle === 'function')
  .map((i) => i.getAsFileSystemHandle().catch(() => null)));
function linkDropped(files, handles) {
  for (const h of handles) {
    if (h?.kind !== 'file') continue;
    const f = files.find((x) => x.name === h.name && !handleOfFile.has(x));
    if (f) handleOfFile.set(f, h);
  }
}
/** guarda o atalho do arquivo de uma mídia (se o arquivo veio da janela de escolher ou foi solto) */
const rememberHandle = (id, file) => { const h = file && handleOfFile.get(file); if (h) fileHandles.set(id, h); };
/** abre o arquivo pelo atalho; com `ask`, pede a permissão de novo (só funciona logo depois de um clique) */
async function fileFromHandle(h, meta, ask) {
  try {
    let st = await h.queryPermission({ mode: 'read' });
    if (st !== 'granted' && ask) st = await h.requestPermission({ mode: 'read' });
    if (st !== 'granted') return null;
    const f = await h.getFile();
    if (meta.ref?.size && f.size !== meta.ref.size) return null;   // o arquivo foi trocado ou editado
    handleOfFile.set(f, h);
    return f;
  } catch { return null; }   // arquivo apagado, movido ou renomeado
}
/** "Reconectar": pede a permissão das mídias que têm atalho e devolve as que voltaram */
async function reconnectMedia(assets) {
  const back = [];
  for (const a of assets) {
    const h = a.missing && fileHandles.get(a.id);
    if (!h) continue;
    const f = await fileFromHandle(h, a, true);
    if (f) back.push(restoreAsset(assetMeta(a), f));
  }
  return back;
}

/* ---------- salvamento automático ---------- */
const savedBlobs = new Set();   // ids de mídia já gravados nesta sessão
/** mídias grandes ficam só com o atalho; as pequenas (imagens, áudios, clipes curtos) são copiadas */
const isLarge = (a) => (a.file?.size ?? 0) > COPY_MAX;
async function autosaveProject(p) {
  const doc = projectDoc(p);
  const docIds = new Set(doc.assets.map((m) => m.id));
  const live = new Map(p.assets.filter((a) => !a.loading && !a.error && !a.missing).map((a) => [a.id, a]));
  const copy = new Map([...live].filter(([, a]) => !isLarge(a)));
  // mídia grande: nome + tamanho identificam o arquivo para religar (pelo atalho ou importando de novo)
  for (const m of doc.assets) { const a = live.get(m.id); if (a && isLarge(a)) m.ref = { name: a.file.name || a.name, size: a.file.size }; }
  // confere o que já está gravado (o armazenamento pode ter sido limpo por fora durante a sessão)
  const stored = new Set(await dbTx(['blobs'], 'readonly', ({ blobs }) => reqP(blobs.getAllKeys())));
  for (const id of [...savedBlobs]) if (!stored.has(id)) savedBlobs.delete(id);
  // conteúdo das mídias novas é lido antes da transação (fetch não pode rodar dentro dela)
  const fresh = [];
  for (const [id, a] of copy) if (!savedBlobs.has(id)) fresh.push([id, await assetBlob(a)]);
  await dbTx(['projects', 'blobs', 'handles'], 'readwrite', async ({ projects, blobs, handles }) => {
    for (const [id, b] of fresh) blobs.put(b, id);
    for (const [id, h] of fileHandles) if (docIds.has(id)) handles.put(h, id);
    projects.put(doc, 'current');
    // apaga o conteúdo de mídias que saíram do projeto e as cópias antigas de mídias grandes (versões
    // anteriores copiavam tudo). Proxies ('proxy:<id>:…') ficam enquanto a mídia estiver no projeto,
    // mesmo esperando ser reconectada (refazer o proxy de um vídeo grande demora)
    const keys = await reqP(blobs.getAllKeys());
    for (const k of keys) {
      const s = String(k);
      if (s.startsWith('proxy:') ? !docIds.has(s.split(':')[1]) : !copy.has(s)) blobs.delete(k);
    }
    for (const k of await reqP(handles.getAllKeys())) if (!docIds.has(k)) handles.delete(k);
  });
  for (const [id] of fresh) savedBlobs.add(id);
  for (const id of [...savedBlobs]) if (!copy.has(id)) savedBlobs.delete(id);
  for (const id of [...fileHandles.keys()]) if (!docIds.has(id)) fileHandles.delete(id);
}
/* proxies de prévia guardados neste navegador (ver 38-proxy): um registro por trecho,
   'proxy:<mídia>:<início>:<fim>' → { blob, from, to, off } */
const proxyKey = (id, s) => `proxy:${id}:${s.from}:${s.to}`;
const saveProxySeg = (id, s) => dbTx(['blobs'], 'readwrite', ({ blobs }) => { blobs.put({ blob: s.blob, from: s.from, to: s.to, off: s.off }, proxyKey(id, s)); });
const deleteProxySeg = (id, s) => dbTx(['blobs'], 'readwrite', ({ blobs }) => { blobs.delete(proxyKey(id, s)); }).catch(() => {});
async function loadProxySegs(id) {
  return dbTx(['blobs'], 'readonly', async ({ blobs }) => {
    const keys = (await reqP(blobs.getAllKeys())).filter((k) => String(k) === 'proxy:' + id || String(k).startsWith('proxy:' + id + ':'));
    const out = [];
    for (const k of keys) {
      const v = await reqP(blobs.get(k));
      if (v instanceof Blob) out.push({ blob: v, from: 0, to: Infinity, off: 0 });   // versão anterior: arquivo inteiro
      else if (v?.blob) out.push(v);
    }
    return out;
  }).catch(() => []);
}
async function loadAutosave() {
  // só leituras do IndexedDB dentro da transação; abrir os arquivos pelos atalhos vem depois
  const got = await dbTx(['projects', 'blobs', 'handles'], 'readonly', async ({ projects, blobs, handles }) => {
    const doc = await reqP(projects.get('current'));
    if (!doc) return null;
    const items = [];
    for (const meta of doc.assets || []) items.push([meta, await reqP(blobs.get(meta.id)), await reqP(handles.get(meta.id))]);
    return { doc, items };
  });
  if (!got) return null;
  const assets = [];
  for (const [meta, b, h] of got.items) {
    if (b) { assets.push(restoreAsset(meta, b)); savedBlobs.add(meta.id); continue; }
    if (h) {
      fileHandles.set(meta.id, h);
      const f = await fileFromHandle(h, meta, false);
      if (f) { assets.push(restoreAsset(meta, f)); continue; }
    }
    if (meta.ref) assets.push(missingAsset(meta, !!h));
  }
  return { ...got.doc, assets };
}

/* ---------- arquivo .cutlab: "CUTL" + tamanho do JSON (uint32) + JSON + mídias em sequência ----------
   Mídias grandes (vídeos, músicas) não vão dentro do arquivo: ficam só referenciadas (nome + tamanho) e
   são religadas ao abrir — pelo salvamento automático deste navegador ou importando o arquivo de novo.
   Com `withMedia`, tudo vai junto (pacote para levar o projeto a outro computador). */
const EMBED_MAX = 20 * 1048576;
async function packProject(p, { withMedia = false } = {}) {
  const doc = projectDoc(p);
  const parts = [];
  let off = 0;
  for (const meta of doc.assets) {
    const a = p.assets.find((x) => x.id === meta.id);
    if (a.missing) continue;   // continua só com a referência que já tinha
    const b = await assetBlob(a);
    if (!withMedia && b.size > EMBED_MAX) {
      meta.ref = { name: a.file?.name || a.name, size: b.size };
      continue;
    }
    delete meta.ref;
    meta.blob = { off, size: b.size, type: b.type };
    parts.push(b);
    off += b.size;
  }
  const json = new TextEncoder().encode(JSON.stringify(doc));
  const head = new DataView(new ArrayBuffer(8));
  [...CUTLAB_MAGIC].forEach((c, i) => head.setUint8(i, c.charCodeAt(0)));
  head.setUint32(4, json.length, true);
  return new Blob([head, json, ...parts], { type: 'application/octet-stream' });
}
/** abre um .cutlab; mídias só referenciadas são procuradas nas já abertas e no salvamento automático */
async function unpackProject(file, current = []) {
  const head = new DataView(await file.slice(0, 8).arrayBuffer());
  const magic = String.fromCharCode(...[0, 1, 2, 3].map((i) => head.getUint8(i)));
  if (magic !== CUTLAB_MAGIC) throw new Error('Este arquivo não é um projeto do CutLab');
  const len = head.getUint32(4, true);
  const doc = JSON.parse(await file.slice(8, 8 + len).text());
  if (doc.version > PROJECT_VERSION) throw new Error('Projeto criado numa versão mais nova do CutLab');
  const base = 8 + len;
  const assets = [];
  for (const { blob, ...meta } of doc.assets || []) {
    if (blob) { assets.push(restoreAsset(meta, file.slice(base + blob.off, base + blob.off + blob.size, blob.type))); continue; }
    const { name, size } = meta.ref || {};
    let b = current.find((a) => a.file && !a.missing && a.file.size === size && (a.id === meta.id || a.file.name === name))?.file;
    if (!b) b = await dbTx(['blobs'], 'readonly', ({ blobs }) => reqP(blobs.get(meta.id))).catch(() => null);
    // vídeo grande deste computador: o atalho guardado reabre o arquivo original
    const h = !b && (fileHandles.get(meta.id) || await dbTx(['handles'], 'readonly', ({ handles }) => reqP(handles.get(meta.id))).catch(() => null));
    if (h) { fileHandles.set(meta.id, h); b = await fileFromHandle(h, meta, false); }
    assets.push(b && b.size === size ? restoreAsset(meta, b) : missingAsset(meta, !!h));
  }
  return { ...doc, assets };
}
/** salva o arquivo (seletor nativo quando existe; senão, download) */
async function saveProjectFile(p, opts) {
  const fname = `${(p.name || 'projeto').replace(/[\\/:*?"<>|]+/g, '_')}.cutlab`;
  const blob = await packProject(p, opts);
  if (window.showSaveFilePicker) {
    try {
      const h = await showSaveFilePicker({ suggestedName: fname, types: [{ description: 'Projeto CutLab', accept: { 'application/octet-stream': ['.cutlab'] } }] });
      const w = await h.createWritable();
      await w.write(blob);
      await w.close();
      return { size: blob.size };
    } catch (e) {
      if (e.name === 'AbortError') return null;   // usuário cancelou
      throw e;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fname;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return { size: blob.size };
}
