<!--
  Appearance settings dialog: font selection for the whiteboard and the
  interface. Reads/writes doc font settings and persists via lib/doc.
-->
<script lang="ts">
import { Dialog } from 'bits-ui';
import { Search, X } from 'lucide-svelte';
import { doc, persist } from '../lib/doc.svelte';
import { fontFamily, fontOptions } from '../lib/fonts';
import type { FontId } from '../lib/model';

let { open = $bindable(false) }: { open?: boolean } = $props();

let settingsQuery = $state('');
const whiteboardFont = $derived(doc.whiteboardFont ?? 'inter');
const interfaceFont = $derived(doc.interfaceFont ?? 'inter');
const appearanceMatches = $derived(
  !settingsQuery.trim() || 'appearance font typography'.includes(settingsQuery.trim().toLowerCase()),
);

function setFont(target: 'whiteboardFont' | 'interfaceFont', value: FontId) {
  doc[target] = value;
  persist();
}
</script>

<Dialog.Root bind:open
  ><Dialog.Portal
    ><Dialog.Overlay class="dialog-overlay" /><Dialog.Content class="settings-dialog"
      ><Dialog.Title class="sr-only">Settings</Dialog.Title><Dialog.Description class="sr-only"
        >Choose fonts for your content and interface.</Dialog.Description
      >
      <aside class="settings-sidebar">
        <h2>Settings</h2>
        <label class="settings-search">
          <span class="sr-only">Search settings</span>
          <Search size={14} aria-hidden="true" />
          <input bind:value={settingsQuery} type="search" placeholder="Search" />
        </label>
        <nav aria-label="Settings sections">
          {#if appearanceMatches}<button class="active" aria-current="page"
              ><span class="settings-nav-icon">Aa</span>Appearance</button
            >{:else}<p class="settings-empty">No settings found</p>{/if}
        </nav>
      </aside>
      <section class="settings-main">
        <div class="settings-heading">
          <div>
            <small>Appearance</small>
            <h2>Fonts</h2>
          </div>
          <Dialog.Close class="icon-button" aria-label="Close settings"
            ><X size={17} /></Dialog.Close
          >
        </div>
        {#if appearanceMatches}<div class="settings-group">
            <label class="font-setting">
              <span
                ><strong>Whiteboard font</strong><small
                  >Cards and writing surfaces. PDF documents are never changed.</small
                ></span
              >
              <select
                aria-label="Whiteboard font"
                value={whiteboardFont}
                onchange={(event) => setFont('whiteboardFont', event.currentTarget.value as FontId)}
              >
                {#each fontOptions as font}<option value={font.id}>{font.label}</option>{/each}
              </select>
              <span class="font-sample content-sample"
                ><b>Notes become paths.</b> The quick brown fox jumps over the lazy dog.</span
              >
            </label>
            <label class="font-setting">
              <span
                ><strong>Interface font</strong><small
                  >Menus, controls, dialogs, and application labels.</small
                ></span
              >
              <select
                aria-label="Interface font"
                value={interfaceFont}
                onchange={(event) => setFont('interfaceFont', event.currentTarget.value as FontId)}
              >
                {#each fontOptions as font}<option value={font.id}>{font.label}</option>{/each}
              </select>
              <span class="font-sample ui-sample"
                ><b>Thinking space</b> · Search, connect, and keep writing.</span
              >
            </label>
          </div>{:else}<div class="settings-no-results">
            <Search size={20} aria-hidden="true" />
            <p>No settings match “{settingsQuery}”.</p>
          </div>{/if}
      </section>
    </Dialog.Content></Dialog.Portal
  ></Dialog.Root
>
