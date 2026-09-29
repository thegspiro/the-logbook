import { describe, it, expect } from 'vitest';
import { externalShiftTimeRange } from './externalShiftTimes';

const TZ = 'America/New_York';

describe('externalShiftTimeRange', () => {
  it('is null for an entry logged without times', () => {
    expect(externalShiftTimeRange({ start_at: null, end_at: null }, TZ)).toBeNull();
  });

  it('reads a same-day shift in the department’s timezone', () => {
    expect(externalShiftTimeRange({ start_at: '2026-03-04T12:00:00Z', end_at: '2026-03-05T00:00:00Z' }, TZ)).toBe(
      '7:00 AM – 7:00 PM'
    );
  });

  it('says when the end falls on a later day', () => {
    expect(externalShiftTimeRange({ start_at: '2026-03-04T12:00:00Z', end_at: '2026-03-05T12:00:00Z' }, TZ)).toBe(
      '7:00 AM – 7:00 AM next day'
    );
    expect(externalShiftTimeRange({ start_at: '2026-03-04T12:00:00Z', end_at: '2026-03-06T12:00:00Z' }, TZ)).toBe(
      '7:00 AM – 7:00 AM (+2 days)'
    );
  });
});
