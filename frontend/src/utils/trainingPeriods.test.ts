import { describe, it, expect, vi } from 'vitest';

vi.mock('./dateFormatting', () => ({
  getTodayLocalDate: () => '2026-05-15',
}));

import {
  getTrainingPeriodWindow,
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
