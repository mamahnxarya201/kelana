import type { Doc, Asset } from './model';
let database: Promise<IDBDatabase>;
function db() {
  return (database ??= new Promise((resolve, reject) => {
    const r = indexedDB.open('kelana-local', 2);
    r.onupgradeneeded = () => {
      for (const name of ['documents', 'assets', 'blobs', 'search'])
        if (!r.result.objectStoreNames.contains(name)) r.result.createObjectStore(name);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}
async function get<T>(store: string, key: string): Promise<T | undefined> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = d.transaction(store).objectStore(store).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function put(store: string, key: string, value: unknown) {
  const d = await db();
  return new Promise<void>((resolve, reject) => {
    const t = d.transaction(store, 'readwrite');
    t.objectStore(store).put(value, key);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('Storage transaction aborted'));
  });
}
export const loadDoc = () => get<Doc>('documents', 'main');
export const saveDoc = (doc: Doc) => put('documents', 'main', doc);
export const loadPdfText = (assetId: string) => get<string>('search', assetId);
export const savePdfText = (assetId: string, text: string) => put('search', assetId, text);
export async function saveAsset(file: File): Promise<Asset> {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const checksum = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(
    '',
  );
  const id = `asset:${checksum}`;
  const old = await get<Asset>('assets', id);
  if (old) return old;
  const record: Asset = {
    id,
    storageKey: checksum,
    mimeType: file.type,
    byteSize: file.size,
    checksum,
    createdAt: Date.now(),
    backend: 'idb',
  };
  if (navigator.storage?.getDirectory) {
    try {
      const root = await navigator.storage.getDirectory();
      const handle = await root.getFileHandle(checksum, { create: true });
      const stream = await handle.createWritable();
      await stream.write(bytes);
      await stream.close();
      record.backend = 'opfs';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'QuotaExceededError') throw error;
      await put('blobs', id, new Blob([bytes], { type: file.type }));
    }
  } else await put('blobs', id, new Blob([bytes], { type: file.type }));
  await put('assets', id, record);
  return record;
}
export async function loadAsset(id: string) {
  const meta = await get<Asset>('assets', id);
  if (!meta) throw new Error('The local asset is missing.');
  if (meta.backend === 'opfs') {
    const root = await navigator.storage.getDirectory();
    return (await root.getFileHandle(meta.storageKey)).getFile();
  }
  const blob = await get<Blob>('blobs', id);
  if (!blob) throw new Error('The local asset is missing.');
  return blob;
}
