/**
 * KaTeX math for markdown cards: inline `$...$` and block `$$...$$`.
 *
 * Parsing goes through the markdown tokenizer (so imported/pasted markdown
 * becomes math nodes) and a live scanner (so typing the closing delimiter
 * converts immediately, the same way MarkdownEscape works). Rendering is a
 * node view: KaTeX when the editor is read-only, the raw LaTeX source between
 * delimiters while editing — double-clicking a card shows the syntax.
 */
import { Extension, Node, mergeAttributes, type NodeViewRendererProps } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { NodeView, ViewMutationRecord } from '@tiptap/pm/view';
import katex from 'katex';

/** Content hugs the delimiters; a closing `$` before a digit keeps currency
 *  like "$5 and $10" as plain text. */
const INLINE_MATH = /(?<!\$)\$(?!\s)((?:\\.|[^\\$])+?)(?<!\s)\$(?![\d$])/g;
const BLOCK_MATH = /^\$\$([\s\S]+?)\$\$$/;

function renderKatex(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex, { throwOnError: false, displayMode, strict: false });
  } catch {
    return '';
  }
}

const views = new Set<MathView>();
/** Re-render every math node view (called when editability flips). */
export function refreshMathViews() {
  for (const view of views) view.refresh();
}

class MathView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private renderHost: HTMLElement;
  private sourceEl: HTMLElement;
  private editor: NodeViewRendererProps['editor'];
  private node: ProseMirrorNode;
  private displayMode: boolean;

  constructor(props: NodeViewRendererProps, displayMode: boolean) {
    this.editor = props.editor;
    this.node = props.node;
    this.displayMode = displayMode;
    this.dom = document.createElement(displayMode ? 'div' : 'span');
    this.dom.classList.add(displayMode ? 'math-block' : 'math-inline');
    this.renderHost = document.createElement(displayMode ? 'div' : 'span');
    this.renderHost.classList.add('math-render');
    this.dom.append(this.renderHost);
    this.contentDOM = document.createElement('span');
    this.contentDOM.classList.add('math-content');
    const source = document.createElement('span');
    source.classList.add('math-source');
    source.append(
      document.createTextNode(displayMode ? '$$' : '$'),
      this.contentDOM,
      document.createTextNode(displayMode ? '$$' : '$'),
    );
    this.dom.append(source);
    this.sourceEl = source;
    this.refresh();
    views.add(this);
  }

  refresh() {
    const editable = this.editor.isEditable;
    this.dom.classList.toggle('editing', editable);
    // The delimiters and the rendered KaTeX are node-view chrome, not
    // document content — only contentDOM may receive typing.
    this.renderHost.contentEditable = 'false';
    this.sourceEl.contentEditable = 'false';
    this.contentDOM.contentEditable = editable ? 'true' : 'false';
    if (!editable) {
      this.renderHost.innerHTML = renderKatex(this.node.textContent, this.displayMode);
    }
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type.name !== this.node.type.name) return false;
    this.node = node;
    if (!this.editor.isEditable) {
      this.renderHost.innerHTML = renderKatex(node.textContent, this.displayMode);
    }
    return true;
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    if (mutation.type === 'selection') return true;
    if (!this.editor.isEditable) return true;
    return mutation.target !== this.contentDOM && !this.contentDOM.contains(mutation.target);
  }

  destroy() {
    views.delete(this);
  }
}

const inlineTokenizer = {
  name: 'mathInline',
  start: (src: string) => src.indexOf('$'),
  level: 'inline' as const,
  tokenize: (src: string) => {
    const match = /^\$(?!\s)((?:\\.|[^\\$])+?)(?<!\s)\$(?![\d$])/.exec(src);
    if (!match) return undefined;
    return { type: 'mathInline', raw: match[0], text: match[1] };
  },
};

const blockTokenizer = {
  name: 'mathBlock',
  start: (src: string) => src.indexOf('$$'),
  level: 'block' as const,
  tokenize: (src: string) => {
    const match = /^\$\$([\s\S]+?)\$\$/.exec(src);
    if (!match) return undefined;
    return { type: 'mathBlock', raw: match[0], text: match[1] };
  },
};

export const MathInline = Node.create({
  name: 'mathInline',
  inline: true,
  group: 'inline',
  content: 'text*',
  marks: '',
  code: true,

  parseHTML() {
    return [{ tag: 'span[data-math-inline]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-math-inline': '' }), 0];
  },

  renderText({ node }) {
    return `$${node.textContent}$`;
  },

  // renderChildren (not textContent): the serializer hands us plain JSON
  // nodes, and code:true children skip markdown escaping so LaTeX survives.
  renderMarkdown: (node, helpers) => `$${helpers.renderChildren(node)}$`,

  parseMarkdown: (token, helpers) => ({
    type: 'mathInline',
    content: [helpers.createTextNode(token.text ?? '')],
  }),

  markdownTokenizer: inlineTokenizer,

  addNodeView() {
    return (props) => new MathView(props, false);
  },
});

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  isolating: true,

  parseHTML() {
    return [{ tag: 'div[data-math-block]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-math-block': '' }), 0];
  },

  renderText({ node }) {
    return `$$${node.textContent}$$`;
  },

  renderMarkdown: (node, helpers) => `$$\n${helpers.renderChildren(node)}\n$$`,

  parseMarkdown: (token, helpers) => ({
    type: 'mathBlock',
    content: [helpers.createTextNode((token.text ?? '').trim())],
  }),

  markdownTokenizer: blockTokenizer,

  addNodeView() {
    return (props) => new MathView(props, true);
  },
});

/** Convert freshly typed or loaded `$...$` / `$$...$$` text into math nodes. */
const mathScanner = new Plugin({
  appendTransaction: (transactions, _oldState, newState) => {
    if (!transactions.some((transaction) => transaction.docChanged)) return null;
    const replacements: Array<{ from: number; to: number; block: boolean; text: string }> = [];
    newState.doc.descendants((node, position, parent) => {
      if (!node.isText || !node.text) return;
      const parentName = parent?.type.name ?? '';
      if (parentName.startsWith('math') || parentName === 'codeBlock') return;
      if (node.marks.some((mark) => mark.type.name === 'code')) return;
      if (parent?.type.name === 'paragraph' && parent.childCount === 1) {
        const block = BLOCK_MATH.exec(node.text.trim());
        if (block) {
          replacements.push({
            from: position - 1,
            to: position - 1 + parent.nodeSize,
            block: true,
            text: block[1].trim(),
          });
          return;
        }
      }
      for (const match of node.text.matchAll(INLINE_MATH)) {
        const offset = match.index ?? 0;
        replacements.push({
          from: position + offset,
          to: position + offset + match[0].length,
          block: false,
          text: match[1],
        });
      }
    });
    if (!replacements.length) return null;
    const transaction = newState.tr;
    for (const replacement of replacements.sort((a, b) => b.from - a.from)) {
      const type = replacement.block
        ? newState.schema.nodes.mathBlock
        : newState.schema.nodes.mathInline;
      transaction.replaceWith(
        replacement.from,
        replacement.to,
        type.create(null, newState.schema.text(replacement.text)),
      );
    }
    return transaction;
  },
});

export const MathSupport = Extension.create({
  name: 'mathSupport',
  addExtensions() {
    return [MathInline, MathBlock];
  },
  addProseMirrorPlugins() {
    return [mathScanner];
  },
});
