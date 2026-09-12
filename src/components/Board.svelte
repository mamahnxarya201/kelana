<script lang="ts">
  import { onMount, tick, type Snippet } from 'svelte';
  import EdgesLayer from './EdgesLayer.svelte';
  import { commit, doc, persist } from '../lib/doc.svelte';
  import { clearSelection, selectGroup, selection } from '../lib/selection.svelte';
  import { point, viewport } from '../lib/viewport.svelte';
  import type { BezierConfig } from '../lib/connections';
  import { uid, type ConnectionSide, type Group, type Placement, type Point } from '../lib/model';

  let {
    tool,
    connecting,
    snapTarget,
    cursorWorld,
    bezier,
    cards,
    overlays,
    onclearinteraction,
    onfocusclear,
    onupdateconnectionpreview,
    ondrop,
    onaddcard,
    onnotify,
  }: {
    tool: 'select' | 'hand' | 'connect';
    connecting: { entityId: string; side: ConnectionSide } | null;
    snapTarget: { entityId: string; side: ConnectionSide } | null;
    cursorWorld: Point;
    bezier: BezierConfig;
    cards: Snippet;
    overlays: Snippet;
    onclearinteraction: () => void;
    onfocusclear: () => void;
    onupdateconnectionpreview: (event: PointerEvent) => void;
    ondrop: (event: DragEvent) => void;
    onaddcard: (point: Point) => void;
    onnotify: (message: string) => void;
  } = $props();

  let element: HTMLDivElement;
  let edgesLayer: EdgesLayer;
  let marquee = $state<{ left: number; top: number; width: number; height: number } | null>(null);
  let groupEditing = $state('');
  let groupEditBefore = '';
  const colors = ['white', 'yellow', 'blue', 'green', 'pink', 'purple'];

  export function getElement() {
    return element;
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
    const members = doc.placements.filter((placement) => selection.ids.includes(placement.entityId));
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
      onfocusclear();
    };
    const finish = () => {
      element.removeEventListener('pointermove', movement);
      element.removeEventListener('pointerup', finish);
      element.removeEventListener('pointercancel', finish);
      marquee = null;
      if (!moved) {
        selection.selected = '';
        selection.ids = [];
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
    element.setPointerCapture(event.pointerId);
    const movement = (moveEvent: PointerEvent) => {
      doc.camera.x = camera.x + moveEvent.clientX - start.x;
      doc.camera.y = camera.y + moveEvent.clientY - start.y;
    };
    const finish = () => {
      element.removeEventListener('pointermove', movement);
      element.removeEventListener('pointerup', finish);
      element.removeEventListener('pointercancel', finish);
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
    if (connecting) return;
    if (viewport.space || tool === 'hand') {
      onclearinteraction();
      pan(event);
    } else marqueeSelect(event);
  }

  function wheel(event: WheelEvent) {
    const card = (event.target as HTMLElement).closest<HTMLElement>('.board-card');
    if (
      card?.dataset.entity &&
      selection.ids.includes(card.dataset.entity) &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      card.scrollTop += event.deltaY;
      card.scrollLeft += event.deltaX;
      return;
    }
    event.preventDefault();
    const rect = element.getBoundingClientRect();
    if ((doc.navigationMode ?? 'touchpad') === 'mouse' || event.ctrlKey || event.metaKey) {
      const value = Math.max(0.15, Math.min(2.5, doc.camera.zoom * Math.exp(-event.deltaY * 0.002)));
      const old = doc.camera.zoom;
      const cx = event.clientX - rect.left;
      const cy = event.clientY - rect.top;
      doc.camera = {
        x: cx - ((cx - doc.camera.x) * value) / old,
        y: cy - ((cy - doc.camera.y) * value) / old,
        zoom: value,
      };
      persist();
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
  class:hand={tool === 'hand' || viewport.space}
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
    }
  }}
  onpointermove={(event) => {
    if (connecting) onupdateconnectionpreview(event);
  }}
  ondragover={(event) => event.preventDefault()}
  {ondrop}
  ondblclick={(event) => {
    if (
      !(event.target as HTMLElement).closest(
        '.board-card,.toolbar,.zoom-controls,.navigation-controls,.group-box',
      )
    ) {
      event.preventDefault();
      event.stopPropagation();
      onaddcard(point(event));
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
    <EdgesLayer bind:this={edgesLayer} {connecting} {snapTarget} {cursorWorld} {bezier} />
    {@render cards()}
  </div>
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
  {@render overlays()}
</div>
