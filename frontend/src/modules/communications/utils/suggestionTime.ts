import { formatDate, formatDateTime } from '../../../utils/dateFormatting';
import type { TimestampPrecision } from '../types/suggestions';

/**
 * Anonymous-side timestamps are stored at 12:00 UTC of the day, so only the
 * date is real. Rendering one as a time would invent a moment the server
 * refused to record; formatting it in UTC keeps the calendar date stable.
 */
export function formatSuggestionTime(value: string, precision: TimestampPrecision, tz: string): string {
  return precision === 'day' ? formatDate(value, 'UTC') : formatDateTime(value, tz);
}
