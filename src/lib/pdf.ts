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
/**
 * Board pdf cards show the page itself: no mat, no frame. A card sized to
 * `pdfCardSize` is exactly the page's shape, so an imported PDF reads as one
 * sheet of paper on the canvas.
 */
export const PDF_CARD_INSET = 0;
/** Default page width for a freshly imported card, before the height cap. */
const PDF_CARD_PAGE_WIDTH = 340;
/** Keeps very tall pages (long folios, scans) from towering over the board. */
const PDF_CARD_MAX_HEIGHT = 720;
/**
 * Card size that fits a page of the given aspect ratio (height / width): the
 * page keeps its own proportions and fills the card exactly.
 */
export function pdfCardSize(ratio: number) {
  const pageWidth = Math.min(
    PDF_CARD_PAGE_WIDTH,
    (PDF_CARD_MAX_HEIGHT - PDF_CARD_INSET) / Math.max(ratio, 0.01),
  );
  return {
    width: Math.round(pageWidth) + PDF_CARD_INSET,
    height: Math.round(pageWidth * ratio) + PDF_CARD_INSET,
  };
}
