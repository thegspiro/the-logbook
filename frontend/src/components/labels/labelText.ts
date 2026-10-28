/**
 * Text styling shared by every printed label.
 *
 * The print iframe is a bare document that never loads the app's fonts, so
 * without a family a label prints in the browser default, Times. A serif's
 * hairlines are the first thing a 203 dpi thermal head drops at 6-7pt. The
 * stack names fonts already installed rather than a web font, which could
 * still be loading when the print dialog snapshots the page.
 */
import type React from 'react';

export const LABEL_FONT_FAMILY = 'Arial, Helvetica, "Liberation Sans", sans-serif';

/**
 * An item name on up to two lines, then an ellipsis. One line cut the part
 * that tells items apart: "Golf Shirt — XXL — Unisex Short Sleeve …" read the
 * same for the short- and long-sleeve variants on a 2" x 1" label.
 */
export function labelNameStyle(fontSize: string): React.CSSProperties {
  return {
    fontSize,
    fontWeight: 600,
    textAlign: 'center',
    lineHeight: 1.15,
    maxWidth: '100%',
    color: '#000',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 2,
    overflow: 'hidden',
    overflowWrap: 'anywhere',
    flexShrink: 0,
  };
}
