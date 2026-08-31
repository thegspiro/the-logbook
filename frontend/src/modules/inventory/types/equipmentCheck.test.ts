import { describe, it, expect } from 'vitest';
import {
  containerTypeLabel,
  countedOnTruck,
  daysUntil,
  isPresetContainerType,
  submitterMaySwap,
} from './equipmentCheck';

describe('containerTypeLabel', () => {
  it('maps known preset keys to their display label', () => {
    expect(containerTypeLabel('bag')).toBe('Bag');
    expect(containerTypeLabel('pack')).toBe('Pack');
    expect(containerTypeLabel('compartment')).toBe('Compartment');
  });

  it('returns a custom label verbatim', () => {
    expect(containerTypeLabel('Trauma Kit')).toBe('Trauma Kit');
  });

  it('falls back to Compartment when empty or missing', () => {
    expect(containerTypeLabel('')).toBe('Compartment');
    expect(containerTypeLabel(undefined)).toBe('Compartment');
    expect(containerTypeLabel(null)).toBe('Compartment');
  });
});

describe('isPresetContainerType', () => {
  it('is true for preset keys and empty (default) values', () => {
    expect(isPresetContainerType('bag')).toBe(true);
    expect(isPresetContainerType('')).toBe(true);
    expect(isPresetContainerType(undefined)).toBe(true);
  });

  it('is false for a custom label', () => {
    expect(isPresetContainerType('Trauma Kit')).toBe(false);
  });
});

describe('daysUntil', () => {
  // Moved here from CheckItemControls.test.tsx when the four controls were
  // deleted. The function outlived them: expiryUrgency, the sweep's expiry row
  // and the seal-blocker rule all count days with it.
  it('returns null for a missing or unparseable date', () => {
    expect(daysUntil(null, new Date())).toBeNull();
    expect(daysUntil('not-a-date', new Date())).toBeNull();
  });

  it('is zero on the day itself', () => {
    const today = new Date(2026, 7, 23);
    expect(daysUntil('2026-08-23', today)).toBe(0);
  });

  it('is negative once past', () => {
    const today = new Date(2026, 7, 23);
    expect(daysUntil('2026-08-20', today)).toBe(-3);
  });
});

describe('submitterMaySwap', () => {
  // The rule this mirrors lives in EquipmentCheckService.swap_item_lot. Each
  // case below is a branch of it, named by what the server does there.

  it('allows an expired position, which goes through the disposition path', () => {
    // That branch's ceiling is the expired units aboard, not a shortfall — so
    // replacing a drug that has gone out of date is always a submitter's to do.
    expect(submitterMaySwap(true, null, null)).toBe(true);
    expect(submitterMaySwap(true, 4, 4)).toBe(true);
  });

  it('refuses a position with no counted target', () => {
    // `_target_quantity` is null, so the no-disposition ceiling is zero and
    // every quantity exceeds it. This is the expiry-only row.
    expect(submitterMaySwap(false, null, null)).toBe(false);
    expect(submitterMaySwap(false, null, 2)).toBe(false);
  });

  it('allows a counted position that is genuinely short', () => {
    expect(submitterMaySwap(false, 4, 1)).toBe(true);
  });

  it('refuses a counted position that is full', () => {
    expect(submitterMaySwap(false, 4, 4)).toBe(false);
    expect(submitterMaySwap(false, 4, 6)).toBe(false);
  });

  it('reads an uncounted position as stocked, not as empty', () => {
    // `_on_truck` falls back to the target when there is no live count and no
    // lots aboard: nobody has counted since the position was defined, which is
    // not the same as an empty bracket. Zero here would invent a shortfall the
    // server will not find, and the swap it enables comes back 403.
    expect(submitterMaySwap(false, 4, null)).toBe(false);
  });
});

describe('countedOnTruck', () => {
  const item = (over: Record<string, unknown>) =>
    ({
      id: 'i',
      compartmentId: 'c',
      name: 'X',
      sortOrder: 0,
      isRequired: true,
      hasExpiration: false,
      expirationWarningDays: 30,
      checkType: 'count',
      ...over,
    }) as never;

  it('prefers the lots aboard, which carry actual units and actual dates', () => {
    // The scalar and the lots can disagree; the lots are the count of real
    // boxes, so keeping the scalar authoritative would let the two drift.
    expect(
      countedOnTruck(
        item({
          quantityOnTruck: 9,
          lotsAboard: [
            { id: 'a', quantity: 2, isExpired: false },
            { id: 'b', quantity: 3, isExpired: false },
          ],
        })
      )
    ).toBe(5);
  });

  it('falls back to the scalar count where no lots are aboard', () => {
    expect(countedOnTruck(item({ quantityOnTruck: 7 }))).toBe(7);
  });

  it('reports null when nothing has been counted, leaving the fallback to the caller', () => {
    expect(countedOnTruck(item({}))).toBeNull();
  });
});
