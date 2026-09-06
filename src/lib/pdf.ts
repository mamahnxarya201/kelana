import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { loadAsset } from './storage';
GlobalWorkerOptions.workerSrc = workerUrl;
// Retain promises only while a reader/indexer uses them; bound decoded documents.
const cache = new Map<string, { promise: ReturnType<typeof load>; refs: number }>();
async function load(id: string) {
  const blob = await loadAsset(id);
  return getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
    cMapUrl: '/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/standard_fonts/',
    wasmUrl: '/wasm/',
  }).promise;
}
export function acquirePdf(id: string) {
  let item = cache.get(id);
  if (!item) {
    item = { promise: load(id), refs: 0 };
    cache.set(id, item);
  }
  item.refs++;
  return item.promise;
}
export function releasePdf(id: string) {
  const item = cache.get(id);
  if (item && --item.refs <= 0) {
    cache.delete(id);
    item.promise.then((pdf) => pdf.destroy()).catch(() => {});
  }
}
