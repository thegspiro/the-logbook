/**
 * Month helpers shared by the hours chart and the shift list beneath it, so the
 * two name months and total them the same way.
 */

import type { MemberHoursMonth } from '../../modules/scheduling/services/api';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "January" for 1; an empty string outside 1-12. */
export const monthName = (month: number): string => MONTHS[month - 1] ?? '';

/**
 * Every credited shift hour in a month: the department's own credited hours
 * plus those logged with other departments. Pending hours are in neither.
 */
export const monthTotalHours = (m: MemberHoursMonth): number => m.hours + (m.external_hours ?? 0);
