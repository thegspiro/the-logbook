import { formatCalendarDate } from './dateFormatting';
import type { RequirementDetail } from '../types/training';

type MonthlyHours = NonNullable<RequirementDetail['monthly_hours']>;

/** "Nov" or "Nov 2025" for a "YYYY-MM" month key. */
export const monthLabel = (month: string, withYear = false): string =>
  formatCalendarDate(`${month}-01`, withYear ? { month: 'short', year: 'numeric' } : { month: 'short' });

/** "Nov 2025 – Oct 2026" from the first and last month of the breakdown. */
export const countingWindowLabel = (months: MonthlyHours): string => {
  const first = months[0];
  const last = months[months.length - 1];
  if (!first || !last) return '';
  return first.month === last.month
    ? monthLabel(first.month, true)
    : `${monthLabel(first.month, true)} – ${monthLabel(last.month, true)}`;
};
