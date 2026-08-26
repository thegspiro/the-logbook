/**
 * Backdrop selection for the embroidery preview swatch.
 *
 * The preview stands in for the garment, and the garment's color is not
 * something the store models — only the thread is. A fixed dark swatch worked
 * while the thread was always gold, and stops working the moment a
 * quartermaster picks black: black stitching on a near-black backdrop is an
 * empty box, which reads as "the preview is broken" rather than "you chose a
 * dark thread".
 *
 * So the backdrop is chosen against the thread: dark thread previews on a
 * light garment, light thread on a dark one. Both are plausible things a
 * department orders, and either way the member can read their own name.
 */

/** Relative luminance per WCAG 2.x, from a `#rrggbb` string. */
export const hexLuminance = (hex: string): number => {
  const normalized = hex.replace('#', '').trim();
  const full =
    normalized.length === 3
      ? normalized
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : normalized;

  if (!/^[0-9a-f]{6}$/i.test(full)) {
    // An unparseable value should not decide the layout; treat it as mid-tone
    // so the caller falls back to the historical dark swatch.
    return 0.5;
  }

  const channel = (offset: number): number => {
    const value = parseInt(full.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
};

/** Approximate luminance of the two candidate garment backdrops. */
const DARK_BACKDROP_LUMINANCE = 0.09;
const LIGHT_BACKDROP_LUMINANCE = 0.87;

const contrast = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * True when *hex* reads better on a light garment than a dark one.
 *
 * Compared rather than thresholded: a single cutoff put orange (luminance
 * 0.18, and so nominally "light") on the dark swatch at 1.7:1, which is
 * unreadable. Picking whichever backdrop actually contrasts more keeps the
 * rule correct if the palette is ever retuned or extended.
 */
export const needsLightBackdrop = (hex: string): boolean => {
  const thread = hexLuminance(hex);
  return contrast(thread, LIGHT_BACKDROP_LUMINANCE) > contrast(thread, DARK_BACKDROP_LUMINANCE);
};

/** Tailwind classes for the preview swatch, chosen against the thread color. */
export const threadPreviewSurface = (hex: string): string =>
  needsLightBackdrop(hex)
    ? 'border-slate-300 bg-slate-100 dark:border-slate-400 dark:bg-slate-200'
    : 'border-slate-700 bg-slate-800 dark:border-slate-600';

/** Class for the "Preview" caption, legible on whichever backdrop was chosen. */
export const threadPreviewCaption = (hex: string): string =>
  needsLightBackdrop(hex) ? 'text-slate-600' : 'text-slate-300';

/** Surface for an engraved preview — cut into metal, so no thread colour.
 *
 *  Rendered as dark lettering on a pale brushed-metal ground rather than in a
 *  colour: an engraver removes material, and showing coloured text would imply
 *  a thread the vendor is not being sent.
 */
export const ENGRAVED_SURFACE =
  'border-slate-400 bg-gradient-to-b from-slate-200 to-slate-300 dark:border-slate-500 dark:from-slate-300 dark:to-slate-400';

/** Lettering colour for an engraved preview — reads as a cut, not a stitch. */
export const ENGRAVED_TEXT = '#3f3f46';

/** Caption colour legible on the engraved ground. */
export const ENGRAVED_CAPTION = 'text-slate-600';
