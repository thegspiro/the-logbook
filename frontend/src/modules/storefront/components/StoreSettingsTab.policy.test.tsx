import { describe, it, expect } from 'vitest';

import { PAYMENT_POLICY_OPTIONS, StorePaymentPolicy } from '../types';

/**
 * The policy picker is a comparison table, not a dropdown, because a
 * quartermaster chooses it before any catalog exists. These guard the thing
 * that makes it useful: every rule states both consequences, in the same
 * words, so they can be read against each other.
 */
describe('payment policy options', () => {
  it('covers every policy the backend accepts, in increasing strictness', () => {
    expect(PAYMENT_POLICY_OPTIONS.map((o) => o.value)).toEqual([
      StorePaymentPolicy.NONE,
      StorePaymentPolicy.BEFORE_PICKUP,
      StorePaymentPolicy.BEFORE_VENDOR_ORDER,
    ]);
  });

  it('answers both questions for every rule', () => {
    for (const option of PAYMENT_POLICY_OPTIONS) {
      for (const field of ['label', 'summary', 'vendorOrder', 'pickup', 'suits'] as const) {
        expect(option[field].length).toBeGreaterThan(0);
      }
    }
  });

  it('uses a consistent vocabulary so the rules can be compared', () => {
    // Two rules share a pickup answer and two share a vendor answer; if the
    // wording drifted apart the table would stop reading as a comparison.
    const vendor = PAYMENT_POLICY_OPTIONS.map((o) => o.vendorOrder);
    const pickup = PAYMENT_POLICY_OPTIONS.map((o) => o.pickup);

    expect(vendor).toEqual(['Ordered', 'Ordered', 'Not ordered']);
    expect(pickup).toEqual(['Can collect', 'Held until paid', 'Held until paid']);
  });

  it('describes who each rule suits, distinctly', () => {
    const suits = PAYMENT_POLICY_OPTIONS.map((o) => o.suits);
    expect(new Set(suits).size).toBe(suits.length);
  });
});
