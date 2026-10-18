/**
 * What answering an item stores, independent of what it looks like.
 *
 * Its own module rather than a corner of `CheckItemControls`, for the reason
 * that file's neighbour already states: a file exporting both components and
 * functions loses fast refresh, and the linter says so.
 *
 * Extracted because the sweep lays these four types out differently — a tally
 * table, a gauge card, a verdict pair — while asking exactly the same
 * questions. Two layouts each carrying their own copy of "an expired unit fails
 * whatever the crew taps" is two chances to lose it, and the one that shipped
 * would be whichever the crew happened to be looking at.
 */

import { daysUntil } from '@/modules/inventory/types/equipmentCheck';

import type { CheckItemAnswer, CheckItemSpec } from './CheckItemControls';

/** The controls call these too, so the two layouts cannot drift apart. */
export function countAnswer(item: CheckItemSpec, next: number): Partial<CheckItemAnswer> {
  const par = item.expectedQuantity ?? null;
  const floor = item.passFloor ?? null;
  const value = Math.max(0, next);
  const short = par !== null && value < par;
  return {
    quantityFound: value,
    /*
     * Two numbers, two questions (department decision, 2026-10-16). The pass
     * floor — Min to Pass, else Critical Min — decides the verdict, exactly
     * as `EquipmentCheckService._pass_floor` does, so the sweep never offers
     * a pass the server refuses. Par decides the restock: short of par alone
     * passes, and `stopRestocks` lists it as a supply line.
     */
    status: floor !== null && value < floor ? 'fail' : 'pass',
    restockNeeded: short,
  };
}

export function levelAnswer(item: CheckItemSpec, raw: string): Partial<CheckItemAnswer> {
  const threshold = item.minLevel ?? null;
  // An emptied box is "not read yet", not zero. Coercing it to 0 would report
  // an empty cylinder and open a swap task for a gauge nobody has looked at.
  const next = raw === '' ? undefined : Number(raw);
  return {
    levelReading: next,
    status: next === undefined ? 'not_checked' : threshold !== null && next < threshold ? 'fail' : 'pass',
  };
}

export function expiryAnswer(item: CheckItemSpec, today = new Date()): Partial<CheckItemAnswer> {
  const days = daysUntil(item.expirationDate, today);
  return {
    expiryConfirmed: true,
    // An expired unit is a failure whatever the crew confirms — the
    // department's own record says the thing aboard is out of date, and
    // confirming that you read it does not make it usable.
    status: days !== null && days < 0 ? 'fail' : 'pass',
  };
}

/** Withdraws a replacement date, leaving the line to be answered again. */
export const CLEARED_REPLACEMENT: Partial<CheckItemAnswer> = {
  expirationFound: undefined,
  lotFound: undefined,
  expiryConfirmed: false,
  status: 'not_checked',
};

/**
 * Dating the replacement a crew put in on a line nothing else tracks.
 *
 * The new unit is what is aboard now, so an accepted date passes the line —
 * the replaced box is the one that expired, not this one. `null` for a date
 * that has already passed, which the server refuses: storing it would only
 * move the refusal to submit, after the box is back in the cabinet.
 */
export function replacementAnswer(date: string, lot: string, today = new Date()): Partial<CheckItemAnswer> | null {
  if (!date) return CLEARED_REPLACEMENT;
  const days = daysUntil(date, today);
  if (days === null || days < 0) return null;
  return { expirationFound: date, lotFound: lot.trim() || undefined, expiryConfirmed: true, status: 'pass' };
}
