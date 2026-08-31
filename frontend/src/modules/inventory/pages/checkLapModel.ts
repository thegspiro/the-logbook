/**
 * What a lap is made of, and the rules for reading one.
 *
 * Separated from the components because these are the questions the form and
 * the reports both ask — "is this stop finished", "can this be bulk-confirmed"
 * — and because a file that exports both components and functions loses fast
 * refresh.
 */

import { CheckType, daysUntil, normalizeCheckType } from '@/modules/inventory/types/equipmentCheck';

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
  /**
   * Absent until the crew has actually read the tag.
   *
   * The numbers below come off the record and are on screen before anyone has
   * looked, so the status is the crew's answer rather than the container's
   * description — `isSealed` already says the container is a sealed one.
   */
  status?: 'intact' | 'broken' | undefined;
  /**
   * Whether the tag is standing in for the contents count. Defaults to true
   * for an intact tag.
   *
   * False for an intact tag whose number is not the number on record. That is
   * not a broken seal — the tag is physically fine — but it is not evidence
   * either: an unrecognised number is evidence the container was opened, not
   * evidence it was not, so the count still has to be done. The sweep's own
   * two buttons never produce this state; a draft resumed from the accordion,
   * which asks the fuller question, can.
   */
  cleared?: boolean | undefined;
  /** The tag currently on the seal. */
  tagNumber?: string | null | undefined;
  /**
   * Whether the last recorded check found this seal intact.
   *
   * Only a tag matching an *intact* prior seal is evidence the container
   * stayed shut. A container with no tag on record has nothing to match
   * against, and one whose last check recorded a broken seal was open since —
   * in both cases the crew can still say the tag in their hand is intact, and
   * it still clears nothing.
   */
  priorIntact?: boolean | undefined;
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
 * And it stops standing in entirely once something inside has to come out —
 * see `sealBlockers`.
 *
 * (The clearing rule mirrors `sealClearableIn` in EquipmentCheckForm, which is
 * the reviewed rule on main. An earlier version of this file skipped the whole
 * container, which would have hidden an expiring drug behind an intact tag.)
 */
export function contentsAreSealed(stop: LapStop, today: Date = new Date()): boolean {
  // `=== 'intact'`, not `!== 'broken'`: an absent seal means nobody has read
  // the tag yet, and the earlier form cleared the counting for a crew that had
  // not looked at it — the one thing a seal is supposed to be evidence of.
  if (!stop.isSealed || stop.seal?.status !== 'intact' || stop.seal.cleared === false) return false;
  // An intact tag stops standing in for the contents the moment something
  // inside has to come out: the crew is going in regardless, and once the
  // container is open the seal is no longer evidence of anything.
  return sealBlockers(stop, today).length === 0;
}

/**
 * How close an item is to being unusable.
 *
 * `expirationWarningDays` is the department's own pull window for that item —
 * 30 days where it is not set. Owned here because the same three-way was
 * already written out at two call sites and is about to be needed at a third.
 */
export type ExpiryUrgency = 'none' | 'ok' | 'due' | 'expired';

export function expiryUrgency(item: CheckItemSpec, today: Date = new Date()): ExpiryUrgency {
  const days = daysUntil(item.expirationDate, today);
  if (days === null) return 'none';
  if (days < 0) return 'expired';
  return days <= (item.expirationWarningDays ?? 30) ? 'due' : 'ok';
}

/**
 * What forces a sealed container open, tag or no tag.
 *
 * A seal is evidence that nothing was *taken*. It is no evidence at all that
 * what is inside is still usable — a drug expires on schedule behind an intact
 * tag, and a crew that reads "seal intact, all good" carries an expired drug
 * to a call. So an expiring or expired item inside overrides the tag: the
 * container has to be opened, the item replaced, and the seal renewed.
 *
 * Recurses, because a sealed bag's pockets are inside the same seal.
 */
export function sealBlockers(stop: LapStop, today: Date = new Date()): CheckItemSpec[] {
  if (!stop.isSealed) return [];
  return stopItems(stop).filter((item) => {
    const urgency = expiryUrgency(item, today);
    return urgency === 'due' || urgency === 'expired';
  });
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

/**
 * The items one container's own tag can speak for.
 *
 * Traversal stops at a descendant carrying its own tag. A pouch sealed inside
 * a bag is a separate claim about a separate container: the outer tag being
 * intact says only that nobody reached past it, never that the inner pouch was
 * not opened before it went in. Clearing its contents from out here would call
 * the bag complete with the inner seal — and everything behind it — unanswered
 * on the submitted record, which is also the opposite of what the sweep draws:
 * an inner seal gets its own card and its own counts.
 */
export function itemsUnderOwnSeal(stop: LapStop): CheckItemSpec[] {
  const nested = (stop.children ?? []).filter((child) => !child.isSealed).flatMap(itemsUnderOwnSeal);
  return [...ownAnswerableItems(stop), ...nested];
}

/** Everything a separately-sealed descendant still asks, on its own terms. */
function sealedDescendantAsks(stop: LapStop, today: Date): CheckItemSpec[] {
  return (stop.children ?? []).flatMap((child) =>
    child.isSealed
      ? // Its own tag decides what it asks, whatever the outer one says. Its
        // own sealed descendants are the same story one level further down.
        [...askedWithin(child, today), ...sealedDescendantAsks(child, today)]
      : sealedDescendantAsks(child, today)
  );
}

/** What a container asks once its own tag has had its say. */
function askedWithin(stop: LapStop, today: Date): CheckItemSpec[] {
  return contentsAreSealed(stop, today)
    ? [...ownAnswerableItems(stop), ...sealCannotClear(itemsUnderOwnSeal(stop))]
    : answerableItems(stop);
}

export function isStopComplete(stop: LapStop, answers: AnswerMap, today: Date = new Date()): boolean {
  // An intact seal clears the counting inside, but not the expiry dates and
  // readings that move while the bag sits shut — so those still have to be
  // answered before the stop is finished. And not anything behind a seal of
  // its own: see `itemsUnderOwnSeal`.
  const items = contentsAreSealed(stop, today)
    ? [...ownAnswerableItems(stop), ...sealCannotClear(itemsUnderOwnSeal(stop)), ...sealedDescendantAsks(stop, today)]
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

// ============================================================================
// The sweep
// ============================================================================

/**
 * The claim the bulk button is making, said out loud.
 *
 * The button sits at the top of a stop the crew has not read yet, so it has to
 * say *how many* items it speaks for as well as what it claims about them.
 * "All 4 counts at par" is a claim somebody can check against the cabinet in
 * front of them; "All good" over four items is a button.
 *
 * The wording follows the contents — never "All good" over a gauge, because a
 * gauge is not bulk-confirmable at all and the count here excludes it.
 */
export interface BulkClaim {
  /** Exactly the items the button answers. */
  items: CheckItemSpec[];
  label: string;
  /**
   * The quantity the claim asserts, per count item.
   *
   * Carried where a number carried forward, par otherwise. Spelled out rather
   * than left for the caller to re-derive, because the two are not the same
   * claim: writing par over a carried 12 quietly destroys a surplus the last
   * crew counted, and it would do it behind a button captioned "at par".
   */
  quantities: Record<string, number>;
}

/**
 * The number the crew is shown for a count before they touch anything.
 *
 * Carried outranks par: par is what the truck is *supposed* to hold, the
 * carried figure is what was last actually counted, and the second is the one
 * the next crew is looking at when they open the door.
 */
export function shownQuantity(item: CheckItemSpec): number | null {
  return item.carriedQuantity ?? item.expectedQuantity ?? null;
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

  const quantities: Record<string, number> = {};
  let anyOffPar = false;
  for (const item of claimable) {
    if (normalizeCheckType(item.checkType) !== CheckType.COUNT) continue;
    const shown = shownQuantity(item);
    if (shown === null) continue;
    quantities[item.id] = shown;
    if (item.expectedQuantity != null && shown !== item.expectedQuantity) anyOffPar = true;
  }

  // "At par" is only true while every shown number *is* par. Once a carried
  // figure differs, the claim being made is that the carried numbers still
  // hold — which is a different sentence, and the one the crew can actually
  // check from where they are standing.
  const countLabel = anyOffPar ? `All ${n} counts as carried` : `All ${n} count${n === 1 ? '' : 's'} at par`;
  const label = types.size === 1 ? ([...types][0] === CheckType.COUNT ? countLabel : `All ${n} work`) : `All ${n} good`;
  return { items: claimable, label, quantities };
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
export function stillAsked(stop: LapStop, today: Date = new Date()): CheckItemSpec[] {
  if (!contentsAreSealed(stop, today)) return answerableItems(stop);
  // What this tag clears, plus everything behind a tag of its own, which it
  // does not clear — mirroring what the stop body actually draws.
  const sealedInside = (stop.children ?? []).flatMap(function inner(child): CheckItemSpec[] {
    return child.isSealed ? stillAsked(child, today) : (child.children ?? []).flatMap(inner);
  });
  return [...sealCannotClear(itemsUnderOwnSeal(stop)), ...sealedInside];
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
