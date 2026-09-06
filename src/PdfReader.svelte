<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { PDFDocumentProxy } from 'pdfjs-dist';
  import { acquirePdf, releasePdf } from './lib/pdf';
  import type { Entity, Pane, Anchor } from './lib/model';
  import PdfPage from './PdfPage.svelte';
  import { Highlighter, ArrowUpRight, X } from 'lucide-svelte';
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
    onannotate: (anchor: Anchor) => string;
    onplace: (id: string) => void;
  } = $props();
  let pdf = $state<PDFDocumentProxy>();
  let error = $state('');
  let root: HTMLDivElement;
  let scrollHost: HTMLElement;
  let available = $state(440);
  let selected = $state<Anchor | null>(null);
  let kept = $state('');
  let popup = $state({ x: 0, y: 0 });
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
  function select(anchor: Anchor) {
    selected = anchor;
    kept = '';
    const selection = window.getSelection();
    const rect = selection?.rangeCount
      ? selection.getRangeAt(0).getBoundingClientRect()
      : root.getBoundingClientRect();
    popup = {
      x: Math.max(12, Math.min(innerWidth - 330, rect.left)),
      y: Math.max(60, Math.min(innerHeight - 130, rect.bottom + 10)),
    };
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
      selected = null;
      kept = '';
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
        onselect={select}
      />
      <div class="page-number">{i + 1} / {pdf.numPages}</div>{/each}{:else}<p
      class="reader-loading"
    >
      Opening PDF…
    </p>{/if}
</div>
{#if selected}<div
    class="selection-popover"
    style:left={popup.x + 'px'}
    style:top={popup.y + 'px'}
    role="region"
    aria-label="PDF selection actions"
  >
    <p
      draggable={!!kept}
      ondragstart={(event) => {
        if (kept) {
          event.dataTransfer!.setData('application/kelana-entity', kept);
          event.dataTransfer!.effectAllowed = 'copy';
        }
      }}
    >
      {selected.quote.slice(0, 110)}{selected.quote.length > 110 ? '…' : ''}
    </p>
    <div>
      {#if kept}<button
          onclick={() => {
            onplace(kept);
            selected = null;
            kept = '';
          }}>Place on board <ArrowUpRight size={14} /></button
        ><span class="muted">or drag passage</span>{:else}<button
          onclick={() => {
            kept = onannotate(selected!);
            window.getSelection()?.removeAllRanges();
          }}><Highlighter size={15} /> Keep highlight</button
        >{/if}<button
        aria-label="Dismiss selection"
        onclick={() => {
          selected = null;
          kept = '';
        }}><X size={14} /></button
      >
    </div>
  </div>{/if}
{#if annotations.length}<div class="annotation-tray">
    <span class="eyebrow">Passages · drag onto the board</span>{#each annotations as a}<div
        class="passage"
        draggable="true"
        ondragstart={(event) => {
          event.dataTransfer!.setData('application/kelana-entity', a.id);
          event.dataTransfer!.effectAllowed = 'copy';
        }}
        role="group"
        aria-label="Draggable highlight"
      >
        <p>{a.anchor?.quote}</p>
        <div class="passage-actions">
          <button title="Jump to passage" onclick={() => jump(a.anchor!.page)}
            >p. {a.anchor?.page}<ArrowUpRight size={13} /></button
          ><button onclick={() => onplace(a.id)}>Place on board <ArrowUpRight size={13} /></button>
        </div>
      </div>{/each}
  </div>{/if}
