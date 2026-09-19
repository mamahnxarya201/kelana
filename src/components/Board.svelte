<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    Hand,
    Laptop,
    Link2,
    Maximize,
    Minus,
    Mouse,
    MousePointer2,
    Plus,
    Redo2,
    Type,
    Undo2,
    Upload,
  } from 'lucide-svelte';
  import BoardCard from './BoardCard.svelte';
  import EdgesLayer from './EdgesLayer.svelte';
  import { commit, doc, persist, redo, redoStack, undo, undoStack } from '../lib/doc.svelte';
  import { endEntityDrag, entityDrag, moveEntityDrag } from '../lib/drag.svelte';
  import { highlightSwatch } from '../lib/highlight';
  import { clearSelection, selectGroup, selection } from '../lib/selection.svelte';
  import { centerPoint, fit, point, viewport, zoom, zoomFromWheel } from '../lib/viewport.svelte';
  import {
    connectionPoint,
    defaultBezierConfig,
    facingConnectionSides,
    nearestConnectionSide,
  } from '../lib/connections';
  import {
    SpatialGrid,
    uid,
    type ConnectionSide,
    type Edge,
    type Entity,
    type Group,
    type Placement,
    type Point,
  } from '../lib/model';

  let {
    focused,
    editingBoard,
    onclearinteraction,
    onfocus,
    onediting,
    ondrop,
    onaddcard,
    onaddfreetext,
    onimport,
    onnotify,
    onopen,
    onsource,
    onduplicate,
    oncolor,
    onreorder,
    onremove,
    onremoveedge,
    onedit,
    oneditcommit,
    onbeginfreetextedit,
    oneditfreetext,
    onfinishfreetextedit,
  }: {
    focused: string;
    editingBoard: string;
    onclearinteraction: () => void;
    onfocus: (id: string) => void;
    onediting: (id: string) => void;
    ondrop: (event: DragEvent) => void;
    onaddcard: (point?: Point) => void;
    onaddfreetext: (point?: Point) => void;
    onimport: () => void;
    onnotify: (message: string) => void;
    onopen: (id: string) => void;
    onsource: (entity: Entity) => void;
    onduplicate: (id: string) => void;
    oncolor: (id: string, color: string) => void;
    onreorder: (id: string, front: boolean) => void;
    onremove: (id: string) => void;
    onremoveedge: (id: string) => void;
    onedit: (id: string, body: string) => void;
    oneditcommit: (id: string, before: string) => void;
    onbeginfreetextedit: (id: string) => void;
    oneditfreetext: (id: string, body: string) => void;
    onfinishfreetextedit: (id: string) => void;
  } = $props();

  let element: HTMLDivElement;
  let edgesLayer: EdgesLayer;
  let marquee = $state<{ left: number; top: number; width: number; height: number } | null>(null);
  let tool = $state<'select' | 'hand' | 'connect'>('select');
  let createMode = $state<'card' | 'text'>('card');
  let isPanning = $state(false);
  const isTempPan = $derived(viewport.space || isPanning);
  const selectActive = $derived(tool === 'select' && !isTempPan);
  const handActive = $derived(tool === 'hand' || isTempPan);
  const connectActive = $derived(tool === 'connect' && !isTempPan);
  let connecting = $state<{ entityId: string; side: ConnectionSide } | null>(null);
  let snapTarget = $state<{ entityId: string; side: ConnectionSide } | null>(null);
  let hoverConnectId = $state<string | null>(null);
  let suppressPortsId = $state<string | null>(null);
  let cursorWorld = $state<Point>({ x: 0, y: 0 });
  let curveSettingsOpen = $state(false);
  let bezier = $state({ ...defaultBezierConfig });
  let dragging = $state(false);
  let resizing = $state(false);
  let groupEditing = $state('');
  let groupEditBefore = '';
  const colors = ['white', 'yellow', 'blue', 'green', 'pink', 'purple', 'orange'];
  const navigationMode = $derived(doc.navigationMode ?? 'touchpad');
  const placementsByEntity = $derived(
    new Map(doc.placements.map((placement) => [placement.entityId, placement])),
  );
  // Indexed once per placement change, not once per camera change: zooming
  // animates the camera every frame and must not rebuild the whole grid.
  const grid = $derived(new SpatialGrid(doc.placements));
  const visible = $derived(
    grid.query(
      (-doc.camera.x - 200) / doc.camera.zoom,
      (-doc.camera.y - 200) / doc.camera.zoom,
      (viewport.width + 400) / doc.camera.zoom,
      (viewport.height + 400) / doc.camera.zoom,
    ),
  );

  export function getElement() {
    return element;
  }

  export function setResizing(value: boolean) {
    resizing = value;
    element?.closest('.workspace-shell')?.classList.toggle('resizing', resizing);
  }

  export function getRect() {
    return element.getBoundingClientRect();
  }

  export function refreshEdges(id: string, override: Placement) {
    edgesLayer.refresh(id, override);
  }

  export function refreshPorts(id: string, placement: Placement) {
    for (const port of element.querySelectorAll<HTMLElement>('.connection-port')) {
      if (port.dataset.entity !== id || !port.dataset.side) continue;
      const side = port.dataset.side as ConnectionSide;
      const anchor =
        side === 'top'
          ? { x: placement.x + placement.width / 2, y: placement.y }
          : side === 'right'
            ? { x: placement.x + placement.width, y: placement.y + placement.height / 2 }
            : side === 'bottom'
              ? { x: placement.x + placement.width / 2, y: placement.y + placement.height }
              : { x: placement.x, y: placement.y + placement.height / 2 };
      port.style.left = `${anchor.x}px`;
      port.style.top = `${anchor.y}px`;
    }
  }

  function groupBounds(group: Group) {
    if (
      group.x !== undefined &&
      group.y !== undefined &&
      group.width !== undefined &&
      group.height !== undefined
    )
      return { x: group.x, y: group.y, width: group.width, height: group.height };
    const members = doc.placements.filter((placement) =>
      group.entityIds.includes(placement.entityId),
    );
    if (!members.length) return null;
    const padding = 24;
    const minX = Math.min(...members.map((member) => member.x)) - padding;
    const minY = Math.min(...members.map((member) => member.y)) - padding;
    const maxX = Math.max(...members.map((member) => member.x + member.width)) + padding;
    const maxY = Math.max(...members.map((member) => member.y + member.height)) + padding;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
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

  function createGroup() {
    if (selection.ids.length < 2) return;
    const before = $state.snapshot(doc.groups ?? []);
    const members = doc.placements.filter((placement) =>
      selection.ids.includes(placement.entityId),
    );
    const padding = 24;
    const x = Math.min(...members.map((member) => member.x)) - padding;
    const y = Math.min(...members.map((member) => member.y)) - padding;
    const group: Group = {
      id: uid('group'),
      label: 'New group',
      color: colors[1 + Math.floor(Math.random() * (colors.length - 1))],
      entityIds: [...selection.ids],
      x,
      y,
      width: Math.max(...members.map((member) => member.x + member.width)) + padding - x,
      height: Math.max(...members.map((member) => member.y + member.height)) + padding - y,
    };
    commit([{ collection: 'document', id: 'groups', before, after: [...before, group] }]);
    selection.menu = null;
    selectGroup(group.id);
    onnotify('Group created. Edit its label inline.');
  }

  function updateGroup(id: string, value: Partial<Group>) {
    const before = $state.snapshot(doc.groups ?? []);
    const after = before.map((group) => (group.id === id ? { ...group, ...value } : group));
    commit([{ collection: 'document', id: 'groups', before, after }]);
    selection.groupMenu = null;
  }

  export function deleteGroup(id: string) {
    const before = $state.snapshot(doc.groups ?? []);
    const after = before.filter((group) => group.id !== id);
    commit([{ collection: 'document', id: 'groups', before, after }]);
    selection.group = '';
    selection.groupMenu = null;
    onnotify('Group removed. Its items are unchanged.');
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

  function makeEdge(
    from: string,
    to: string,
    fromSide?: ConnectionSide,
    toSide?: ConnectionSide,
  ): Edge {
    const fromPlacement = placementsByEntity.get(from);
    const toPlacement = placementsByEntity.get(to);
    if ((!fromSide || !toSide) && fromPlacement && toPlacement) {
      const facing = facingConnectionSides(fromPlacement, toPlacement);
      fromSide ??= facing[0];
      toSide ??= facing[1];
    }
    return { id: uid('edge'), from, to, fromSide, toSide };
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

  // Hover/proximity reveal for connection ports. Visual only — snapping stays
  // strict inside updateConnectionPreview (exact port or card under cursor).
  function updateConnectHover(event: PointerEvent) {
    if (tool !== 'connect') {
      hoverConnectId = null;
      return;
    }
    const landed = document.elementFromPoint(event.clientX, event.clientY) as Element | null;
    const port = landed?.closest?.('.connection-port') as HTMLElement | null;
    const card = landed?.closest?.('.board-card') as HTMLElement | null;
    const directId = port?.dataset.entity ?? card?.dataset.entity ?? null;
    if (directId) {
      if (directId === suppressPortsId) {
        hoverConnectId = null;
        return;
      }
      suppressPortsId = null;
      hoverConnectId = directId;
      return;
    }
    // Proximity: cursor near (not necessarily over) a card reveals its ports.
    const world = point(event);
    const margin = 40 / doc.camera.zoom;
    let best: string | null = null;
    let bestDist = Infinity;
    for (const placement of doc.placements) {
      if (placement.entityId === suppressPortsId) continue;
      const dx = Math.max(
        placement.x - world.x,
        0,
        world.x - (placement.x + placement.width),
      );
      const dy = Math.max(
        placement.y - world.y,
        0,
        world.y - (placement.y + placement.height),
      );
      const dist = Math.hypot(dx, dy);
      if (dist <= margin && dist < bestDist) {
        bestDist = dist;
        best = placement.entityId;
      }
    }
    if (best) {
      hoverConnectId = best;
    } else {
      hoverConnectId = null;
      suppressPortsId = null;
    }
  }

  function isPortsVisible(entityId: string) {
    if (tool !== 'connect' || suppressPortsId === entityId) return false;
    return (
      hoverConnectId === entityId ||
      connecting?.entityId === entityId ||
      snapTarget?.entityId === entityId
    );
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
    // Auto-hide: keep the just-connected card's dots hidden until the
    // pointer moves elsewhere, even though the cursor is still over it.
    hoverConnectId = null;
    suppressPortsId = to;
  }

  function connectionDrag(event: PointerEvent, placement: Placement, side: ConnectionSide) {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    if (connecting && connecting.entityId !== placement.entityId) {
      finishConnection(placement.entityId, side);
      return;
    }
    if (connecting?.entityId === placement.entityId && connecting.side === side) {
      connecting = null;
      snapTarget = null;
      return;
    }
    connecting = { entityId: placement.entityId, side };
    snapTarget = null;
    cursorWorld = connectionPoint(placement, side);
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

  function setConnection(id: string, side: ConnectionSide) {
    tool = 'connect';
    curveSettingsOpen = true;
    snapTarget = null;
    hoverConnectId = null;
    suppressPortsId = null;
    connecting = { entityId: id, side };
    const placement = placementsByEntity.get(id);
    if (placement) cursorWorld = connectionPoint(placement, side);
  }

  function edgeContext(id: string, event: MouseEvent) {
    const rect = element.getBoundingClientRect();
    selection.edgeMenu = { id, x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function deleteEdge(id: string) {
    selection.edgeMenu = null;
    onremoveedge(id);
  }

  function refreshCard(id: string, placement: Placement) {
    refreshEdges(id, placement);
    refreshPorts(id, placement);
  }

  export function activateSelectTool() {
    selectTool('select');
  }

  function selectTool(next: 'select' | 'hand') {
    tool = next;
    curveSettingsOpen = false;
    connecting = null;
    snapTarget = null;
    hoverConnectId = null;
    suppressPortsId = null;
  }

  function toggleConnectTool() {
    tool = tool === 'connect' ? 'select' : 'connect';
    curveSettingsOpen = tool === 'connect';
    connecting = null;
    snapTarget = null;
    hoverConnectId = null;
    suppressPortsId = null;
  }

  function setNavigationMode(mode: 'mouse' | 'touchpad') {
    doc.navigationMode = mode;
    persist();
  }

  export function handleKey(event: KeyboardEvent) {
    if (event.code === 'Space') {
      viewport.space = true;
      event.preventDefault();
    }
    if (event.key === 'Escape') {
      clearSelection();
      connecting = null;
      snapTarget = null;
      hoverConnectId = null;
      suppressPortsId = null;
      tool = 'select';
      curveSettingsOpen = false;
    }
    if (event.key.toLowerCase() === 'n') {
      if (!selectActive) return;
      createMode = 'card';
      onaddcard();
    }
    if (event.key.toLowerCase() === 't') {
      if (!selectActive) return;
      createMode = 'text';
      onaddfreetext();
    }
    if (event.key.toLowerCase() === 'v') selectTool('select');
    if (event.key.toLowerCase() === 'h') selectTool('hand');
    if (event.key.toLowerCase() === 'c') toggleConnectTool();
    if (event.key === 'Delete' && selection.edge) deleteEdge(selection.edge);
    else if (event.key === 'Delete' && selection.group) deleteGroup(selection.group);
    else if (event.key === 'Delete' && selection.ids.length)
      for (const id of [...selection.ids]) onremove(id);
    if (event.key === '0') fit();
  }

  function marqueeSelect(event: PointerEvent) {
    if (event.button !== 0 || tool !== 'select' || viewport.space) return;
    event.preventDefault();
    groupEditing = '';
    onclearinteraction();
    const rect = element.getBoundingClientRect();
    const startScreen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const startWorld = point(event);
    let moved = false;
    element.setPointerCapture(event.pointerId);
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
      selection.ids = doc.placements
        .filter(
          (placement) =>
            placement.x < right &&
            placement.x + placement.width > left &&
            placement.y < bottom &&
            placement.y + placement.height > top,
        )
        .map((placement) => placement.entityId);
      selection.selected = selection.ids.length === 1 ? selection.ids[0] : '';
      onfocus('');
    };
    const finish = () => {
      element.removeEventListener('pointermove', movement);
      element.removeEventListener('pointerup', finish);
      element.removeEventListener('pointercancel', finish);
      marquee = null;
      if (!moved) {
        selection.selected = '';
        selection.ids = [];
        selection.edge = '';
      }
    };
    element.addEventListener('pointermove', movement);
    element.addEventListener('pointerup', finish);
    element.addEventListener('pointercancel', finish);
  }

  export function pan(event: PointerEvent) {
    const middleMouse = event.button === 1;
    const explicitPan = event.button === 0 && (viewport.space || tool === 'hand');
    if (!middleMouse && !explicitPan) return;
    if (
      (event.target as HTMLElement).closest('.board-card') &&
      !middleMouse &&
      !viewport.space &&
      tool !== 'hand'
    )
      return;
    event.preventDefault();
    const start = { x: event.clientX, y: event.clientY };
    const camera = { ...doc.camera };
    isPanning = true;
    element.setPointerCapture(event.pointerId);
    const movement = (moveEvent: PointerEvent) => {
      doc.camera.x = camera.x + moveEvent.clientX - start.x;
      doc.camera.y = camera.y + moveEvent.clientY - start.y;
    };
    const finish = () => {
      element.removeEventListener('pointermove', movement);
      element.removeEventListener('pointerup', finish);
      element.removeEventListener('pointercancel', finish);
      isPanning = false;
      persist();
    };
    element.addEventListener('pointermove', movement);
    element.addEventListener('pointerup', finish);
    element.addEventListener('pointercancel', finish);
    clearSelection();
  }

  function boardPointerDown(event: PointerEvent) {
    if (event.button === 1) {
      pan(event);
      return;
    }
    if (
      (event.target as HTMLElement).closest(
        '.board-card,.toolbar,.zoom-controls,.navigation-controls,.group-label,.floating-menu,.curve-settings',
      )
    )
      return;
    if (connecting) {
      connecting = null;
      snapTarget = null;
      return;
    }
    if (viewport.space || tool === 'hand') {
      groupEditing = '';
      onclearinteraction();
      pan(event);
    } else marqueeSelect(event);
  }

  function wheel(event: WheelEvent) {
    const card = (event.target as HTMLElement).closest<HTMLElement>('.board-card');
    // The card itself never scrolls (its overflow is hidden); overflowing
    // content lives in the inner .card-scroll host.
    const scroller = card?.querySelector<HTMLElement>('.card-scroll');
    if (
      card?.dataset.entity &&
      scroller &&
      selection.ids.includes(card.dataset.entity) &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      scroller.scrollTop += event.deltaY;
      scroller.scrollLeft += event.deltaX;
      return;
    }
    event.preventDefault();
    if ((doc.navigationMode ?? 'touchpad') === 'mouse' || event.ctrlKey || event.metaKey) {
      zoomFromWheel(event);
    } else {
      doc.camera.x -= event.deltaX;
      doc.camera.y -= event.deltaY;
      persist();
    }
  }

  onMount(() => {
    const observer = new ResizeObserver((entries) => {
      viewport.width = entries[0].contentRect.width;
      viewport.height = entries[0].contentRect.height;
    });
    observer.observe(element);
    element.addEventListener('wheel', wheel, { passive: false });
    return () => {
      observer.disconnect();
      element.removeEventListener('wheel', wheel);
    };
  });
</script>

<div
  class:hand={handActive}
  class:connecting={Boolean(connecting)}
  class="board"
  bind:this={element}
  role="region"
  aria-label="Whiteboard"
  onpointerdown={boardPointerDown}
  oncontextmenu={(event) => {
    if (selection.ids.length > 1) {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      selection.menu = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      selection.groupMenu = null;
      selection.edgeMenu = null;
    }
  }}
  onpointermove={(event) => {
    if (tool === 'connect') {
      if (connecting) updateConnectionPreview(event);
      updateConnectHover(event);
    }
  }}
  onpointerleave={() => {
    hoverConnectId = null;
  }}
  ondragover={(event) => {
    event.preventDefault();
    if (!entityDrag.active) return;
    // The preview is board-local so it lines up with where the card lands.
    const rect = element.getBoundingClientRect();
    moveEntityDrag(event.clientX - rect.left, event.clientY - rect.top, true);
  }}
  ondragleave={(event) => {
    const to = event.relatedTarget as Node | null;
    if (to && element.contains(to)) return;
    moveEntityDrag(0, 0, false);
  }}
  ondrop={(event) => {
    ondrop(event);
    endEntityDrag();
  }}
  ondblclick={(event) => {
    if (!selectActive) return;
    if (
      !(event.target as HTMLElement).closest(
        '.board-card,.toolbar,.zoom-controls,.navigation-controls,.group-box',
      )
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (createMode === 'card') onaddcard(point(event));
      else onaddfreetext(point(event));
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
          class={`group-box ${group.color} ${selection.group === group.id ? 'selected' : ''}`}
          role="group"
          aria-label={group.label}
          style={`transform:translate(${bounds.x}px,${bounds.y}px);width:${bounds.width}px;height:${bounds.height}px;--label-scale:${Math.max(1, 1 / doc.camera.zoom)}`}
          oncontextmenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            selectGroup(group.id);
            const rect = element.getBoundingClientRect();
            selection.groupMenu = {
              id: group.id,
              x: event.clientX - rect.left,
              y: event.clientY - rect.top,
            };
            selection.menu = null;
            selection.edgeMenu = null;
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
    <EdgesLayer
      bind:this={edgesLayer}
      {connecting}
      {snapTarget}
      {cursorWorld}
      {bezier}
      onedgecontextmenu={edgeContext}
    />
    {#each visible as placement (placement.id)}
      {@const entity = doc.entities[placement.entityId]}
      {#if entity}<BoardCard
          {placement}
          {entity}
          {focused}
          {editingBoard}
          {tool}
          {connecting}
          {snapTarget}
          portsVisible={isPortsVisible(entity.id)}
          {dragging}
          {onfocus}
          {onediting}
          {onopen}
          {onsource}
          {onduplicate}
          {oncolor}
          {onreorder}
          {onremove}
          {onedit}
          {oneditcommit}
          {onbeginfreetextedit}
          {oneditfreetext}
          {onfinishfreetextedit}
          onpan={pan}
          onfinishconnection={finishConnection}
          onconnectiondrag={connectionDrag}
          onsetconnection={setConnection}
          onsetdragging={(value) => (dragging = value)}
          onrefresh={refreshCard}
          onselectionmenu={(event) => {
            const rect = element.getBoundingClientRect();
            selection.menu = { x: event.clientX - rect.left, y: event.clientY - rect.top };
          }}
        />{/if}
    {/each}
  </div>
  {#if entityDrag.active && entityDrag.over}{@const preview = doc.entities[entityDrag.entityId]}
    {#if preview}<div
        class="drop-preview"
        style:left={`${entityDrag.x}px`}
        style:top={`${entityDrag.y}px`}
        style:--drop-tint={highlightSwatch(preview.anchor?.highlight ?? preview.color)}
        aria-hidden="true"
      >
        {#if preview.anchor}<span class="drop-preview-source"
            >p. {preview.anchor.page} · {doc.entities[preview.anchor.pdfId]?.title ??
              'Source unavailable'}</span
          ><blockquote>{preview.anchor.quote}</blockquote>
        {:else}<strong>{preview.title}</strong>{/if}
      </div>{/if}
  {/if}
  {#if marquee}<div
      class="selection-marquee"
      style={`left:${marquee.left}px;top:${marquee.top}px;width:${marquee.width}px;height:${marquee.height}px`}
      aria-hidden="true"
    ></div>{/if}
  {#if selection.menu}<div
      class="floating-menu"
      role="menu"
      tabindex="-1"
      style={`left:${selection.menu.x}px;top:${selection.menu.y}px`}
      onpointerdown={(event) => event.stopPropagation()}
    >
      <button role="menuitem" onclick={createGroup}
        >Create group from {selection.ids.length} items</button
      >
    </div>{/if}
  {#if selection.groupMenu}{@const activeGroup = (doc.groups ?? []).find(
      (group) => group.id === selection.groupMenu?.id,
    )}
    {#if activeGroup}<div
        class="floating-menu group-menu"
        role="menu"
        tabindex="-1"
        style={`left:${selection.groupMenu.x}px;top:${selection.groupMenu.y}px`}
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
  {#if selection.edgeMenu}{@const edge = doc.edges.find(
      (edge) => edge.id === selection.edgeMenu?.id,
    )}
    {#if edge}<div
        class="floating-menu"
        role="menu"
        tabindex="-1"
        style={`left:${selection.edgeMenu.x}px;top:${selection.edgeMenu.y}px`}
        onpointerdown={(event) => event.stopPropagation()}
      >
        <button class="danger" role="menuitem" onclick={() => deleteEdge(edge.id)}
          >Delete connection</button
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
      class:active={selectActive}
      class="icon-button"
      title="Select · V"
      aria-label="Select tool"
      onclick={() => {
        tool = 'select';
        curveSettingsOpen = false;
        connecting = null;
        snapTarget = null;
        hoverConnectId = null;
        suppressPortsId = null;
      }}><MousePointer2 size={19} /></button
    ><button
      class:active={handActive}
      class="icon-button"
      title="Pan · H or hold Space"
      aria-label="Pan tool"
      onclick={() => {
        tool = 'hand';
        curveSettingsOpen = false;
        connecting = null;
        snapTarget = null;
        hoverConnectId = null;
        suppressPortsId = null;
      }}><Hand size={19} /></button
    ><span class="tool-divider"></span><button
      class:active={selectActive && createMode === 'card'}
      class="icon-button"
      title="New card · N"
      aria-label="New card"
      aria-pressed={selectActive && createMode === 'card'}
      onclick={() => {
        tool = 'select';
        createMode = 'card';
        curveSettingsOpen = false;
        connecting = null;
        snapTarget = null;
        hoverConnectId = null;
        suppressPortsId = null;
      }}><Plus size={20} /></button
    ><button
      class:active={selectActive && createMode === 'text'}
      class="icon-button"
      title="Free text · T"
      aria-label="Add free text"
      aria-pressed={selectActive && createMode === 'text'}
      onclick={() => {
        tool = 'select';
        createMode = 'text';
        curveSettingsOpen = false;
        connecting = null;
        snapTarget = null;
        hoverConnectId = null;
        suppressPortsId = null;
      }}><Type size={19} /></button
    ><span class="tool-divider"></span><button
      class:active={connectActive}
      class="icon-button"
      title="Connect items · C"
      aria-label="Connect items"
      aria-pressed={connectActive}
      onclick={() => {
        tool = tool === 'connect' ? 'select' : 'connect';
        curveSettingsOpen = tool === 'connect';
        connecting = null;
        snapTarget = null;
        hoverConnectId = null;
        suppressPortsId = null;
      }}><Link2 size={19} /></button
    ><button
      class="icon-button"
      title="Import PDF, image, or markdown"
      aria-label="Import files"
      onclick={onimport}><Upload size={19} /></button
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
        <strong>Bezier curve</strong><button onclick={() => (bezier = { ...defaultBezierConfig })}
          >Reset</button
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
</div>
