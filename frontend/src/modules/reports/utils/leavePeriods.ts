/**
 * How a report names a member's leave of absence. Shared by the Annual
 * Training and Program Requirement Progress reports, so the two describe a
 * leave the same way.
 */

import { formatCalendarDate } from '@/utils/dateFormatting';
import type { ReportLeavePeriod } from '../types';

/** "Jul 1, 2025 – Sep 1, 2026", saying when an exempt leave excused nothing. */
export const leavePeriodText = (period: ReportLeavePeriod): string => {
  const end = period.end_date ? formatCalendarDate(period.end_date) : 'no end date';
  const span = `${formatCalendarDate(period.start_date)} – ${end}`;
  return period.excuses_training ? span : `${span} (requirements stayed in force)`;
};

/** Every period as one line of text, for an export cell. */
export const leavePeriodsText = (periods: ReportLeavePeriod[] | undefined): string =>
  (periods ?? []).map(leavePeriodText).join('; ');
