/**
 * The amount range of an approval chain, as typed into the form.
 *
 * Both ends are inclusive, and an amount that fits two chains uses the one
 * with the higher minimum (backend `pick_approval_chain`), so a chain "up to
 * $500" and one "$500 and over" never compete for exactly $500.00. A blank end
 * is open; a range whose minimum is above its maximum can match nothing.
 */

import { MAX_MONEY_AMOUNT, MAX_MONEY_MESSAGE } from './moneyLimits';

export const CHAIN_RANGE_HINT =
  'Both ends are included. An amount that fits two chains goes to the one with the higher minimum.';

/** The message for a range the form should not send, or null when it is fine. */
export function chainRangeError(minAmount: string, maxAmount: string): string | null {
  const low = minAmount.trim() === '' ? null : Number(minAmount);
  const high = maxAmount.trim() === '' ? null : Number(maxAmount);

  for (const value of [low, high]) {
    if (value === null) continue;
    if (!Number.isFinite(value) || value < 0) return 'Amounts must be zero or more.';
    if (value > MAX_MONEY_AMOUNT) return MAX_MONEY_MESSAGE;
  }
  if (low !== null && high !== null && low > high) {
    return 'The minimum amount cannot be above the maximum amount.';
  }
  return null;
}
