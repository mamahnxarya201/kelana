<!--
  SVG layer rendering board edges plus the live connection preview.
  Exposes refresh(id, override) so drag/resize handlers can update edge
  geometry without re-rendering the whole layer.
-->
<script lang="ts">
import { doc } from '../lib/doc.svelte';
import { selection, selectEdge } from '../lib/selection.svelte';
import { connectionPath, previewPath, type BezierConfig } from '../lib/connections';
import type { ConnectionSide, Placement, Point } from '../lib/model';

let {
  connecting = null,
  snapTarget = null,
  cursorWorld,
  bezier,
  onedgecontextmenu,
}: {
  connecting?: { entityId: string; side: ConnectionSide } | null;
  snapTarget?: { entityId: string; side: ConnectionSide } | null;
  cursorWorld: Point;
  bezier: BezierConfig;
  onedgecontextmenu: (id: string, event: MouseEvent) => void;
} = $props();

const edgeNodes = new Map<string, SVGPathElement>();
const placementsByEntity = $derived(new Map(doc.placements.map((p) => [p.entityId, p])));

function edgeNode(node: SVGPathElement, id: string) {
  edgeNodes.set(id, node);
  return {
    destroy() {
      edgeNodes.delete(id);
    },
  };
}

export function refresh(id: string, override: Placement) {
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

function edgePointerDown(event: PointerEvent, id: string) {
  event.stopPropagation();
  selectEdge(id);
}

function edgeContextMenu(event: MouseEvent, id: string) {
  event.preventDefault();
  event.stopPropagation();
  selectEdge(id);
  onedgecontextmenu(id, event);
}
</script>

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
        class:selected={selection.edge === edge.id}
        d={connectionPath(a, b, edge.fromSide, edge.toSide, bezier)}
        marker-end="url(#arrow)"
      /><path
        class="connection-hit"
        role="presentation"
        d={connectionPath(a, b, edge.fromSide, edge.toSide, bezier)}
        onpointerdown={(event) => edgePointerDown(event, edge.id)}
        oncontextmenu={(event) => edgeContextMenu(event, edge.id)}
      />{/if}
  {/each}
  {#if connecting && placementsByEntity.has(connecting.entityId)}{@const sourcePlacement =
      placementsByEntity.get(connecting.entityId)!}{@const targetPlacement = snapTarget
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
