<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { PDFDocumentProxy } from 'pdfjs-dist';
  import { acquirePdf, releasePdf } from './lib/pdf';
  import type { Entity, Pane, Anchor } from './lib/model';
  import PdfPage from './PdfPage.svelte';
  import { ArrowUpRight, Highlighter } from 'lucide-svelte';
  import { HIGHLIGHT_COLORS, highlightSwatch, type HighlightColor } from './lib/highlight';
  import { beginEntityDrag, endEntityDrag } from './lib/drag.svelte';
  let {
    entity,
    pane,
    annotations,
    active = false,
    onview,
    onannotate,
    onplace,
  }: {
    entity: Entity;
    pane: Pane;
    annotations: Entity[];
    active?: boolean;
    onview: (view: Partial<Pane>) => void;
    onannotate: (anchor: Anchor, color: HighlightColor) => string;
    onplace: (id: string) => void;
  } = $props();
  let pdf = $state<PDFDocumentProxy>();
  let error = $state('');
  let root: HTMLDivElement;
  let scrollHost: HTMLElement;
  let available = $state(440);
  // Right-click on a live selection opens the color palette here; nothing else
  // reacts to a selection, so reading stays calm. The highlight it creates is
  // then draggable straight onto the board from the page.
  let palette = $state<{ anchor: Anchor; x: number; y: number } | null>(null);
  let width = $state(440);
  let scrollFrame = 0;
  let ready = false;
  const visualWidth = $derived(available * pane.zoom);
  function offset(node: HTMLElement) {
    return (
      node.getBoundingClientRect().top -
      scrollHost.getBoundingClientRect().top +
      scrollHost.scrollTop
    );
  }
  function readingPosition() {
    if (!pdf || !ready) return;
    const bounds = root.getBoundingClientRect(),
      host = scrollHost.getBoundingClientRect();
    if (bounds.bottom < host.top + 44 || bounds.top > host.bottom) return;
    let low = 1,
      high = pdf.numPages;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2),
        page = root.querySelector<HTMLElement>('[data-page="' + mid + '"]');
      if (page && offset(page) <= scrollHost.scrollTop + 50) low = mid;
      else high = mid - 1;
    }
    const page = root.querySelector<HTMLElement>('[data-page="' + low + '"]');
    if (page)
      onview({
        readPage: low,
        readOffset:
          (scrollHost.scrollTop + 44 - offset(page)) / page.getBoundingClientRect().height,
      });
  }
  function restore() {
    if (!active || !pane.readPage || !scrollHost) return;
    const page = root.querySelector<HTMLElement>('[data-page="' + pane.readPage + '"]');
    if (page)
      scrollHost.scrollTop =
        offset(page) + (pane.readOffset ?? 0) * page.getBoundingClientRect().height - 44;
  }
  function jump(page: number) {
    const target = root.querySelector<HTMLElement>('[data-page="' + page + '"]');
    if (target) scrollHost.scrollTop = offset(target) - 44;
  }
  function openPalette(anchor: Anchor, event: MouseEvent) {
    const box = { width: 214, height: 64 };
    palette = {
      anchor,
      x: Math.max(10, Math.min(innerWidth - box.width - 10, event.clientX - box.width / 2)),
      y: Math.max(52, Math.min(innerHeight - box.height - 10, event.clientY + 14)),
    };
  }
  function applyHighlight(color: HighlightColor) {
    if (!palette) return;
    onannotate(palette.anchor, color);
    window.getSelection()?.removeAllRanges();
    palette = null;
  }
  onMount(() => {
    let alive = true;
    scrollHost = root.closest<HTMLElement>('.bench-column')!;
    const observer = new ResizeObserver(
      (entries) => (available = Math.max(180, entries[0].contentRect.width)),
    );
    observer.observe(root);
    const scroll = () => {
      cancelAnimationFrame(scrollFrame);
      scrollFrame = requestAnimationFrame(readingPosition);
      palette = null;
    };
    scrollHost.addEventListener('scroll', scroll, { passive: true });
    acquirePdf(entity.assetId!)
      .then(async (p) => {
        if (!alive) return;
        pdf = p;
        await tick();
        if (pane.jump && pane.page) {
          jump(pane.page);
          onview({ jump: undefined });
        } else restore();
        ready = true;
      })
      .catch((e) => (error = e.message));
    return () => {
      alive = false;
      observer.disconnect();
      scrollHost.removeEventListener('scroll', scroll);
      cancelAnimationFrame(scrollFrame);
      releasePdf(entity.assetId!);
    };
  });
  $effect(() => {
    const page = pane.page,
      jumpId = pane.jump;
    if (page && jumpId && pdf)
      tick().then(() => {
        jump(page);
        onview({ jump: undefined });
      });
  });
  $effect(() => {
    const target = visualWidth;
    ready = false;
    const timer = setTimeout(async () => {
      width = target;
      await tick();
      if (root) restore();
      ready = true;
    }, 120);
    return () => clearTimeout(timer);
  });
  // The palette belongs to the current selection: any press outside it, or
  // Escape, dismisses it without touching the page.
  $effect(() => {
    if (!palette) return;
    const dismiss = (event: Event) => {
      if (
        event instanceof PointerEvent &&
        (event.target as HTMLElement).closest?.('.highlight-palette')
      )
        return;
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      palette = null;
    };
    window.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('keydown', dismiss);
    return () => {
      window.removeEventListener('pointerdown', dismiss, true);
      window.removeEventListener('keydown', dismiss);
    };
  });
</script>

<div class="pdf-flow" bind:this={root}>
  {#if error}<p class="error">
      Could not open this PDF: {error}
    </p>{:else if pdf}{#each Array(pdf.numPages) as _, i}<PdfPage
        {pdf}
        number={i + 1}
        {width}
        {visualWidth}
        pdfId={entity.id}
        {annotations}
        onselect={openPalette}
        dragHighlights
      />
      <div class="page-number">{i + 1} / {pdf.numPages}</div>{/each}{:else}<p
      class="reader-loading"
    >
      Opening PDF…
    </p>{/if}
</div>
{#if palette}<div
    class="highlight-palette"
    style:left={`${palette.x}px`}
    style:top={`${palette.y}px`}
    role="menu"
    aria-label="Highlight color"
  >
    <span class="eyebrow"><Highlighter size={13} /> Highlight</span>
    <div class="palette-row">
      {#each HIGHLIGHT_COLORS as option}<button
          class="palette-swatch"
          style:background={option.swatch}
          title={option.label}
          aria-label={`Highlight ${option.label}`}
          onclick={() => applyHighlight(option.id)}
        ></button>{/each}
    </div>
  </div>{/if}
{#if annotations.length}<div class="annotation-tray">
    <span class="eyebrow">Passages · drag onto the board</span>{#each annotations as a}<div
        class="passage"
        draggable="true"
        ondragstart={(event) => {
          beginEntityDrag(a.id);
          event.dataTransfer!.setData('application/kelana-entity', a.id);
          event.dataTransfer!.effectAllowed = 'copy';
        }}
        ondragend={endEntityDrag}
        role="group"
        aria-label="Draggable highlight"
      >
        <p>
          <span
            class="passage-dot"
            style:background={highlightSwatch(a.anchor?.highlight ?? a.color)}
          ></span>{a.anchor?.quote}
        </p>
        <div class="passage-actions">
          <button title="Jump to passage" onclick={() => jump(a.anchor!.page)}
            >p. {a.anchor?.page}<ArrowUpRight size={13} /></button
          ><button onclick={() => onplace(a.id)}>Place on board <ArrowUpRight size={13} /></button>
        </div>
      </div>{/each}
  </div>{/if}
