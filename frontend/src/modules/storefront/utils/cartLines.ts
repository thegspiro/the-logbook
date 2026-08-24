/**
 * Cart line identity and display.
 */

import type { CartLine } from '../types';

/** Two lines are the same line only if product, variant AND personalization
 *  match — the store's own rule, so a React key has to carry all three or a
 *  shirt reading "SMITH" and one reading "JONES" collide. */
export const cartLineKey = (line: CartLine): string =>
  `${line.productId}-${line.variantId ?? ''}-${line.personalizationText ?? ''}`;

/** The one-line description under a cart line's name. */
export const cartLineMeta = (line: CartLine): string =>
  [
    line.variantLabel ? `Size ${line.variantLabel}` : null,
    line.personalizationText ? `Embroidered “${line.personalizationText}”` : null,
  ]
    .filter(Boolean)
    .join(' · ');
