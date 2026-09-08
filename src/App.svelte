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
    Mouse,
    Laptop,
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
    type Group,
    type Edge,
    type ConnectionSide,
  } from './lib/model';
  import { loadDoc, saveDoc, saveAsset, loadPdfText, savePdfText } from './lib/storage';
  import { titleFromMarkdown } from './lib/markdown';
  import { acquirePdf, releasePdf } from './lib/pdf';
  import Editor from './Editor.svelte';
  import AssetImage from './AssetImage.svelte';
  import Workbench from './Workbench.svelte';
  import {
    connectionPath,
    previewPath,
    connectionPoint,
    nearestConnectionSide,
    facingConnectionSides,
    defaultBezierConfig,
    type BezierConfig,
  } from './lib/connections';
  let doc = $state<Doc>(seed());
  let loaded = $state(false);
  let saveStatus = $state('Opening…');
  let notice = $state('');
  let selected = $state('');
  let selectedIds = $state<string[]>([]);
  let selectedGroup = $state('');
  let titleEditing = $state(false);
  let groupEditing = $state('');
  let groupEditBefore = '';
  let boardTitleInput: HTMLInputElement;
  let marquee = $state<{ left: number; top: number; width: number; height: number } | null>(null);
  let selectionMenu = $state<{ x: number; y: number } | null>(null);
  let groupMenu = $state<{ id: string; x: number; y: number } | null>(null);
  let focused = $state('');
  let editingBoard = $state('');
  let resizing = $state(false);
  let cursorWorld = $state<Point>({ x: 0, y: 0 });
  const edgeNodes = new Map<string, SVGPathElement>();
  let tool = $state<'select' | 'hand' | 'connect'>('select');
  let connecting = $state<{ entityId: string; side: ConnectionSide } | null>(null);
  let snapTarget = $state<{ entityId: string; side: ConnectionSide } | null>(null);
  let curveSettingsOpen = $state(false);
  let bezier = $state<BezierConfig>({ ...defaultBezierConfig });
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
  const colors = ['white', 'yellow', 'blue', 'green', 'pink', 'purple'];
  const navigationMode = $derived(doc.navigationMode ?? 'touchpad');
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
  function stabilizeConnectionSides(value: Doc): Doc {
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
    selectedIds = [];
    selectedGroup = '';
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
    selectOnly(id);
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
    selectedIds = selectedIds.filter((selectedId) => selectedId !== id);
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
  function makeEdge(
    from: string,
    to: string,
    fromSide?: ConnectionSide,
    toSide?: ConnectionSide,
    fromPlacement = placementsByEntity.get(from),
    toPlacement = placementsByEntity.get(to),
  ): Edge {
    if ((!fromSide || !toSide) && fromPlacement && toPlacement) {
      const facing = facingConnectionSides(fromPlacement, toPlacement);
      fromSide ??= facing[0];
      toSide ??= facing[1];
    }
    return { id: uid('edge'), from, to, fromSide, toSide };
  }
  function finishConnection(to: string, toSide: ConnectionSide) {
    if (!connecting || connecting.entityId === to) {
      connecting = null;
      return;
    }
    const source = connecting;
    if (
      !doc.edges.some(
        (edge) =>
          edge.from === source.entityId &&
          edge.to === to &&
          edge.fromSide === source.side &&
          edge.toSide === toSide,
      )
    ) {
      const edge = makeEdge(source.entityId, to, source.side, toSide);
      commit([{ collection: 'edges', id: edge.id, before: undefined, after: edge }]);
    }
    connecting = null;
    snapTarget = null;
  }
  function point(event: { clientX: number; clientY: number }) {
    const r = board.getBoundingClientRect();
    return {
      x: (event.clientX - r.left - doc.camera.x) / doc.camera.zoom,
      y: (event.clientY - r.top - doc.camera.y) / doc.camera.zoom,
    };
  }
  function clearBoardInteraction() {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    titleEditing = false;
    groupEditing = '';
    selected = '';
    selectedIds = [];
    selectedGroup = '';
    selectionMenu = null;
    groupMenu = null;
  }
  async function editBoardTitle() {
    titleEditing = true;
    await tick();
    boardTitleInput.focus();
    boardTitleInput.setSelectionRange(doc.title.length, doc.title.length);
  }
  async function editGroupLabel(group: Group, input: HTMLInputElement) {
    selectGroup(group.id);
    groupEditBefore = group.label;
    groupEditing = group.id;
    await tick();
    input.focus();
    input.setSelectionRange(group.label.length, group.label.length);
  }
  function finishGroupLabel(group: Group, input: HTMLInputElement) {
    if (groupEditing !== group.id) return;
    const label = input.value.trim() || 'Untitled group';
    group.label = label;
    input.value = label;
    groupEditing = '';
    persist();
  }
  function cancelGroupLabel(group: Group, input: HTMLInputElement) {
    group.label = groupEditBefore;
    input.value = groupEditBefore;
    groupEditing = '';
    input.blur();
  }
  function selectOnly(id: string) {
    selected = id;
    selectedIds = [id];
    selectedGroup = '';
    selectionMenu = null;
    groupMenu = null;
  }
  function selectGroup(id: string) {
    selected = '';
    selectedIds = [];
    selectedGroup = id;
    focused = '';
    selectionMenu = null;
    groupMenu = null;
  }
  function groupBounds(group: Group) {
    if (
      group.x !== undefined &&
      group.y !== undefined &&
      group.width !== undefined &&
      group.height !== undefined
    )
      return { x: group.x, y: group.y, width: group.width, height: group.height };
    const members = doc.placements.filter((placement) => group.entityIds.includes(placement.entityId));
    if (!members.length) return null;
    const padding = 24;
    const minX = Math.min(...members.map((member) => member.x)) - padding;
    const minY = Math.min(...members.map((member) => member.y)) - padding;
    const maxX = Math.max(...members.map((member) => member.x + member.width)) + padding;
    const maxY = Math.max(...members.map((member) => member.y + member.height)) + padding;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }
  function createGroup() {
    if (selectedIds.length < 2) return;
    const before = $state.snapshot(doc.groups ?? []);
    const members = doc.placements.filter((placement) => selectedIds.includes(placement.entityId));
    const padding = 24;
    const x = Math.min(...members.map((member) => member.x)) - padding;
    const y = Math.min(...members.map((member) => member.y)) - padding;
    const group: Group = {
      id: uid('group'),
      label: 'New group',
      color: colors[1 + Math.floor(Math.random() * (colors.length - 1))],
      entityIds: [...selectedIds],
      x,
      y,
      width: Math.max(...members.map((member) => member.x + member.width)) + padding - x,
      height: Math.max(...members.map((member) => member.y + member.height)) + padding - y,
    };
    commit([{ collection: 'document', id: 'groups', before, after: [...before, group] }]);
    selectionMenu = null;
    selectGroup(group.id);
    notify('Group created. Edit its label inline.');
  }
  function updateGroup(id: string, value: Partial<Group>) {
    const before = $state.snapshot(doc.groups ?? []);
    const after = before.map((group) => (group.id === id ? { ...group, ...value } : group));
    commit([{ collection: 'document', id: 'groups', before, after }]);
    groupMenu = null;
  }
  function deleteGroup(id: string) {
    const before = $state.snapshot(doc.groups ?? []);
    const after = before.filter((group) => group.id !== id);
    commit([{ collection: 'document', id: 'groups', before, after }]);
    selectedGroup = '';
    groupMenu = null;
    notify('Group removed. Its cards are unchanged.');
  }
  function resizeGroup(
    event: PointerEvent,
    group: Group,
    direction: 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw',
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    selectGroup(group.id);
    const handle = event.currentTarget as HTMLElement;
    const box = handle.closest<HTMLElement>('.group-box');
    const bounds = groupBounds(group);
    if (!box || !bounds) return;
    const start = { x: event.clientX, y: event.clientY };
    let next = { ...bounds };
    handle.setPointerCapture(event.pointerId);
    const movement = (moveEvent: PointerEvent) => {
      const dx = (moveEvent.clientX - start.x) / doc.camera.zoom;
      const dy = (moveEvent.clientY - start.y) / doc.camera.zoom;
      next = { ...bounds };
      if (direction.includes('e')) next.width = Math.max(120, bounds.width + dx);
      if (direction.includes('s')) next.height = Math.max(80, bounds.height + dy);
      if (direction.includes('w')) {
        next.width = Math.max(120, bounds.width - dx);
        next.x = bounds.x + bounds.width - next.width;
      }
      if (direction.includes('n')) {
        next.height = Math.max(80, bounds.height - dy);
        next.y = bounds.y + bounds.height - next.height;
      }
      box.style.transform = `translate(${next.x}px,${next.y}px)`;
      box.style.width = `${next.width}px`;
      box.style.height = `${next.height}px`;
    };
    const finish = () => {
      handle.removeEventListener('pointermove', movement);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', finish);
      if (
        next.x !== bounds.x ||
        next.y !== bounds.y ||
        next.width !== bounds.width ||
        next.height !== bounds.height
      )
        updateGroup(group.id, next);
    };
    handle.addEventListener('pointermove', movement);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  }
  function resizeCard(
    event: PointerEvent,
    placement: Placement,
    direction: 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw',
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget as HTMLElement;
    const card = handle.closest<HTMLElement>('.board-card');
    if (!card) return;
    const start = { x: event.clientX, y: event.clientY };
    const before = $state.snapshot(placement);
    let next = { ...before };
    handle.setPointerCapture(event.pointerId);
    const movement = (moveEvent: PointerEvent) => {
      const dx = (moveEvent.clientX - start.x) / doc.camera.zoom;
      const dy = (moveEvent.clientY - start.y) / doc.camera.zoom;
      next = { ...before };
      if (direction.includes('e')) next.width = Math.max(120, before.width + dx);
      if (direction.includes('s')) next.height = Math.max(80, before.height + dy);
      if (direction.includes('w')) {
        next.width = Math.max(120, before.width - dx);
        next.x = before.x + before.width - next.width;
      }
      if (direction.includes('n')) {
        next.height = Math.max(80, before.height - dy);
        next.y = before.y + before.height - next.height;
      }
      card.style.transform = `translate(${next.x}px,${next.y}px)`;
      card.style.width = `${next.width}px`;
      card.style.height = `${next.height}px`;
      refreshEdges(placement.entityId, next);
      refreshPorts(placement.entityId, next);
    };
    const finish = () => {
      handle.removeEventListener('pointermove', movement);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', finish);
      if (
        next.x !== before.x ||
        next.y !== before.y ||
        next.width !== before.width ||
        next.height !== before.height
      )
        commit([{ collection: 'placements', id: placement.id, before, after: next }]);
    };
    handle.addEventListener('pointermove', movement);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  }
  function marqueeSelect(event: PointerEvent) {
    if (event.button !== 0 || tool !== 'select' || space) return;
    event.preventDefault();
    clearBoardInteraction();
    const node = board;
    const rect = board.getBoundingClientRect();
    const startScreen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const startWorld = point(event);
    let moved = false;
    node.setPointerCapture(event.pointerId);
    const movement = (moveEvent: PointerEvent) => {
      const currentScreen = {
        x: moveEvent.clientX - rect.left,
        y: moveEvent.clientY - rect.top,
      };
      if (Math.hypot(currentScreen.x - startScreen.x, currentScreen.y - startScreen.y) > 3)
        moved = true;
      marquee = {
        left: Math.min(startScreen.x, currentScreen.x),
        top: Math.min(startScreen.y, currentScreen.y),
        width: Math.abs(currentScreen.x - startScreen.x),
        height: Math.abs(currentScreen.y - startScreen.y),
      };
      const currentWorld = point(moveEvent);
      const left = Math.min(startWorld.x, currentWorld.x);
      const top = Math.min(startWorld.y, currentWorld.y);
      const right = Math.max(startWorld.x, currentWorld.x);
      const bottom = Math.max(startWorld.y, currentWorld.y);
      selectedIds = doc.placements
        .filter(
          (placement) =>
            placement.x < right &&
            placement.x + placement.width > left &&
            placement.y < bottom &&
            placement.y + placement.height > top,
        )
        .map((placement) => placement.entityId);
      selected = selectedIds.length === 1 ? selectedIds[0] : '';
      focused = '';
    };
    const finish = () => {
      node.removeEventListener('pointermove', movement);
      node.removeEventListener('pointerup', finish);
      node.removeEventListener('pointercancel', finish);
      marquee = null;
      if (!moved) {
        selected = '';
        selectedIds = [];
      }
    };
    node.addEventListener('pointermove', movement);
    node.addEventListener('pointerup', finish);
    node.addEventListener('pointercancel', finish);
  }
  function updateConnectionPreview(event: PointerEvent) {
    cursorWorld = point(event);
    if (!connecting) {
      snapTarget = null;
      return;
    }
    const landed = document.elementFromPoint(event.clientX, event.clientY);
    const exactPort = landed?.closest<HTMLElement>('.connection-port');
    const targetCard = landed?.closest<HTMLElement>('.board-card');
    const targetId = exactPort?.dataset.entity ?? targetCard?.dataset.entity;
    if (!targetId || targetId === connecting.entityId) {
      snapTarget = null;
      return;
    }
    const targetPlacement = placementsByEntity.get(targetId);
    if (!targetPlacement) {
      snapTarget = null;
      return;
    }
    snapTarget = {
      entityId: targetId,
      side: exactPort?.dataset.side
        ? (exactPort.dataset.side as ConnectionSide)
        : nearestConnectionSide(targetPlacement, cursorWorld),
    };
  }
  function boardPointerDown(event: PointerEvent) {
    if (event.button === 1) {
      pan(event);
      return;
    }
    if ((event.target as HTMLElement).closest('.board-card,.toolbar,.zoom-controls,.navigation-controls,.group-label,.floating-menu,.curve-settings'))
      return;
    if (connecting) {
      connecting = null;
      return;
    }
    if (space || tool === 'hand') {
      clearBoardInteraction();
      pan(event);
    } else marqueeSelect(event);
  }
  function dragCard(event: PointerEvent, p: Placement) {
    if (
      (event.target as HTMLElement).closest('button,a,textarea') ||
      editingBoard === p.entityId ||
      event.button !== 0
    )
      return;
    if (event.detail > 1) return;
    event.stopPropagation();
    if (connecting) {
      event.preventDefault();
      finishConnection(p.entityId, nearestConnectionSide(p, point(event)));
      return;
    }
    if (space || tool === 'hand') {
      pan(event);
      return;
    }
    selectOnly(p.entityId);
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
        refreshPorts(p.entityId, { ...before, x, y });
      });
    };
    const finish = () => {
      cancelAnimationFrame(raf);
      node.removeEventListener('pointermove', movement);
      node.removeEventListener('pointerup', finish);
      node.removeEventListener('pointercancel', cancel);
      dragging = false;
      refreshEdges(p.entityId, { ...before, x, y });
      refreshPorts(p.entityId, { ...before, x, y });
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
    const middleMouse = event.button === 1;
    const explicitPan = event.button === 0 && (space || tool === 'hand');
    if (!middleMouse && !explicitPan) return;
    if ((event.target as HTMLElement).closest('.board-card') && !middleMouse && !space && tool !== 'hand') return;
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
    selectedIds = [];
    selectedGroup = '';
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
    const card = (e.target as HTMLElement).closest<HTMLElement>('.board-card');
    if (card?.dataset.entity && selectedIds.includes(card.dataset.entity) && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      card.scrollTop += e.deltaY;
      card.scrollLeft += e.deltaX;
      return;
    }
    e.preventDefault();
    const r = board.getBoundingClientRect();
    if (navigationMode === 'mouse' || e.ctrlKey || e.metaKey) {
      zoom(doc.camera.zoom * Math.exp(-e.deltaY * 0.002), e.clientX - r.left, e.clientY - r.top);
    } else {
      doc.camera.x -= e.deltaX;
      doc.camera.y -= e.deltaY;
      persist();
    }
  }
  function setNavigationMode(mode: 'mouse' | 'touchpad') {
    doc.navigationMode = mode;
    persist();
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
      if (a && b)
        edgeNodes
          .get(edge.id)
          ?.setAttribute('d', connectionPath(a, b, edge.fromSide, edge.toSide, bezier));
    }
  }
  function refreshPorts(id: string, placement: Placement) {
    for (const port of board.querySelectorAll<HTMLElement>('.connection-port')) {
      if (port.dataset.entity !== id || !port.dataset.side) continue;
      const anchor = connectionPoint(placement, port.dataset.side as ConnectionSide);
      port.style.left = `${anchor.x}px`;
      port.style.top = `${anchor.y}px`;
    }
  }
  function connectionDrag(event: PointerEvent, p: Placement, side: ConnectionSide) {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    if (connecting && connecting.entityId !== p.entityId) {
      finishConnection(p.entityId, side);
      return;
    }
    if (connecting?.entityId === p.entityId && connecting.side === side) {
      connecting = null;
      snapTarget = null;
      return;
    }
    connecting = { entityId: p.entityId, side };
    snapTarget = null;
    cursorWorld = connectionPoint(p, side);
    const node = event.currentTarget as HTMLElement;
    const start = { x: event.clientX, y: event.clientY };
    let moved = false;
    node.setPointerCapture(event.pointerId);
    const movement = (moveEvent: PointerEvent) => {
      if (Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) > 3) moved = true;
      updateConnectionPreview(moveEvent);
    };
    const cleanup = () => {
      node.removeEventListener('pointermove', movement);
      node.removeEventListener('pointerup', end);
      node.removeEventListener('pointercancel', cancel);
    };
    const end = (endEvent: PointerEvent) => {
      cleanup();
      if (!moved) return;
      updateConnectionPreview(endEvent);
      if (snapTarget) finishConnection(snapTarget.entityId, snapTarget.side);
      else {
        connecting = null;
        snapTarget = null;
      }
    };
    const cancel = () => {
      cleanup();
      connecting = null;
      snapTarget = null;
    };
    node.addEventListener('pointermove', movement);
    node.addEventListener('pointerup', end);
    node.addEventListener('pointercancel', cancel);
  }
  function placeHighlight(id: string) {
    const p = place(id);
    const edge = makeEdge(doc.entities[id].anchor!.pdfId, id, undefined, undefined, undefined, p);
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
        const edge = makeEdge(anchor.pdfId, id, undefined, undefined, undefined, p);
        changes.push({ collection: 'edges', id: edge.id, before: undefined, after: edge });
      }
      commit(changes);
    } else if (e.dataTransfer?.files.length) importFiles([...e.dataTransfer.files], point(e));
  }
  function runSearch() {
    worker?.postMessage({ type: 'query', query, request: ++request });
  }
  function key(e: KeyboardEvent) {
    if (!loaded || e.defaultPrevented) return;
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
      selectedIds = [];
      selectedGroup = '';
      selectionMenu = null;
      groupMenu = null;
      connecting = null;
      snapTarget = null;
      tool = 'select';
      curveSettingsOpen = false;
    }
    if (e.key.toLowerCase() === 'n') addCard();
    if (e.key.toLowerCase() === 'v') {
      tool = 'select';
      curveSettingsOpen = false;
      connecting = null;
      snapTarget = null;
    }
    if (e.key.toLowerCase() === 'h') {
      tool = 'hand';
      curveSettingsOpen = false;
      connecting = null;
      snapTarget = null;
    }
    if (e.key.toLowerCase() === 'c') {
      tool = tool === 'connect' ? 'select' : 'connect';
      curveSettingsOpen = tool === 'connect';
      connecting = null;
      snapTarget = null;
    }
    if (e.key === 'Delete' && selectedGroup) deleteGroup(selectedGroup);
    else if (e.key === 'Delete' && selectedIds.length) {
      for (const id of [...selectedIds]) remove(id);
    }
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
        if (saved) doc = stabilizeConnectionSides(saved);
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
      class:connecting={Boolean(connecting)}
      class="board"
      bind:this={board}
      role="region"
      aria-label="Whiteboard"
      onpointerdown={boardPointerDown}
      oncontextmenu={(event) => {
        if (selectedIds.length > 1) {
          event.preventDefault();
          const rect = board.getBoundingClientRect();
          selectionMenu = { x: event.clientX - rect.left, y: event.clientY - rect.top };
          groupMenu = null;
        }
      }}
      onpointermove={(event) => {
        if (connecting) updateConnectionPreview(event);
      }}
      ondragover={(e) => e.preventDefault()}
      ondrop={drop}
      ondblclick={(e) => {
        if (!(e.target as HTMLElement).closest('.board-card,.toolbar,.zoom-controls,.navigation-controls,.group-box')) {
          e.preventDefault();
          e.stopPropagation();
          addCard(point(e));
        }
      }}
    >
      <div
        class="scene"
        style:transform={`translate(${doc.camera.x}px,${doc.camera.y}px) scale(${doc.camera.zoom})`}
      >
        {#each doc.groups ?? [] as group (group.id)}
          {@const bounds = groupBounds(group)}
          {#if bounds}<div
              class={`group-box ${group.color} ${selectedGroup === group.id ? 'selected' : ''}`}
              role="group"
              aria-label={group.label}
              style={`transform:translate(${bounds.x}px,${bounds.y}px);width:${bounds.width}px;height:${bounds.height}px;--label-scale:${Math.max(1, 1 / doc.camera.zoom)}`}
              oncontextmenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                selectGroup(group.id);
                const rect = board.getBoundingClientRect();
                groupMenu = { id: group.id, x: event.clientX - rect.left, y: event.clientY - rect.top };
                selectionMenu = null;
              }}
            >
              <input
                class="group-label floating-text-input"
                class:editing={groupEditing === group.id}
                aria-label="Group label"
                aria-readonly={groupEditing !== group.id}
                readonly={groupEditing !== group.id}
                tabindex={groupEditing === group.id ? 0 : -1}
                value={group.label}
                onpointerdown={(event) => {
                  event.stopPropagation();
                  if (groupEditing !== group.id) event.preventDefault();
                  selectGroup(group.id);
                }}
                ondblclick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  editGroupLabel(group, event.currentTarget);
                }}
                oninput={(event) => {
                  group.label = event.currentTarget.value;
                  persist();
                }}
                onblur={(event) => finishGroupLabel(group, event.currentTarget)}
                onkeydown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    event.currentTarget.blur();
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    cancelGroupLabel(group, event.currentTarget);
                  }
                }}
              />
              {#each ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as direction}<button
                  class={`group-resize-zone card-resize-zone ${direction}`}
                  tabindex="-1"
                  aria-label={`Resize ${group.label} ${direction}`}
                  onpointerdown={(event) =>
                    resizeGroup(
                      event,
                      group,
                      direction as 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw',
                    )}
                ></button>{/each}
            </div>{/if}
        {/each}
        <svg class="edges" aria-hidden="true">
          <defs
            ><marker id="arrow" markerWidth="7" markerHeight="7" refX="7" refY="3.5" orient="auto"
              ><path d="M0 0 L7 3.5 L0 7" fill="none" stroke="#aaa9a1" /></marker
            ></defs
          >
          {#each doc.edges as edge (edge.id)}{@const a = placementsByEntity.get(
              edge.from,
            )}{@const b = placementsByEntity.get(edge.to)}
            {#if a && b}<path
                use:edgeNode={edge.id}
                class="connection"
                d={connectionPath(a, b, edge.fromSide, edge.toSide, bezier)}
                marker-end="url(#arrow)"
              />{/if}
          {/each}
          {#if connecting && placementsByEntity.has(connecting.entityId)}{@const sourcePlacement = placementsByEntity.get(
              connecting.entityId,
            )!}{@const targetPlacement = snapTarget
              ? placementsByEntity.get(snapTarget.entityId)
              : undefined}<path
              class="connection-preview"
              d={snapTarget && targetPlacement
                ? connectionPath(
                    sourcePlacement,
                    targetPlacement,
                    connecting.side,
                    snapTarget.side,
                    bezier,
                  )
                : previewPath(sourcePlacement, connecting.side, cursorWorld, bezier)}
              marker-end="url(#arrow)"
            />{/if}
        </svg>
        {#each visible as p (p.id)}{@const entity = doc.entities[p.entityId]}{#if entity}
            <ContextMenu.Root
              ><ContextMenu.Trigger
                tabindex={0}
                class={`board-card ${entity.color} ${selectedIds.includes(entity.id) || focused === entity.id ? 'selected' : ''} ${editingBoard === entity.id ? 'editing' : ''} ${connecting && connecting.entityId !== entity.id ? 'connection-target' : ''} ${connecting?.entityId === entity.id ? 'connection-source' : ''} ${dragging && selectedIds.includes(entity.id) ? 'dragging' : ''}`}
                data-entity={entity.id}
                style={`transform:translate(${p.x}px,${p.y}px);width:${p.width}px;height:${p.height}px;z-index:${p.z}`}
                onpointerdown={(e) => dragCard(e, p)}
                oncontextmenu={(event) => {
                  if (selectedIds.length > 1 && selectedIds.includes(entity.id)) {
                    event.preventDefault();
                    event.stopPropagation();
                    const rect = board.getBoundingClientRect();
                    selectionMenu = { x: event.clientX - rect.left, y: event.clientY - rect.top };
                  }
                }}
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
                        selectOnly(entity.id);
                        focused = '';
                      }
                    }}
                    oninput={(body) => edit(entity.id, body)}
                    oncommit={(before) => editCommit(entity.id, before)}
                  />{/if}
                {#if selectedIds.includes(entity.id) && editingBoard !== entity.id}
                  {#each ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as direction}<button
                      class={`card-resize-zone ${direction}`}
                      tabindex="-1"
                      aria-label={`Resize ${entity.title} ${direction}`}
                      onpointerdown={(event) =>
                        resizeCard(
                          event,
                          p,
                          direction as 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw',
                        )}
                    ></button>{/each}
                {/if}
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
                      const side: ConnectionSide = 'right';
                      tool = 'connect';
                      curveSettingsOpen = true;
                      snapTarget = null;
                      connecting = { entityId: entity.id, side };
                      cursorWorld = connectionPoint(p, side);
                    }}>Connect from right…</ContextMenu.Item
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
            {#if tool === 'connect'}{#each ['top', 'right', 'bottom', 'left'] as side}{@const portPoint = connectionPoint(
                  p,
                  side as ConnectionSide,
                )}<button
                  class="connection-port"
                  class:active={connecting?.entityId === entity.id && connecting.side === side}
                  class:snap-target={snapTarget?.entityId === entity.id && snapTarget.side === side}
                  data-entity={entity.id}
                  data-side={side}
                  style={`left:${portPoint.x}px;top:${portPoint.y}px`}
                  aria-label={`Connect from ${side} of ${entity.title}`}
                  title={`Connect from ${side}`}
                  onpointerdown={(event) =>
                    connectionDrag(event, p, side as ConnectionSide)}
                ></button>{/each}{/if}
          {/if}{/each}
      </div>
      {#if marquee}<div
          class="selection-marquee"
          style={`left:${marquee.left}px;top:${marquee.top}px;width:${marquee.width}px;height:${marquee.height}px`}
          aria-hidden="true"
        ></div>{/if}
      {#if selectionMenu}<div
          class="floating-menu"
          role="menu"
          tabindex="-1"
          style={`left:${selectionMenu.x}px;top:${selectionMenu.y}px`}
          onpointerdown={(event) => event.stopPropagation()}
        >
          <button role="menuitem" onclick={createGroup}>Create group from {selectedIds.length} cards</button>
        </div>{/if}
      {#if groupMenu}{@const activeGroup = (doc.groups ?? []).find((group) => group.id === groupMenu?.id)}
        {#if activeGroup}<div
            class="floating-menu group-menu"
            role="menu"
            tabindex="-1"
            style={`left:${groupMenu.x}px;top:${groupMenu.y}px`}
            onpointerdown={(event) => event.stopPropagation()}
          >
            <div class="color-row" aria-label="Group color">
              {#each colors as colorName}<button
                  class={`swatch ${colorName}`}
                  aria-label={`Set ${colorName} group color`}
                  onclick={() => updateGroup(activeGroup.id, { color: colorName })}
                ></button>{/each}
            </div>
            <button class="danger" role="menuitem" onclick={() => deleteGroup(activeGroup.id)}
              >Delete group</button
            >
          </div>{/if}
      {/if}
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
          onclick={() => {
            tool = 'select';
            curveSettingsOpen = false;
            connecting = null;
            snapTarget = null;
          }}><MousePointer2 size={19} /></button
        ><button
          class:active={tool === 'hand'}
          class="icon-button"
          title="Pan · H or hold Space"
          aria-label="Pan tool"
          onclick={() => {
            tool = 'hand';
            curveSettingsOpen = false;
            connecting = null;
            snapTarget = null;
          }}><Hand size={19} /></button
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
          aria-pressed={tool === 'connect'}
          onclick={() => {
            tool = tool === 'connect' ? 'select' : 'connect';
            curveSettingsOpen = tool === 'connect';
            connecting = null;
            snapTarget = null;
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
      {#if curveSettingsOpen}<div
          class="curve-settings"
          role="group"
          aria-label="Bezier curve settings"
          onpointerdown={(event) => event.stopPropagation()}
        >
          <div class="curve-settings-title"><strong>Bezier curve</strong><button
              onclick={() => (bezier = { ...defaultBezierConfig })}>Reset</button
            ></div
          >
          <label>Curvature <output>{bezier.curvature.toFixed(2)}</output><input
              type="range"
              min="0"
              max="1.5"
              step="0.05"
              bind:value={bezier.curvature}
            /></label>
          <label>Minimum pull <output>{bezier.minControlDistance}px</output><input
              type="range"
              min="0"
              max="160"
              step="5"
              bind:value={bezier.minControlDistance}
            /></label>
          <label>Maximum pull <output>{bezier.maxControlDistance}px</output><input
              type="range"
              min="40"
              max="400"
              step="10"
              bind:value={bezier.maxControlDistance}
            /></label>
          <label>Source pull <output>{bezier.sourcePull.toFixed(2)}</output><input
              type="range"
              min="0"
              max="2"
              step="0.05"
              bind:value={bezier.sourcePull}
            /></label>
          <label>Target pull <output>{bezier.targetPull.toFixed(2)}</output><input
              type="range"
              min="0"
              max="2"
              step="0.05"
              bind:value={bezier.targetPull}
            /></label>
        </div>{/if}
      <div class="board-hint">
        {tool === 'connect'
          ? connecting
            ? 'Choose a destination dot or release anywhere inside a card'
            : 'Click or drag from a card dot'
          : navigationMode === 'mouse'
            ? 'Middle-drag to pan · Wheel to zoom · Double-click to write'
            : 'Two-finger pan · Pinch to zoom · Double-click to write'}
      </div>
      <div
        class="navigation-controls"
        role="toolbar"
        tabindex="-1"
        aria-label="Navigation mode"
        onpointerdown={(event) => event.stopPropagation()}
      >
        <button
          class:active={navigationMode === 'mouse'}
          class="icon-button"
          title="Mouse navigation: middle-drag to pan, wheel to zoom"
          aria-label="Use mouse navigation"
          aria-pressed={navigationMode === 'mouse'}
          onclick={() => setNavigationMode('mouse')}><Mouse size={15} /></button
        ><button
          class:active={navigationMode === 'touchpad'}
          class="icon-button"
          title="Touchpad navigation: two-finger pan, pinch to zoom"
          aria-label="Use touchpad navigation"
          aria-pressed={navigationMode === 'touchpad'}
          onclick={() => setNavigationMode('touchpad')}><Laptop size={15} /></button
        >
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
          selectedIds = [];
          selectedGroup = '';
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
        {#each [['N', 'New card'], ['V / H', 'Select / pan'], ['Space + drag', 'Pan the board'], ['Mouse mode', 'Middle-drag to pan · wheel to zoom'], ['Touchpad mode', 'Two-finger pan · pinch to zoom'], ['Drag empty space', 'Select multiple cards'], ['Right-click selection', 'Create a group'], ['Delete on a group', 'Remove group, keep its cards'], ['C', 'Connect cards and tune curves'], ['Ctrl / ⌘ K', 'Search locally'], ['Ctrl / ⌘ Z', 'Undo'], ['Ctrl / ⌘ Shift Z', 'Redo'], ['0', 'Fit everything'], ['Enter on a card', 'Open in workbench'], ['Arrow keys on a card', 'Nudge position'], ['Shift F10', 'Card context menu']] as shortcut}<div
          >
            <dt>{shortcut[0]}</dt>
            <dd>{shortcut[1]}</dd>
          </div>{/each}
      </dl>
      <Dialog.Close class="help-close">Back to thinking</Dialog.Close></Dialog.Content
    ></Dialog.Portal
  ></Dialog.Root
>
