/**
 * Length-of-service display.
 *
 * Every span is measured as calendar years and months ending on a given day,
 * using the same anniversary rule as the backend's `whole_years` — a year is
 * complete on its anniversary, not a day before — so the years shown on a
 * profile are the years tier advancement grades. The backend reports a length
 * in days; `today - days` recovers the start of an equivalent unbroken span.
 *
 * Dates are `YYYY-MM-DD` calendar dates and all arithmetic is done in UTC, so
 * the result does not shift with the viewer's timezone.
 */

export interface ServiceSpan {
  years: number;
  months: number;
}

const DAY_MS = 86_400_000;

function parseIsoDate(value: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function toUtcMs(value: string): number | null {
  const parts = parseIsoDate(value);
  return parts ? Date.UTC(parts.y, parts.m - 1, parts.d) : null;
}

function fromUtcMs(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Completed years and months from `start` to `end` (both `YYYY-MM-DD`). */
export function spanBetween(start: string, end: string): ServiceSpan {
  const a = parseIsoDate(start);
  const b = parseIsoDate(end);
  if (!a || !b) return { years: 0, months: 0 };
  let months = (b.y - a.y) * 12 + (b.m - a.m);
  if (b.d < a.d) months -= 1;
  if (months < 0) return { years: 0, months: 0 };
  return { years: Math.floor(months / 12), months: months % 12 };
}

/** The span a length of `days` ending on `today` covers. */
export function spanFromDays(days: number, today: string): ServiceSpan {
  const end = toUtcMs(today);
  if (end === null || days <= 0) return { years: 0, months: 0 };
  return spanBetween(fromUtcMs(end - days * DAY_MS), today);
}

/** "7 years, 3 months", "1 year", "5 months", or "Less than a month". */
export function formatServiceSpan(span: ServiceSpan): string {
  const parts: string[] = [];
  if (span.years > 0) parts.push(`${String(span.years)} ${span.years === 1 ? 'year' : 'years'}`);
  if (span.months > 0) parts.push(`${String(span.months)} ${span.months === 1 ? 'month' : 'months'}`);
  return parts.length > 0 ? parts.join(', ') : 'Less than a month';
}
