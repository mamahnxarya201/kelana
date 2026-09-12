<!--
  Keyboard shortcuts reference. Fully static; visibility controlled via open.
-->
<script lang="ts">
import { Dialog } from 'bits-ui';

let { open = $bindable(false) }: { open?: boolean } = $props();

const shortcuts: [string, string][] = [
  ['N', 'New card'],
  ['V / H', 'Select / pan'],
  ['Space + drag', 'Pan the board'],
  ['Mouse mode', 'Middle-drag to pan · wheel to zoom'],
  ['Touchpad mode', 'Two-finger pan · pinch to zoom'],
  ['Drag empty space', 'Select multiple cards'],
  ['Right-click selection', 'Create a group'],
  ['Delete on a group', 'Remove group, keep its cards'],
  ['C', 'Connect cards and tune curves'],
  ['Ctrl / ⌘ K', 'Search locally'],
  ['Ctrl / ⌘ Z', 'Undo'],
  ['Ctrl / ⌘ Shift Z', 'Redo'],
  ['0', 'Fit everything'],
  ['Enter on a card', 'Open in workbench'],
  ['Arrow keys on a card', 'Nudge position'],
  ['Shift F10', 'Card context menu'],
];
</script>

<Dialog.Root bind:open
  ><Dialog.Portal
    ><Dialog.Overlay class="dialog-overlay" /><Dialog.Content class="help-dialog"
      ><Dialog.Title>Keep your hands on the thought.</Dialog.Title><Dialog.Description
        >Shortcuts for your workspace.</Dialog.Description
      >
      <dl>
        {#each shortcuts as shortcut}<div>
            <dt>{shortcut[0]}</dt>
            <dd>{shortcut[1]}</dd>
          </div>{/each}
      </dl>
      <Dialog.Close class="help-close">Back to thinking</Dialog.Close></Dialog.Content
    ></Dialog.Portal
  ></Dialog.Root
>
