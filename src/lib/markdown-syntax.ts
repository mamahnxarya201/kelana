import { Extension, Node, mergeAttributes } from '@tiptap/core';
import { Fragment, type Mark as ProseMirrorMark } from '@tiptap/pm/model';
import { Plugin, TextSelection, type EditorState } from '@tiptap/pm/state';

const escapablePunctuation = /^[\\`*_[\]{}<>#+\-.!|()]$/;

function hasEscapedPunctuation(state: EditorState, from: number, to: number) {
  let found = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (node.type.name === 'markdownEscape') found = true;
    return !found;
  });
  return found;
}

function resemblesMarkdownInput(value: string, inserted: string) {
  if (inserted === ' ' && /^(?:#{1,6}|>|[-+*]|\d+\.)$/.test(value.trimEnd())) return true;
  return (
    /^(?:---|___|\*\*\*)$/.test(value) ||
    /(?:\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|`[^`]+`)$/.test(value) ||
    /!?\[[^\]]*\]\([^\s)]+(?:\s+["'][^"']*["'])?\)$/.test(value)
  );
}

export const MarkdownEscape = Node.create({
  name: 'markdownEscape',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: false,

  addAttributes() {
    return { character: { default: '', rendered: false } };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-markdown-escape]',
        getAttrs: (element) => ({ character: (element as HTMLElement).textContent ?? '' }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-markdown-escape': '' }),
      node.attrs.character,
    ];
  },

  renderText({ node }) {
    return node.attrs.character;
  },

  renderMarkdown(node) {
    return `\\${node.attrs?.character ?? ''}`;
  },
});

export const MarkdownSyntax = Extension.create({
  name: 'markdownSyntax',
  priority: 1_000,

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { state, view } = this.editor;
        const { $from, empty } = state.selection;
        if (!empty || $from.parent.type.name !== 'paragraph') return false;

        const line = $from.parent.textContent;
        const setext = /^(=+|-+)\s*$/.exec(line);
        if (setext && $from.parentOffset === $from.parent.content.size) {
          const parentDepth = $from.depth - 1;
          const index = $from.index(parentDepth);
          if (index > 0) {
            const previous = $from.node(parentDepth).child(index - 1);
            if (previous.type.name === 'paragraph' && previous.textContent.trim()) {
              const currentStart = $from.before($from.depth);
              const previousStart = currentStart - previous.nodeSize;
              const transaction = state.tr
                .setNodeMarkup(previousStart, state.schema.nodes.heading, {
                  level: setext[1][0] === '=' ? 1 : 2,
                })
                .delete(currentStart + 1, currentStart + 1 + $from.parent.content.size);
              transaction.setSelection(TextSelection.create(transaction.doc, currentStart + 1));
              view.dispatch(transaction.scrollIntoView());
              return true;
            }
          }
        }

        if (
          $from.depth === 1 &&
          $from.parentOffset === $from.parent.content.size &&
          /^(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line)
        ) {
          const currentStart = $from.before();
          const transaction = state.tr.replaceWith(
            currentStart,
            currentStart + $from.parent.nodeSize,
            Fragment.fromArray([
              state.schema.nodes.horizontalRule.create(),
              state.schema.nodes.paragraph.create(),
            ]),
          );
          transaction.setSelection(TextSelection.create(transaction.doc, currentStart + 2));
          view.dispatch(transaction.scrollIntoView());
          return true;
        }

        if (line.endsWith('  ') && $from.parentOffset === $from.parent.content.size) {
          return this.editor
            .chain()
            .command(({ tr }) => {
              tr.delete($from.pos - 2, $from.pos);
              return true;
            })
            .setHardBreak()
            .run();
        }

        return false;
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((transaction) => transaction.docChanged)) return null;
          const replacements: Array<{
            from: number;
            to: number;
            character: string;
            marks: readonly ProseMirrorMark[];
          }> = [];
          newState.doc.descendants((node, position) => {
            if (!node.isText || !node.text) return;
            for (const match of node.text.matchAll(/\\([\\`*_[\]{}<>#+\-.!|()])/g)) {
              const offset = match.index ?? 0;
              replacements.push({
                from: position + offset,
                to: position + offset + match[0].length,
                character: match[1],
                marks: node.marks,
              });
            }
          });
          if (!replacements.length) return null;
          const transaction = newState.tr;
          for (const replacement of replacements.reverse()) {
            transaction.replaceWith(
              replacement.from,
              replacement.to,
              newState.schema.nodes.markdownEscape.create(
                { character: replacement.character },
                null,
                replacement.marks,
              ),
            );
          }
          return transaction;
        },
        props: {
          handleTextInput: (view, from, to, text) => {
            const { state } = view;
            const $from = state.doc.resolve(from);
            const paragraphStart = $from.start();
            const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc');

            if (
              hasEscapedPunctuation(state, paragraphStart, from) &&
              resemblesMarkdownInput(before + text, text)
            ) {
              view.dispatch(state.tr.insertText(text, from, to).scrollIntoView());
              return true;
            }

            if (
              text === ' ' &&
              before === '   ' &&
              $from.depth === 1 &&
              $from.parent.type.name === 'paragraph'
            ) {
              view.dispatch(
                state.tr
                  .setNodeMarkup($from.before(), state.schema.nodes.codeBlock)
                  .delete(paragraphStart, from)
                  .scrollIntoView(),
              );
              return true;
            }

            if ($from.parent.type.name === 'paragraph' && text === '>') {
              const breakTag = /<br\s*\/?$/i.exec(before);
              if (breakTag) {
                const start = from - breakTag[0].length;
                view.dispatch(
                  state.tr
                    .replaceWith(start, to, state.schema.nodes.hardBreak.create())
                    .scrollIntoView(),
                );
                return true;
              }
            }

            if (!escapablePunctuation.test(text) || from < 1) return false;
            if (state.doc.textBetween(from - 1, from, undefined, '\ufffc') !== '\\') return false;

            view.dispatch(
              state.tr
                .replaceWith(
                  from - 1,
                  to,
                  state.schema.nodes.markdownEscape.create(
                    { character: text },
                    null,
                    $from.marks(),
                  ),
                )
                .scrollIntoView(),
            );
            return true;
          },
        },
      }),
    ];
  },
});
