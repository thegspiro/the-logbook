import { formatCalendarDate, formatDate } from '../../../utils/dateFormatting';

/**
 * Report cells as the rest of the app reads them, not as ISO strings (W72-4).
 *
 * Only the on-screen tables use these. Each renderer's export columns keep
 * the raw values, so a CSV stays sortable and unambiguous in a spreadsheet.
 */

/** A calendar date the server already settled in the department's zone. */
export const renderCalendarDate = (value: unknown): string =>
  typeof value === 'string' && value ? formatCalendarDate(value) : '-';

/** An instant (an ISO timestamp), shown on the department's calendar. */
export const renderInstantDate =
  (timezone: string) =>
  (value: unknown): string =>
    typeof value === 'string' && value ? formatDate(value, timezone) : '-';
