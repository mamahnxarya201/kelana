<!--
  Local search dialog: queries the workspace index (lib/search.svelte.ts)
  and opens results on the board or in the workbench.
-->
<script lang="ts">
import { Dialog } from 'bits-ui';
import { ArrowUpRight, FileText, Search, Type, X } from 'lucide-svelte';
import { search, run } from '../lib/search.svelte';
import { doc } from '../lib/doc.svelte';

let {
  open = $bindable(false),
  indexing = 0,
  onreveal,
  onopen,
}: {
  open?: boolean;
  indexing?: number;
  onreveal: (id: string) => void;
  onopen: (id: string) => void;
} = $props();
</script>

<Dialog.Root bind:open
  ><Dialog.Portal
    ><Dialog.Overlay class="dialog-overlay" /><Dialog.Content class="search-dialog"
      ><Dialog.Title class="sr-only">Search your workspace</Dialog.Title><Dialog.Description
        class="sr-only"
        >Find cards, free text, highlights, and text inside local PDFs.</Dialog.Description
      >
      <div class="search-box">
        <Search size={19} /><input
          bind:value={search.query}
          oninput={run}
          placeholder="Search your thoughts and sources…"
          aria-label="Search query"
        /><Dialog.Close class="icon-button" aria-label="Close search"><X size={17} /></Dialog.Close>
      </div>
      <div class="search-results">
        {#if !search.query}<p class="muted">
            Search cards, free text, highlights, and text inside your PDFs.
          </p>{:else if !search.hits.length}<p class="muted">
            No matches for “{search.query}”.
          </p>{:else}{#each search.hits as id}{@const e = doc.entities[id]}<button
              class="search-result"
              onclick={() => {
                if (e.type === 'text') onreveal(id);
                else onopen(id);
                open = false;
              }}
              >{#if e.type === 'text'}<Type size={17} />{:else}<FileText size={17} />{/if}<span
                ><strong>{e.title}</strong><small
                  >{e.anchor?.quote ?? e.body.replace(/[#*]/g, '').slice(0, 110)}</small
                ></span
              ><ArrowUpRight size={15} /></button
            >{/each}{/if}{#if indexing}<p class="muted">
            Indexing {indexing} PDF{indexing > 1 ? 's' : ''}…
          </p>{/if}
      </div></Dialog.Content
    ></Dialog.Portal
  ></Dialog.Root
>
