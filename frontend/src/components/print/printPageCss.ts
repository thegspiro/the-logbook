/**
 * The non-component half of the print-route page setup.
 *
 * Kept out of `PrintPageStyles.tsx` so that file exports a component and
 * nothing else — a module mixing the two disables Fast Refresh for it, which
 * ESLint's `react-refresh/only-export-components` rule flags.
 */

export interface PrintPageOptions {
  /**
   * `@page size`. Letter portrait unless a sheet genuinely needs the width —
   * the compliance grid is the only landscape one.
   */
  size?: string;
  /** `@page margin`, e.g. `'0.5in 0.6in'`. Per-sheet, so it is required. */
  margin: string;
}

/**
 * Marks the root element so the `html.print-preview` rule in `styles/index.css`
 * can swap the themed canvas for the print routes' neutral grey desk.
 *
 * It has to be the root. A background on `body` reaches the window only while
 * the root element's `background-image` is `none` and its `background-color` is
 * `transparent` (CSS Backgrounds & Borders §2.11.2), and `index.css` paints the
 * themed gradient on `html`.
 */
export const PRINT_PREVIEW_CLASS = 'print-preview';

/**
 * The sheet's own page box, as a string.
 *
 * Separated from the component so it can be asserted directly rather than by
 * digging the text back out of a rendered `<style>` node — which is what the
 * shared testing conventions exist to discourage.
 */
export function buildPrintPageCss({ size = 'letter', margin }: PrintPageOptions): string {
  return `@page { size: ${size}; margin: ${margin}; }\n@media print { body { margin: 0; padding: 0; } }`;
}
