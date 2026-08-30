/**
 * What a lap is made of, and the rules for reading one.
 *
 * Separated from the components because these are the questions the form and
 * the reports both ask — "is this stop finished", "can this be bulk-confirmed"
 * — and because a file that exports both components and functions loses fast
 * refresh.
 */

import { CheckType, normalizeCheckType } from '@/modules/scheduling/types/equipmentCheck';

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

// ============================================================================
// The sweep
// ============================================================================

/**
 * The claim the bulk button is making, said out loud.
 *
 * `bulkLabel` answers "at par or good"; the sweep puts the button at the top of
 * a stop the crew has not read yet, so it also has to say *how many* items it
 * speaks for. "All 4 counts at par" is a claim somebody can check against the
 * cabinet in front of them; "All good" over four items is a button.
 *
 * The wording follows the contents for the same reason `bulkLabel` does — never
 * "All good" over a gauge, because a gauge is not bulk-confirmable at all and
 * the count here excludes it.
 */
export interface BulkClaim {
  /** Exactly the items the button answers. */
  items: CheckItemSpec[];
  label: string;
}

export function bulkClaim(items: CheckItemSpec[]): BulkClaim | null {
  // A printed date is excluded on top of `bulkConfirmable`'s exclusion of
  // gauges, and for the same reason one step softer: it is read off the object
  // in your hand, so claiming it for a whole cabinet is inventing a reading —
  // just cheaper to get away with. `bulkConfirmable` itself is left alone
  // because it is the lap's reviewed rule; this is the sweep's claim, and the
  // handoff's own cabinet screen puts "All 4 counts at par" over four counts
  // and one date, with the date still holding its own Confirm.
  const claimable = bulkConfirmable(items).filter((i) => normalizeCheckType(i.checkType) !== CheckType.EXPIRY);
  if (claimable.length === 0) return null;
  const n = claimable.length;
  const types = new Set(claimable.map((i) => normalizeCheckType(i.checkType)));
  const label =
    types.size === 1
      ? [...types][0] === CheckType.COUNT
        ? `All ${n} count${n === 1 ? '' : 's'} at par`
        : `All ${n} work`
      : `All ${n} good`;
  return { items: claimable, label };
}

/**
 * Items short of par: a restock line, not a failure.
 *
 * Kept apart from `stopFailures` because they are different consequences — one
 * takes the truck out of service, the other adds a line to a supply order — and
 * the finish screen reports them separately. A count with no answer is neither;
 * it is unanswered.
 */
export function stopRestocks(stop: LapStop, answers: AnswerMap): CheckItemSpec[] {
  return answerableItems(stop).filter((i) => {
    if (normalizeCheckType(i.checkType) !== CheckType.COUNT) return false;
    const found = answers[i.id]?.quantityFound;
    if (found === undefined) return false;
    const par = i.expectedQuantity;
    return typeof par === 'number' && found < par;
  });
}

/** Gauges still to read. A stop holding one cannot be finished by a bulk claim. */
export function unreadGauges(stop: LapStop, answers: AnswerMap): CheckItemSpec[] {
  return answerableItems(stop).filter((i) => {
    if (normalizeCheckType(i.checkType) !== CheckType.LEVEL) return false;
    const a = answers[i.id];
    return a?.levelReading === undefined && (a?.status === undefined || a.status === 'not_checked');
  });
}

/**
 * What a stop still owes an answer for, under the sweep.
 *
 * Deliberately **not** `isStopComplete`'s set, and the difference is not a
 * refinement — it is a different modelling of the same rule, and picking the
 * wrong one either hides an expiring drug or asks a crew to count through an
 * intact seal.
 *
 * `isStopComplete` unions in `ownAnswerableItems`, because the lap models a
 * bag's tag confirmation as an item sitting on the stop: the tag line stays
 * asked, the pockets are cleared. The sweep is wired into `EquipmentCheckForm`,
 * where the tag is separate seal state and never an item — so the set here is
 * exactly `sealClearableIn`'s complement, the reviewed rule on main: a seal
 * clears a `function` or `count` that does not expire, wherever it sits, and
 * clears nothing else. A sealed container holding items directly, with no
 * pockets, is the case the two disagree on, and it is the case the design's
 * sealed drug box is made of.
 */
export function stillAsked(stop: LapStop): CheckItemSpec[] {
  return contentsAreSealed(stop) ? sealCannotClear(answerableItems(stop)) : answerableItems(stop);
}

/** `isStopComplete` for the sweep, over the set the sweep actually asks. */
export function stopSwept(stop: LapStop, answers: AnswerMap): boolean {
  return stillAsked(stop).every((i) => {
    const status = answers[i.id]?.status;
    return status !== undefined && status !== 'not_checked';
  });
}

export type StopMapState = 'complete' | 'fault' | 'restock' | 'untouched';

/**
 * What one segment of the truck map is saying.
 *
 * The strip is read at a glance while walking, so the states are ranked by what
 * the crew has to act on rather than by how far through the stop they are: a
 * fault outranks a restock, and both outrank finished. A stop part-answered
 * with nothing wrong reads as untouched — the strip answers "what is left",
 * and a stop with items still to answer is left.
 */
export function stopMapState(stop: LapStop, answers: AnswerMap): StopMapState {
  if (stopFailures(stop, answers).length > 0) return 'fault';
  if (stopRestocks(stop, answers).length > 0) return 'restock';
  return stopSwept(stop, answers) ? 'complete' : 'untouched';
}

/** Answered questions on a stop, for the map's per-stop progress. */
export function stopAnswered(stop: LapStop, answers: AnswerMap): number {
  return answerableItems(stop).filter((i) => {
    const a = answers[i.id];
    if (a === undefined) return false;
    return a.status !== undefined && a.status !== 'not_checked';
  }).length;
}

export interface SweepException {
  item: CheckItemSpec;
  /** 1-based, because it is shown to the crew as "Go to stop 7". */
  stopNumber: number;
  stopName: string;
}

export interface SweepSummary {
  faults: SweepException[];
  unanswered: SweepException[];
  restocks: SweepException[];
  /** Everything answered with nothing to report — one line, not a list. */
  goodCount: number;
  answeredCount: number;
  totalCount: number;
}

/**
 * The finish screen, exceptions first.
 *
 * A crew that has just walked 130 items does not need to read 130 lines back.
 * What is left to decide is the handful that went wrong, so those are listed
 * and everything else is accounted for in a single line. The stop number rides
 * along with each exception because the only useful action on an unanswered
 * item is going back to where it is.
 */
export function sweepSummary(stops: LapStop[], answers: AnswerMap): SweepSummary {
  const faults: SweepException[] = [];
  const unanswered: SweepException[] = [];
  const restocks: SweepException[] = [];
  let answeredCount = 0;
  let totalCount = 0;

  stops.forEach((stop, index) => {
    const at = (item: CheckItemSpec): SweepException => ({
      item,
      stopNumber: index + 1,
      stopName: stop.name,
    });
    const failed = new Set(stopFailures(stop, answers).map((i) => i.id));
    const short = new Set(stopRestocks(stop, answers).map((i) => i.id));
    // A sealed container's cleared contents are answered by the tag, so they
    // are neither unanswered nor in the total the crew is accountable for.
    const asked = stillAsked(stop);

    totalCount += asked.length;
    asked.forEach((item) => {
      const status = answers[item.id]?.status;
      const isAnswered = status !== undefined && status !== 'not_checked';
      if (isAnswered) answeredCount += 1;
      if (failed.has(item.id)) faults.push(at(item));
      else if (short.has(item.id)) restocks.push(at(item));
      else if (!isAnswered) unanswered.push(at(item));
    });
  });

  return {
    faults,
    unanswered,
    restocks,
    goodCount: answeredCount - faults.length - restocks.length,
    answeredCount,
    totalCount,
  };
}
