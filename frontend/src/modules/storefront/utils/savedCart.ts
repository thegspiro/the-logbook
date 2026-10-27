/**
 * Saved Store Cart
 *
 * W67-6, owner decision 2026-10-27: the cart is kept in this browser, per
 * member and per order window, so a reload or a phone discarding the tab does
 * not empty it.
 *
 * Only what identifies each line is kept — product, variant, personalization
 * and quantity. Names and prices are rebuilt from the current catalog when the
 * cart is restored, and a line whose product or variant is no longer offered
 * is dropped, so a saved cart can never show a stale price. A saved cart is
 * cleared when its order is placed, when its window is no longer open, and at
 * sign-out (see purgeLocalMemberData), because station computers are shared.
 */

import type { CartLine } from '../types';

const SAVED_CART_KEY_PREFIX = 'store-cart-';

export interface SavedCartLine {
  productId: string;
  variantId?: string | undefined;
  personalizationText?: string | undefined;
  quantity: number;
}

const keyFor = (memberId: string, windowId: string): string => `${SAVED_CART_KEY_PREFIX}${memberId}-${windowId}`;

const memberPrefix = (memberId: string): string => `${SAVED_CART_KEY_PREFIX}${memberId}-`;

const isSavedLine = (value: unknown): value is SavedCartLine => {
  if (typeof value !== 'object' || value === null) return false;
  const line = value as Record<string, unknown>;
  return (
    typeof line.productId === 'string' &&
    (line.variantId === undefined || typeof line.variantId === 'string') &&
    (line.personalizationText === undefined || typeof line.personalizationText === 'string') &&
    typeof line.quantity === 'number' &&
    Number.isInteger(line.quantity) &&
    line.quantity > 0
  );
};

/** Keep `cart` for this member and window; an empty cart removes the entry. */
export function saveCart(memberId: string, windowId: string, cart: CartLine[]): void {
  try {
    if (cart.length === 0) {
      localStorage.removeItem(keyFor(memberId, windowId));
      return;
    }
    const lines: SavedCartLine[] = cart.map((line) => ({
      productId: line.productId,
      variantId: line.variantId,
      personalizationText: line.personalizationText,
      quantity: line.quantity,
    }));
    localStorage.setItem(keyFor(memberId, windowId), JSON.stringify({ lines }));
  } catch {
    // Storage full, blocked or unavailable: the cart still works in memory.
  }
}

/** The saved lines for this member and window, or none. Malformed lines are skipped. */
export function loadSavedCart(memberId: string, windowId: string): SavedCartLine[] {
  try {
    const raw = localStorage.getItem(keyFor(memberId, windowId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    const lines = (parsed as { lines?: unknown } | null)?.lines;
    return Array.isArray(lines) ? lines.filter(isSavedLine) : [];
  } catch {
    return [];
  }
}

/** Remove this member's saved carts for every window not in `openWindowIds`. */
export function pruneSavedCarts(memberId: string, openWindowIds: string[]): void {
  try {
    const keep = new Set(openWindowIds.map((windowId) => keyFor(memberId, windowId)));
    const prefix = memberPrefix(memberId);
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix) && !keep.has(key)) localStorage.removeItem(key);
    }
  } catch {
    // As above.
  }
}

/**
 * Remove every saved cart on this device, whoever it belonged to.
 *
 * Called from the sign-out purge: a cart can carry the name a member asked to
 * have embroidered, and the browser profile is shared by whoever is on duty.
 */
export function clearAllSavedCarts(): number {
  let removed = 0;
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(SAVED_CART_KEY_PREFIX)) {
        localStorage.removeItem(key);
        removed += 1;
      }
    }
  } catch {
    // As above.
  }
  return removed;
}
