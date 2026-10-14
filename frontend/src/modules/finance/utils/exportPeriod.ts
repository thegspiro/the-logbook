/**
 * The calendar days a QuickBooks export covers, as the instants the API takes.
 *
 * The export selects payments by timestamp between two instants, and dates
 * each entry by the department's calendar. A period of whole days therefore
 * starts at local midnight on the first day and ends just before local
 * midnight after the last, in the department's timezone, not the browser's.
 */

import { localToUTC } from '@/utils/dateFormatting';

/** The server's limit on one export's span, in days. */
export const MAX_EXPORT_DAYS = 366;

const pad = (n: number) => String(n).padStart(2, '0');

const parts = (day: string): [number, number, number] => {
  const [y, m, d] = day.split('-').map(Number);
  return [y ?? 0, m ?? 1, d ?? 1];
};

const format = (date: Date): string =>
  `${String(date.getUTCFullYear())}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

/** `YYYY-MM-DD` plus *days*, as calendar arithmetic with no timezone involved. */
export const addDays = (day: string, days: number): string => {
  const [y, m, d] = parts(day);
  return format(new Date(Date.UTC(y, m - 1, d + days)));
};

/** Days from *start* to *end* inclusive. */
export const periodLength = (start: string, end: string): number => {
  const [sy, sm, sd] = parts(start);
  const [ey, em, ed] = parts(end);
  return Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86_400_000) + 1;
};

/** The first and last day of the month before *today* (`YYYY-MM-DD`). */
export const previousMonth = (today: string): { start: string; end: string } => {
  const [y, m] = parts(today);
  const first = new Date(Date.UTC(y, m - 2, 1));
  const last = new Date(Date.UTC(y, m - 1, 0));
  return { start: format(first), end: format(last) };
};

/** The API's instants for whole days *start*..*end* in *timezone*. */
export const exportRange = (
  start: string,
  end: string,
  timezone: string
): { dateRangeStart: string; dateRangeEnd: string } => {
  const nextMidnight = Date.parse(localToUTC(`${addDays(end, 1)}T00:00`, timezone));
  return {
    dateRangeStart: localToUTC(`${start}T00:00`, timezone),
    // The API includes its end instant, so stop a millisecond short of the
    // next day.
    dateRangeEnd: new Date(nextMidnight - 1).toISOString(),
  };
};
