<script lang="ts">
  import { ContextMenu } from 'bits-ui';
  import { ArrowUpRight, FileText, PanelRightOpen } from 'lucide-svelte';
  import Editor from '../Editor.svelte';
  import AssetImage from '../AssetImage.svelte';
  import FreeText from './FreeText.svelte';
  import { commit, doc } from '../lib/doc.svelte';
  import {
    FREE_TEXT_MIN_HEIGHT,
    FREE_TEXT_MIN_WIDTH,
    measureHeightAt,
    measureNaturalHeight,
    measureWidthForHeight,
  } from '../lib/free-text';
  import { connectionPoint, nearestConnectionSide } from '../lib/connections';
  import { selectOnly, selection } from '../lib/selection.svelte';
  import { point, viewport } from '../lib/viewport.svelte';
  import type { ConnectionSide, Entity, Placement } from '../lib/model';

  type Direction = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
  type Connection = { entityId: string; side: ConnectionSide } | null;

  let {
    placement,
    entity,
    focused,
    editingBoard,
    tool,
    connecting,
    snapTarget,
    dragging,
    onfocus,
    onediting,
    onopen,
    onsource,
    onduplicate,
    oncolor,
    onreorder,
    onremove,
    onedit,
    oneditcommit,
    onbeginfreetextedit,
    oneditfreetext,
    onfinishfreetextedit,
    onpan,
    onfinishconnection,
    onconnectiondrag,
    onsetconnection,
    onsetdragging,
    onrefresh,
    onselectionmenu,
  }: {
    placement: Placement;
    entity: Entity;
    focused: string;
    editingBoard: string;
    tool: 'select' | 'hand' | 'connect';
    connecting: Connection;
    snapTarget: Connection;
    dragging: boolean;
    onfocus: (id: string) => void;
    onediting: (id: string) => void;
    onopen: (id: string) => void;
    onsource: (entity: Entity) => void;
    onduplicate: (id: string) => void;
    oncolor: (id: string, color: string) => void;
    onreorder: (id: string, front: boolean) => void;
    onremove: (id: string) => void;
    onedit: (id: string, body: string) => void;
    oneditcommit: (id: string, before: string) => void;
    onbeginfreetextedit: (id: string) => void;
    oneditfreetext: (id: string, body: string) => void;
    onfinishfreetextedit: (id: string) => void;
    onpan: (event: PointerEvent) => void;
    onfinishconnection: (id: string, side: ConnectionSide) => void;
    onconnectiondrag: (event: PointerEvent, placement: Placement, side: ConnectionSide) => void;
    onsetconnection: (id: string, side: ConnectionSide) => void;
    onsetdragging: (value: boolean) => void;
    onrefresh: (id: string, placement: Placement) => void;
    onselectionmenu: (event: MouseEvent) => void;
  } = $props();

  let card = $state<HTMLElement>(null!);

  function resizeCard(event: PointerEvent, direction: Direction) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget as HTMLElement;
    const isFreeText = entity.type === 'text';
    const freeTextLock: 'width' | 'height' =
      direction.includes('e') || direction.includes('w') ? 'width' : 'height';
    const freeHost = isFreeText ? card.querySelector<HTMLElement>('.live-editor') : null;
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
        if (direction.includes('s')) next.height = Math.max(80, before.height + dy);
        if (direction.includes('w')) {
          next.width = Math.max(minimumWidth, before.width - dx);
          next.x = before.x + before.width - next.width;
        }
        if (direction.includes('n')) {
          next.height = Math.max(80, before.height - dy);
          next.y = before.y + before.height - next.height;
        }
      }
      card.style.transform = `translate(${next.x}px,${next.y}px)`;
      card.style.width = `${next.width}px`;
      card.style.height = `${next.height}px`;
      onrefresh(entity.id, next);
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

  function dragCard(event: PointerEvent) {
    if (
      (event.target as HTMLElement).closest('button,a,textarea') ||
      editingBoard === entity.id ||
      event.button !== 0
    )
      return;
    if (event.detail > 1 && entity.type !== 'text') return;
    event.stopPropagation();
    if (connecting) {
      event.preventDefault();
      onfinishconnection(entity.id, nearestConnectionSide(placement, point(event)));
      return;
    }
    if (viewport.space || tool === 'hand') {
      onpan(event);
      return;
    }
    selectOnly(entity.id);
    onfocus('');
    const start = { x: event.clientX, y: event.clientY };
    const before = $state.snapshot(placement);
    let x = placement.x;
    let y = placement.y;
    let raf = 0;
    onsetdragging(true);
    const movement = (moveEvent: PointerEvent) => {
      if (Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) < 3) return;
      if (!card.hasPointerCapture(event.pointerId)) card.setPointerCapture(event.pointerId);
      x = before.x + (moveEvent.clientX - start.x) / doc.camera.zoom;
      y = before.y + (moveEvent.clientY - start.y) / doc.camera.zoom;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        card.style.transform = `translate(${x}px,${y}px)`;
        onrefresh(entity.id, { ...before, x, y });
      });
    };
    const finish = () => {
      cancelAnimationFrame(raf);
      card.removeEventListener('pointermove', movement);
      card.removeEventListener('pointerup', finish);
      card.removeEventListener('pointercancel', cancel);
      onsetdragging(false);
      onrefresh(entity.id, { ...before, x, y });
      if (x !== before.x || y !== before.y)
        commit([
          { collection: 'placements', id: placement.id, before, after: { ...before, x, y } },
        ]);
    };
    const cancel = () => {
      x = before.x;
      y = before.y;
      card.style.transform = `translate(${x}px,${y}px)`;
      finish();
    };
    card.addEventListener('pointermove', movement);
    card.addEventListener('pointerup', finish);
    card.addEventListener('pointercancel', cancel);
  }
</script>

<ContextMenu.Root>
  <ContextMenu.Trigger
    bind:ref={card}
    tabindex={0}
    class={`board-card ${entity.type === 'text' ? 'free-text' : ''} ${entity.color} ${selection.ids.includes(entity.id) || focused === entity.id ? 'selected' : ''} ${editingBoard === entity.id ? 'editing' : ''} ${connecting && connecting.entityId !== entity.id ? 'connection-target' : ''} ${connecting?.entityId === entity.id ? 'connection-source' : ''} ${dragging && selection.ids.includes(entity.id) ? 'dragging' : ''}`}
    data-entity={entity.id}
    style={`transform:translate(${placement.x}px,${placement.y}px);width:${placement.width}px;height:${placement.height}px;z-index:${placement.z}`}
    onpointerdown={dragCard}
    onclick={(event) => {
      if (entity.type !== 'text' || editingBoard === entity.id) return;
      const anchor = (event.target as HTMLElement).closest('a');
      if (!anchor?.href) return;
      event.preventDefault();
      event.stopPropagation();
      window.open(anchor.href, '_blank', 'noopener');
    }}
    ondblclick={(event) => {
      if (entity.type !== 'text') return;
      event.preventDefault();
      event.stopPropagation();
      onbeginfreetextedit(entity.id);
    }}
    oncontextmenu={(event) => {
      if (selection.ids.length > 1 && selection.ids.includes(entity.id)) {
        event.preventDefault();
        event.stopPropagation();
        onselectionmenu(event);
      }
    }}
    onkeydown={(event) => {
      if ((event.target as HTMLElement).closest('.live-editor,.editable')) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        if (entity.type === 'text') onbeginfreetextedit(entity.id);
        else onopen(entity.id);
      }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        const distance = event.shiftKey ? 20 : 5;
        commit([
          {
            collection: 'placements',
            id: placement.id,
            before: $state.snapshot(placement),
            after: {
              ...$state.snapshot(placement),
              x:
                placement.x +
                (event.key === 'ArrowRight' ? distance : event.key === 'ArrowLeft' ? -distance : 0),
              y:
                placement.y +
                (event.key === 'ArrowDown' ? distance : event.key === 'ArrowUp' ? -distance : 0),
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
        onclick={(event) => {
          event.stopPropagation();
          onopen(entity.id);
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
        oninput={(body) => oneditfreetext(entity.id, body)}
        onfinish={() => onfinishfreetextedit(entity.id)}
        onfit={onrefresh}
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
        onclick={(event) => {
          event.stopPropagation();
          onsource(entity);
        }}
        >p. {entity.anchor?.page} · {doc.entities[entity.anchor?.pdfId ?? '']?.title ??
          'Source unavailable'}<ArrowUpRight size={12} /></button
      >{:else}<Editor
        body={entity.body}
        activation="double"
        active={editingBoard === entity.id}
        onactive={(value) => {
          onediting(value ? entity.id : '');
          if (value) {
            selectOnly(entity.id);
            onfocus('');
          }
        }}
        oninput={(body) => onedit(entity.id, body)}
        oncommit={(before) => oneditcommit(entity.id, before)}
      />{/if}
    {#if selection.ids.includes(entity.id) && editingBoard !== entity.id}
      {#each entity.type === 'text' ? ['n', 'e', 's', 'w'] : ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as direction}<button
          class={`card-resize-zone ${direction}`}
          tabindex="-1"
          aria-label={`Resize ${entity.title} ${direction}`}
          onpointerdown={(event) => resizeCard(event, direction as Direction)}
        ></button>{/each}
    {/if}
  </ContextMenu.Trigger>
  <ContextMenu.Portal
    ><ContextMenu.Content class="context-menu"
      >{#if entity.type !== 'text'}<ContextMenu.Item onclick={() => onopen(entity.id)}
          >Open in workbench <PanelRightOpen size={15} /></ContextMenu.Item
        >{/if}{#if entity.anchor}<ContextMenu.Item onclick={() => onsource(entity)}
          >Open source <ArrowUpRight size={15} /></ContextMenu.Item
        >{/if}<ContextMenu.Item onclick={() => onduplicate(entity.id)}>Duplicate</ContextMenu.Item
      ><ContextMenu.Item onclick={() => onsetconnection(entity.id, 'right')}
        >Connect from right…</ContextMenu.Item
      >{#if entity.type !== 'text'}<ContextMenu.Separator class="menu-separator" />
        <div class="color-row">
          {#each ['white', 'yellow', 'blue', 'green', 'pink', 'purple'] as color}<button
              class={`swatch ${color}`}
              aria-label={`Set ${color} card color`}
              title={color}
              onclick={() => oncolor(entity.id, color)}
            ></button>{/each}
        </div>{/if}
      <ContextMenu.Item onclick={() => onreorder(entity.id, true)}>Bring forward</ContextMenu.Item
      ><ContextMenu.Item onclick={() => onreorder(entity.id, false)}>Send backward</ContextMenu.Item
      ><ContextMenu.Separator class="menu-separator" /><ContextMenu.Item
        class="danger"
        onclick={() => onremove(entity.id)}>Delete from workspace</ContextMenu.Item
      ></ContextMenu.Content
    ></ContextMenu.Portal
  >
</ContextMenu.Root>
{#if tool === 'connect'}{#each ['top', 'right', 'bottom', 'left'] as side}{@const portPoint =
      connectionPoint(placement, side as ConnectionSide)}<button
      class="connection-port"
      class:active={connecting?.entityId === entity.id && connecting.side === side}
      class:snap-target={snapTarget?.entityId === entity.id && snapTarget.side === side}
      data-entity={entity.id}
      data-side={side}
      style={`left:${portPoint.x}px;top:${portPoint.y}px`}
      aria-label={`Connect from ${side} of ${entity.title}`}
      title={`Connect from ${side}`}
      onpointerdown={(event) => onconnectiondrag(event, placement, side as ConnectionSide)}
    ></button>{/each}{/if}
