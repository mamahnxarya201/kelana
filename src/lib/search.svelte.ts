/**
 * Full-text search wiring: owns the worker, the query, and the hits.
 * Index updates flow through upsert/remove; queries through run().
 */
import { doc } from './doc.svelte';

export const search = $state({ query: '', hits: [] as string[] });

let worker: Worker | undefined;
let request = 0;
const indexedText = new Map<string, string>();

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./search.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    if (e.data.request === request) {
      search.hits = e.data.hits.filter((id: string) => doc.entities[id]);
    }
  };
  return worker;
}

export function upsert(id: string, text: string) {
  if (indexedText.get(id) === text) return;
  ensureWorker().postMessage({ type: 'upsert', id, text });
  indexedText.set(id, text);
}

export function remove(id: string) {
  if (!indexedText.has(id)) return;
  ensureWorker().postMessage({ type: 'remove', id });
  indexedText.delete(id);
}

export function isKnown(id: string) {
  return indexedText.has(id);
}

export function run() {
  ensureWorker().postMessage({ type: 'query', query: search.query, request: ++request });
}

/** Stop indexing ids not in `keep` (entity removed). */
export function prune(keep: Set<string>) {
  for (const id of [...indexedText.keys()]) if (!keep.has(id)) remove(id);
}
