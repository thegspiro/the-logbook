import { describe, it, expect } from 'vitest';
import { addDays, exportRange, periodLength, previousMonth } from './exportPeriod';

describe('exportPeriod', () => {
  it('steps across a month and a year end', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('counts both ends of the period', () => {
    expect(periodLength('2026-03-01', '2026-03-31')).toBe(31);
    expect(periodLength('2026-03-05', '2026-03-05')).toBe(1);
  });

  it('defaults to last month, including across January', () => {
    expect(previousMonth('2026-10-14')).toEqual({ start: '2026-09-01', end: '2026-09-30' });
    expect(previousMonth('2026-01-03')).toEqual({ start: '2025-12-01', end: '2025-12-31' });
    expect(previousMonth('2024-03-10')).toEqual({ start: '2024-02-01', end: '2024-02-29' });
  });

  it("spans whole days in the department's timezone", () => {
    expect(exportRange('2026-03-01', '2026-03-31', 'America/New_York')).toEqual({
      dateRangeStart: '2026-03-01T05:00:00.000Z',
      // Daylight saving began on March 8, so April 1 starts at 04:00 UTC.
      dateRangeEnd: '2026-04-01T03:59:59.999Z',
    });
    expect(exportRange('2026-03-01', '2026-03-31', 'UTC')).toEqual({
      dateRangeStart: '2026-03-01T00:00:00.000Z',
      dateRangeEnd: '2026-03-31T23:59:59.999Z',
    });
  });
});
