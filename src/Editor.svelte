<script lang="ts">
  import { onDestroy, tick } from 'svelte';
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
  let liveEditor: { focusAt: (position: number) => void; focusAtPoint: (x: number, y: number) => void };

  async function edit(event?: MouseEvent) {
    if (editing) return;
    before = body;
    position = caret;
    editing = true;
    onactive(true);
    await tick();
    // The browser finishes dispatching the click that created/activated the
    // card after this component mounts. Focus on the next frame so that click
    // cannot steal the initial caret back from CodeMirror.
    requestAnimationFrame(() => {
      if (event) liveEditor?.focusAtPoint(event.clientX, event.clientY);
      else liveEditor?.focusAt(position);
    });
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

<div
  class:editing
  class="editable"
  role="textbox"
  tabindex={editing ? -1 : 0}
  aria-label={activation === 'double' ? 'Double-click to edit card' : 'Edit card'}
  aria-multiline="true"
  onclick={(event) => {
    if (activation === 'click') edit(event);
  }}
  ondblclick={(event) => {
    if (activation === 'double') {
      event.preventDefault();
      event.stopPropagation();
      edit(event);
    }
  }}
  onkeydown={(event) => {
    if (!editing && event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      edit();
    }
  }}
>
  <LiveEditor
    bind:this={liveEditor}
    {body}
    {editing}
    caret={position}
    {oninput}
    oncaret={(pos) => {
      position = pos;
      oncaret(pos);
    }}
    onfinish={finish}
  />
</div>
