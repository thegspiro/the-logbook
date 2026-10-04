/**
 * Pure arithmetic for the shift close-out wizard.
 *
 * Kept out of the component so it can be tested on its own, and because these
 * are the calculations that were repeatedly got wrong while prototyping the
 * flow — each mistake produced a plausible number rather than an error.
 */

import { formatForDateTimeInput, localToUTC } from '../../utils/dateFormatting';

/** Slug for the "no type given" row. Never sent as a call type. */
export const UNCATEGORISED = '__uncategorised__';

/** Parse a count field. Blank, negative and rubbish all read as zero. */
export const num = (v: string): number => {
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) || n < 0 ? 0 : n;
};

/** Hours between two datetime-local strings, or 0 when either is unusable. */
export const hoursBetween = (inLocal: string, outLocal: string): number => {
  if (!inLocal || !outLocal) return 0;
  const a = new Date(inLocal).getTime();
  const b = new Date(outLocal).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return 0;
  return Math.round(((b - a) / 3_600_000) * 10) / 10;
};

/**
 * The apparatus's call count, or null when nothing has been entered at all.
 *
 * The rows are the only source — the total is derived from them, never stored
 * alongside them. Holding both meant reconciling two inputs that each claimed
 * to own the number, and the rule for revising one *down* was missing, so a
 * corrected count left the old total on screen and saved it.
 *
 * null and 0 are different facts and are stored differently: null is a gap in
 * the record, 0 is a department reporting a quiet tour.
 */
export const deriveCallTotal = (counts: Record<string, string>): number | null => {
  const entered = Object.values(counts).some((v) => v.trim() !== '');
  if (!entered) return null;
  return Object.values(counts).reduce((sum, v) => sum + num(v), 0);
};

/**
 * The longest single attendance span the server accepts. Mirrors the 48-hour
 * cap in `save_closeout_attendance`, so an entry the server would reject is
 * refused here with a message instead of failing the whole step on Next.
 */
export const MAX_ATTENDANCE_HOURS = 48;

/**
 * Parse a typed hours figure, or null when it cannot be recorded.
 *
 * Zero is refused along with blanks and rubbish: an attendance row with no
 * time on it is how "not entered" is stored, and a zero-length span is
 * rejected server-side as leaving before arriving.
 */
export const parseHoursEntry = (v: string): number | null => {
  if (v.trim() === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_ATTENDANCE_HOURS) return null;
  return n;
};

/**
 * A datetime-local string `hours` after another, both read in `tz`.
 *
 * Goes through UTC rather than adding to the wall-clock fields, because the
 * server computes duration from the stored instants: across a DST change a
 * wall-clock "+12h" is 11 or 13 real hours, and the member would be credited
 * with that instead of what the officer typed.
 */
export const addHoursLocal = (startLocal: string, hours: number, tz: string): string => {
  const startUtc = localToUTC(startLocal, tz);
  if (!startUtc) return '';
  const start = new Date(startUtc).getTime();
  if (Number.isNaN(start)) return '';
  return formatForDateTimeInput(new Date(start + Math.round(hours * 60) * 60_000), tz);
};
