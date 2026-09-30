/**
 * How an outside shift's recorded start and end read in a list.
 *
 * Entries logged before the times were kept, and entries whose date or hours
 * were later corrected on their own, have none — they read by date and hours
 * alone, as they always did.
 */

import { formatForDateTimeInput, formatTime } from '../../utils/dateFormatting';
import type { ExternalShiftEntry } from '../../modules/scheduling/services/api';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const localDate = (iso: string, timezone: string): string => formatForDateTimeInput(iso, timezone).split('T')[0] ?? '';

/**
 * "7:00 AM – 7:00 PM", or null when the entry has no times. An end on a later
 * day says so: a 24-hour shift otherwise reads as starting and ending at once.
 */
export const externalShiftTimeRange = (
  entry: Pick<ExternalShiftEntry, 'start_at' | 'end_at'>,
  timezone: string
): string | null => {
  if (!entry.start_at || !entry.end_at) return null;
  const startDay = Date.parse(`${localDate(entry.start_at, timezone)}T00:00:00Z`);
  const endDay = Date.parse(`${localDate(entry.end_at, timezone)}T00:00:00Z`);
  const days = isNaN(startDay) || isNaN(endDay) ? 0 : Math.round((endDay - startDay) / MS_PER_DAY);
  const suffix = days === 1 ? ' next day' : days > 1 ? ` (+${days} days)` : '';
  return `${formatTime(entry.start_at, timezone)} – ${formatTime(entry.end_at, timezone)}${suffix}`;
};
