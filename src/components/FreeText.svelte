/**
 * The free-text card body: a live markdown editor that is editable when
 * `editing` and read-only otherwise, self-fitted to its content. Sizing
 * decisions live in lib/free-text.ts; this component owns the observer that
 * keeps the box hugging the text.
 */
<script lang="ts">
import LiveEditor from '../LiveEditor.svelte';
import { doc } from '../lib/doc.svelte';
import { fitFreeTextSize } from '../lib/free-text';
import type { Placement } from '../lib/model';

let {
  id,
  body,
  editing,
  oninput,
  onfinish,
  onfit,
}: {
  id: string;
  body: string;
  editing: boolean;
  oninput: (body: string) => void;
  onfinish: () => void;
  onfit: (id: string, placement: Placement) => void;
} = $props();

let host: HTMLElement | undefined;

function fit() {
  const placement = doc.placements.find((p) => p.entityId === id);
  if (!placement || !host) return;
  const editor = host.querySelector<HTMLElement>('.live-editor');
  if (!editor) return;
  fitFreeTextSize(placement, editor);
  onfit(id, placement);
}

function observe(node: HTMLElement) {
  let frame = 0;
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => fit());
  });
  observer.observe(node);
  return {
    destroy() {
      cancelAnimationFrame(frame);
      observer.disconnect();
    },
  };
}
</script>

<div class="free-text-fit" use:observe>
  <LiveEditor {body} {editing} {oninput} {onfinish} />
</div>
