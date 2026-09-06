import { EditorState, StateField, type Range } from '@codemirror/state';
import { Decoration, WidgetType, EditorView, type DecorationSet } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
class ListBullet extends WidgetType {
  constructor(readonly label: string) {
    super();
  }
  eq(other: ListBullet) {
    return this.label === other.label;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'md-bullet';
    span.textContent = this.label;
    span.setAttribute('aria-hidden', 'true');
    return span;
  }
}
export function activeLines(state: EditorState) {
  const lines = new Set<number>();
  for (const range of state.selection.ranges)
    for (let n = state.doc.lineAt(range.from).number; n <= state.doc.lineAt(range.to).number; n++)
      lines.add(n);
  return lines;
}
export function previewDecorations(state: EditorState): DecorationSet {
  const active = activeLines(state),
    marks: Range<Decoration>[] = [],
    paragraphs: { from: number; to: number }[] = [],
    codeLines = new Set<number>();
  const inactive = (from: number, to: number) => {
    for (let n = state.doc.lineAt(from).number; n <= state.doc.lineAt(to).number; n++)
      if (active.has(n)) return false;
    return true;
  };
  const hide = (from: number, to: number) => {
    if (to > from && inactive(from, to)) marks.push(Decoration.replace({}).range(from, to));
  };
  const lineClasses = new Map<number, string[]>();
  const addLine = (from: number, cls: string) => {
    const start = state.doc.lineAt(from).from;
    lineClasses.set(start, [...(lineClasses.get(start) ?? []), cls]);
  };
  syntaxTree(state).iterate({
    enter(node) {
      const { name, from, to } = node;
      // Top-level paragraphs behave like the preview's <p> margins.
      if (name === 'Paragraph' && node.node.parent?.name === 'Document')
        paragraphs.push({ from, to });
      if (/^ATXHeading[1-6]$/.test(name)) addLine(from, `md-h${name.at(-1)}`);
      const inline: Record<string, string> = {
        StrongEmphasis: 'md-strong',
        Emphasis: 'md-em',
        Strikethrough: 'md-strike',
        InlineCode: 'md-inline-code',
        Link: 'md-link',
      };
      if (inline[name]) marks.push(Decoration.mark({ class: inline[name] }).range(from, to));
      if (name === 'ListItem') {
        const first = state.doc.lineAt(from),
          last = state.doc.lineAt(to);
        const depth = Math.max(1, Math.floor((first.text.match(/^\s*/)?.[0].length ?? 0) / 2) + 1);
        for (let i = first.number; i <= last.number; i++)
          marks.push(
            Decoration.line({
              class: 'md-list-line',
              attributes: { style: `--list-depth:${depth}` },
            }).range(state.doc.line(i).from),
          );
        addLine(first.from, 'md-li-start');
        addLine(last.from, 'md-li-end');
      }
      if (name === 'Blockquote' || name === 'FencedCode') {
        const firstLine = state.doc.lineAt(from).number,
          lastLine = state.doc.lineAt(to).number;
        for (let i = firstLine; i <= lastLine; i++) {
          addLine(state.doc.line(i).from, name === 'Blockquote' ? 'md-quote-line' : 'md-code-line');
          if (name === 'FencedCode') codeLines.add(i);
        }
        if (name === 'Blockquote') addLine(state.doc.line(lastLine).from, 'md-quote-end');
      }
      if (name === 'ListMark' && inactive(from, to)) {
        const raw = state.doc.sliceString(from, to);
        marks.push(
          Decoration.replace({ widget: new ListBullet(/^\d/.test(raw) ? raw : '•') }).range(
            from,
            to,
          ),
        );
      } else if (name === 'HeaderMark')
        hide(from, state.doc.sliceString(to, to + 1) === ' ' ? to + 1 : to);
      else if (['EmphasisMark', 'CodeMark', 'LinkMark', 'StrikethroughMark'].includes(name))
        hide(from, to);
      else if (name === 'URL' && node.node.parent?.name === 'Link') hide(from, to);
      else if (name === 'QuoteMark') hide(from, to);
    },
  });
  // Paragraph margins mirror the preview: every <p> but the last gets a
  // bottom margin, and the first/last blocks drop their edge margins.
  for (const p of paragraphs)
    if (/\S/.test(state.doc.sliceString(p.to)))
      addLine(state.doc.lineAt(Math.max(p.from, p.to - 1)).from, 'md-para-end');
  let firstLine = 0,
    lastLine = 0;
  for (let n = 1; n <= state.doc.lines; n++)
    if (state.doc.line(n).text.trim()) {
      if (!firstLine) firstLine = n;
      lastLine = n;
    }
  if (firstLine) {
    addLine(state.doc.line(firstLine).from, 'md-first');
    addLine(state.doc.line(lastLine).from, 'md-last');
  }
  // Blank source lines are collapsed in the rendered preview; hide them too
  // (except inside code blocks or when the caret sits on them).
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    if (!line.text.trim() || codeLines.has(n)) continue;
    if (inactive(line.from, line.to)) marks.push(Decoration.replace({}).range(line.from, line.to));
  }
  for (const [from, classes] of lineClasses)
    marks.push(Decoration.line({ class: [...new Set(classes)].join(' ') }).range(from));
  return Decoration.set(marks, true);
}
export const liveMarkdown = StateField.define<DecorationSet>({
  create: previewDecorations,
  update(value, tr) {
    return tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state)
      ? previewDecorations(tr.state)
      : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});
