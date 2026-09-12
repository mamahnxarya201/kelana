<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import EdgesLayer from './EdgesLayer.svelte';
  import { doc, persist } from '../lib/doc.svelte';
  import { clearSelection, selection } from '../lib/selection.svelte';
  import { point, viewport } from '../lib/viewport.svelte';
  import type { BezierConfig } from '../lib/connections';
  import type { ConnectionSide, Placement, Point } from '../lib/model';

  let {
    tool,
    connecting,
    snapTarget,
    cursorWorld,
    bezier,
    groups,
    cards,
    overlays,
    onclearinteraction,
    onfocusclear,
    onupdateconnectionpreview,
    ondrop,
    onaddcard,
  }: {
    tool: 'select' | 'hand' | 'connect';
    connecting: { entityId: string; side: ConnectionSide } | null;
    snapTarget: { entityId: string; side: ConnectionSide } | null;
    cursorWorld: Point;
    bezier: BezierConfig;
    groups: Snippet;
    cards: Snippet;
    overlays: Snippet;
    onclearinteraction: () => void;
    onfocusclear: () => void;
    onupdateconnectionpreview: (event: PointerEvent) => void;
    ondrop: (event: DragEvent) => void;
    onaddcard: (point: Point) => void;
  } = $props();

  let element: HTMLDivElement;
  let edgesLayer: EdgesLayer;
  let marquee = $state<{ left: number; top: number; width: number; height: number } | null>(null);

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

  function marqueeSelect(event: PointerEvent) {
    if (event.button !== 0 || tool !== 'select' || viewport.space) return;
    event.preventDefault();
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
    {@render groups()}
    <EdgesLayer bind:this={edgesLayer} {connecting} {snapTarget} {cursorWorld} {bezier} />
    {@render cards()}
  </div>
  {#if marquee}<div
      class="selection-marquee"
      style={`left:${marquee.left}px;top:${marquee.top}px;width:${marquee.width}px;height:${marquee.height}px`}
      aria-hidden="true"
    ></div>{/if}
  {@render overlays()}
</div>
