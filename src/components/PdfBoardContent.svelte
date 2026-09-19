<script lang="ts">
  import { onMount } from 'svelte';
  import type { PDFDocumentProxy } from 'pdfjs-dist';
  import { ChevronLeft, ChevronRight } from 'lucide-svelte';
  import { acquirePdf, releasePdf, PDF_CARD_INSET } from '../lib/pdf';
  import type { Entity } from '../lib/model';
  import PdfPage from '../PdfPage.svelte';

  let {
    entity,
    width,
    height,
  }: {
    entity: Entity;
    width: number;
    height: number;
  } = $props();

  // Read-only mirror of the panel: highlights come from annotation entities
  // whose anchor points at this pdf. Annotating stays panel-only, so no
  // selection popup lives here.
  import { doc } from '../lib/doc.svelte';
  import { selection } from '../lib/selection.svelte';
  const annotations = $derived(
    Object.values(doc.entities).filter(
      (e): e is Entity => e.type === 'annotation' && e.anchor?.pdfId === entity.id,
    ),
  );

  let pdf = $state<PDFDocumentProxy | null>(null);
  let error = $state('');
  let page = $state(1);
  let pageRatio = $state(0); // page height / width of page 1

  const contentWidth = $derived(Math.max(120, Math.floor(width) - PDF_CARD_INSET));
  // Flip view shows one page at a time: the page sits inside the card frame
  // with a small breathing margin, and the floating controls overlay it.
  const fitWidth = $derived.by(() => {
    if (!pageRatio) return contentWidth;
    const availableHeight = Math.max(80, height - PDF_CARD_INSET);
    return Math.max(120, Math.floor(Math.min(contentWidth, availableHeight / pageRatio)));
  });

  onMount(() => {
    let alive = true;
    if (!entity.assetId) {
      error = 'The local asset is missing.';
      return;
    }
    acquirePdf(entity.assetId)
      .then(async (p) => {
        if (!alive) {
          releasePdf(entity.assetId!);
          return;
        }
        pdf = p;
        const base = (await p.getPage(1)).getViewport({ scale: 1 });
        if (alive) pageRatio = base.height / base.width;
      })
      .catch((e) => {
        if (alive) error = e instanceof Error ? e.message : String(e);
      });
    return () => {
      alive = false;
      if (entity.assetId) releasePdf(entity.assetId);
    };
  });

  function flip(delta: number) {
    if (!pdf) return;
    page = Math.min(pdf.numPages, Math.max(1, page + delta));
  }
</script>

<div
  class="pdf-card-flip"
  role="document"
  aria-label={`PDF: ${entity.title}`}
  onwheel={(event) => {
    // Wheel flips pages only when the card is selected (no ctrl/meta — the
    // board zooms then); at the edges the board's no-op card scroll applies.
    if (!selection.ids.includes(entity.id) || event.ctrlKey || event.metaKey) return;
    if (!pdf || pdf.numPages <= 1) {
      event.stopPropagation();
      return;
    }
    const delta = Math.sign(event.deltaY);
    const next = page + delta;
    if (next < 1 || next > pdf.numPages) return;
    event.stopPropagation();
    page = next;
  }}
>
  {#if error}
    <p class="pdf-card-error">{error}</p>
  {:else if pdf}
    <PdfPage
      {pdf}
      number={page}
      width={fitWidth}
      visualWidth={fitWidth}
      pdfId={entity.id}
      {annotations}
      onselect={() => {}}
    />
    {#if pdf.numPages > 1}
      <div class="pdf-float pdf-flip-bar" role="group" aria-label="PDF pages">
        <button
          class="pdf-flip-button"
          aria-label="Previous page"
          disabled={page <= 1}
          onclick={() => flip(-1)}
        ><ChevronLeft size={15} /></button>
        <span class="pdf-flip-count">{page} / {pdf.numPages}</span>
        <button
          class="pdf-flip-button"
          aria-label="Next page"
          disabled={page >= pdf.numPages}
          onclick={() => flip(1)}
        ><ChevronRight size={15} /></button>
      </div>
    {/if}
  {:else}
    <p class="reader-loading">Opening PDF…</p>
  {/if}
</div>
