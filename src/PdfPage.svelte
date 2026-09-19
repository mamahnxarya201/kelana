<script lang="ts">
  import { onMount } from 'svelte';
  import { TextLayer, type PDFDocumentProxy } from 'pdfjs-dist';
  import type { Anchor, Entity } from './lib/model';
  import { highlightTint } from './lib/highlight';
  import { beginEntityDrag, endEntityDrag } from './lib/drag.svelte';
  let {
    pdf,
    number,
    width,
    visualWidth = width,
    pdfId,
    annotations,
    onselect,
    dragHighlights = false,
  }: {
    pdf: PDFDocumentProxy;
    number: number;
    width: number;
    visualWidth?: number;
    pdfId: string;
    annotations: Entity[];
    /** Right-click on a live selection: the reader offers highlight colors. */
    onselect: (anchor: Anchor, event: MouseEvent) => void;
    /** Panel only: a highlight itself is the drag source for the board. */
    dragHighlights?: boolean;
  } = $props();
  let host: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let text: HTMLDivElement;
  let visible = $state(false);
  let ratio = $state(1.414);
  let error = $state('');
  onMount(() => {
    const root = host.closest<HTMLElement>('.pdf-card-scroll');
    const observer = new IntersectionObserver((entries) => (visible = entries[0].isIntersecting), {
      // Board pdf cards scroll inside their own container; the panel keeps
      // the default viewport root.
      root: root ?? undefined,
      rootMargin: '700px',
    });
    observer.observe(host);
    return () => observer.disconnect();
  });
  $effect(() => {
    const w = width;
    if (!visible) return;
    let cancelled = false;
    let task: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined;
    let layer: TextLayer | undefined;
    (async () => {
      const page = await pdf.getPage(number);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      ratio = base.height / base.width;
      const viewport = page.getViewport({ scale: w / base.width });
      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(viewport.width * dpr);
      canvas.height = Math.round(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      task = page.render({
        canvas,
        canvasContext: canvas.getContext('2d')!,
        viewport,
        transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
      });
      await task.promise;
      if (cancelled) return;
      text.replaceChildren();
      text.style.setProperty('--scale-factor', String(viewport.scale));
      text.style.setProperty('--total-scale-factor', String(viewport.scale));
      layer = new TextLayer({
        textContentSource: await page.getTextContent(),
        container: text,
        viewport,
      });
      await layer.render();
    })().catch((e) => {
      if (!cancelled && e.name !== 'RenderingCancelledException') error = e.message;
    });
    return () => {
      cancelled = true;
      task?.cancel();
      layer?.cancel();
      text?.replaceChildren();
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    };
  });
  function anchorFromSelection(): Anchor | null {
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    if (!text.contains(range.startContainer) || !text.contains(range.endContainer)) return null;
    const quote = selection.toString().trim();
    if (!quote) return null;
    const box = host.getBoundingClientRect();
    const before = range.cloneRange();
    before.selectNodeContents(text);
    before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length;
    return {
      pdfId,
      page: number,
      quote,
      start,
      end: start + selection.toString().length,
      createdAt: Date.now(),
      rects: [...range.getClientRects()]
        .filter((r) => r.width && r.height)
        .map((r) => ({
          x: (r.left - box.left) / box.width,
          y: (r.top - box.top) / box.height,
          width: r.width / box.width,
          height: r.height / box.height,
        })),
    };
  }
  // Selection never opens anything by itself; the reader only reacts to an
  // explicit right-click, and only while a passage is selected.
  function contextmenu(event: MouseEvent) {
    const anchor = anchorFromSelection();
    if (!anchor) return;
    event.preventDefault();
    event.stopPropagation();
    onselect(anchor, event);
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions (native PDF text selection; this surface is a document, not a button) -->
<div
  class="pdf-page"
  bind:this={host}
  style:width={`${visualWidth}px`}
  style:height={`${visualWidth * ratio}px`}
  data-page={number}
  oncontextmenu={contextmenu}
  role="document"
  aria-label={`Page ${number}`}
>
  <div
    class="pdf-raster"
    style:width={`${width}px`}
    style:height={`${width * ratio}px`}
    style:transform={`scale(${visualWidth / width})`}
  >
    <canvas bind:this={canvas}></canvas>
    <div class="textLayer" bind:this={text}></div>
    <!-- Decorative layer: the page text lives in the text layer above, and the
         passages are listed accessibly in the reader's tray. -->
    <div class="highlights">
      {#each annotations.filter((a) => a.anchor?.page === number) as a}{#each a.anchor?.rects ?? [] as r}<span
            class={a.color}
            style:left={`${r.x * 100}%`}
            style:top={`${r.y * 100}%`}
            style:width={`${r.width * 100}%`}
            style:height={`${r.height * 100}%`}
            style:background={highlightTint(a.anchor?.highlight ?? a.color)}
            aria-hidden="true"
            draggable={dragHighlights}
            title={dragHighlights ? 'Drag this highlight onto the board' : undefined}
            ondragstart={(event) => {
              if (!dragHighlights) return;
              beginEntityDrag(a.id);
              event.dataTransfer!.setData('application/kelana-entity', a.id);
              event.dataTransfer!.effectAllowed = 'copy';
            }}
            ondragend={dragHighlights ? endEntityDrag : undefined}
          ></span>{/each}{/each}
    </div>
    {#if error}<p class="error">{error}</p>{/if}
  </div>
</div>
