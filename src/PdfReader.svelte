<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { PDFDocumentProxy } from 'pdfjs-dist';
  import { acquirePdf, releasePdf } from './lib/pdf';
  import type { Entity, Pane, Anchor } from './lib/model';
  import PdfPage from './PdfPage.svelte';
  import { ArrowUpRight, ChevronLeft, ChevronRight, Highlighter } from 'lucide-svelte';
  import { HIGHLIGHT_COLORS, highlightSwatch, type HighlightColor } from './lib/highlight';
  import { beginEntityDrag, endEntityDrag } from './lib/drag.svelte';
  import { doc } from './lib/doc.svelte';
  import { viewport } from './lib/viewport.svelte';
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
  let flow = $state<HTMLDivElement>();
  let stage = $state<HTMLDivElement>();
  let scrollHost: HTMLElement;
  let available = $state(440);
  let stagePixels = $state(560);
  let pageRatio = $state(1.414);
  // Right-click on a live selection opens the color palette here; nothing else
  // reacts to a selection, so reading stays calm. The highlight it creates is
  // then draggable straight onto the board from the page.
  let palette = $state<{ anchor: Anchor; x: number; y: number } | null>(null);
  let scrollFrame = 0;
  let anchorFrame = 0;
  let pendingAnchor: { page: number; fx: number; fy: number; x: number; y: number } | null = null;
  let ready = false;
  let panning = $state(false);
  /** When the current zoom gesture stops owning the layout. */
  let zoomSettled = 0;
  let lastMode: 'all' | 'page' | '' = '';

  /*
   * Reading camera.
   *
   * "All pages" keeps the document's own scroll — the column owns vertical
   * reading — so a zoom only resizes the pages and a pan slides them sideways.
   * "Per page" is a fixed viewport holding one page fitted to the column
   * height, so a pan moves in both axes. Gestures match the whiteboard: pinch
   * (or wheel in mouse mode) zooms about the pointer, two fingers pan,
   * middle-drag or Space+drag pans with the mouse. A zoom resizes the page
   * immediately (the mounted raster is scaled) and the sharper raster is
   * rendered once the gesture settles.
   */
  const MIN_ZOOM = 0.5;
  const MAX_ZOOM = 4;
  /** Past this multiple of the fitted page the raster is scaled, not redrawn. */
  const RENDER_LIMIT = 2;
  /** One wheel notch or pinch burst step, capped the way the board caps it. */
  const MAX_STEP = 1.2;
  const MIN_STEP = 1 / MAX_STEP;
  /** Idle time after the last gesture event before the sharper raster renders. */
  const RENDER_IDLE_MS = 180;
  /** How long a zoom gesture owns the layout it keeps re-flowing. */
  const ZOOM_IDLE_MS = 240;
  /** The sticky item header and a little air: what the stage leaves above it. */
  const STAGE_MARGIN = 56;
  const clampZoom = (value: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));

  const mode = $derived<'all' | 'page'>(pane.mode === 'page' ? 'page' : 'all');
  const zoom = $derived(clampZoom(pane.zoom ?? 1));
  const pan = $derived(pane.pan ?? { x: 0, y: 0 });
  const pages = $derived(pdf?.numPages ?? 0);
  const currentPage = $derived(
    Math.min(Math.max(1, pane.page ?? pane.readPage ?? 1), Math.max(1, pages)),
  );
  /** A page at 100%: the column width in the flow, the stage's fit per page. */
  const fitWidth = $derived.by(() =>
    mode === 'all'
      ? available
      : Math.max(
          120,
          Math.floor(Math.min(available, stagePixels / Math.max(pageRatio, 0.1))),
        ),
  );
  const visualWidth = $derived(fitWidth * zoom);
  /**
   * Canvas width the mounted rasters were rendered at. It follows the view
   * after a pause, so a pinch — or a panel still animating open — re-renders
   * once instead of once per frame; meanwhile the raster is scaled to the page
   * box, which keeps the page readable while it settles.
   */
  let renderWidth = $state(440);
  $effect(() => {
    const target = fitWidth * Math.min(zoom, RENDER_LIMIT);
    if (Math.abs(target - renderWidth) < 1) return;
    const timer = setTimeout(() => (renderWidth = target), RENDER_IDLE_MS);
    return () => clearTimeout(timer);
  });
  function offset(node: HTMLElement) {
    return (
      node.getBoundingClientRect().top -
      scrollHost.getBoundingClientRect().top +
      scrollHost.scrollTop
    );
  }
  function readingPosition() {
    if (!pdf || !ready || mode !== 'all') return;
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
        // `page` rides along so switching to the per-page view opens the page
        // being read, not the last passage that was jumped to.
        page: low,
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
  /** Show a passage's page: scroll the flow, or flip the single-page view. */
  function reveal(page: number) {
    if (mode === 'page') onview({ page, readPage: page, readOffset: 0 });
    else jump(page);
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
  function setPan(x: number, y: number) {
    if (x === pan.x && y === pan.y) return;
    onview({ pan: { x, y } });
  }
  /** The page and the page-fraction under a screen point. */
  function anchorAt(clientX: number, clientY: number) {
    const node = (
      document.elementFromPoint(clientX, clientY) as HTMLElement | null
    )?.closest<HTMLElement>('.pdf-page');
    if (!node?.dataset.page) return null;
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      page: Number(node.dataset.page),
      fx: (clientX - rect.left) / rect.width,
      fy: (clientY - rect.top) / rect.height,
      x: clientX,
      y: clientY,
    };
  }
  /**
   * Zooming re-lays out every page, so the point that was under the pointer is
   * put back under it once the new layout is in the DOM: the pages slide by the
   * same delta and, in the flow, the column scrolls by it. Coalesced per frame,
   * so a pinch burst corrects once per painted frame.
   */
  function keepAnchored(anchor: NonNullable<ReturnType<typeof anchorAt>>) {
    pendingAnchor = anchor;
    if (anchorFrame) return;
    anchorFrame = requestAnimationFrame(async () => {
      anchorFrame = 0;
      const pending = pendingAnchor;
      pendingAnchor = null;
      if (!pending || !root) return;
      await tick();
      const node = root.querySelector<HTMLElement>('[data-page="' + pending.page + '"]');
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const dx = rect.left + pending.fx * rect.width - pending.x;
      const dy = rect.top + pending.fy * rect.height - pending.y;
      if (mode === 'page') setPan(pan.x - dx, pan.y - dy);
      else {
        setPan(pan.x - dx, pan.y);
        if (scrollHost) scrollHost.scrollTop += dy;
      }
    });
  }
  function zoomTo(value: number, event: { clientX: number; clientY: number }) {
    const next = clampZoom(value);
    if (next === zoom) return;
    const anchor = anchorAt(event.clientX, event.clientY);
    // The pointer owns the layout for the length of the gesture; a page whose
    // proportions arrive meanwhile must not re-anchor reading underneath it.
    zoomSettled = performance.now() + ZOOM_IDLE_MS;
    onview({ zoom: next });
    if (anchor) keepAnchored(anchor);
  }
  function zoomFromWheel(event: WheelEvent) {
    // deltaMode: 0 = pixels, 1 = lines, 2 = pages (Firefox reports lines for mice).
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1);
    zoomTo(zoom * Math.min(MAX_STEP, Math.max(MIN_STEP, Math.exp(-pixels / 100))), event);
  }
  function columnScrolls() {
    return Boolean(scrollHost && scrollHost.scrollHeight > scrollHost.clientHeight + 1);
  }
  function wheel(event: WheelEvent) {
    // Pinch (ctrl+wheel) and mouse-mode wheel zoom about the pointer, exactly
    // like the board; two-finger panning stays the reader's own movement.
    if (event.ctrlKey || event.metaKey || (doc.navigationMode ?? 'touchpad') === 'mouse') {
      event.preventDefault();
      zoomFromWheel(event);
      return;
    }
    // Per page the stage is the viewport, so both axes pan — unless the column
    // itself still has somewhere to scroll.
    if (mode === 'page' && !columnScrolls()) {
      event.preventDefault();
      setPan(pan.x - event.deltaX, pan.y - event.deltaY);
      return;
    }
    if (event.deltaX) {
      event.preventDefault();
      setPan(pan.x - event.deltaX, pan.y);
    }
  }
  function panByDrag(event: PointerEvent) {
    const middleMouse = event.button === 1;
    const explicitPan = event.button === 0 && viewport.space;
    if (!middleMouse && !explicitPan) return;
    event.preventDefault();
    const node = event.currentTarget as HTMLElement;
    node.setPointerCapture(event.pointerId);
    const start = { x: event.clientX, y: event.clientY };
    const from = { ...pan };
    const fromScroll = scrollHost?.scrollTop ?? 0;
    panning = true;
    const movement = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - start.x,
        dy = moveEvent.clientY - start.y;
      onview({ pan: { x: from.x + dx, y: mode === 'page' ? from.y + dy : from.y } });
      if (mode === 'all' && scrollHost) scrollHost.scrollTop = fromScroll - dy;
    };
    const finish = () => {
      node.removeEventListener('pointermove', movement);
      node.removeEventListener('pointerup', finish);
      node.removeEventListener('pointercancel', finish);
      panning = false;
    };
    node.addEventListener('pointermove', movement);
    node.addEventListener('pointerup', finish);
    node.addEventListener('pointercancel', finish);
  }
  function flip(delta: number) {
    if (!pdf) return;
    const next = Math.min(pdf.numPages, Math.max(1, currentPage + delta));
    if (next === currentPage) return;
    onview({ page: next, readPage: next, readOffset: 0 });
  }
  onMount(() => {
    let alive = true;
    scrollHost = root.closest<HTMLElement>('.bench-column')!;
    const column = new ResizeObserver(() => {
      stagePixels = Math.max(220, scrollHost.clientHeight - STAGE_MARGIN);
    });
    column.observe(scrollHost);
    stagePixels = Math.max(220, scrollHost.clientHeight - STAGE_MARGIN);
    const scroll = () => {
      cancelAnimationFrame(scrollFrame);
      scrollFrame = requestAnimationFrame(readingPosition);
      palette = null;
    };
    scrollHost.addEventListener('scroll', scroll, { passive: true });
    root.addEventListener('wheel', wheel, { passive: false });
    acquirePdf(entity.assetId!)
      .then(async (p) => {
        if (!alive) return;
        pdf = p;
        await tick();
        if (pane.jump && pane.page) {
          reveal(pane.page);
          onview({ jump: undefined });
        } else restore();
        ready = true;
      })
      .catch((e) => (error = e.message));
    return () => {
      alive = false;
      column.disconnect();
      scrollHost.removeEventListener('scroll', scroll);
      root.removeEventListener('wheel', wheel);
      cancelAnimationFrame(scrollFrame);
      cancelAnimationFrame(anchorFrame);
      releasePdf(entity.assetId!);
    };
  });
  $effect(() => {
    const page = pane.page,
      jumpId = pane.jump;
    if (page && jumpId && pdf)
      tick().then(() => {
        reveal(page);
        onview({ jump: undefined });
      });
  });
  // The mounted surface is the measure of a page: the flow's width is the page
  // width, the stage's box is the per-page viewport. Every box change — a panel
  // resize, a page whose proportions just arrived, a view switch — re-lays the
  // flow out, so the reading line is put back where the pane left it.
  $effect(() => {
    const node = mode === 'page' ? stage : flow;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const width = Math.max(120, entries[0].contentRect.width);
      if (width !== available) available = width;
      if (mode === 'all' && performance.now() > zoomSettled) restore();
    });
    observer.observe(node);
    return () => observer.disconnect();
  });
  // Per page: the page's own proportions decide how it fits the stage.
  $effect(() => {
    const number = currentPage,
      loaded = pdf;
    if (!loaded || mode !== 'page') return;
    let alive = true;
    loaded
      .getPage(number)
      .then((page) => {
        if (!alive) return;
        const base = page.getViewport({ scale: 1 });
        pageRatio = base.height / base.width;
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  });
  // Leaving the per-page view returns the flow to the page that was read.
  $effect(() => {
    const next = mode;
    if (next === lastMode) return;
    lastMode = next;
    if (next === 'all' && ready) tick().then(() => restore());
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

<div
  class="pdf-reader"
  class:panning
  bind:this={root}
  role="group"
  aria-label="PDF reading surface"
  onpointerdown={panByDrag}
  oncontextmenu={(event) => {
    // Middle-drag panning never needs the browser menu; a page's own
    // contextmenu handler still opens the highlight palette.
    if (event.button === 1) event.preventDefault();
  }}
>
  {#if error}<p class="error">
      Could not open this PDF: {error}
    </p>{:else if pdf}{#if mode === 'page'}<div
        class="pdf-stage"
        bind:this={stage}
        style:height={`${stagePixels}px`}
      >
        <div class="pdf-stage-page" style:transform={`translate(${pan.x}px, ${pan.y}px)`}>
          <PdfPage
            {pdf}
            number={currentPage}
            width={renderWidth}
            {visualWidth}
            pdfId={entity.id}
            {annotations}
            onselect={openPalette}
            dragHighlights
          />
        </div>
        {#if pdf.numPages > 1}<div class="pdf-float pdf-flip-bar" role="group" aria-label="PDF pages"
            ><button
              class="pdf-flip-button"
              aria-label="Previous page"
              disabled={currentPage <= 1}
              onclick={() => flip(-1)}><ChevronLeft size={15} /></button
            ><span class="pdf-flip-count">{currentPage} / {pdf.numPages}</span><button
              class="pdf-flip-button"
              aria-label="Next page"
              disabled={currentPage >= pdf.numPages}
              onclick={() => flip(1)}><ChevronRight size={15} /></button
            ></div
          >{/if}
      </div>{:else}<div class="pdf-flow" bind:this={flow} style:transform={`translateX(${pan.x}px)`}>
        {#each Array(pdf.numPages) as _, i}<PdfPage
            {pdf}
            number={i + 1}
            width={renderWidth}
            {visualWidth}
            pdfId={entity.id}
            {annotations}
            onselect={openPalette}
            dragHighlights
          />
          <div class="page-number">{i + 1} / {pdf.numPages}</div>{/each}
      </div>{/if}{:else}<p class="reader-loading">
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
          <button title="Jump to passage" onclick={() => reveal(a.anchor!.page)}
            >p. {a.anchor?.page}<ArrowUpRight size={13} /></button
          ><button onclick={() => onplace(a.id)}>Place on board <ArrowUpRight size={13} /></button>
        </div>
      </div>{/each}
  </div>{/if}
