<!--
  Confirm-replace dialog for opening a `.kelana` board file
  (kelana-file-format.md Phase 2). Nothing happens until the user confirms;
  cancelling leaves the current board untouched.
-->
<script lang="ts">
  import { Dialog } from 'bits-ui';

  let {
    open = $bindable(false),
    currentTitle,
    fileName,
    onconfirm,
  }: {
    open?: boolean;
    currentTitle: string;
    fileName: string;
    onconfirm: () => void;
  } = $props();
</script>

<Dialog.Root bind:open
  ><Dialog.Portal
    ><Dialog.Overlay class="dialog-overlay" /><Dialog.Content class="open-board-dialog"
      ><Dialog.Title class="open-board-title">Open “{fileName}”?</Dialog.Title
      ><Dialog.Description class="open-board-copy"
        >This replaces the current board <strong>“{currentTitle}”</strong>. The current board
        stays saved on this device — use Save As first if you also want it as a file.</Dialog.Description
      >
      <footer class="open-board-actions">
        <Dialog.Close class="open-board-button">Cancel</Dialog.Close>
        <button class="open-board-button primary" onclick={onconfirm}>Open</button>
      </footer>
    </Dialog.Content></Dialog.Portal
  ></Dialog.Root
>
