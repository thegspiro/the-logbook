/**
 * Helpers for training-record export periods (monthly / quarterly / yearly /
 * lifetime). Windows are calendar-period-to-date in the supplied timezone
 * (e.g. "This Year" = Jan 1 of the current year through today). "Lifetime"
 * omits the start date so the backend applies no lower bound.
 */

import { getTodayLocalDate } from './dateFormatting';

export const TrainingExportPeriod = {
  MONTH: 'month',
  QUARTER: 'quarter',
  YEAR: 'year',
  LIFETIME: 'lifetime',
} as const;
export type TrainingExportPeriod =
  (typeof TrainingExportPeriod)[keyof typeof TrainingExportPeriod];

export const TRAINING_PERIOD_LABELS: Record<TrainingExportPeriod, string> = {
  month: 'This Month',
  quarter: 'This Quarter',
  year: 'This Year',
  lifetime: 'All Time',
};

export interface TrainingPeriodWindow {
  start_date?: string;
  end_date: string;
}

/**
 * Compute the {start_date, end_date} window for an export period.
 * Dates are ISO `YYYY-MM-DD` strings. Lifetime returns no `start_date`.
 */
export function getTrainingPeriodWindow(
  period: TrainingExportPeriod,
  timezone?: string,
): TrainingPeriodWindow {
  const today = getTodayLocalDate(timezone); // 'YYYY-MM-DD'
  const parts = today.split('-');
  const year = parts[0] ?? '1970';
  const monthStr = parts[1] ?? '01';
  const month = Number(monthStr); // 1-12

  switch (period) {
    case TrainingExportPeriod.MONTH:
      return { start_date: `${year}-${monthStr}-01`, end_date: today };
    case TrainingExportPeriod.QUARTER: {
      const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
      const mm = String(quarterStartMonth).padStart(2, '0');
      return { start_date: `${year}-${mm}-01`, end_date: today };
    }
    case TrainingExportPeriod.YEAR:
      return { start_date: `${year}-01-01`, end_date: today };
    case TrainingExportPeriod.LIFETIME:
    default:
      return { end_date: today };
  }
}
