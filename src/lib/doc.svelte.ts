/**
 * Shared document state: the doc itself, undo/redo, and persistence.
 *
 * Domain state lives here (not in App.svelte) so any component can read and
 * mutate it directly via `import { doc, commit } from ...` — no prop drilling.
 * UI composition still receives instances via props; this module is the data
 * backbone, not a UI concern.
 */
import { applyChanges, seed, type Change, type Doc } from './model';
import { loadDoc as storageLoadDoc, saveDoc } from './storage';
import { facingConnectionSides } from './connections';

export const doc = $state<Doc>(seed());

/** Load/save lifecycle flags (object wrapper: Svelte only allows exporting
 *  state that is mutated, never reassigned). */
export const docStatus = $state({
  loaded: false,
  saveStatus: 'Opening…',
  loadFailed: false,
});
const loaded = () => docStatus.loaded;
const loadFailed = () => docStatus.loadFailed;

export const undoStack: Change[][] = $state([]);
export const redoStack: Change[][] = $state([]);

let saveTimer: ReturnType<typeof setTimeout>;
let writing = Promise.resolve();
let savingRevision = $state(0);
/** Monotonic counter of working-copy writes; read via getSaveRevision(). */
export const getSaveRevision = () => savingRevision;
/** Identity + revision of the last `.kelana` file write, for the dirty dot. */
export const fileWrite = $state({ name: '', revision: -1 });

let changeListeners: (() => void)[] = [];
/**
 * Register a listener fired after any change that alters document content
 * (commit/undo/redo — not `record`, which only captures manual mutations).
 */
export function onDocChange(listener: () => void) {
  changeListeners.push(listener);
}

let notifyHandler: (message: string) => void = () => {};
export function setNotifyHandler(handler: (message: string) => void) {
  notifyHandler = handler;
}

function apply(next: Doc, changes: Change[], reverse = false) {
  Object.assign(doc, applyChanges($state.snapshot(doc), changes, reverse));
}

function emitChange() {
  for (const listener of changeListeners) listener();
}

export function persist() {
  if (!loaded() || loadFailed()) return;
  docStatus.saveStatus = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 250);
}

export function flush(): Promise<void> {
  if (!loaded() || loadFailed()) return Promise.resolve();
  clearTimeout(saveTimer);
  const revision = ++savingRevision;
  const snapshot = $state.snapshot(doc);
  writing = writing
    .catch(() => {})
    .then(() => saveDoc(snapshot))
    .then(() => {
      if (revision === savingRevision) docStatus.saveStatus = 'Saved on this device';
    })
    .catch((e: Error) => {
      docStatus.saveStatus = 'Could not save';
      notifyHandler(`Your changes are still open. Storage failed: ${e.message}`);
    });
  return writing;
}

export function commit(changes: Change[]) {
  if (!changes.length) return;
  apply(doc, changes);
  undoStack.push(changes);
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
  emitChange();
  persist();
}

/**
 * Capture already-applied manual mutations (e.g. live editing) into the undo
 * stack without re-applying or re-indexing anything.
 */
export function record(changes: Change[]) {
  if (!changes.length) return;
  undoStack.push(changes);
  redoStack.length = 0;
  persist();
}

export function undo() {
  const c = undoStack.pop();
  if (!c) return;
  apply(doc, c, true);
  redoStack.push(c);
  emitChange();
  persist();
}

export function redo() {
  const c = redoStack.pop();
  if (!c) return;
  apply(doc, c);
  undoStack.push(c);
  emitChange();
  persist();
}

function stabilizeConnectionSides(value: Doc): Doc {
  value.panes = value.panes.filter((pane) => value.entities[pane.entityId]?.type !== 'text');
  const placements = new Map(value.placements.map((placement) => [placement.entityId, placement]));
  for (const edge of value.edges) {
    if (edge.fromSide && edge.toSide) continue;
    const from = placements.get(edge.from);
    const to = placements.get(edge.to);
    if (!from || !to) continue;
    const sides = facingConnectionSides(from, to);
    edge.fromSide ??= sides[0];
    edge.toSide ??= sides[1];
  }
  return value;
}

/** Load the persisted doc (if any). Resolves with whether a doc was loaded. */
export async function loadDoc(): Promise<boolean> {
  try {
    const saved = await storageLoadDoc();
    if (saved) Object.assign(doc, stabilizeConnectionSides(saved));
    docStatus.loaded = true;
    docStatus.saveStatus = 'Saved on this device';
    return !!saved;
  } catch (e) {
    docStatus.loadFailed = true;
    docStatus.saveStatus = 'Storage unavailable';
    throw e;
  }
}

/**
 * Replace the working copy with an imported board (kelana-file-format.md
 * Phase 2). Undo/redo is session state and resets; listeners reindex via
 * emitChange; the replacement is flushed immediately so it is durable before
 * anything else happens.
 */
export async function adoptImportedDoc(next: Doc) {
  undoStack.length = 0;
  redoStack.length = 0;
  Object.assign(doc, stabilizeConnectionSides(next));
  emitChange();
  await flush();
}
