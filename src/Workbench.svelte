<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { crossfade, slide } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { cubicOut } from 'svelte/easing';
  import { ContextMenu } from 'bits-ui';
  import {
    FileText,
    Image,
    Highlighter,
    PanelRightOpen,
    PanelLeftOpen,
    ChevronRight,
    X,
    ArrowUpRight,
  } from 'lucide-svelte';
  import type { Doc, Entity, Pane, Anchor } from './lib/model';
  import Editor from './Editor.svelte';
  import PdfReader from './PdfReader.svelte';
  import AssetImage from './AssetImage.svelte';
  let {
    doc,
    width,
    focused,
    onfocus,
    onmove,
    onclose,
    onview,
    onedit,
    oncommit,
    onsource,
    onannotate,
    onplace,
    onresize,
    onwidth,
    onratio,
    oncolumnscroll,
    onresizing,
  }: {
    doc: Doc;
    width: number;
    focused: string;
    onfocus: (id: string) => void;
    onmove: (id: string) => void;
    onclose: (id: string) => void;
    onview: (id: string, view: Partial<Pane>) => void;
    onedit: (id: string, body: string) => void;
    oncommit: (id: string, before: string) => void;
    onsource: (e: Entity) => void;
    onannotate: (anchor: Anchor) => string;
    onplace: (id: string) => void;
    onresize: (e: PointerEvent) => void;
    onwidth: (width: number) => void;
    onratio: (ratio: number) => void;
    oncolumnscroll: (column: 'primary' | 'secondary', scroll: number) => void;
    onresizing: (value: boolean) => void;
  } = $props();
  const two = $derived(doc.panes.some((p) => p.column === 'secondary'));
  const columns = $derived(two ? (['primary', 'secondary'] as const) : (['primary'] as const));
  const annotations = $derived(Object.values(doc.entities).filter((e) => e.type === 'annotation'));
  let container: HTMLDivElement;
  let reduced = $state(false);
  onMount(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    reduced = media.matches;
    const change = () => (reduced = media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  });
  const [send, receive] = crossfade({
    duration: () => (reduced ? 0 : 180),
    easing: cubicOut,
    fallback: () => ({
      duration: reduced ? 0 : 140,
      css: (t) => `opacity:${t};transform:translateY(${(1 - t) * 5}px)`,
    }),
  });
  function columnState(node: HTMLElement, column: 'primary' | 'secondary') {
    tick().then(() => {
      node.scrollTop = doc.columnScroll?.[column] ?? 0;
    });
    let frame = 0;
    const scroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => oncolumnscroll(column, node.scrollTop));
    };
    node.addEventListener('scroll', scroll);
    return {
      destroy() {
        cancelAnimationFrame(frame);
        node.removeEventListener('scroll', scroll);
      },
    };
  }
  function split(event: PointerEvent) {
    event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    onresizing(true);
    const move = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      onratio(Math.max(0.25, Math.min(0.75, (e.clientX - rect.left) / rect.width)));
    };
    const end = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
      onresizing(false);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  }
</script>

<aside
  class="workbench"
  class:two
  class:closed={!doc.panes.length}
  inert={!doc.panes.length}
  aria-hidden={!doc.panes.length}
  style:width={`${width}px`}
  aria-label="Workbench"
>
  <div
    class="resize-handle"
    role="slider"
    aria-label="Workbench width"
    aria-orientation="horizontal"
    aria-valuemin={360}
    aria-valuemax={2000}
    aria-valuenow={width}
    tabindex="0"
    onpointerdown={onresize}
    onkeydown={(e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        onwidth(width + (e.key === 'ArrowLeft' ? 20 : -20));
      }
    }}
  ></div>
  <div
    class="bench-columns"
    bind:this={container}
    style:grid-template-columns={two
      ? `minmax(0,${doc.splitRatio ?? 0.5}fr) 1px minmax(0,${1 - (doc.splitRatio ?? 0.5)}fr)`
      : 'minmax(0,1fr)'}
  >
    {#each columns as column}
      {#if column === 'secondary'}<div
          class="column-divider"
          role="slider"
          aria-label="Column width split"
          aria-orientation="horizontal"
          aria-valuemin={25}
          aria-valuemax={75}
          aria-valuenow={Math.round((doc.splitRatio ?? 0.5) * 100)}
          tabindex="0"
          onpointerdown={split}
          onkeydown={(e) => {
            if (['ArrowLeft', 'ArrowRight', 'Home'].includes(e.key)) {
              e.preventDefault();
              onratio(
                e.key === 'Home'
                  ? 0.5
                  : Math.max(
                      0.25,
                      Math.min(
                        0.75,
                        (doc.splitRatio ?? 0.5) + (e.key === 'ArrowRight' ? 0.025 : -0.025),
                      ),
                    ),
              );
            }
          }}
        ></div>{/if}
      <div class="bench-column" use:columnState={column} data-column={column}>
        {#each doc.panes.filter((p) => p.column === column) as pane (pane.entityId)}
          {@const e = doc.entities[pane.entityId]}
          <article
            class="bench-item"
            class:focused={focused === pane.entityId}
            id={'pane-' + pane.entityId}
            data-entity={pane.entityId}
            in:receive={{ key: pane.entityId }}
            out:send={{ key: pane.entityId }}
            animate:flip={{ duration: reduced ? 0 : 180, easing: cubicOut }}
            onfocusin={() => onfocus(pane.entityId)}
            onpointerdown={() => onfocus(pane.entityId)}
          >
            <ContextMenu.Root
              ><ContextMenu.Trigger tabindex={0} class="item-header">
                <button
                  class="fold-button"
                  class:folded={pane.folded}
                  aria-label={pane.folded ? 'Expand item' : 'Fold item'}
                  aria-expanded={!pane.folded}
                  onclick={() => onview(e.id, { folded: !pane.folded })}
                  ><ChevronRight size={15} /></button
                >
                <span class="item-title"
                  >{#if e.type === 'pdf'}<FileText size={14} />{:else if e.type === 'image'}<Image
                      size={14}
                    />{:else if e.type === 'annotation'}<Highlighter size={14} />{:else}<span
                      class="text-icon">T</span
                    >{/if}<span title={e.title}>{e.title}</span></span
                >
                <div class="item-actions">
                  {#if e.type === 'pdf'}<select
                      aria-label="PDF zoom"
                      value={pane.zoom}
                      onchange={(event) =>
                        onview(e.id, { zoom: Number(event.currentTarget.value) })}
                      ><option value="0.75">75%</option><option value="1">Fit width</option><option
                        value="1.25">125%</option
                      ><option value="1.5">150%</option></select
                    >{/if}
                  <button
                    class="icon-button"
                    disabled={doc.panes.length < 2}
                    title={doc.panes.length < 2
                      ? 'Open another item to work beside it'
                      : column === 'primary'
                        ? 'Move beside'
                        : 'Move to primary'}
                    aria-label={column === 'primary' ? 'Move beside' : 'Move to primary'}
                    onclick={() => onmove(e.id)}
                    >{#if column === 'primary'}<PanelRightOpen size={16} />{:else}<PanelLeftOpen
                        size={16}
                      />{/if}</button
                  ><button
                    class="icon-button"
                    title="Remove from workbench"
                    aria-label={`Remove ${e.title} from workbench`}
                    onclick={() => onclose(e.id)}><X size={16} /></button
                  >
                </div>
              </ContextMenu.Trigger><ContextMenu.Portal
                ><ContextMenu.Content class="context-menu"
                  ><ContextMenu.Item disabled={doc.panes.length < 2} onclick={() => onmove(e.id)}
                    >{column === 'primary' ? 'Move beside' : 'Move to primary'}</ContextMenu.Item
                  ><ContextMenu.Item onclick={() => onview(e.id, { folded: !pane.folded })}
                    >{pane.folded ? 'Expand item' : 'Fold item'}</ContextMenu.Item
                  ><ContextMenu.Item onclick={() => onclose(e.id)}
                    >Remove from workbench</ContextMenu.Item
                  ></ContextMenu.Content
                ></ContextMenu.Portal
              ></ContextMenu.Root
            >
            {#if !pane.folded}<div
                class="item-body"
                transition:slide={{ duration: reduced ? 0 : 160, easing: cubicOut }}
              >
                {#if e.type === 'pdf'}<PdfReader
                    entity={e}
                    {pane}
                    active={focused === e.id}
                    annotations={annotations.filter((a) => a.anchor?.pdfId === e.id)}
                    onview={(v) => onview(e.id, v)}
                    {onannotate}
                    {onplace}
                  />{:else if e.type === 'image'}<div class="bench-image">
                    <AssetImage id={e.assetId!} alt={e.title} />
                  </div>{:else}<div class="bench-writing">
                    {#if e.anchor}<blockquote>{e.anchor.quote}</blockquote>
                      <button class="source-link" onclick={() => onsource(e)}
                        >p. {e.anchor.page} · Open source <ArrowUpRight size={13} /></button
                      >{/if}<Editor
                      body={e.body}
                      oninput={(body) => onedit(e.id, body)}
                      oncommit={(before) => oncommit(e.id, before)}
                      caret={pane.caret}
                      oncaret={(caret) => onview(e.id, { caret })}
                    />
                  </div>{/if}
              </div>{/if}
          </article>
        {/each}
      </div>
    {/each}
  </div>
</aside>
