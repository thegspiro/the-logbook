import { formatCalendarDate } from './dateFormatting';
import type { RequirementDetail } from '../types/training';

type MonthlyHours = ReadonlyArray<Pick<NonNullable<RequirementDetail['monthly_hours']>[number], 'month'>>;

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

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * "11 months on leave", "2 waived months", or both. Falls back to the plain
 * waived count for a server that does not split it by reason.
 */
export const excusedMonthsPhrase = (req: RequirementDetail): string => {
  const waived = req.waived_months ?? 0;
  const leave = req.leave_months ?? 0;
  const waiver = req.waiver_months ?? 0;
  if (leave === 0 && waiver === 0) return `${plural(waived, 'waived month')} of leave`;
  const parts: string[] = [];
  if (leave > 0) parts.push(`${plural(leave, 'month')} on leave`);
  if (waiver > 0) parts.push(plural(waiver, 'waived month'));
  return parts.join(' and ');
};
