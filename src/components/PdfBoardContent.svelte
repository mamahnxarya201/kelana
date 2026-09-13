<script lang="ts">
  import { onMount } from 'svelte';
  import type { PDFDocumentProxy } from 'pdfjs-dist';
  import { acquirePdf, releasePdf } from '../lib/pdf';
  import type { Entity } from '../lib/model';
  import PdfPage from '../PdfPage.svelte';

  let {
    entity,
    width,
  }: {
    entity: Entity;
    width: number;
  } = $props();

  // Read-only mirror of the panel: highlights come from annotation entities
  // whose anchor points at this pdf. Annotating stays panel-only, so no
  // selection popup lives here.
  import { doc } from '../lib/doc.svelte';
  import { selectOnly, selection } from '../lib/selection.svelte';
  const annotations = $derived(
    Object.values(doc.entities).filter(
      (e): e is Entity => e.type === 'annotation' && e.anchor?.pdfId === entity.id,
    ),
  );

  let pdf = $state<PDFDocumentProxy | null>(null);
  let error = $state('');
  let scrollHost: HTMLDivElement;

  // Card scroll has zero padding: pages bleed edge-to-edge so the pdf
  // perfectly fits the card at first. Any leftover space after a user
  // resize shows as grey letterbox instead of a permanent gutter.
  const contentWidth = $derived(Math.max(120, Math.floor(width)));

  onMount(() => {
    let alive = true;
    if (!entity.assetId) {
      error = 'The local asset is missing.';
      return;
    }
    acquirePdf(entity.assetId)
      .then((p) => {
        if (alive) pdf = p;
        else releasePdf(entity.assetId!);
      })
      .catch((e) => {
        if (alive) error = e instanceof Error ? e.message : String(e);
      });
    return () => {
      alive = false;
      if (entity.assetId) releasePdf(entity.assetId);
    };
  });
</script>

<div
  class="pdf-card-scroll"
  bind:this={scrollHost}
  role="document"
  aria-label={`PDF: ${entity.title}`}
  onpointerdown={(event) => {
    // Select without dragging: header remains the drag handle, the reader
    // itself scrolls. Stop propagation so BoardCard drag / space-pan never
    // starts from inside the pdf.
    if (!selection.ids.includes(entity.id)) selectOnly(entity.id);
    event.stopPropagation();
  }}
  onwheel={(event) => {
    // Wheel scrolls the pdf only when the card is selected; otherwise the
    // board pans/zooms as usual. No ctrl-zoom in cards.
    if (!selection.ids.includes(entity.id)) return;
    event.stopPropagation();
  }}
>
  {#if error}
    <p class="pdf-card-error">{error}</p>
  {:else if pdf}
    {#each Array(pdf.numPages) as _, i}
      <PdfPage
        {pdf}
        number={i + 1}
        width={contentWidth}
        visualWidth={contentWidth}
        pdfId={entity.id}
        {annotations}
        onselect={() => {}}
      />
    {/each}
  {:else}
    <p class="reader-loading">Opening PDF…</p>
  {/if}
</div>
