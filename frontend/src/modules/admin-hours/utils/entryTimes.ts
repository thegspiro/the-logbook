/**
 * Start/end coupling shared by the two admin-hours time forms — the member's
 * manual entry form and the reviewer's edit form.
 *
 * Both hold local wall-clock strings ("2026-09-01T18:00") in the department's
 * timezone and convert to UTC exactly once on submit, so every helper here
 * takes and returns that same shape.
 */

import { addCalendarDays, formatForDateTimeInput, localToUTC } from '../../../utils/dateFormatting';

/** Quick-duration presets, matching the Create Events form. */
export const DURATION_PRESET_HOURS = [1, 2, 4, 8] as const;

/** Filled into a blank end when the member first picks a start. */
const DEFAULT_END_OFFSET_HOURS = 1;

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

const datePart = (local: string): string => local.split('T')[0] ?? '';
const timePart = (local: string): string => local.split('T')[1] ?? '';

/**
 * A local wall-clock string paired with the exact UTC instant it denotes.
 *
 * Carrying the instant alongside the string is what lets a caller preserve
 * the elapsed duration a member actually picked across a DST fall-back fold
 * — see `resolveEndUtc`.
 */
export interface DerivedEndTime {
  local: string;
  utcMs: number;
}

/**
 * `start + hours`, re-derived as a wall-clock string in `timezone`, alongside
 * the exact UTC instant that produced it.
 *
 * Going through a real UTC instant and formatting the result back in the
 * department's timezone is what makes midnight, month-end and DST transitions
 * fall out for free — 23:00 + 4h rolls the date, and no branch is needed to do
 * it. Adding to the string's own hour field would not.
 *
 * The wall-clock string this returns is not always enough on its own: during
 * a DST fall-back, the hour between 1am and 2am occurs twice, so a string
 * like "01:30" is genuinely ambiguous — `localToUTC` always resolves it back
 * to the *first* (pre-transition) occurrence, regardless of which one this
 * function actually meant. A caller that lets that ambiguous string round-trip
 * through `localToUTC` a second time at submit can silently lose up to an
 * hour off the duration the member selected. Callers that need the selected
 * duration to survive verbatim should keep `utcMs` and resolve through
 * `resolveEndUtc` instead of re-parsing `local`.
 */
export const addHoursExact = (localStart: string, hours: number, timezone: string): DerivedEndTime | null => {
  if (!localStart) return null;
  const startUtc = new Date(localToUTC(localStart, timezone)).getTime();
  if (isNaN(startUtc)) return null;
  const utcMs = startUtc + hours * MS_PER_HOUR;
  return { local: formatForDateTimeInput(new Date(utcMs), timezone), utcMs };
};

/** String-only convenience wrapper over `addHoursExact` for display purposes. */
export const addHours = (localStart: string, hours: number, timezone: string): string =>
  addHoursExact(localStart, hours, timezone)?.local ?? '';

/**
 * Resolve a local wall-clock string to its UTC ISO instant, preferring a
 * previously-derived exact instant (`pinned`, from `addHoursExact` /
 * `syncEndToStartExact`) when it still matches the string on screen.
 *
 * The match check is the whole mechanism: if the member has since retyped
 * the field, or picked a different start that produced a different string,
 * `pinned.local` no longer equals `local` and this falls back to parsing the
 * string on its own — the same, ordinary (and, across a fold, ambiguous)
 * resolution every other date field in this app uses. Nothing needs to be
 * explicitly invalidated on every edit path; a stale pin simply stops
 * matching.
 */
export const resolveEndUtc = (local: string, pinned: DerivedEndTime | null, timezone: string): string =>
  pinned && pinned.local === local ? new Date(pinned.utcMs).toISOString() : localToUTC(local, timezone);

/** Whole calendar days from one "YYYY-MM-DD" to another, ignoring clocks. */
const calendarDaysBetween = (from: string, to: string): number => {
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`);
  if (isNaN(fromMs) || isNaN(toMs)) return 0;
  return Math.round((toMs - fromMs) / MS_PER_DAY);
};

/**
 * Move the end alongside a changed start.
 *
 * The end tracks the start's **date**, never its time-of-day, and that
 * asymmetry is the whole point — do not "simplify" this into preserving the
 * duration. Members set the day first, then the real start time, then press a
 * quick-duration button; if the end chased the start time as well, that button
 * press would be fighting an end that had already moved. Shifting only by the
 * calendar-day delta also preserves an overnight entry: an end the member put
 * on the following day stays on the day after whatever start they end up with.
 */
export const syncEndToStart = (prevStart: string, nextStart: string, currentEnd: string, timezone: string): string =>
  syncEndToStartExact(prevStart, nextStart, currentEnd, null, timezone).local;

/**
 * `syncEndToStart`, carrying a `DerivedEndTime` pin alongside the string the
 * same way `addHoursExact` does, so the fold-safety `resolveEndUtc` provides
 * survives every path that can produce this field's value, not just the
 * quick-duration buttons.
 *
 * - Blank end filled from the new start: pins to the same instant
 *   `addHoursExact` would have produced, for the same reason.
 * - Time-of-day-only change: the end string does not change, so whatever pin
 *   the caller already had for it is still exactly as valid as it was —
 *   passed through unchanged.
 * - Calendar-date shift: this is a wall-clock shift ("keep the same
 *   time-of-day, `n` days later"), not a fixed elapsed duration — a day can
 *   be 23, 24 or 25 hours across a DST boundary, and this function's own
 *   contract (see `syncEndToStart`'s docstring) is to preserve the
 *   time-of-day, not the duration. There is no "exact instant" to offer for
 *   that contract, so the pin is cleared and the shifted string resolves the
 *   ordinary way, same as any other hand-authored value.
 */
export const syncEndToStartExact = (
  prevStart: string,
  nextStart: string,
  currentEnd: string,
  currentEndPin: DerivedEndTime | null,
  timezone: string
): { local: string; pin: DerivedEndTime | null } => {
  if (!nextStart) return { local: currentEnd, pin: currentEndPin };
  if (!currentEnd) {
    const derived = addHoursExact(nextStart, DEFAULT_END_OFFSET_HOURS, timezone);
    return { local: derived?.local ?? '', pin: derived };
  }

  const prevDate = datePart(prevStart);
  const nextDate = datePart(nextStart);
  // Only the time-of-day moved (or there was no start date to move from):
  // leave an end the member already chose exactly where it is.
  if (!prevDate || prevDate === nextDate) return { local: currentEnd, pin: currentEndPin };

  const endDate = datePart(currentEnd);
  const endTime = timePart(currentEnd);
  if (!endDate || !endTime) return { local: currentEnd, pin: currentEndPin };

  const shifted = `${addCalendarDays(endDate, calendarDaysBetween(prevDate, nextDate))}T${endTime}`;
  return { local: shifted, pin: null };
};
