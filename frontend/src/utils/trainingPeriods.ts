/**
 * Helpers for training-record periods (monthly / quarterly / yearly /
 * last 12 months / lifetime). The calendar periods run to date in the supplied
 * timezone (e.g. "This Year" = Jan 1 of the current year through today).
 * "Last 12 Months" is the twelve whole calendar months ending with the current
 * one, the same window the backend's `rolling_window` grades a rolling
 * requirement on, so its total matches the requirement card. "Lifetime" omits
 * the start date so the backend applies no lower bound.
 */

import { getTodayLocalDate } from './dateFormatting';

export const TrainingExportPeriod = {
  MONTH: 'month',
  QUARTER: 'quarter',
  YEAR: 'year',
  LAST_12_MONTHS: 'last_12_months',
  LIFETIME: 'lifetime',
} as const;
export type TrainingExportPeriod = (typeof TrainingExportPeriod)[keyof typeof TrainingExportPeriod];

export const TRAINING_PERIOD_LABELS: Record<TrainingExportPeriod, string> = {
  month: 'This Month',
  quarter: 'This Quarter',
  year: 'This Year',
  last_12_months: 'Last 12 Months',
  lifetime: 'All Time',
};

export interface TrainingPeriodWindow {
  start_date?: string;
  end_date: string;
}

/**
 * Whether a `YYYY-MM-DD` date falls inside a period window; either bound may be
 * omitted. An undated record belongs only to a window with no start. Plain string comparison is
 * exact for ISO calendar dates, and avoids `Date` parsing, which would read a
 * bare date as UTC midnight and shift it a day west of Greenwich.
 */
export function isDateInTrainingPeriod(
  date: string | null | undefined,
  window: { start_date?: string | undefined; end_date?: string | undefined }
): boolean {
  if (!date) return window.start_date === undefined;
  const day = date.slice(0, 10);
  if (window.start_date !== undefined && day < window.start_date) return false;
  return window.end_date === undefined || day <= window.end_date;
}

/**
 * Compute the {start_date, end_date} window for a training period.
 * Dates are ISO `YYYY-MM-DD` strings. Lifetime returns no `start_date`.
 */
export function getTrainingPeriodWindow(period: TrainingExportPeriod, timezone?: string): TrainingPeriodWindow {
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
    case TrainingExportPeriod.LAST_12_MONTHS: {
      // Eleven months back from the current one, so the current month is the
      // twelfth: on 2026-11-06 the window opens 2025-12-01.
      const monthsSinceEpoch = Number(year) * 12 + (month - 1) - 11;
      const startYear = Math.floor(monthsSinceEpoch / 12);
      const startMonth = String((monthsSinceEpoch % 12) + 1).padStart(2, '0');
      return { start_date: `${startYear}-${startMonth}-01`, end_date: today };
    }
    case TrainingExportPeriod.LIFETIME:
    default:
      return { end_date: today };
  }
}
