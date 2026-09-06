<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { ContextMenu, Dialog } from 'bits-ui';
  import {
    MousePointer2,
    Hand,
    Plus,
    Image,
    FileText,
    PanelRightOpen,
    PanelLeftOpen,
    X,
    Search,
    Undo2,
    Redo2,
    Minus,
    Maximize,
    Link2,
    ArrowUpRight,
    Check,
    LoaderCircle,
    Keyboard,
    Upload,
    Highlighter,
  } from 'lucide-svelte';
  import {
    seed,
    uid,
    SpatialGrid,
    applyChanges,
    openPane,
    closePane,
    movePane,
    benchSize,
    type Doc,
    type Entity,
    type Placement,
    type Pane,
    type Change,
    type Anchor,
    type Point,
  } from './lib/model';
  import { loadDoc, saveDoc, saveAsset, loadPdfText, savePdfText } from './lib/storage';
  import { acquirePdf, releasePdf } from './lib/pdf';
  import Markdown from './Markdown.svelte';
  import Editor from './Editor.svelte';
  import AssetImage from './AssetImage.svelte';
  import Workbench from './Workbench.svelte';
  import { connectionPath, previewPath } from './lib/connections';
  let doc = $state<Doc>(seed());
  let loaded = $state(false);
  let saveStatus = $state('Opening…');
  let notice = $state('');
  let selected = $state('');
  let focused = $state('');
  let editingBoard = $state('');
  let resizing = $state(false);
  let cursorWorld = $state<Point>({ x: 0, y: 0 });
  const edgeNodes = new Map<string, SVGPathElement>();
  let tool = $state<'select' | 'hand' | 'connect'>('select');
  let connecting = $state('');
  let space = $state(false);
  let dragging = $state(false);
  let searchOpen = $state(false);
  let helpOpen = $state(false);
  let query = $state('');
  let hits = $state<string[]>([]);
  let indexing = $state(0);
  let board: HTMLDivElement;
  let boardWidth = $state(1000);
  let boardHeight = $state(800);
  let fileInput: HTMLInputElement;
  let searchInput: HTMLInputElement;
  let undoStack: Change[][] = $state([]);
  let redoStack: Change[][] = $state([]);
  let saveTimer: ReturnType<typeof setTimeout>;
  let notificationTimer: ReturnType<typeof setTimeout>;
  let worker: Worker;
  let request = 0;
  let writing = Promise.resolve();
  let savingRevision = 0;
  let loadFailed = $state(false);
  const grid = $derived(new SpatialGrid(doc.placements));
  const visible = $derived(
    grid.query(
      (-doc.camera.x - 200) / doc.camera.zoom,
      (-doc.camera.y - 200) / doc.camera.zoom,
      (boardWidth + 400) / doc.camera.zoom,
      (boardHeight + 400) / doc.camera.zoom,
    ),
  );
  const hasSecondary = $derived(doc.panes.some((p) => p.column === 'secondary'));
  const benchWidth = $derived(doc.panes.length ? benchSize(doc) : 0);
  const placementsByEntity = $derived(new Map(doc.placements.map((p) => [p.entityId, p])));
  const annotations = $derived(Object.values(doc.entities).filter((e) => e.type === 'annotation'));
  const columns = $derived(
    hasSecondary ? (['primary', 'secondary'] as const) : (['primary'] as const),
  );
  function notify(text: string) {
    notice = text;
    clearTimeout(notificationTimer);
    notificationTimer = setTimeout(() => (notice = ''), 5000);
  }
  function persist() {
    if (!loaded || loadFailed) return;
    saveStatus = 'Saving…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 250);
  }
  function flush() {
    if (!loaded || loadFailed) return;
    clearTimeout(saveTimer);
    const revision = ++savingRevision;
    const snapshot = $state.snapshot(doc);
    writing = writing
      .catch(() => {})
      .then(() => saveDoc(snapshot))
      .then(() => {
        if (revision === savingRevision) saveStatus = 'Saved on this device';
      })
      .catch((e) => {
        saveStatus = 'Could not save';
        notify(`Your changes are still open. Storage failed: ${e.message}`);
      });
  }
  const indexedText = new Map<string, string>();
  function updateSearch() {
    if (!worker) return;
    for (const entity of Object.values(doc.entities)) {
      if (entity.type === 'pdf') {
        if (!indexedText.has(entity.id)) {
          indexedText.set(entity.id, entity.assetId ?? entity.title);
          indexPdf(entity);
        }
        continue;
      }
      const text = entity.title + ' ' + entity.body + ' ' + (entity.anchor?.quote ?? '');
      if (indexedText.get(entity.id) !== text) {
        worker.postMessage({ type: 'upsert', id: entity.id, text });
        indexedText.set(entity.id, text);
      }
    }
    for (const id of indexedText.keys())
      if (!doc.entities[id]) {
        worker.postMessage({ type: 'remove', id });
        indexedText.delete(id);
      }
    if (query) runSearch();
  }
  function commit(changes: Change[]) {
    if (!changes.length) return;
    doc = applyChanges($state.snapshot(doc), changes);
    undoStack.push(changes);
    if (undoStack.length > 100) undoStack.shift();
    redoStack = [];
    updateSearch();
    persist();
  }
  function record(changes: Change[]) {
    undoStack.push(changes);
    redoStack = [];
    persist();
  }
  function undo() {
    const c = undoStack.pop();
    if (!c) return;
    doc = applyChanges($state.snapshot(doc), c, true);
    redoStack.push(c);
    updateSearch();
    persist();
  }
  function redo() {
    const c = redoStack.pop();
    if (!c) return;
    doc = applyChanges($state.snapshot(doc), c);
    undoStack.push(c);
    updateSearch();
    persist();
  }
  function paneChanges(panes: Pane[]) {
    return [
      { collection: 'document', id: 'panes', before: $state.snapshot(doc.panes), after: panes },
    ] as Change[];
  }
  async function open(id: string) {
    focused = id;
    selected = '';
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
  function centerPoint(): Point {
    return {
      x: (boardWidth / 2 - doc.camera.x) / doc.camera.zoom - 145,
      y: (boardHeight / 2 - doc.camera.y) / doc.camera.zoom - 100,
    };
  }
  function place(entityId: string, point = centerPoint()) {
    const p: Placement = {
      id: uid('placement'),
      entityId,
      ...point,
      width: 290,
      height: doc.entities[entityId]?.type === 'image' ? 240 : 250,
      z: Math.max(0, ...doc.placements.map((p) => p.z)) + 1,
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
    selected = id;
    editingBoard = id;
    tool = 'select';
  }
  async function importFiles(files: File[], point = centerPoint()) {
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
            worker?.postMessage({
              type: 'upsert',
              id: entity.id,
              text: entity.title + ' ' + cached,
            });
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
          worker?.postMessage({ type: 'upsert', id: entity.id, text: entity.title + ' ' + text });
          if (query) runSearch();
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
    worker?.postMessage({ type: 'remove', id });
    selected = '';
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
    e.title =
      body
        .split('\n')
        .find((l) => l.trim())
        ?.replace(/^#+\s*/, '')
        .slice(0, 90) || 'Untitled';
    updateSearch();
    persist();
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
            title:
              before
                .split('\n')
                .find((l) => l.trim())
                ?.replace(/^#+\s*/, '')
                .slice(0, 90) || 'Untitled',
          },
          after: $state.snapshot(e),
        },
      ]);
  }
  function annotate(anchor: Anchor) {
    const id = uid('annotation');
    const e: Entity = {
      id,
      type: 'annotation',
      title: anchor.quote.slice(0, 70),
      body: '',
      color: 'yellow',
      anchor: $state.snapshot(anchor),
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
  function connect(id: string) {
    if (!connecting) {
      connecting = id;
      notify('Choose another card to connect.');
      return;
    }
    if (connecting !== id && !doc.edges.some((e) => e.from === connecting && e.to === id)) {
      const edge = { id: uid('edge'), from: connecting, to: id };
      commit([{ collection: 'edges', id: edge.id, before: undefined, after: edge }]);
    }
    connecting = '';
    tool = 'select';
  }
  function point(event: { clientX: number; clientY: number }) {
    const r = board.getBoundingClientRect();
    return {
      x: (event.clientX - r.left - doc.camera.x) / doc.camera.zoom,
      y: (event.clientY - r.top - doc.camera.y) / doc.camera.zoom,
    };
  }
  function dragCard(event: PointerEvent, p: Placement) {
    if (
      (event.target as HTMLElement).closest('button,a,textarea,.live-editor') ||
      editingBoard === p.entityId ||
      event.button !== 0
    )
      return;
    if (event.detail > 1) return;
    event.stopPropagation();
    if (tool === 'connect') {
      cursorWorld = point(event);
      connect(p.entityId);
      return;
    }
    if (space || tool === 'hand') {
      pan(event);
      return;
    }
    selected = p.entityId;
    focused = '';
    const node = event.currentTarget as HTMLElement;
    const start = { x: event.clientX, y: event.clientY };
    const before = $state.snapshot(p);
    let x = p.x,
      y = p.y;
    let raf = 0;
    dragging = true;
    const movement = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 3) return;
      if (!node.hasPointerCapture(event.pointerId)) node.setPointerCapture(event.pointerId);
      x = before.x + (e.clientX - start.x) / doc.camera.zoom;
      y = before.y + (e.clientY - start.y) / doc.camera.zoom;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        node.style.transform = `translate(${x}px,${y}px)`;
        refreshEdges(p.entityId, { ...before, x, y });
      });
    };
    const finish = () => {
      cancelAnimationFrame(raf);
      node.removeEventListener('pointermove', movement);
      node.removeEventListener('pointerup', finish);
      node.removeEventListener('pointercancel', cancel);
      dragging = false;
      refreshEdges(p.entityId, { ...before, x, y });
      if (x !== before.x || y !== before.y)
        commit([{ collection: 'placements', id: p.id, before, after: { ...before, x, y } }]);
    };
    const cancel = () => {
      x = before.x;
      y = before.y;
      node.style.transform = `translate(${x}px,${y}px)`;
      finish();
    };
    node.addEventListener('pointermove', movement);
    node.addEventListener('pointerup', finish);
    node.addEventListener('pointercancel', cancel);
  }
  function pan(event: PointerEvent) {
    if (event.button !== 0 && event.button !== 1) return;
    if ((event.target as HTMLElement).closest('.board-card') && !space && tool !== 'hand') return;
    event.preventDefault();
    const node = board;
    const start = { x: event.clientX, y: event.clientY };
    const camera = { ...doc.camera };
    node.setPointerCapture(event.pointerId);
    const movement = (e: PointerEvent) => {
      doc.camera.x = camera.x + e.clientX - start.x;
      doc.camera.y = camera.y + e.clientY - start.y;
    };
    const finish = () => {
      node.removeEventListener('pointermove', movement);
      node.removeEventListener('pointerup', finish);
      node.removeEventListener('pointercancel', finish);
      persist();
    };
    node.addEventListener('pointermove', movement);
    node.addEventListener('pointerup', finish);
    node.addEventListener('pointercancel', finish);
    selected = '';
  }
  function zoom(value: number, cx = boardWidth / 2, cy = boardHeight / 2) {
    const z = Math.max(0.15, Math.min(2.5, value));
    const old = doc.camera.zoom;
    doc.camera = {
      x: cx - ((cx - doc.camera.x) * z) / old,
      y: cy - ((cy - doc.camera.y) * z) / old,
      zoom: z,
    };
    persist();
  }
  function wheel(e: WheelEvent) {
    if ((e.target as HTMLElement).closest('.board-card.editing') && !e.ctrlKey && !e.metaKey)
      return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const r = board.getBoundingClientRect();
      zoom(doc.camera.zoom * Math.exp(-e.deltaY * 0.008), e.clientX - r.left, e.clientY - r.top);
    } else {
      doc.camera.x -= e.deltaX;
      doc.camera.y -= e.deltaY;
      persist();
    }
  }
  function fit() {
    if (!doc.placements.length) {
      doc.camera = { x: 0, y: 0, zoom: 1 };
      return;
    }
    const minX = Math.min(...doc.placements.map((p) => p.x)),
      minY = Math.min(...doc.placements.map((p) => p.y));
    const maxX = Math.max(...doc.placements.map((p) => p.x + p.width)),
      maxY = Math.max(...doc.placements.map((p) => p.y + p.height));
    const z = Math.min(
      1.2,
      (boardWidth - 100) / (maxX - minX),
      (boardHeight - 100) / (maxY - minY),
    );
    doc.camera = {
      zoom: Math.max(0.15, z),
      x: (boardWidth - (maxX - minX) * z) / 2 - minX * z,
      y: (boardHeight - (maxY - minY) * z) / 2 - minY * z,
    };
    persist();
  }
  function resize(e: PointerEvent) {
    const start = e.clientX,
      width = benchWidth,
      target = e.currentTarget as HTMLElement;
    resizing = true;
    target.setPointerCapture(e.pointerId);
    const movement = (event: PointerEvent) => setWidth(width + start - event.clientX);
    const end = () => {
      target.removeEventListener('pointermove', movement);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
      resizing = false;
      persist();
    };
    target.addEventListener('pointermove', movement);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  }
  function edgeNode(node: SVGPathElement, id: string) {
    edgeNodes.set(id, node);
    return {
      destroy() {
        edgeNodes.delete(id);
      },
    };
  }
  function refreshEdges(id: string, override: Placement) {
    for (const edge of doc.edges) {
      if (edge.from !== id && edge.to !== id) continue;
      const a = edge.from === id ? override : placementsByEntity.get(edge.from),
        b = edge.to === id ? override : placementsByEntity.get(edge.to);
      if (a && b) edgeNodes.get(edge.id)?.setAttribute('d', connectionPath(a, b));
    }
  }
  function connectionDrag(event: PointerEvent, p: Placement) {
    event.stopPropagation();
    event.preventDefault();
    connecting = p.entityId;
    cursorWorld = point(event);
    const node = event.currentTarget as HTMLElement;
    node.setPointerCapture(event.pointerId);
    const movement = (e: PointerEvent) => (cursorWorld = point(e));
    const end = (e: PointerEvent) => {
      node.removeEventListener('pointermove', movement);
      node.removeEventListener('pointerup', end);
      node.removeEventListener('pointercancel', cancel);
      const target = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest<HTMLElement>('.board-card');
      if (target?.dataset.entity && target.dataset.entity !== p.entityId)
        connect(target.dataset.entity);
      else connecting = '';
    };
    const cancel = () => {
      node.removeEventListener('pointermove', movement);
      node.removeEventListener('pointerup', end);
      node.removeEventListener('pointercancel', cancel);
      connecting = '';
    };
    node.addEventListener('pointermove', movement);
    node.addEventListener('pointerup', end);
    node.addEventListener('pointercancel', cancel);
  }
  function placeHighlight(id: string) {
    const p = place(id);
    const edge = { id: uid('edge'), from: doc.entities[id].anchor!.pdfId, to: id };
    const changes: Change[] = [{ collection: 'placements', id: p.id, before: undefined, after: p }];
    if (!doc.edges.some((e) => e.from === edge.from && e.to === edge.to))
      changes.push({ collection: 'edges', id: edge.id, before: undefined, after: edge });
    commit(changes);
    notify('Highlight placed on the board.');
  }
  function drop(e: DragEvent) {
    e.preventDefault();
    const id = e.dataTransfer?.getData('application/kelana-entity');
    if (id && doc.entities[id]) {
      const p = place(id, point(e));
      const changes: Change[] = [
        { collection: 'placements', id: p.id, before: undefined, after: p },
      ];
      const anchor = doc.entities[id].anchor;
      if (anchor && !doc.edges.some((e) => e.from === anchor.pdfId && e.to === id)) {
        const edge = { id: uid('edge'), from: anchor.pdfId, to: id };
        changes.push({ collection: 'edges', id: edge.id, before: undefined, after: edge });
      }
      commit(changes);
    } else if (e.dataTransfer?.files.length) importFiles([...e.dataTransfer.files], point(e));
  }
  function runSearch() {
    worker?.postMessage({ type: 'query', query, request: ++request });
  }
  function key(e: KeyboardEvent) {
    if (!loaded) return;
    const input = (e.target as HTMLElement).closest('input,textarea,[contenteditable="true"]');
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      searchOpen = true;
      return;
    }
    if (input || searchOpen || helpOpen || (e.target as HTMLElement).closest('[role="menu"]'))
      return;
    if (e.code === 'Space') {
      space = true;
      e.preventDefault();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    }
    if (e.key === 'Escape') {
      selected = '';
      connecting = '';
      tool = 'select';
    }
    if (e.key.toLowerCase() === 'n') addCard();
    if (e.key.toLowerCase() === 'v') tool = 'select';
    if (e.key.toLowerCase() === 'h') tool = 'hand';
    if (e.key.toLowerCase() === 'c') tool = 'connect';
    if (e.key === 'Delete' && selected) remove(selected);
    if (e.key === '0') fit();
  }
  onMount(() => {
    worker = new Worker(new URL('./lib/search.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      if (e.data.request === request) hits = e.data.hits.filter((id: string) => doc.entities[id]);
    };
    let alive = true;
    loadDoc()
      .then((saved) => {
        if (!alive) return;
        if (saved) doc = saved;
        loaded = true;
        saveStatus = 'Saved on this device';
        updateSearch();
        if (!saved) persist();
      })
      .catch((e) => {
        loadFailed = true;
        notify(`Could not load your workspace: ${e.message}. Reload to retry; saving is paused.`);
        saveStatus = 'Storage unavailable';
      });
    const observer = new ResizeObserver((entries) => {
      boardWidth = entries[0].contentRect.width;
      boardHeight = entries[0].contentRect.height;
    });
    observer.observe(board);
    board.addEventListener('wheel', wheel, { passive: false });
    const onhide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onhide);
    return () => {
      alive = false;
      observer.disconnect();
      worker.terminate();
      board.removeEventListener('wheel', wheel);
      document.removeEventListener('visibilitychange', onhide);
      clearTimeout(saveTimer);
      clearTimeout(notificationTimer);
    };
  });
</script>

<svelte:window
  onkeydown={key}
  onkeyup={(e) => {
    if (e.code === 'Space') space = false;
  }}
  onblur={() => (space = false)}
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
  accept="application/pdf,image/*,.md,.markdown,.txt"
  multiple
  onchange={(e) => {
    importFiles([...(e.currentTarget.files ?? [])]);
    e.currentTarget.value = '';
  }}
/>
<div class="workspace-shell" class:resizing style:--bench-width={`${benchWidth}px`}>
  <header class="appbar" class:with-bench={doc.panes.length > 0}>
    <div class="brand"><img src="/icon.svg" alt="" />kelana</div>
    <span class="bar-divider"></span><input
      class="board-title"
      aria-label="Board title"
      bind:value={doc.title}
      oninput={persist}
    />
    <div class="bar-right">
      <span class="save-state" title={saveStatus}
        >{#if saveStatus === 'Saving…'}<LoaderCircle
            size={13}
          />{:else if saveStatus === 'Saved on this device'}<Check
            size={13}
          />{/if}{saveStatus}</span
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
      >
    </div>
  </header>
  <main inert={!loaded}>
    <div
      class:hand={tool === 'hand' || space}
      class:connecting={tool === 'connect'}
      class="board"
      bind:this={board}
      role="region"
      aria-label="Whiteboard"
      onpointerdown={pan}
      onpointermove={(event) => {
        if (connecting) cursorWorld = point(event);
      }}
      ondragover={(e) => e.preventDefault()}
      ondrop={drop}
      ondblclick={(e) => {
        if (!(e.target as HTMLElement).closest('.board-card,.toolbar,.zoom-controls'))
          addCard(point(e));
      }}
    >
      <div
        class="board-grid"
        style:background-position={`${doc.camera.x}px ${doc.camera.y}px`}
        style:background-size={`${24 * doc.camera.zoom}px ${24 * doc.camera.zoom}px`}
      ></div>
      <div
        class="scene"
        style:transform={`translate(${doc.camera.x}px,${doc.camera.y}px) scale(${doc.camera.zoom})`}
      >
        <svg class="edges" aria-hidden="true">
          <defs
            ><marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"
              ><path d="M0 0 L7 3.5 L0 7" fill="none" stroke="#aaa9a1" /></marker
            ></defs
          >
          {#each doc.edges as edge (edge.id)}{@const a = placementsByEntity.get(
              edge.from,
            )}{@const b = placementsByEntity.get(edge.to)}
            {#if a && b}<path
                use:edgeNode={edge.id}
                class="connection"
                d={connectionPath(a, b)}
                marker-end="url(#arrow)"
              />{/if}
          {/each}
          {#if connecting && placementsByEntity.has(connecting)}<path
              class="connection-preview"
              d={previewPath(placementsByEntity.get(connecting)!, cursorWorld)}
              marker-end="url(#arrow)"
            />{/if}
        </svg>
        {#each visible as p (p.id)}{@const entity = doc.entities[p.entityId]}{#if entity}
            <ContextMenu.Root
              ><ContextMenu.Trigger
                tabindex={0}
                class={`board-card ${entity.color} ${selected === entity.id || focused === entity.id ? 'selected' : ''} ${editingBoard === entity.id ? 'editing' : ''} ${connecting && connecting !== entity.id ? 'connection-target' : ''} ${dragging && selected === entity.id ? 'dragging' : ''}`}
                data-entity={entity.id}
                style={`transform:translate(${p.x}px,${p.y}px);width:${p.width}px;height:${p.height}px;z-index:${p.z}`}
                onpointerdown={(e) => dragCard(e, p)}
                onkeydown={(e) => {
                  if ((e.target as HTMLElement).closest('.live-editor,.editable')) return;
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    open(entity.id);
                  }
                  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
                    e.preventDefault();
                    const d = e.shiftKey ? 20 : 5;
                    commit([
                      {
                        collection: 'placements',
                        id: p.id,
                        before: $state.snapshot(p),
                        after: {
                          ...$state.snapshot(p),
                          x: p.x + (e.key === 'ArrowRight' ? d : e.key === 'ArrowLeft' ? -d : 0),
                          y: p.y + (e.key === 'ArrowDown' ? d : e.key === 'ArrowUp' ? -d : 0),
                        },
                      },
                    ]);
                  }
                }}
                aria-label={entity.title}
              >
                <button
                  class="open-card"
                  title="Open in workbench"
                  aria-label={`Open ${entity.title} in workbench`}
                  onclick={(e) => {
                    e.stopPropagation();
                    open(entity.id);
                  }}
                  ><svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"
                    ><rect
                      x="2"
                      y="3"
                      width="12"
                      height="10"
                      rx="1"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.2"
                    /><path d="M9 3v10h4V3Z" fill="currentColor" /></svg
                  ></button
                >
                {#if tool === 'connect'}<button
                    class="connection-port"
                    aria-label="Drag to connect card"
                    title="Drag to another card"
                    onpointerdown={(event) => connectionDrag(event, p)}><Plus size={12} /></button
                  >{/if}
                {#if doc.camera.zoom < 0.35 && editingBoard !== entity.id}<strong
                    >{entity.title}</strong
                  >{:else if entity.type === 'pdf'}<div class="pdf-cover">
                    <FileText size={30} strokeWidth={1.2} />
                    <h2>{entity.title}</h2>
                    <span>Open to read and annotate <ArrowUpRight size={14} /></span>
                  </div>{:else if entity.type === 'image'}<AssetImage
                    id={entity.assetId!}
                    alt={entity.title}
                  />{:else if entity.type === 'annotation'}<blockquote>
                    {entity.anchor?.quote}
                  </blockquote>
                  <button
                    class="source-link"
                    onclick={(e) => {
                      e.stopPropagation();
                      source(entity);
                    }}
                    >p. {entity.anchor?.page} · {doc.entities[entity.anchor?.pdfId ?? '']?.title ??
                      'Source unavailable'}<ArrowUpRight size={12} /></button
                  >{:else}<Editor
                    body={entity.body}
                    activation="double"
                    active={editingBoard === entity.id}
                    onactive={(value) => {
                      editingBoard = value ? entity.id : '';
                      if (value) {
                        selected = entity.id;
                        focused = '';
                      }
                    }}
                    oninput={(body) => edit(entity.id, body)}
                    oncommit={(before) => editCommit(entity.id, before)}
                  />{/if}
              </ContextMenu.Trigger><ContextMenu.Portal
                ><ContextMenu.Content class="context-menu"
                  ><ContextMenu.Item onclick={() => open(entity.id)}
                    >Open in workbench <PanelRightOpen size={15} /></ContextMenu.Item
                  >{#if entity.anchor}<ContextMenu.Item onclick={() => source(entity)}
                      >Open source <ArrowUpRight size={15} /></ContextMenu.Item
                    >{/if}<ContextMenu.Item onclick={() => duplicate(entity.id)}
                    >Duplicate</ContextMenu.Item
                  ><ContextMenu.Item
                    onclick={() => {
                      tool = 'connect';
                      connecting = entity.id;
                    }}>Connect to…</ContextMenu.Item
                  ><ContextMenu.Separator class="menu-separator" />
                  <div class="color-row">
                    {#each ['white', 'yellow', 'blue', 'green', 'pink', 'purple'] as c}<button
                        class={`swatch ${c}`}
                        aria-label={`Set ${c} card color`}
                        title={c}
                        onclick={() => color(entity.id, c)}
                      ></button>{/each}
                  </div>
                  <ContextMenu.Item onclick={() => reorder(entity.id, true)}
                    >Bring forward</ContextMenu.Item
                  ><ContextMenu.Item onclick={() => reorder(entity.id, false)}
                    >Send backward</ContextMenu.Item
                  ><ContextMenu.Separator class="menu-separator" /><ContextMenu.Item
                    class="danger"
                    onclick={() => remove(entity.id)}>Delete from workspace</ContextMenu.Item
                  ></ContextMenu.Content
                ></ContextMenu.Portal
              ></ContextMenu.Root
            >
          {/if}{/each}
      </div>
      <div
        class="toolbar"
        role="toolbar"
        tabindex="-1"
        aria-label="Whiteboard tools"
        onpointerdown={(e) => e.stopPropagation()}
      >
        <button
          class:active={tool === 'select'}
          class="icon-button"
          title="Select · V"
          aria-label="Select tool"
          onclick={() => (tool = 'select')}><MousePointer2 size={19} /></button
        ><button
          class:active={tool === 'hand'}
          class="icon-button"
          title="Pan · H or hold Space"
          aria-label="Pan tool"
          onclick={() => (tool = 'hand')}><Hand size={19} /></button
        ><span class="tool-divider"></span><button
          class="icon-button"
          title="New card · N"
          aria-label="New card"
          onclick={() => addCard()}><Plus size={20} /></button
        ><button
          class="icon-button"
          title="Import PDF, image, or markdown"
          aria-label="Import files"
          onclick={() => fileInput.click()}><Upload size={19} /></button
        ><button
          class:active={tool === 'connect'}
          class="icon-button"
          title="Connect cards · C"
          aria-label="Connect cards"
          onclick={() => {
            tool = 'connect';
            connecting = '';
          }}><Link2 size={19} /></button
        ><span class="tool-divider"></span><button
          class="icon-button"
          title="Undo · Ctrl Z"
          aria-label="Undo"
          disabled={!undoStack.length}
          onclick={undo}><Undo2 size={18} /></button
        ><button
          class="icon-button"
          title="Redo · Ctrl Shift Z"
          aria-label="Redo"
          disabled={!redoStack.length}
          onclick={redo}><Redo2 size={18} /></button
        >
      </div>
      <div class="board-hint">
        {tool === 'connect'
          ? connecting
            ? 'Choose the other card'
            : 'Choose a card to connect'
          : 'Double-click to write · Drop a PDF to read'}
      </div>
      <div
        class="zoom-controls"
        role="toolbar"
        tabindex="-1"
        aria-label="Board zoom"
        onpointerdown={(e) => e.stopPropagation()}
      >
        <button
          class="icon-button"
          title="Zoom out"
          aria-label="Zoom out"
          onclick={() => zoom(doc.camera.zoom / 1.2)}><Minus size={15} /></button
        ><button class="zoom-value" title="Reset zoom" onclick={() => zoom(1)}
          >{Math.round(doc.camera.zoom * 100)}%</button
        ><button
          class="icon-button"
          title="Zoom in"
          aria-label="Zoom in"
          onclick={() => zoom(doc.camera.zoom * 1.2)}><Plus size={15} /></button
        ><span class="tool-divider"></span><button
          class="icon-button"
          title="Fit board · 0"
          aria-label="Fit board"
          onclick={fit}><Maximize size={15} /></button
        >
      </div>
    </div>
    {#if loaded}<Workbench
        {doc}
        width={benchWidth}
        {focused}
        onfocus={(id) => {
          focused = id;
          selected = '';
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
        onresizing={(value) => (resizing = value)}
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
{#if !loaded}<div class="load-cover" role="status">
    {loadFailed
      ? 'Your workspace could not be loaded. Reload to retry.'
      : 'Opening your workspace…'}
  </div>{/if}
{#if notice}<div class="toast" role="status">
    {notice}<button aria-label="Dismiss" onclick={() => (notice = '')}><X size={14} /></button>
  </div>{/if}
<Dialog.Root bind:open={searchOpen}
  ><Dialog.Portal
    ><Dialog.Overlay class="dialog-overlay" /><Dialog.Content class="search-dialog"
      ><Dialog.Title class="sr-only">Search your workspace</Dialog.Title><Dialog.Description
        class="sr-only">Find cards, highlights, and text inside local PDFs.</Dialog.Description
      >
      <div class="search-box">
        <Search size={19} /><input
          bind:this={searchInput}
          bind:value={query}
          oninput={runSearch}
          placeholder="Search your thoughts and sources…"
          aria-label="Search query"
        /><Dialog.Close class="icon-button" aria-label="Close search"><X size={17} /></Dialog.Close>
      </div>
      <div class="search-results">
        {#if !query}<p class="muted">
            Search cards, highlights, and text inside your PDFs.
          </p>{:else if !hits.length}<p class="muted">
            No matches for “{query}”.
          </p>{:else}{#each hits as id}{@const e = doc.entities[id]}<button
              class="search-result"
              onclick={() => {
                open(id);
                searchOpen = false;
              }}
              ><FileText size={17} /><span
                ><strong>{e.title}</strong><small
                  >{e.anchor?.quote ?? e.body.replace(/[#*]/g, '').slice(0, 110)}</small
                ></span
              ><ArrowUpRight size={15} /></button
            >{/each}{/if}{#if indexing}<p class="muted">
            Indexing {indexing} PDF{indexing > 1 ? 's' : ''}…
          </p>{/if}
      </div></Dialog.Content
    ></Dialog.Portal
  ></Dialog.Root
>
<Dialog.Root bind:open={helpOpen}
  ><Dialog.Portal
    ><Dialog.Overlay class="dialog-overlay" /><Dialog.Content class="help-dialog"
      ><Dialog.Title>Keep your hands on the thought.</Dialog.Title><Dialog.Description
        >Shortcuts for your workspace.</Dialog.Description
      >
      <dl>
        {#each [['N', 'New card'], ['V / H', 'Select / pan'], ['Space + drag', 'Pan the board'], ['Ctrl / ⌘ + wheel', 'Zoom around pointer'], ['C', 'Connect two cards'], ['Ctrl / ⌘ K', 'Search locally'], ['Ctrl / ⌘ Z', 'Undo'], ['Ctrl / ⌘ Shift Z', 'Redo'], ['0', 'Fit everything'], ['Enter on a card', 'Open in workbench'], ['Arrow keys on a card', 'Nudge position'], ['Shift F10', 'Card context menu']] as shortcut}<div
          >
            <dt>{shortcut[0]}</dt>
            <dd>{shortcut[1]}</dd>
          </div>{/each}
      </dl>
      <Dialog.Close class="help-close">Back to thinking</Dialog.Close></Dialog.Content
    ></Dialog.Portal
  ></Dialog.Root
>
