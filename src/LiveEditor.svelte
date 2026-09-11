<script lang="ts">
  import { onMount } from 'svelte';
  import { Editor, Extension } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import Image from '@tiptap/extension-image';
  import { Markdown } from '@tiptap/markdown';
  import { MarkdownEscape, MarkdownSyntax } from './lib/markdown-syntax';

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
  let editor: Editor | undefined;
  let applyingExternal = false;
  let lastEmitted = '';
  let pendingExternal: string | null = null;
  let composing = false;
  let finishAfterComposition = false;

  function editablePosition(position: number) {
    if (!editor) return 1;
    return Math.max(1, Math.min(position || 1, Math.max(1, editor.state.doc.content.size - 1)));
  }

  export function focusAt(position: number) {
    if (!editor) return;
    editor.commands.focus();
    editor.commands.setTextSelection(editablePosition(position));
    editor.commands.scrollIntoView();
  }

  export function positionAtPoint(x: number, y: number) {
    if (!editor) return 1;
    return editor.view.posAtCoords({ left: x, top: y })?.pos ?? editablePosition(caret);
  }

  function applyExternal(markdown: string) {
    if (!editor) return;
    if (composing || editor.view.composing) {
      pendingExternal = markdown;
      return;
    }
    const position = editor.state.selection.from;
    const focused = editor.isFocused;
    applyingExternal = true;
    editor.commands.setContent(markdown, {
      contentType: 'markdown',
      emitUpdate: false,
    });
    editor.commands.setTextSelection(editablePosition(position));
    if (focused) editor.commands.focus();
    applyingExternal = false;
  }

  function finishEditing() {
    if (composing || editor?.view.composing) {
      finishAfterComposition = true;
      return;
    }
    onfinish();
  }

  onMount(() => {
    const EscapeToFinish = Extension.create({
      name: 'escapeToFinish',
      addKeyboardShortcuts() {
        return {
          Escape: () => {
            if (!editing) return false;
            finishEditing();
            return true;
          },
        };
      },
    });

    editor = new Editor({
      element: host,
      editable: editing,
      content: body,
      contentType: 'markdown',
      extensions: [
        StarterKit.configure({
          link: { markdownLinks: true },
        }),
        Image.configure({
          inline: true,
          allowBase64: false,
          HTMLAttributes: { loading: 'lazy', referrerpolicy: 'no-referrer' },
        }),
        MarkdownEscape,
        MarkdownSyntax,
        Markdown.configure({ markedOptions: { gfm: true, breaks: false } }),
        EscapeToFinish,
      ],
      editorProps: {
        attributes: {
          class: 'markdown',
          'aria-label': 'Edit Markdown',
          'aria-multiline': 'true',
          spellcheck: 'true',
        },
        handleDOMEvents: {
          compositionstart: () => {
            composing = true;
            return false;
          },
          compositionend: () => {
            composing = false;
            queueMicrotask(() => {
              if (pendingExternal !== null) {
                const next = pendingExternal;
                pendingExternal = null;
                applyExternal(next);
              }
              if (finishAfterComposition) {
                finishAfterComposition = false;
                onfinish();
              }
            });
            return false;
          },
          blur: () => {
            queueMicrotask(() => {
              if (editing && editor && !editor.isFocused) finishEditing();
            });
            return false;
          },
        },
      },
      onUpdate: ({ editor: current, transaction }) => {
        if (applyingExternal || !transaction.docChanged) return;
        const markdown = current.getMarkdown();
        lastEmitted = markdown;
        oninput(markdown);
      },
      onSelectionUpdate: ({ editor: current }) => {
        oncaret(current.state.selection.from);
      },
    });

    return () => {
      editor?.destroy();
      editor = undefined;
    };
  });

  $effect(() => {
    const enabled = editing;
    if (editor && editor.isEditable !== enabled) editor.setEditable(enabled);
  });

  $effect(() => {
    const next = body;
    if (!editor || next === lastEmitted) return;
    const current = editor.getMarkdown();
    if (next !== current) applyExternal(next);
  });
</script>

<div class="live-editor" class:editing bind:this={host}></div>
