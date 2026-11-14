import { describe, it, expect, vi } from 'vitest';

vi.mock('./dateFormatting', () => ({
  getTodayLocalDate: () => '2026-05-15',
}));

import {
  getTrainingPeriodWindow,
  isDateInTrainingPeriod,
  TrainingExportPeriod,
  TRAINING_PERIOD_LABELS,
} from './trainingPeriods';

describe('getTrainingPeriodWindow', () => {
  it('returns the current calendar month to date', () => {
    expect(getTrainingPeriodWindow(TrainingExportPeriod.MONTH)).toEqual({
      start_date: '2026-05-01',
      end_date: '2026-05-15',
    });
  });

  it('returns the current quarter to date (Q2 starts in April)', () => {
    expect(getTrainingPeriodWindow(TrainingExportPeriod.QUARTER)).toEqual({
      start_date: '2026-04-01',
      end_date: '2026-05-15',
    });
  });

  it('returns the current calendar year to date', () => {
    expect(getTrainingPeriodWindow(TrainingExportPeriod.YEAR)).toEqual({
      start_date: '2026-01-01',
      end_date: '2026-05-15',
    });
  });

  it('returns the twelve whole calendar months ending with the current one', () => {
    // Matches the backend's rolling_window: on 2026-05-15 that is June 2025
    // through May 2026, crossing the year boundary.
    expect(getTrainingPeriodWindow(TrainingExportPeriod.LAST_12_MONTHS)).toEqual({
      start_date: '2025-06-01',
      end_date: '2026-05-15',
    });
  });

  it('omits start_date for lifetime so the backend applies no lower bound', () => {
    const window = getTrainingPeriodWindow(TrainingExportPeriod.LIFETIME);
    expect(window.start_date).toBeUndefined();
    expect(window.end_date).toBe('2026-05-15');
  });

  it('provides a human label for every period', () => {
    for (const period of Object.values(TrainingExportPeriod)) {
      expect(TRAINING_PERIOD_LABELS[period].length).toBeGreaterThan(0);
    }
  });
});

describe('isDateInTrainingPeriod', () => {
  const year = { start_date: '2026-01-01', end_date: '2026-05-15' };

  it('includes both ends of the window and excludes dates outside it', () => {
    expect(isDateInTrainingPeriod('2026-01-01', year)).toBe(true);
    expect(isDateInTrainingPeriod('2026-05-15', year)).toBe(true);
    expect(isDateInTrainingPeriod('2025-12-31', year)).toBe(false);
    expect(isDateInTrainingPeriod('2026-05-16', year)).toBe(false);
  });

  it('places an undated record only in the lifetime window', () => {
    expect(isDateInTrainingPeriod(undefined, year)).toBe(false);
    expect(isDateInTrainingPeriod(null, { end_date: '2026-05-15' })).toBe(true);
  });

  it('applies no upper bound when the window has no end', () => {
    expect(isDateInTrainingPeriod('2027-03-01', { start_date: '2026-01-01' })).toBe(true);
  });
});
