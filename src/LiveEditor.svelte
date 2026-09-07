<script lang="ts">
  import { onMount } from 'svelte';
  import { Compartment, EditorState, Transaction } from '@codemirror/state';
  import { EditorView, keymap, drawSelection } from '@codemirror/view';
  import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
  import { markdown, markdownKeymap } from '@codemirror/lang-markdown';
  import { liveMarkdown } from './lib/live-markdown';
  let {
    body,
    editing = true,
    caret = 0,
    oninput,
    onfinish,
    oncaret = () => {},
  }: {
    body: string;
    editing?: boolean;
    caret?: number;
    oninput: (body: string) => void;
    onfinish: () => void;
    oncaret?: (pos: number) => void;
  } = $props();
  let host: HTMLDivElement;
  let editor: EditorView | undefined;
  let fromOutside = false;
  const readOnly = new Compartment();
  const editable = new Compartment();

  export function focusAt(position: number) {
    if (!editor) return;
    const anchor = Math.max(0, Math.min(position, editor.state.doc.length));
    editor.dispatch({ selection: { anchor }, scrollIntoView: true });
    editor.focus();
  }
  export function focusAtPoint(x: number, y: number) {
    if (!editor) return;
    const position = editor.posAtCoords({ x, y });
    focusAt(position ?? Math.min(caret, editor.state.doc.length));
  }

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
          readOnly.of(EditorState.readOnly.of(!editing)),
          editable.of(EditorView.editable.of(editing)),
          EditorView.contentAttributes.of({ 'aria-label': 'Edit Markdown', spellcheck: 'true' }),
          keymap.of([
            {
              key: 'Escape',
              run: () => {
                if (!editing) return false;
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
              if (!editing) return;
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
    if (editing) requestAnimationFrame(() => focusAt(caret));
    return () => {
      editor?.destroy();
      editor = undefined;
    };
  });
  $effect(() => {
    const enabled = editing;
    if (!editor) return;
    editor.dispatch({
      effects: [
        readOnly.reconfigure(EditorState.readOnly.of(!enabled)),
        editable.reconfigure(EditorView.editable.of(enabled)),
      ],
    });
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

<div class="live-editor" class:editing bind:this={host}></div>
