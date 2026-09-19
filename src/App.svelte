<script lang="ts">
  import { onMount, tick } from 'svelte';
  import SearchDialog from './components/SearchDialog.svelte';
  import SettingsDialog from './components/SettingsDialog.svelte';
  import HelpDialog from './components/HelpDialog.svelte';
  import { DropdownMenu } from 'bits-ui';
  import { X, Search, Check, LoaderCircle, Keyboard, Settings, Menu } from 'lucide-svelte';
  import {
    uid,
    openPane,
    closePane,
    movePane,
    benchSize,
    type Entity,
    type Placement,
    type Pane,
    type Change,
    type Anchor,
    type Point,
    type Doc,
  } from './lib/model';
  import { saveAsset, loadPdfText, savePdfText, saveFileIdentity } from './lib/storage';
  import {
    adoptImportedDoc,
    commit,
    doc,
    docStatus,
    fileWrite,
    flush,
    getSaveRevision,
    onDocChange,
    persist,
    record,
    redo,
    setNotifyHandler,
    startEmptyDoc,
    undo,
  } from './lib/doc.svelte';
  import { saveKelanaWithPicker } from './lib/kelana/fileAccess';
  import { isKelanaFile, kelanaFilename } from './lib/kelana/schema';
  import type { ImportStats } from './lib/kelana/container.worker';
  import { titleFromMarkdown } from './lib/markdown';
  import { centerOn, centerPoint, point, viewport } from './lib/viewport.svelte';
  import { clearSelection, selectOnly, selection } from './lib/selection.svelte';
  import {
    isKnown,
    prune,
    remove as searchRemove,
    run,
    search,
    upsert as searchUpsert,
  } from './lib/search.svelte';
  import { fitFreeTextSize } from './lib/free-text';
  import { fontFamily, fontOptions } from './lib/fonts';
  import { acquirePdf, releasePdf, pdfCardSize } from './lib/pdf';
  import { DEFAULT_HIGHLIGHT } from './lib/highlight';
  import Board from './components/Board.svelte';
  import OpenBoardDialog from './components/OpenBoardDialog.svelte';
  import Workbench from './Workbench.svelte';
  let notice = $state('');
  let titleEditing = $state(false);
  let boardTitleInput: HTMLInputElement;
  let focused = $state('');
  let editingBoard = $state('');
  let textEditBefore: { id: string; entity: Entity; placement: Placement } | null = null;
  let searchOpen = $state(false);
  let helpOpen = $state(false);
  let settingsOpen = $state(false);
  let indexing = $state(0);
  let board: Board;
  let fileInput: HTMLInputElement;
  let notificationTimer: ReturnType<typeof setTimeout>;
  const whiteboardFont = $derived(doc.whiteboardFont ?? 'inter');
  const interfaceFont = $derived(doc.interfaceFont ?? 'inter');
  const hasSecondary = $derived(doc.panes.some((p) => p.column === 'secondary'));
  const benchWidth = $derived(doc.panes.length ? benchSize(doc) : 0);
  const placementsByEntity = $derived(new Map(doc.placements.map((p) => [p.entityId, p])));
  $effect(() => {
    document.documentElement.style.setProperty('--font-ui', fontFamily(interfaceFont));
    document.documentElement.style.setProperty('--font-content', fontFamily(whiteboardFont));
  });
  function notify(text: string) {
    notice = text;
    clearTimeout(notificationTimer);
    notificationTimer = setTimeout(() => (notice = ''), 5000);
  }
  setNotifyHandler(notify);
  // --- `.kelana` board file export (Phase 1 of kelana-file-format.md): the
  // --- container worker is created on first export, never at app startup.
  let container: Worker | undefined;
  function callContainer<T>(message: unknown, transfer: Transferable[] = []): Promise<T> {
    container ??= new Worker(new URL('./lib/kelana/container.worker.ts', import.meta.url), {
      type: 'module',
    });
    const worker = container;
    return new Promise((resolve, reject) => {
      const onMessage = (event: MessageEvent) => {
        const message = event.data as { type: string; message?: string };
        if (message.type === 'error') {
          cleanup();
          reject(new Error(message.message ?? 'The board file could not be processed.'));
        } else {
          cleanup();
          resolve(event.data as T);
        }
      };
      const onError = () => {
        cleanup();
        reject(new Error('The file worker failed to start.'));
      };
      const cleanup = () => {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
      };
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      worker.postMessage(message, transfer);
    });
  }
  const requestExport = (board: Doc) =>
    callContainer<{ bytes: ArrayBuffer; filename: string }>({ type: 'export', doc: board });
  const requestImport = (bytes: ArrayBuffer) =>
    callContainer<{ doc: Doc; stats: ImportStats }>({ type: 'import', bytes }, [bytes]);
  let exporting = $state(false);
  let explainedFileCopy = false;
  const fileDirty = $derived(fileWrite.name !== '' && getSaveRevision() > fileWrite.revision);
  async function exportBoardFile(intent: 'save' | 'saveAs') {
    if (!docStatus.loaded || exporting) return;
    exporting = true;
    try {
      await flush();
      const filename = kelanaFilename(doc.title);
      const { bytes } = await requestExport($state.snapshot(doc));
      const outcome = await saveKelanaWithPicker(bytes, filename);
      if (outcome === 'cancelled') return;
      fileWrite.name = filename;
      fileWrite.revision = getSaveRevision();
      await saveFileIdentity({ name: filename });
      if (intent === 'save') {
        // The web cannot hold a writable handle yet (Phase 3/desktop); Save
        // silently produced a new copy — never claim the original was updated.
        if (!explainedFileCopy) {
          explainedFileCopy = true;
          notify('Saved a new copy — the browser can’t overwrite the original.');
        } else notify(`Saved a copy as ${filename}.`);
      } else notify(outcome === 'downloaded' ? `Downloaded ${filename}.` : `Saved ${filename}.`);
    } catch (e) {
      notify(`Could not save the board file: ${(e as Error).message}`);
    } finally {
      exporting = false;
    }
  }
  function updateSearch() {
    const keep = new Set<string>();
    for (const entity of Object.values(doc.entities)) {
      keep.add(entity.id);
      if (entity.type === 'pdf') {
        if (!isKnown(entity.id)) indexPdf(entity);
        continue;
      }
      searchUpsert(
        entity.id,
        entity.title + ' ' + entity.body + ' ' + (entity.anchor?.quote ?? ''),
      );
    }
    prune(keep);
    if (search.query) run();
  }
  onDocChange(updateSearch);
  function paneChanges(panes: Pane[]) {
    return [
      { collection: 'document', id: 'panes', before: $state.snapshot(doc.panes), after: panes },
    ] as Change[];
  }
  async function open(id: string) {
    if (doc.entities[id]?.type === 'text') {
      revealOnBoard(id);
      return;
    }
    focused = id;
    clearSelection();
    editingBoard = '';
    commit(paneChanges(openPane($state.snapshot(doc), id)));
    await tick();
    document.getElementById('pane-' + id)?.scrollIntoView({ block: 'nearest' });
  }
  function close(id: string) {
    commit(paneChanges(closePane($state.snapshot(doc), id)));
    if (focused === id) focused = doc.panes[0]?.entityId ?? '';
  }
  function move(id: string) {
    if (doc.panes.length < 2) return;
    focused = id;
    commit(paneChanges(movePane($state.snapshot(doc), id)));
    tick().then(() => document.getElementById('pane-' + id)?.scrollIntoView({ block: 'nearest' }));
  }
  function setWidth(width: number) {
    const value = Math.max(hasSecondary ? 680 : 360, Math.min(window.innerWidth - 120, width));
    if (hasSecondary) doc.benchDoubleWidth = value;
    else doc.benchSingleWidth = value;
    persist();
  }
  function view(id: string, value: Partial<Pane>) {
    const p = doc.panes.find((p) => p.entityId === id);
    if (p) {
      Object.assign(p, value);
      persist();
    }
  }
  function place(entityId: string, point = centerPoint()) {
    const type = doc.entities[entityId]?.type;
    const p: Placement = {
      id: uid('placement'),
      entityId,
      ...point,
      width: type === 'text' ? 88 : 290,
      height: type === 'text' ? 30 : type === 'image' ? 240 : 250,
      z: Math.max(0, ...doc.placements.map((p) => p.z)) + 1,
      ...(type === 'text' ? { autoWidth: true } : {}),
    };
    return p;
  }
  function addCard(point = centerPoint()) {
    const id = uid('card');
    const entity: Entity = { id, type: 'markdown', title: 'Untitled', body: '', color: 'white' };
    commit(
      [
        { collection: 'entities', id, before: undefined, after: entity },
        { collection: 'placements', id: '', before: undefined, after: place(id, point) },
      ].map((c) =>
        c.collection === 'placements' ? { ...c, id: (c.after as Placement).id } : c,
      ) as Change[],
    );
    selectOnly(id);
    editingBoard = id;
    board?.activateSelectTool();
  }
  async function addFreeText(point?: Point) {
    const id = uid('text');
    const entity: Entity = {
      id,
      type: 'text',
      title: 'New Text',
      body: 'New Text',
      color: 'white',
    };
    // Register the entity before placing so place() sees type 'text' and sizes
    // the placement for free text instead of falling back to card defaults.
    doc.entities[id] = entity;
    const placement = place(
      id,
      point ?? {
        x: (viewport.width / 2 - doc.camera.x) / doc.camera.zoom - 44,
        y: (viewport.height / 2 - doc.camera.y) / doc.camera.zoom - 15,
      },
    );
    commit([
      { collection: 'entities', id, before: undefined, after: entity },
      { collection: 'placements', id: placement.id, before: undefined, after: placement },
    ]);
    selectOnly(id);
    board?.activateSelectTool();
    await beginFreeTextEdit(id, true);
  }
  async function importFiles(files: File[], point = centerPoint()) {
    // A `.kelana` board file (by name or sniffed SQLite magic) opens the whole
    // board instead of being imported as an asset — and must arrive alone.
    const isBoardFile = await Promise.all(
      files.map(
        async (file) =>
          /\.kelana$/i.test(file.name) ||
          isKelanaFile(new Uint8Array(await file.slice(0, 16).arrayBuffer())),
      ),
    );
    const boardCount = isBoardFile.filter(Boolean).length;
    if (boardCount > 0) {
      if (files.length > 1 || boardCount > 1) {
        notify('A board file opens by itself.');
        return;
      }
      pendingBoardFile = files[isBoardFile.indexOf(true)];
      openBoardDialog = true;
      return;
    }
    for (const [i, file] of files.entries()) {
      try {
        const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        const isImage = file.type.startsWith('image/');
        const isText = /\.(md|markdown|txt)$/i.test(file.name);
        if (!isPdf && !isImage && !isText) {
          notify(`Unsupported file: ${file.name}. Use PDF, image, or Markdown.`);
          continue;
        }
        const id = uid(isPdf ? 'pdf' : isImage ? 'image' : 'card');
        const asset = isText ? undefined : await saveAsset(file);
        const body = isText ? await file.text() : '';
        const entity: Entity = {
          id,
          type: isPdf ? 'pdf' : isImage ? 'image' : 'markdown',
          title: file.name,
          body,
          color: 'white',
          assetId: asset?.id,
        };
        const placement = place(id, { x: point.x + i * 35, y: point.y + i * 35 });
        commit([
          { collection: 'entities', id, before: undefined, after: entity },
          { collection: 'placements', id: placement.id, before: undefined, after: placement },
        ]);
        if (isPdf && asset) {
          // Size the card from the first page so the page fits it exactly;
          // afterwards the user can resize freely like a markdown card.
          const placementId = placement.id;
          acquirePdf(asset.id)
            .then(async (pdf) => {
              try {
                const page = await pdf.getPage(1);
                const base = page.getViewport({ scale: 1 });
                const ratio = base.height / base.width;
                const target = doc.placements.find((p) => p.id === placementId);
                if (!target) return;
                const prev = $state.snapshot(target);
                const { width, height } = pdfCardSize(ratio);
                if (prev.width === width && prev.height === height) return;
                commit([
                  {
                    collection: 'placements',
                    id: placementId,
                    before: prev,
                    after: { ...prev, width, height },
                  },
                ]);
              } finally {
                releasePdf(asset.id);
              }
            })
            .catch(() => {});
        }
        notify(`Added ${file.name}`);
      } catch (e) {
        notify(`Could not import ${file.name}: ${(e as Error).message}`);
      }
    }
  }
  let indexQueue = Promise.resolve();
  function indexPdf(entity: Entity) {
    indexing++;
    indexQueue = indexQueue
      .then(async () => {
        if (!entity.assetId) return;
        let acquired = false;
        try {
          const cached = await loadPdfText(entity.assetId);
          if (cached !== undefined) {
            searchUpsert(entity.id, entity.title + ' ' + cached);
            return;
          }
          const pdf = await acquirePdf(entity.assetId);
          acquired = true;
          let text = '';
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            text += ' ' + content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
            if (i % 10 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
          }
          await savePdfText(entity.assetId, text);
          searchUpsert(entity.id, entity.title + ' ' + text);
          if (search.query) run();
        } catch {
          notify(`Text search could not index ${entity.title}. You can still try opening it.`);
        } finally {
          if (acquired) releasePdf(entity.assetId);
        }
      })
      .finally(() => indexing--);
  }
  function color(id: string, color: string) {
    const e = doc.entities[id];
    commit([
      {
        collection: 'entities',
        id,
        before: $state.snapshot(e),
        after: { ...$state.snapshot(e), color },
      },
    ]);
  }
  function duplicate(id: string) {
    const e = doc.entities[id],
      newId = uid(e.type);
    const p = doc.placements.find((p) => p.entityId === id);
    const placement = place(newId, p ? { x: p.x + 35, y: p.y + 35 } : centerPoint());
    if (e.type === 'text' && p) {
      placement.width = p.width;
      placement.height = p.height;
      placement.autoWidth = p.autoWidth;
    }
    commit([
      {
        collection: 'entities',
        id: newId,
        before: undefined,
        after: { ...$state.snapshot(e), id: newId },
      },
      { collection: 'placements', id: placement.id, before: undefined, after: placement },
    ]);
  }
  function remove(id: string) {
    const changes: Change[] = [
      { collection: 'entities', id, before: $state.snapshot(doc.entities[id]), after: undefined },
    ];
    const groups = $state.snapshot(doc.groups ?? []);
    if (groups.some((group) => group.entityIds.includes(id)))
      changes.push({
        collection: 'document',
        id: 'groups',
        before: groups,
        after: groups
          .map((group) => ({
            ...group,
            entityIds: group.entityIds.filter((entityId) => entityId !== id),
          }))
          .filter((group) => group.entityIds.length),
      });
    for (const p of doc.placements.filter((p) => p.entityId === id))
      changes.push({
        collection: 'placements',
        id: p.id,
        before: $state.snapshot(p),
        after: undefined,
      });
    for (const p of doc.panes.filter((p) => p.entityId === id))
      changes.push({ collection: 'panes', id, before: $state.snapshot(p), after: undefined });
    for (const e of doc.edges.filter((e) => e.from === id || e.to === id))
      changes.push({ collection: 'edges', id: e.id, before: $state.snapshot(e), after: undefined });
    commit(changes);
    searchRemove(id);
    selection.selected = '';
    selection.ids = selection.ids.filter((selectedId) => selectedId !== id);
    notify('Deleted from the workspace. Undo to restore.');
  }
  function reorder(id: string, front: boolean) {
    const p = doc.placements.find((p) => p.entityId === id);
    if (!p) return;
    commit([
      {
        collection: 'placements',
        id: p.id,
        before: $state.snapshot(p),
        after: {
          ...$state.snapshot(p),
          z:
            (front
              ? Math.max(...doc.placements.map((p) => p.z))
              : Math.min(...doc.placements.map((p) => p.z))) + (front ? 1 : -1),
        },
      },
    ]);
  }
  function edit(id: string, body: string) {
    const e = doc.entities[id];
    e.body = body;
    e.title = titleFromMarkdown(body);
    updateSearch();
    persist();
  }
  function freeTextTitle(body: string) {
    return titleFromMarkdown(body);
  }
  // --- free-text sizing: engine lives in lib/free-text.ts; this wrapper applies
  // --- the fit to the live placement and refreshes edges/ports ---
  function freeTextHost(id: string) {
    return board.getElement().querySelector<HTMLElement>(`[data-entity="${id}"] .live-editor`);
  }
  function fitFreeText(
    id: string,
    opts: { lock?: 'width' | 'height'; width?: number; height?: number } = {},
  ) {
    const placement = placementsByEntity.get(id);
    const host = freeTextHost(id);
    if (!placement || !host) return;
    fitFreeTextSize(placement, host, opts);
    board.refreshEdges(id, placement);
    board.refreshPorts(id, placement);
  }
  async function beginFreeTextEdit(id: string, selectAll = false) {
    const entity = doc.entities[id];
    const placement = placementsByEntity.get(id);
    if (!entity || entity.type !== 'text' || !placement) return;
    textEditBefore = {
      id,
      entity: $state.snapshot(entity),
      placement: $state.snapshot(placement),
    };
    editingBoard = id;
    selectOnly(id);
    focused = '';
    await tick();
    const host = freeTextHost(id);
    if (!host) return;
    fitFreeText(id);
    // Re-fit once the editor's layout has fully settled (fresh mounts measure small).
    requestAnimationFrame(() => fitFreeText(id));
    const surface = host.querySelector<HTMLElement>('.ProseMirror');
    if (!surface) return;
    surface.focus();
    if (selectAll) {
      const range = document.createRange();
      range.selectNodeContents(surface);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  }
  function editFreeText(id: string, body: string) {
    const entity = doc.entities[id];
    if (!entity || entity.type !== 'text') return;
    entity.body = body;
    entity.title = freeTextTitle(body);
    fitFreeText(id);
    updateSearch();
    persist();
  }
  function finishFreeTextEdit(id: string) {
    if (editingBoard === id) editingBoard = '';
    if (!textEditBefore || textEditBefore.id !== id) return;
    const before = textEditBefore;
    textEditBefore = null;
    const entity = doc.entities[id];
    const placement = placementsByEntity.get(id);
    if (!entity || !placement) return;
    // Final fit from settled layout so the stored size always hugs the text.
    fitFreeText(id);
    const changes: Change[] = [];
    if (before.entity.body !== entity.body || before.entity.title !== entity.title)
      changes.push({
        collection: 'entities',
        id,
        before: before.entity,
        after: $state.snapshot(entity),
      });
    if (
      before.placement.x !== placement.x ||
      before.placement.y !== placement.y ||
      before.placement.width !== placement.width ||
      before.placement.height !== placement.height ||
      before.placement.locked !== placement.locked
    )
      changes.push({
        collection: 'placements',
        id: placement.id,
        before: before.placement,
        after: $state.snapshot(placement),
      });
    record(changes);
  }
  function editCommit(id: string, before: string) {
    const e = doc.entities[id];
    if (!e) return;
    if (before !== e.body)
      record([
        {
          collection: 'entities',
          id,
          before: {
            ...$state.snapshot(e),
            body: before,
            title: titleFromMarkdown(before),
          },
          after: $state.snapshot(e),
        },
      ]);
  }
  function annotate(anchor: Anchor, color: string = DEFAULT_HIGHLIGHT) {
    const id = uid('annotation');
    const e: Entity = {
      id,
      type: 'annotation',
      title: anchor.quote.slice(0, 70),
      body: '',
      // The card is a plain note; the passage keeps the color the reader chose,
      // so re-coloring the card never repaints the highlight.
      color: 'white',
      anchor: { ...$state.snapshot(anchor), highlight: color },
    };
    commit([{ collection: 'entities', id, before: undefined, after: e }]);
    return id;
  }
  async function source(e: Entity) {
    if (!e.anchor || !doc.entities[e.anchor.pdfId])
      return notify('The source PDF was deleted. Undo its deletion to restore it.');
    await open(e.anchor.pdfId);
    view(e.anchor.pdfId, { page: e.anchor.page, jump: Date.now() });
  }
  function removeEdge(id: string) {
    const edge = doc.edges.find((edge) => edge.id === id);
    if (!edge) return;
    commit([{ collection: 'edges', id, before: $state.snapshot(edge), after: undefined }]);
    selection.edge = '';
    selection.edgeMenu = null;
    notify('Connection deleted. Undo to restore.');
  }
  function revealOnBoard(id: string) {
    const placement = placementsByEntity.get(id);
    if (!placement) return;
    editingBoard = '';
    selectOnly(id);
    focused = '';
    centerOn(placement);
  }
  function clearBoardInteraction() {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    titleEditing = false;
    clearSelection();
  }
  async function editBoardTitle() {
    titleEditing = true;
    await tick();
    boardTitleInput.focus();
    boardTitleInput.setSelectionRange(doc.title.length, doc.title.length);
  }
  function resize(e: PointerEvent) {
    const start = e.clientX,
      width = benchWidth,
      target = e.currentTarget as HTMLElement;
    board.setResizing(true);
    target.setPointerCapture(e.pointerId);
    const movement = (event: PointerEvent) => setWidth(width + start - event.clientX);
    const end = () => {
      target.removeEventListener('pointermove', movement);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
      board.setResizing(false);
      persist();
    };
    target.addEventListener('pointermove', movement);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  }
  function placeHighlight(id: string) {
    const p = place(id);
    commit([{ collection: 'placements', id: p.id, before: undefined, after: p }]);
    notify('Highlight placed on the board.');
  }
  // --- `.kelana` open flow (Phase 2): confirm replacement, then import ---
  let openBoardDialog = $state(false);
  let pendingBoardFile = $state<File | null>(null);
  $effect(() => {
    if (!openBoardDialog) pendingBoardFile = null;
  });
  async function confirmOpenBoard() {
    const file = pendingBoardFile;
    openBoardDialog = false;
    if (!file) return;
    try {
      const bytes = await file.arrayBuffer();
      const { doc: nextDoc, stats } = await requestImport(bytes);
      await adoptImportedDoc(nextDoc);
      focused = '';
      editingBoard = '';
      clearSelection();
      fileWrite.name = file.name;
      fileWrite.revision = getSaveRevision();
      await saveFileIdentity({ name: file.name });
      const parts = [`${stats.cards} card${stats.cards === 1 ? '' : 's'}`];
      if (stats.pdfs) parts.push(`${stats.pdfs} PDF${stats.pdfs === 1 ? '' : 's'}`);
      if (stats.images) parts.push(`${stats.images} image${stats.images === 1 ? '' : 's'}`);
      notify(`Opened ${nextDoc.title} — ${parts.join(', ')}.`);
    } catch (e) {
      notify((e as Error).message);
    }
  }
  function drop(e: DragEvent) {
    e.preventDefault();
    const id = e.dataTransfer?.getData('application/kelana-entity');
    if (id && doc.entities[id]) {
      const p = place(id, point(e));
      commit([{ collection: 'placements', id: p.id, before: undefined, after: p }]);
    } else if (e.dataTransfer?.files.length) importFiles([...e.dataTransfer.files], point(e));
  }
  function key(e: KeyboardEvent) {
    if (!docStatus.loaded || e.defaultPrevented) return;
    const input = (e.target as HTMLElement).closest('input,textarea,[contenteditable="true"]');
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      searchOpen = true;
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void exportBoardFile(e.shiftKey ? 'saveAs' : 'save');
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      fileInput.click();
      return;
    }
    if (
      input ||
      searchOpen ||
      helpOpen ||
      settingsOpen ||
      (e.target as HTMLElement).closest('[role="menu"]')
    )
      return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
      return;
    }
    board.handleKey(e);
  }
  onMount(() => {
    let alive = true;
    startEmptyDoc()
      .then(() => {
        if (!alive) return;
        updateSearch();
        // Re-hug free text once the board has rendered.
        tick().then(() => {
          for (const p of doc.placements)
            if (doc.entities[p.entityId]?.type === 'text') fitFreeText(p.entityId);
        });
      })
      .catch((e) => {
        notify(`Could not open your workspace: ${e.message}. Reload to retry; saving is paused.`);
      });
    const onhide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    const onPageHide = () => flush();
    document.addEventListener('visibilitychange', onhide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      alive = false;
      flush();
      document.removeEventListener('visibilitychange', onhide);
      window.removeEventListener('pagehide', onPageHide);
      clearTimeout(notificationTimer);
    };
  });
</script>

<svelte:window
  onkeydown={key}
  onkeyup={(e) => {
    if (e.code === 'Space') viewport.space = false;
  }}
  onblur={() => (viewport.space = false)}
  oncontextmenu={(e) => e.preventDefault()}
  onpaste={(e) => {
    if (
      !(e.target as HTMLElement).closest('input,textarea,[contenteditable="true"]') &&
      e.clipboardData?.files.length
    ) {
      e.preventDefault();
      importFiles([...e.clipboardData.files]);
    }
  }}
/>
<input
  class="file-input"
  type="file"
  bind:this={fileInput}
  accept="application/pdf,image/*,.md,.markdown,.txt,.kelana"
  multiple
  onchange={(e) => {
    importFiles([...(e.currentTarget.files ?? [])]);
    e.currentTarget.value = '';
  }}
/>
<div class="workspace-shell" style:--bench-width={`${benchWidth}px`}>
  <header class="appbar" class:with-bench={doc.panes.length > 0}>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger class="brand" title="File menu" aria-label="File menu">
        <Menu size={16} /></DropdownMenu.Trigger
      >
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="file-menu" sideOffset={6} align="start">
          <DropdownMenu.Item class="file-menu-item item-open" onSelect={() => fileInput.click()}
            >Open…</DropdownMenu.Item
          >
          <DropdownMenu.Item
            class="file-menu-item item-save"
            onSelect={() => exportBoardFile('save')}
            >Save<span class="menu-hint">Ctrl S</span></DropdownMenu.Item
          >
          <DropdownMenu.Item
            class="file-menu-item item-save-as"
            onSelect={() => exportBoardFile('saveAs')}
            >Save As…<span class="menu-hint">Ctrl ⇧ S</span></DropdownMenu.Item
          >
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
    <span class="bar-divider"></span><input
      class="board-title floating-text-input"
      class:editing={titleEditing}
      aria-label="Board title"
      aria-readonly={!titleEditing}
      readonly={!titleEditing}
      tabindex={titleEditing ? 0 : -1}
      bind:this={boardTitleInput}
      bind:value={doc.title}
      onpointerdown={(event) => {
        if (!titleEditing) event.preventDefault();
      }}
      ondblclick={(event) => {
        event.preventDefault();
        editBoardTitle();
      }}
      onblur={() => (titleEditing = false)}
      onkeydown={(event) => {
        if (event.key === 'Enter' || event.key === 'Escape') {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      oninput={persist}
    />
    <div class="bar-right">
      <span class="save-state" title={docStatus.saveStatus}
        >{#if fileWrite.name}<span class="file-chip" title={fileWrite.name}
            ><span class="file-dot" class:dirty={fileDirty}></span><span class="file-chip-name"
              >{fileWrite.name}</span
            ></span
          >{/if}{#if docStatus.saveStatus === 'Saving…'}<LoaderCircle
            size={13}
          />{:else if docStatus.saveStatus === 'Saved on this device'}<Check
            size={13}
          />{/if}{docStatus.saveStatus}</span
      ><button
        class="icon-button"
        aria-label="Search locally"
        title="Search locally · Ctrl K"
        onclick={() => (searchOpen = true)}><Search size={17} /></button
      ><button
        class="icon-button"
        title="Keyboard shortcuts"
        aria-label="Keyboard shortcuts"
        onclick={() => (helpOpen = true)}><Keyboard size={17} /></button
      ><button
        class="icon-button"
        title="Settings"
        aria-label="Settings"
        onclick={() => (settingsOpen = true)}><Settings size={17} /></button
      >
    </div>
  </header>
  <main inert={!docStatus.loaded}>
    <Board
      bind:this={board}
      {focused}
      {editingBoard}
      onclearinteraction={clearBoardInteraction}
      onfocus={(id) => (focused = id)}
      onediting={(id) => (editingBoard = id)}
      ondrop={drop}
      onaddcard={addCard}
      onaddfreetext={addFreeText}
      onimport={() => fileInput.click()}
      onnotify={notify}
      onopen={open}
      onsource={source}
      onduplicate={duplicate}
      oncolor={color}
      onreorder={reorder}
      onremove={remove}
      onremoveedge={removeEdge}
      onedit={edit}
      oneditcommit={editCommit}
      onbeginfreetextedit={beginFreeTextEdit}
      oneditfreetext={editFreeText}
      onfinishfreetextedit={finishFreeTextEdit}
    />
    {#if docStatus.loaded}<Workbench
        {doc}
        width={benchWidth}
        {focused}
        onfocus={(id) => {
          focused = id;
          selection.selected = '';
          selection.ids = [];
          selection.group = '';
        }}
        onmove={move}
        onclose={close}
        onview={view}
        onedit={edit}
        oncommit={editCommit}
        onsource={source}
        onannotate={annotate}
        onplace={placeHighlight}
        onresize={resize}
        onwidth={setWidth}
        onresizing={(value) => board.setResizing(value)}
        onratio={(ratio) => {
          doc.splitRatio = ratio;
          persist();
        }}
        oncolumnscroll={(column, scroll) => {
          doc.columnScroll ??= { primary: 0, secondary: 0 };
          doc.columnScroll[column] = scroll;
          persist();
        }}
      />{/if}
  </main>
</div>
{#if !docStatus.loaded}<div class="load-cover" role="status">
    {docStatus.loadFailed
      ? 'Your workspace could not be loaded. Reload to retry.'
      : 'Opening your workspace…'}
  </div>{/if}
{#if notice}<div class="toast" role="status">
    {notice}<button aria-label="Dismiss" onclick={() => (notice = '')}><X size={14} /></button>
  </div>{/if}
<SearchDialog bind:open={searchOpen} {indexing} onreveal={revealOnBoard} onopen={open} />
<SettingsDialog bind:open={settingsOpen} />
<HelpDialog bind:open={helpOpen} />
<OpenBoardDialog
  bind:open={openBoardDialog}
  currentTitle={doc.title}
  fileName={pendingBoardFile?.name ?? ''}
  onconfirm={confirmOpenBoard}
/>
