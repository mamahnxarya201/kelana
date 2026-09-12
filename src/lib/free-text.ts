/**
 * Free-text sizing engine.
 *
 * One dimension of a free-text box is "locked" by the user; the other
 * auto-fits the text exactly (never padded, never clipped):
 *  - no lock:        the box hugs the text (width = widest line, capped)
 *  - locked width:   height adjusts to the wrapped content
 *  - locked height:  width adjusts (binary search) so content fits inside
 *
 * Pure measurement + decision logic; the caller owns the placement object
 * (a Svelte $state proxy is fine — fields are assigned, never cloned) and
 * the DOM host element.
 */
import type { Placement } from './model';

export const FREE_TEXT_MIN_WIDTH = 40;
export const FREE_TEXT_MIN_HEIGHT = 24;
export const FREE_TEXT_MAX_WIDTH = 720;
/** Upper bound for width when fitting text into a locked height. */
export const FREE_TEXT_MAX_FIT_WIDTH = 2000;
/** Slack added to measured widths: rounding must never force a spurious wrap. */
const WIDTH_SLACK = 2;

/** Height of the content when the host is constrained to `width`. */
export function measureHeightAt(host: HTMLElement, width: number): number {
  host.style.width = `${Math.ceil(width)}px`;
  const height = host.scrollHeight;
  host.style.width = '';
  return height;
}

/** Width the content takes with no wrapping constraint. */
export function measureNaturalWidth(host: HTMLElement): number {
  host.style.width = 'max-content';
  const width = host.scrollWidth;
  host.style.width = '';
  return width + WIDTH_SLACK;
}

/** Height of the content laid out one line per block (no wrapping). */
export function measureNaturalHeight(host: HTMLElement): number {
  return measureHeightAt(host, measureNaturalWidth(host));
}

/** Minimal width whose content fits inside `height` (monotonic search). */
export function measureWidthForHeight(host: HTMLElement, height: number): number {
  const max = Math.max(FREE_TEXT_MIN_WIDTH, measureNaturalWidth(host));
  if (max <= FREE_TEXT_MIN_WIDTH || measureHeightAt(host, max) > height) return max;
  let lo = FREE_TEXT_MIN_WIDTH;
  let hi = max;
  while (hi - lo > 2) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measureHeightAt(host, mid) <= height) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * Fit `target` (a placement-like object) around the content in `host`.
 * `opts` may force a lock and/or a new value for the locked dimension;
 * otherwise the target's own lock (or legacy `autoWidth`) is honoured.
 */
export function fitFreeTextSize(
  target: Pick<Placement, 'width' | 'height' | 'locked' | 'autoWidth'>,
  host: HTMLElement,
  opts: { lock?: 'width' | 'height'; width?: number; height?: number } = {},
): void {
  const lock = opts.lock ?? target.locked ?? (target.autoWidth === false ? 'width' : undefined);
  if (lock === 'width') {
    target.width = Math.max(FREE_TEXT_MIN_WIDTH, Math.ceil(opts.width ?? target.width));
    target.height = Math.max(FREE_TEXT_MIN_HEIGHT, measureHeightAt(host, target.width));
  } else if (lock === 'height') {
    // Height is clamped between one line and the text's natural one-line height.
    const naturalHeight = measureNaturalHeight(host);
    target.height = Math.max(
      FREE_TEXT_MIN_HEIGHT,
      Math.min(naturalHeight, Math.ceil(opts.height ?? target.height)),
    );
    target.width = Math.max(
      FREE_TEXT_MIN_WIDTH,
      Math.min(FREE_TEXT_MAX_FIT_WIDTH, measureWidthForHeight(host, target.height)),
    );
  } else {
    const natural = measureNaturalWidth(host);
    target.width = Math.max(FREE_TEXT_MIN_WIDTH, Math.min(natural, FREE_TEXT_MAX_WIDTH));
    target.height = Math.max(FREE_TEXT_MIN_HEIGHT, measureHeightAt(host, target.width));
  }
}
