<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { ContextMenu, Dialog } from 'bits-ui';
  import SearchDialog from './components/SearchDialog.svelte';
  import SettingsDialog from './components/SettingsDialog.svelte';
  import HelpDialog from './components/HelpDialog.svelte';
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
    Settings,
    Upload,
    Highlighter,
    Mouse,
    Laptop,
    Type,
  } from 'lucide-svelte';
  import {
    seed,
    uid,
    SpatialGrid,
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
    type Edge,
    type ConnectionSide,
    type FontId,
  } from './lib/model';
  import { saveAsset, loadPdfText, savePdfText } from './lib/storage';
  import {
    commit,
    doc,
    docStatus,
    flush,
    loadDoc as loadSavedDoc,
    onDocChange,
    persist,
    record,
    redo,
    redoStack,
    setNotifyHandler,
    undo,
    undoStack,
  } from './lib/doc.svelte';
  import { titleFromMarkdown } from './lib/markdown';
  import { centerOn, centerPoint, fit, point, zoom, viewport } from './lib/viewport.svelte';
  import { clearSelection, selectOnly, selection } from './lib/selection.svelte';
  import {
    isKnown,
    prune,
    remove as searchRemove,
    run,
    search,
    upsert as searchUpsert,
  } from './lib/search.svelte';
  import {
    fitFreeTextSize,
    measureHeightAt,
    measureNaturalHeight,
    measureWidthForHeight,
    FREE_TEXT_MIN_WIDTH,
    FREE_TEXT_MIN_HEIGHT,
  } from './lib/free-text';
  import { fontFamily, fontOptions } from './lib/fonts';
  import { acquirePdf, releasePdf } from './lib/pdf';
  import Editor from './Editor.svelte';
  import Board from './components/Board.svelte';
  import FreeText from './components/FreeText.svelte';
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
  let notice = $state('');
  let titleEditing = $state(false);
  let boardTitleInput: HTMLInputElement;
  let focused = $state('');
  let editingBoard = $state('');
  let textEditBefore: { id: string; entity: Entity; placement: Placement } | null = null;
  let resizing = $state(false);
  let cursorWorld = $state<Point>({ x: 0, y: 0 });
  let tool = $state<'select' | 'hand' | 'connect'>('select');
  let connecting = $state<{ entityId: string; side: ConnectionSide } | null>(null);
  let snapTarget = $state<{ entityId: string; side: ConnectionSide } | null>(null);
  let curveSettingsOpen = $state(false);
  let bezier = $state<BezierConfig>({ ...defaultBezierConfig });
  let dragging = $state(false);
  let searchOpen = $state(false);
  let helpOpen = $state(false);
  let settingsOpen = $state(false);
  let indexing = $state(0);
  let board: Board;
  let fileInput: HTMLInputElement;
  let notificationTimer: ReturnType<typeof setTimeout>;
  const navigationMode = $derived(doc.navigationMode ?? 'touchpad');
  const whiteboardFont = $derived(doc.whiteboardFont ?? 'inter');
  const interfaceFont = $derived(doc.interfaceFont ?? 'inter');
  const grid = $derived(new SpatialGrid(doc.placements));
  const visible = $derived(
    grid.query(
      (-doc.camera.x - 200) / doc.camera.zoom,
      (-doc.camera.y - 200) / doc.camera.zoom,
      (viewport.width + 400) / doc.camera.zoom,
      (viewport.height + 400) / doc.camera.zoom,
    ),
  );
  const hasSecondary = $derived(doc.panes.some((p) => p.column === 'secondary'));
  const benchWidth = $derived(doc.panes.length ? benchSize(doc) : 0);
  const placementsByEntity = $derived(new Map(doc.placements.map((p) => [p.entityId, p])));
  const annotations = $derived(Object.values(doc.entities).filter((e) => e.type === 'annotation'));
  const columns = $derived(
    hasSecondary ? (['primary', 'secondary'] as const) : (['primary'] as const),
  );
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
  function updateSearch() {
    const keep = new Set<string>();
    for (const entity of Object.values(doc.entities)) {
      keep.add(entity.id);
      if (entity.type === 'pdf') {
        if (!isKnown(entity.id)) indexPdf(entity);
        continue;
      }
      searchUpsert(entity.id, entity.title + ' ' + entity.body + ' ' + (entity.anchor?.quote ?? ''));
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
    tool = 'select';
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
    tool = 'select';
    await beginFreeTextEdit(id, true);
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
    refreshEdges(id, placement);
    refreshPorts(id, placement);
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
    const isFreeText = doc.entities[placement.entityId]?.type === 'text';
    const freeTextLock: 'width' | 'height' =
      direction.includes('e') || direction.includes('w') ? 'width' : 'height';
    const freeHost = isFreeText ? freeTextHost(placement.entityId) : null;
    const start = { x: event.clientX, y: event.clientY };
    const before = $state.snapshot(placement);
    let next = { ...before };
    handle.setPointerCapture(event.pointerId);
    const movement = (moveEvent: PointerEvent) => {
      const dx = (moveEvent.clientX - start.x) / doc.camera.zoom;
      const dy = (moveEvent.clientY - start.y) / doc.camera.zoom;
      const minimumWidth = isFreeText ? FREE_TEXT_MIN_WIDTH : 120;
      next = {
        ...before,
        ...(isFreeText ? { locked: freeTextLock, autoWidth: undefined } : {}),
      };
      if (isFreeText && freeHost) {
        // The dragged dimension is locked by the user; the other one auto-fits the text.
        if (freeTextLock === 'width') {
          if (direction.includes('e')) next.width = Math.max(minimumWidth, before.width + dx);
          if (direction.includes('w')) {
            next.width = Math.max(minimumWidth, before.width - dx);
            next.x = before.x + before.width - next.width;
          }
          next.height = Math.max(FREE_TEXT_MIN_HEIGHT, measureHeightAt(freeHost, next.width));
        } else {
          const naturalHeight = measureNaturalHeight(freeHost);
          if (direction.includes('s'))
            next.height = Math.max(
              FREE_TEXT_MIN_HEIGHT,
              Math.min(naturalHeight, before.height + dy),
            );
          if (direction.includes('n')) {
            next.height = Math.max(
              FREE_TEXT_MIN_HEIGHT,
              Math.min(naturalHeight, before.height - dy),
            );
            next.y = before.y + before.height - next.height;
          }
          next.width = Math.max(minimumWidth, measureWidthForHeight(freeHost, next.height));
        }
      } else {
        if (direction.includes('e')) next.width = Math.max(minimumWidth, before.width + dx);
        if (!isFreeText && direction.includes('s')) next.height = Math.max(80, before.height + dy);
        if (direction.includes('w')) {
          next.width = Math.max(minimumWidth, before.width - dx);
          next.x = before.x + before.width - next.width;
        }
        if (!isFreeText && direction.includes('n')) {
          next.height = Math.max(80, before.height - dy);
          next.y = before.y + before.height - next.height;
        }
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
        next.height !== before.height ||
        next.locked !== before.locked
      )
        commit([{ collection: 'placements', id: placement.id, before, after: next }]);
    };
    handle.addEventListener('pointermove', movement);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
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
  function dragCard(event: PointerEvent, p: Placement) {
    if (
      (event.target as HTMLElement).closest('button,a,textarea') ||
      editingBoard === p.entityId ||
      event.button !== 0
    )
      return;
    if (event.detail > 1 && doc.entities[p.entityId]?.type !== 'text') return;
    event.stopPropagation();
    if (connecting) {
      event.preventDefault();
      finishConnection(p.entityId, nearestConnectionSide(p, point(event)));
      return;
    }
    if (viewport.space || tool === 'hand') {
      board.pan(event);
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
  function setNavigationMode(mode: 'mouse' | 'touchpad') {
    doc.navigationMode = mode;
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
  function refreshEdges(id: string, override: Placement) {
    board.refreshEdges(id, override);
  }
  function refreshPorts(id: string, placement: Placement) {
    board.refreshPorts(id, placement);
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
  function key(e: KeyboardEvent) {
    if (!docStatus.loaded || e.defaultPrevented) return;
    const input = (e.target as HTMLElement).closest('input,textarea,[contenteditable="true"]');
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      searchOpen = true;
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
    if (e.code === 'Space') {
      viewport.space = true;
      e.preventDefault();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    }
    if (e.key === 'Escape') {
      selection.selected = '';
      selection.ids = [];
      selection.group = '';
      selection.menu = null;
      selection.groupMenu = null;
      connecting = null;
      snapTarget = null;
      tool = 'select';
      curveSettingsOpen = false;
    }
    if (e.key.toLowerCase() === 'n') addCard();
    if (e.key.toLowerCase() === 't') addFreeText();
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
    if (e.key === 'Delete' && selection.group) board.deleteGroup(selection.group);
    else if (e.key === 'Delete' && selection.ids.length) {
      for (const id of [...selection.ids]) remove(id);
    }
    if (e.key === '0') fit();
  }
  onMount(() => {
    let alive = true;
    loadSavedDoc()
      .then((saved) => {
        if (!alive) return;
        updateSearch();
        if (!saved) persist();
        // Normalize free-text sizes once the board has rendered: clamp legacy
        // heights and re-hug the text so no broken state survives a reload.
        tick().then(() => {
          for (const p of doc.placements)
            if (doc.entities[p.entityId]?.type === 'text') fitFreeText(p.entityId);
          persist();
        });
      })
      .catch((e) => {
        notify(`Could not load your workspace: ${e.message}. Reload to retry; saving is paused.`);
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
      <span class="save-state" title={docStatus.saveStatus}
        >{#if docStatus.saveStatus === 'Saving…'}<LoaderCircle
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
      {tool}
      {connecting}
      {snapTarget}
      {cursorWorld}
      {bezier}
      onclearinteraction={clearBoardInteraction}
      onfocusclear={() => (focused = '')}
      onupdateconnectionpreview={updateConnectionPreview}
      ondrop={drop}
      onaddcard={addCard}
      onnotify={notify}
    >
      {#snippet cards()}
        {#each visible as p (p.id)}{@const entity = doc.entities[p.entityId]}{#if entity}
            <ContextMenu.Root
              ><ContextMenu.Trigger
                tabindex={0}
                class={`board-card ${entity.type === 'text' ? 'free-text' : ''} ${entity.color} ${selection.ids.includes(entity.id) || focused === entity.id ? 'selected' : ''} ${editingBoard === entity.id ? 'editing' : ''} ${connecting && connecting.entityId !== entity.id ? 'connection-target' : ''} ${connecting?.entityId === entity.id ? 'connection-source' : ''} ${dragging && selection.ids.includes(entity.id) ? 'dragging' : ''}`}
                data-entity={entity.id}
                style={`transform:translate(${p.x}px,${p.y}px);width:${p.width}px;height:${p.height}px;z-index:${p.z}`}
                onpointerdown={(e) => dragCard(e, p)}
                onclick={(e) => {
                  // Free text: links open in a new tab when the card isn't being edited.
                  if (entity.type !== 'text' || editingBoard === entity.id) return;
                  const anchor = (e.target as HTMLElement).closest('a');
                  if (!anchor?.href) return;
                  e.preventDefault();
                  e.stopPropagation();
                  window.open(anchor.href, '_blank', 'noopener');
                }}
                ondblclick={(event) => {
                  if (entity.type !== 'text') return;
                  event.preventDefault();
                  event.stopPropagation();
                  beginFreeTextEdit(entity.id);
                }}
                oncontextmenu={(event) => {
                  if (selection.ids.length > 1 && selection.ids.includes(entity.id)) {
                    event.preventDefault();
                    event.stopPropagation();
                    const rect = board.getRect();
                    selection.menu = { x: event.clientX - rect.left, y: event.clientY - rect.top };
                  }
                }}
                onkeydown={(e) => {
                  if ((e.target as HTMLElement).closest('.live-editor,.editable')) return;
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (entity.type === 'text') beginFreeTextEdit(entity.id);
                    else open(entity.id);
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
                {#if entity.type !== 'text'}<button
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
                  >{/if}
                {#if entity.type === 'text'}<FreeText
                    id={entity.id}
                    body={entity.body}
                    editing={editingBoard === entity.id}
                    oninput={(body) => editFreeText(entity.id, body)}
                    onfinish={() => finishFreeTextEdit(entity.id)}
                    onfit={refreshEdges}
                  />{:else if doc.camera.zoom < 0.35 && editingBoard !== entity.id}<strong
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
                {#if selection.ids.includes(entity.id) && editingBoard !== entity.id}
                  {#each entity.type === 'text' ? ['n', 'e', 's', 'w'] : ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as direction}<button
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
                  >{#if entity.type !== 'text'}<ContextMenu.Item onclick={() => open(entity.id)}
                      >Open in workbench <PanelRightOpen size={15} /></ContextMenu.Item
                    >{/if}{#if entity.anchor}<ContextMenu.Item onclick={() => source(entity)}
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
                  >{#if entity.type !== 'text'}<ContextMenu.Separator class="menu-separator" />
                    <div class="color-row">
                      {#each ['white', 'yellow', 'blue', 'green', 'pink', 'purple'] as c}<button
                          class={`swatch ${c}`}
                          aria-label={`Set ${c} card color`}
                          title={c}
                          onclick={() => color(entity.id, c)}
                        ></button>{/each}
                    </div>{/if}
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
            {#if tool === 'connect'}{#each ['top', 'right', 'bottom', 'left'] as side}{@const portPoint =
                  connectionPoint(p, side as ConnectionSide)}<button
                  class="connection-port"
                  class:active={connecting?.entityId === entity.id && connecting.side === side}
                  class:snap-target={snapTarget?.entityId === entity.id && snapTarget.side === side}
                  data-entity={entity.id}
                  data-side={side}
                  style={`left:${portPoint.x}px;top:${portPoint.y}px`}
                  aria-label={`Connect from ${side} of ${entity.title}`}
                  title={`Connect from ${side}`}
                  onpointerdown={(event) => connectionDrag(event, p, side as ConnectionSide)}
                ></button>{/each}{/if}
          {/if}{/each}
      {/snippet}
      {#snippet overlays()}
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
          title="Free text · T"
          aria-label="Add free text"
          onclick={() => addFreeText()}><Type size={19} /></button
        ><button
          class="icon-button"
          title="Import PDF, image, or markdown"
          aria-label="Import files"
          onclick={() => fileInput.click()}><Upload size={19} /></button
        ><button
          class:active={tool === 'connect'}
          class="icon-button"
          title="Connect items · C"
          aria-label="Connect items"
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
          <div class="curve-settings-title">
            <strong>Bezier curve</strong><button
              onclick={() => (bezier = { ...defaultBezierConfig })}>Reset</button
            >
          </div>
          <label
            >Curvature <output>{bezier.curvature.toFixed(2)}</output><input
              type="range"
              min="0"
              max="1.5"
              step="0.05"
              bind:value={bezier.curvature}
            /></label
          >
          <label
            >Minimum pull <output>{bezier.minControlDistance}px</output><input
              type="range"
              min="0"
              max="160"
              step="5"
              bind:value={bezier.minControlDistance}
            /></label
          >
          <label
            >Maximum pull <output>{bezier.maxControlDistance}px</output><input
              type="range"
              min="40"
              max="400"
              step="10"
              bind:value={bezier.maxControlDistance}
            /></label
          >
          <label
            >Source pull <output>{bezier.sourcePull.toFixed(2)}</output><input
              type="range"
              min="0"
              max="2"
              step="0.05"
              bind:value={bezier.sourcePull}
            /></label
          >
          <label
            >Target pull <output>{bezier.targetPull.toFixed(2)}</output><input
              type="range"
              min="0"
              max="2"
              step="0.05"
              bind:value={bezier.targetPull}
            /></label
          >
        </div>{/if}
      <div class="board-hint">
        {tool === 'connect'
          ? connecting
            ? 'Choose a destination dot or release anywhere inside an item'
            : 'Click or drag from an item dot'
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
      {/snippet}
    </Board>
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
{#if !docStatus.loaded}<div class="load-cover" role="status">
    {docStatus.loadFailed
      ? 'Your workspace could not be loaded. Reload to retry.'
      : 'Opening your workspace…'}
  </div>{/if}
{#if notice}<div class="toast" role="status">
    {notice}<button aria-label="Dismiss" onclick={() => (notice = '')}><X size={14} /></button>
  </div>{/if}
<SearchDialog
  bind:open={searchOpen}
  {indexing}
  onreveal={revealOnBoard}
  onopen={open}
/>
<SettingsDialog bind:open={settingsOpen} />
<HelpDialog bind:open={helpOpen} />