<script lang="ts">
  import { onMount } from 'svelte';
  import { EditorState, Transaction } from '@codemirror/state';
  import { EditorView, keymap, drawSelection } from '@codemirror/view';
  import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
  import { markdown, markdownKeymap } from '@codemirror/lang-markdown';
  import { liveMarkdown } from './lib/live-markdown';
  let {
    body,
    caret = 0,
    oninput,
    onfinish,
    oncaret = () => {},
  }: {
    body: string;
    caret?: number;
    oninput: (body: string) => void;
    onfinish: () => void;
    oncaret?: (pos: number) => void;
  } = $props();
  let host: HTMLDivElement;
  let editor: EditorView | undefined;
  let fromOutside = false;
  onMount(() => {
    editor = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: body,
        selection: { anchor: Math.min(caret, body.length) },
        extensions: [
          markdown(),
          history(),
          drawSelection(),
          EditorView.lineWrapping,
          liveMarkdown,
          EditorView.contentAttributes.of({ 'aria-label': 'Edit Markdown', spellcheck: 'true' }),
          keymap.of([
            {
              key: 'Escape',
              run: () => {
                onfinish();
                return true;
              },
            },
            ...markdownKeymap,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !fromOutside) oninput(update.state.doc.toString());
            if (update.selectionSet) oncaret(update.state.selection.main.head);
          }),
          EditorView.domEventHandlers({
            blur: () => {
              queueMicrotask(() => {
                if (editor && !editor.hasFocus) onfinish();
              });
            },
          }),
          EditorView.theme({
            '&': { fontSize: '16px', backgroundColor: 'transparent' },
            '.cm-content': {
              fontFamily: 'inherit',
              padding: '0',
              caretColor: '#242422',
            },
            '.cm-line': { padding: '0', lineHeight: '1.6' },
            '.cm-scroller': { fontFamily: 'inherit', overflow: 'visible' },
            '&.cm-focused': { outline: 'none' },
            '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
              backgroundColor: '#4d6fff26',
            },
          }),
        ],
      }),
    });
    editor.focus();
    return () => {
      editor?.destroy();
      editor = undefined;
    };
  });
  $effect(() => {
    const next = body;
    if (editor && editor.state.doc.toString() !== next) {
      fromOutside = true;
      const anchor = Math.min(editor.state.selection.main.head, next.length);
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: next },
        selection: { anchor },
        annotations: Transaction.addToHistory.of(false),
      });
      fromOutside = false;
    }
  });
</script>

<div class="live-editor" bind:this={host}></div>
