/**
 * Reporting-period helpers shared by the personal and organization summaries.
 *
 * Entries are stored as UTC instants, so a reporting day picked in the
 * department's timezone has to be converted before it becomes an API bound.
 * Sending the bare "YYYY-MM-DDT23:59:59.999" a date picker produces drops
 * every entry logged in the UTC-offset-sized tail of the last day for any
 * department west of UTC.
 */

import { localToUTC } from '../../../utils/dateFormatting';

export const startOfReportingDayUTC = (date: string, timezone: string): string => localToUTC(`${date}T00:00`, timezone);

const toDateInputUTC = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * The exclusive end is midnight opening the *next* day, less a millisecond, so
 * the whole selected end day is covered without spilling into the day after.
 */
export const endOfReportingDayUTC = (date: string, timezone: string): string => {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  const nextDate = toDateInputUTC(nextDay);
  return new Date(new Date(localToUTC(`${nextDate}T00:00`, timezone)).getTime() - 1).toISOString();
};
