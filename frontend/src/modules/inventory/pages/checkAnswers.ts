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
  const value = Math.max(0, next);
  const short = par !== null && value < par;
  return {
    quantityFound: value,
    /*
     * A count short of par is recorded as a failure.
     *
     * This used to store `pass`, on the reasoning that a restock is not a
     * fault. That reasoning never reached a crew: the only screen holding it
     * was `CountControl`, which nothing rendered, while the accordion stores
     * `fail` and `EquipmentCheckService._compute_check_status` rewrites any
     * `quantity_found < required_quantity` to `fail` regardless of what is
     * sent. Storing `pass` here told a crew the truck had no fault immediately
     * before the saved report gave it one.
     *
     * The distinction the design asks for is kept where it belongs — in what
     * the sweep *reports*. `stopRestocks` derives a shortfall from the number
     * and the par, and `stopFailures` leaves it out, so a short count is a
     * restock line on screen and a failure on the record.
     */
    status: short ? 'fail' : 'pass',
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
