/**
 * Highlight palette shared by the PDF selection menu, the page overlay, and the
 * annotation card the passage becomes. Ids reuse the entity color names, so a
 * highlight keeps its identity after it lands on the board.
 */
export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple' | 'orange';

export const HIGHLIGHT_COLORS: {
  id: HighlightColor;
  label: string;
  swatch: string;
  tint: string;
}[] = [
  { id: 'yellow', label: 'Yellow', swatch: '#ffd83d', tint: '#ffd83d80' },
  { id: 'green', label: 'Green', swatch: '#7ad97c', tint: '#7ad97c80' },
  { id: 'blue', label: 'Blue', swatch: '#7fb0ff', tint: '#7fb0ff80' },
  { id: 'pink', label: 'Pink', swatch: '#ff9dc0', tint: '#ff9dc080' },
  { id: 'purple', label: 'Purple', swatch: '#bf9df2', tint: '#bf9df280' },
  { id: 'orange', label: 'Orange', swatch: '#ffb45e', tint: '#ffb45e80' },
];

export const DEFAULT_HIGHLIGHT: HighlightColor = 'yellow';

export function highlightColor(color: string | undefined) {
  return HIGHLIGHT_COLORS.find((c) => c.id === color) ?? HIGHLIGHT_COLORS[0];
}

/** Page overlay fill for a passage: translucent so the page text stays legible. */
export function highlightTint(color: string | undefined) {
  return highlightColor(color).tint;
}

/** Full-strength dot used in the passage list and the drop preview. */
export function highlightSwatch(color: string | undefined) {
  return highlightColor(color).swatch;
}
