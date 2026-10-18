/* =====================================================================
   Projeto: salvamento automático (IndexedDB) e arquivo .cutlab
   ===================================================================== */
const PROJECT_VERSION = 1;
const DB_NAME = 'cutlab';
const CUTLAB_MAGIC = 'CUTL';

let dbPromise = null;
function openDb() {
  if (!window.indexedDB) return Promise.reject(new Error('IndexedDB indisponível'));
  return (dbPromise ||= new Promise((res, rej) => {
    const rq = indexedDB.open(DB_NAME, 1);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects');
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
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
const assetMeta = ({ url, file, loading, ...rest }) => (rest.type === 'image' ? { ...rest, thumb: undefined } : rest);
const assetBlob = async (a) => a.file || (await fetch(a.url)).blob();
/** reconstrói uma mídia a partir dos metadados salvos e do conteúdo */
const restoreAsset = (meta, blob) => {
  const file = blob instanceof File ? blob : new File([blob], meta.name || 'midia', { type: blob.type });
  const url = URL.createObjectURL(file);
  return { ...meta, url, file, ...(meta.type === 'image' ? { thumb: url } : {}), loading: false };
};

/** documento do projeto (só dados serializáveis) */
function projectDoc(p) {
  return {
    version: PROJECT_VERSION, savedAt: Date.now(),
    name: p.name, ratio: p.ratio, resolution: p.resolution,
    clips: p.clips, markers: p.markers, trackState: p.trackState, guides: p.guides, capStyle: p.capStyle?.id || null,
    assets: p.assets.filter((a) => !a.loading && !a.error).map(assetMeta),
  };
}

/* ---------- salvamento automático ---------- */
const savedBlobs = new Set();   // ids de mídia já gravados nesta sessão
async function autosaveProject(p) {
  const doc = projectDoc(p);
  const live = new Map(p.assets.filter((a) => !a.loading && !a.error).map((a) => [a.id, a]));
  // confere o que já está gravado (o armazenamento pode ter sido limpo por fora durante a sessão)
  const stored = new Set(await dbTx(['blobs'], 'readonly', ({ blobs }) => reqP(blobs.getAllKeys())));
  for (const id of [...savedBlobs]) if (!stored.has(id)) savedBlobs.delete(id);
  // conteúdo das mídias novas é lido antes da transação (fetch não pode rodar dentro dela)
  const fresh = [];
  for (const [id, a] of live) if (!savedBlobs.has(id)) fresh.push([id, await assetBlob(a)]);
  await dbTx(['projects', 'blobs'], 'readwrite', async ({ projects, blobs }) => {
    for (const [id, b] of fresh) blobs.put(b, id);
    projects.put(doc, 'current');
    // remove mídias que saíram do projeto
    const keys = await reqP(blobs.getAllKeys());
    for (const k of keys) if (!live.has(k)) blobs.delete(k);
  });
  for (const [id] of fresh) savedBlobs.add(id);
  for (const id of [...savedBlobs]) if (!live.has(id)) savedBlobs.delete(id);
}
async function loadAutosave() {
  return dbTx(['projects', 'blobs'], 'readonly', async ({ projects, blobs }) => {
    const doc = await reqP(projects.get('current'));
    if (!doc) return null;
    const assets = [];
    for (const meta of doc.assets || []) {
      const b = await reqP(blobs.get(meta.id));
      if (b) { assets.push(restoreAsset(meta, b)); savedBlobs.add(meta.id); }
    }
    return { ...doc, assets };
  });
}

/* ---------- arquivo .cutlab: "CUTL" + tamanho do JSON (uint32) + JSON + mídias em sequência ---------- */
async function packProject(p) {
  const doc = projectDoc(p);
  const parts = [];
  let off = 0;
  for (const meta of doc.assets) {
    const b = await assetBlob(p.assets.find((a) => a.id === meta.id));
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
async function unpackProject(file) {
  const head = new DataView(await file.slice(0, 8).arrayBuffer());
  const magic = String.fromCharCode(...[0, 1, 2, 3].map((i) => head.getUint8(i)));
  if (magic !== CUTLAB_MAGIC) throw new Error('Este arquivo não é um projeto do CutLab');
  const len = head.getUint32(4, true);
  const doc = JSON.parse(await file.slice(8, 8 + len).text());
  if (doc.version > PROJECT_VERSION) throw new Error('Projeto criado numa versão mais nova do CutLab');
  const base = 8 + len;
  const assets = (doc.assets || []).map(({ blob, ...meta }) =>
    restoreAsset(meta, file.slice(base + blob.off, base + blob.off + blob.size, blob.type)));
  return { ...doc, assets };
}
/** salva o arquivo (seletor nativo quando existe; senão, download) */
async function saveProjectFile(p) {
  const fname = `${(p.name || 'projeto').replace(/[\\/:*?"<>|]+/g, '_')}.cutlab`;
  const blob = await packProject(p);
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
