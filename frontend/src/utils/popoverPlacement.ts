/**
 * Where an anchored popover opens, and how big it may be, so the whole panel
 * stays on screen.
 *
 * A popover fixed to one side of its trigger can leave the viewport, and the
 * part that does may be unreachable. One that opens upward from a trigger near
 * the top of a short page runs past the top edge: the page is already at its
 * top, and scrolling the panel's own contents only moves them further up. One
 * right-aligned to a trigger that wraps to the left of a phone screen hangs
 * off the left edge, which does not scroll at all. The Ballot Builder's
 * template picker did both once the ballot became its own page, and its
 * heading and saved templates could not be reached.
 *
 * Vertically, the side with more room wins and the panel is capped to that
 * room, scrolling inside. When neither side has a usable amount of room it
 * opens downward: overflow below the trigger extends the page, which can be
 * scrolled, while overflow above the top edge cannot. Horizontally, it lines
 * up with the trigger's right edge where that fits and is shifted just enough
 * to keep both edges inside the viewport where it does not.
 */

export interface PopoverPlacement {
  side: 'above' | 'below';
  /** Pixels; apply as the panel's max-height, with its overflow scrolling. */
  maxHeight: number;
  /** Pixels; the panel's width, no wider than the viewport allows. */
  width: number;
  /** Pixels from the trigger's left edge to the panel's; apply as `left`. */
  offsetLeft: number;
}

/** Between trigger and panel; matches the panel's `mt-2` / `mb-2`. */
const GAP_PX = 8;
/** Kept clear between the panel and the viewport edge. */
const EDGE_PX = 16;
/** Below this the panel is too short to use, so it opens downward regardless. */
export const MIN_POPOVER_HEIGHT_PX = 160;

interface TriggerRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export function placePopover(
  trigger: TriggerRect,
  viewport: { width: number; height: number },
  options: { preferredWidth: number; topInset?: number; bottomInset?: number; maxFraction?: number }
): PopoverPlacement {
  const { preferredWidth, topInset = 0, bottomInset = 0, maxFraction = 0.7 } = options;

  const above = trigger.top - topInset - GAP_PX - EDGE_PX;
  const below = viewport.height - bottomInset - trigger.bottom - GAP_PX - EDGE_PX;
  const side = above > below && above >= MIN_POPOVER_HEIGHT_PX ? 'above' : 'below';
  const room = Math.max(side === 'above' ? above : below, MIN_POPOVER_HEIGHT_PX);
  const maxHeight = Math.floor(Math.min(room, viewport.height * maxFraction));

  const width = Math.floor(Math.max(0, Math.min(preferredWidth, viewport.width - 2 * EDGE_PX)));
  const rightAligned = trigger.right - width;
  const left = Math.min(Math.max(rightAligned, EDGE_PX), viewport.width - EDGE_PX - width);

  return { side, maxHeight, width, offsetLeft: Math.round(left - trigger.left) };
}

/**
 * A CSS length as pixels, for the `px` and `rem` values the app's layout
 * variables use. Anything else, or nothing, reads as zero.
 */
export function cssLengthToPx(value: string, rootFontSizePx: number): number {
  const trimmed = value.trim();
  const number = Number.parseFloat(trimmed);
  if (!Number.isFinite(number)) return 0;
  if (trimmed.endsWith('rem')) return number * rootFontSizePx;
  if (trimmed.endsWith('px')) return number;
  return 0;
}

/** Pixels in one rem on this page. */
export function rootFontSizePx(): number {
  const size = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(size) ? size : 16;
}

/**
 * How far down the viewport the app's fixed phone header reaches, status-bar
 * inset included. Zero where it is not drawn (768px and wider).
 *
 * Measured from the element rather than read from `--mobile-header-height`:
 * that variable is set at every width, including the ones where the header is
 * hidden, so it cannot say whether anything is covering the top of the screen.
 */
export function fixedHeaderInset(): number {
  const header = document.querySelector<HTMLElement>('header[role="banner"]');
  if (!header) return 0;
  const style = getComputedStyle(header);
  if (style.position !== 'fixed' || style.display === 'none') return 0;
  return Math.max(0, header.getBoundingClientRect().bottom);
}

/**
 * The mobile bottom bar's height, which covers the foot of the viewport (see
 * CLAUDE.md pitfall #21). Zero where the bar is not drawn. The variable is set
 * in rem, so it is converted rather than read as a bare number.
 */
export function bottomNavInset(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--bottom-nav-height');
  return cssLengthToPx(raw, rootFontSizePx());
}
