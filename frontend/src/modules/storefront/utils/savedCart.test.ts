import { describe, it, expect, beforeEach } from 'vitest';
import { clearAllSavedCarts, loadSavedCart, pruneSavedCarts, saveCart } from './savedCart';
import type { CartLine } from '../types';

const line = (overrides: Partial<CartLine> = {}): CartLine => ({
  productId: 'p1',
  productName: 'Job Shirt',
  unitPrice: 45,
  quantity: 2,
  isTaxable: false,
  ...overrides,
});

describe('savedCart', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps only what identifies each line, not its name or price', () => {
    saveCart('m1', 'w1', [line({ variantId: 'v-l', personalizationText: 'SMITH' })]);

    expect(JSON.parse(localStorage.getItem('store-cart-m1-w1') ?? '{}')).toEqual({
      lines: [{ productId: 'p1', variantId: 'v-l', personalizationText: 'SMITH', quantity: 2 }],
    });
    expect(loadSavedCart('m1', 'w1')).toEqual([
      { productId: 'p1', variantId: 'v-l', personalizationText: 'SMITH', quantity: 2 },
    ]);
  });

  it('is kept per member and per window', () => {
    saveCart('m1', 'w1', [line()]);

    expect(loadSavedCart('m2', 'w1')).toEqual([]);
    expect(loadSavedCart('m1', 'w2')).toEqual([]);
  });

  it('removes the entry when the cart is emptied', () => {
    saveCart('m1', 'w1', [line()]);
    saveCart('m1', 'w1', []);

    expect(localStorage.getItem('store-cart-m1-w1')).toBeNull();
  });

  it('skips malformed lines and survives malformed JSON', () => {
    localStorage.setItem(
      'store-cart-m1-w1',
      JSON.stringify({ lines: [{ productId: 'p1', quantity: 0 }, { productId: 7 }, { productId: 'p2', quantity: 1 }] })
    );
    expect(loadSavedCart('m1', 'w1')).toEqual([{ productId: 'p2', quantity: 1 }]);

    localStorage.setItem('store-cart-m1-w1', '{not json');
    expect(loadSavedCart('m1', 'w1')).toEqual([]);
  });

  it("prunes a member's carts for windows that are no longer open, and nobody else's", () => {
    saveCart('m1', 'w1', [line()]);
    saveCart('m1', 'w-closed', [line()]);
    saveCart('m2', 'w-closed', [line()]);

    pruneSavedCarts('m1', ['w1']);

    expect(localStorage.getItem('store-cart-m1-w1')).not.toBeNull();
    expect(localStorage.getItem('store-cart-m1-w-closed')).toBeNull();
    expect(localStorage.getItem('store-cart-m2-w-closed')).not.toBeNull();
  });

  it('clears every saved cart on the device and nothing else', () => {
    saveCart('m1', 'w1', [line()]);
    saveCart('m2', 'w2', [line()]);
    localStorage.setItem('has_session', '1');

    expect(clearAllSavedCarts()).toBe(2);
    expect(localStorage.getItem('store-cart-m1-w1')).toBeNull();
    expect(localStorage.getItem('store-cart-m2-w2')).toBeNull();
    expect(localStorage.getItem('has_session')).toBe('1');
  });
});
