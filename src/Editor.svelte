<script lang="ts">
  import { onDestroy } from 'svelte';
  import Markdown from './Markdown.svelte';
  import LiveEditor from './LiveEditor.svelte';
  let {
    body,
    oninput,
    oncommit,
    caret = 0,
    oncaret = () => {},
    activation = 'click',
    active = false,
    onactive = () => {},
  }: {
    body: string;
    oninput: (body: string) => void;
    oncommit: (before: string) => void;
    caret?: number;
    oncaret?: (pos: number) => void;
    activation?: 'click' | 'double';
    active?: boolean;
    onactive?: (active: boolean) => void;
  } = $props();
  let editing = $state(false);
  let before = '';
  let position = $state(0);
  function edit(event?: MouseEvent) {
    if (editing) return;
    before = body;
    position = caret;
    if (event) {
      const target = event.target as HTMLElement;
      const block = target.closest('p,h1,h2,h3,h4,h5,h6,li,blockquote');
      const text = block?.textContent?.trim();
      if (text) {
        const found = body.indexOf(text.slice(0, 32));
        if (found >= 0) position = found;
      }
    }
    editing = true;
    onactive(true);
  }
  function finish() {
    if (!editing) return;
    editing = false;
    oncommit(before);
    onactive(false);
  }
  $effect(() => {
    if (active && !editing) edit();
  });
  onDestroy(() => {
    if (editing) oncommit(before);
  });
</script>

{#if editing}<LiveEditor
    {body}
    caret={position}
    {oninput}
    oncaret={(pos) => {
      position = pos;
      oncaret(pos);
    }}
    onfinish={finish}
  />{:else}<div
    class="editable"
    role="button"
    tabindex="0"
    aria-label={activation === 'double' ? 'Double-click to edit card' : 'Edit card'}
    onclick={(event) => {
      if (activation === 'click') edit(event);
    }}
    ondblclick={(event) => {
      if (activation === 'double') {
        event.stopPropagation();
        edit(event);
      }
    }}
    onkeydown={(event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        edit();
      }
    }}
  >
    {#if body}<Markdown text={body} />{:else}<p class="muted">Start writing…</p>{/if}
  </div>{/if}
