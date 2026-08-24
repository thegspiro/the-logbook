/**
 * Rendering for an item history event's raw detail bag.
 *
 * Its own module rather than a helper inside ItemDetailPage: a file that
 * exports both components and functions loses fast refresh, which is the same
 * reason dateFormatting.ts keeps `daysUntil` out of the expiry control.
 */

import { formatCalendarDate, formatDateTime } from '../../../utils/dateFormatting';

/** Looks like an ISO-8601 instant the backend stores in UTC. */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
/** A plain calendar date with no time attached. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Turn a history event's raw detail bag into a line a member can read.
 *
 * These come off the API as the stored payload, so the keys are the column
 * names and the timestamps are UTC. Rendering them straight put
 * `expected_return: 2026-08-20T23:40:15+00:00` and `is_overdue: true` in front
 * of whoever opened the item -- and a UTC instant shown as-is is the one thing
 * the date rules in CLAUDE.md forbid outright, because a member reads it as
 * their own clock and it is not.
 *
 * Keys become sentence case, instants and dates go through the same formatters
 * as the rest of the app (with the organization's timezone), booleans read as
 * Yes/No, and empty values are dropped rather than rendered as a bare
 * `notes:` with nothing after it.
 */
export function formatHistoryDetails(details: Record<string, unknown> | null | undefined, tz: string): string {
  if (!details) return '';
  return Object.entries(details)
    .map(([key, value]) => {
      if (value == null || value === '') return null;
      let text: string;
      if (typeof value === 'boolean') text = value ? 'Yes' : 'No';
      else if (typeof value === 'number') text = String(value);
      else if (typeof value === 'string') {
        if (ISO_INSTANT.test(value)) text = formatDateTime(value, tz);
        // formatCalendarDate, not formatDate: a plain "YYYY-MM-DD" is a
        // calendar date, not an instant, so converting it into a timezone
        // moves it. "2026-08-20" rendered as 8/19/2026 in New York before
        // this, because formatDate anchors it at UTC midnight and then shifts.
        else if (ISO_DATE.test(value)) text = formatCalendarDate(value);
        else text = value;
      } else text = JSON.stringify(value);
      if (text === '') return null;
      const label = key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
      return `${label}: ${text}`;
    })
    .filter((line): line is string => line !== null)
    .join(' · ');
}
