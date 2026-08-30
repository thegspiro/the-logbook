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

import { daysUntil } from '@/modules/scheduling/types/equipmentCheck';

import type { CheckItemAnswer, CheckItemSpec } from './CheckItemControls';

/**
 * What answering an item stores, independent of what it looks like.
 *
 * Extracted because the sweep lays these four types out differently — a tally
 * table, a gauge card, a verdict pair — while asking exactly the same
 * questions. Two layouts each carrying their own copy of "an expired unit fails
 * whatever the crew taps" is two chances to lose it, and the one that shipped
 * would be whichever the crew happened to be looking at.
 *
 * The controls below call these too, so the pair cannot drift.
 */
export function countAnswer(item: CheckItemSpec, next: number): Partial<CheckItemAnswer> {
  const par = item.expectedQuantity ?? null;
  const value = Math.max(0, next);
  return {
    quantityFound: value,
    // Counting is answering. Short of par does not fail the item; it raises a
    // restock line, which is a different queue with a different urgency.
    status: 'pass',
    restockNeeded: par !== null && value < par,
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
