/**
 * What a lap is made of, and the rules for reading one.
 *
 * Separated from the components because these are the questions the form and
 * the reports both ask — "is this stop finished", "can this be bulk-confirmed"
 * — and because a file that exports both components and functions loses fast
 * refresh.
 */

import { CheckType, normalizeCheckType } from '@/modules/inventory/types/equipmentCheck';

import type { CheckItemAnswer, CheckItemSpec } from './CheckItemControls';

// ============================================================================
// Shape
// ============================================================================

/**
 * The seal on a sealed container, as the crew meets it.
 *
 * An intact tag is evidence that nobody has been inside since the last full
 * count, which is the entire reason a bag can be checked in seconds. Break it
 * and that evidence is gone.
 */
export interface SealState {
  status: 'intact' | 'broken';
  /** The tag currently on the seal. */
  tagNumber?: string | null | undefined;
  /** Displayed, never parsed — "02:41" or a full timestamp, as recorded. */
  brokenAt?: string | null | undefined;
  /** Where it was broken — "run 26-1188". */
  brokenNote?: string | null | undefined;
  /** The tag to apply when it is re-sealed. */
  replacementTagNumber?: string | null | undefined;
}

export interface LapStop {
  id: string;
  name: string;
  containerType?: string | null | undefined;
  /** This container is sealed in normal operation. */
  isSealed?: boolean | undefined;
  /** The seal as it stands right now, for a sealed container. */
  seal?: SealState | undefined;
  items: CheckItemSpec[];
  /** Pockets, for a bag. A stop with its own stops. */
  children?: LapStop[] | undefined;
}

/**
 * True when an intact seal is standing in for this container's contents count.
 *
 * A seal that matches the last count is proof nothing inside was *touched*, so
 * it clears the counting. It is **not** proof the contents are still usable:
 * expiry dates and pressure readings move on their own while the bag sits
 * shut, so those are still asked for. A seal proves unchanged, not full.
 *
 * (This mirrors `sealClearableIn` in EquipmentCheckForm, which is the reviewed
 * rule on main. An earlier version of this file skipped the whole container,
 * which would have hidden an expiring drug behind an intact tag.)
 */
export function contentsAreSealed(stop: LapStop): boolean {
  return Boolean(stop.isSealed) && stop.seal?.status !== 'broken';
}

/**
 * What an intact seal cannot vouch for, and therefore still has to be asked.
 *
 * Counts and pass/fails are cleared by the seal. A `level` is not — a cylinder
 * loses pressure whether or not anybody opened the bag — and neither is
 * anything with an expiry, whatever its type.
 */
export function sealCannotClear(items: CheckItemSpec[]): CheckItemSpec[] {
  return items.filter((i) => {
    const t = normalizeCheckType(i.checkType);
    if (t === CheckType.LEVEL || t === CheckType.EXPIRY) return true;
    return Boolean(i.expirationDate);
  });
}

export type AnswerMap = Record<string, CheckItemAnswer | undefined>;

// ============================================================================
// Helpers
// ============================================================================

/** Every item in this stop and its pockets. */
export function stopItems(stop: LapStop): CheckItemSpec[] {
  const nested = (stop.children ?? []).flatMap(stopItems);
  return [...stop.items, ...nested];
}

/** Items that ask a question — layout rows are not answered. */
export function answerableItems(stop: LapStop): CheckItemSpec[] {
  return stopItems(stop).filter((i) => {
    const t = normalizeCheckType(i.checkType);
    return t !== CheckType.HEADER && t !== CheckType.TEXT;
  });
}

/** Questions on this stop itself, not counting anything in its pockets. */
export function ownAnswerableItems(stop: LapStop): CheckItemSpec[] {
  return stop.items.filter((i) => {
    const t = normalizeCheckType(i.checkType);
    return t !== CheckType.HEADER && t !== CheckType.TEXT;
  });
}

export function isStopComplete(stop: LapStop, answers: AnswerMap): boolean {
  // An intact seal clears the counting inside, but not the expiry dates and
  // readings that move while the bag sits shut — so those still have to be
  // answered before the stop is finished.
  const items = contentsAreSealed(stop)
    ? [...ownAnswerableItems(stop), ...sealCannotClear(answerableItems(stop))]
    : answerableItems(stop);
  if (items.length === 0) return true;
  return items.every((i) => {
    const status = answers[i.id]?.status;
    return status !== undefined && status !== 'not_checked';
  });
}

export function stopFailures(stop: LapStop, answers: AnswerMap): CheckItemSpec[] {
  return answerableItems(stop).filter(
    (i) => answers[i.id]?.status === 'fail' || answers[i.id]?.status === 'out_of_service'
  );
}

/**
 * A level cannot be bulk-confirmed.
 *
 * "All good" is a claim the crew is making on the stop's behalf, and for a
 * pass/fail, a par count or a printed date they can make it from where they
 * are standing. A gauge reading is a number nobody has looked at — inventing
 * one is not a shortcut, it is a fabricated record on the one item type whose
 * whole purpose is the stored value.
 */
export function bulkConfirmable(items: CheckItemSpec[]): CheckItemSpec[] {
  return items.filter((i) => normalizeCheckType(i.checkType) !== CheckType.LEVEL);
}

/**
 * The bulk action's wording follows what the stop actually holds.
 *
 * A bag of counts reads "All at par"; a mixed stop reads "All good". The label
 * is the claim being made, so it should say the thing the crew is asserting.
 */
export function bulkLabel(items: CheckItemSpec[]): string {
  const confirmable = bulkConfirmable(items);
  if (confirmable.length === 0) return 'All good';
  const allCounts = confirmable.every((i) => normalizeCheckType(i.checkType) === CheckType.COUNT);
  return allCounts ? 'All at par' : 'All good';
}
