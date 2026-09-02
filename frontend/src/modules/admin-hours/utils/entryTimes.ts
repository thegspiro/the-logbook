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
 * `start + hours`, re-derived as a wall-clock string in `timezone`.
 *
 * Going through a real UTC instant and formatting the result back in the
 * department's timezone is what makes midnight, month-end and DST transitions
 * fall out for free — 23:00 + 4h rolls the date, and no branch is needed to do
 * it. Adding to the string's own hour field would not.
 */
export const addHours = (localStart: string, hours: number, timezone: string): string => {
  if (!localStart) return '';
  const startUtc = new Date(localToUTC(localStart, timezone)).getTime();
  if (isNaN(startUtc)) return '';
  return formatForDateTimeInput(new Date(startUtc + hours * MS_PER_HOUR), timezone);
};

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
export const syncEndToStart = (prevStart: string, nextStart: string, currentEnd: string, timezone: string): string => {
  if (!nextStart) return currentEnd;
  if (!currentEnd) return addHours(nextStart, DEFAULT_END_OFFSET_HOURS, timezone);

  const prevDate = datePart(prevStart);
  const nextDate = datePart(nextStart);
  // Only the time-of-day moved (or there was no start date to move from):
  // leave an end the member already chose exactly where it is.
  if (!prevDate || prevDate === nextDate) return currentEnd;

  const endDate = datePart(currentEnd);
  const endTime = timePart(currentEnd);
  if (!endDate || !endTime) return currentEnd;

  return `${addCalendarDays(endDate, calendarDaysBetween(prevDate, nextDate))}T${endTime}`;
};
