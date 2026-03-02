import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  formatDate,
  formatDateTime,
  formatShortDateTime,
  formatTime,
  formatForDateTimeInput,
  localToUTC,
  getTodayLocalDate,
  toLocalDateString,
  daysUntil,
  calculateDurationMinutes,
  isPastDate,
  isFutureDate,
} from './dateFormatting';

// Use a fixed UTC date for deterministic tests: 2024-06-15T18:30:00Z
const TEST_DATE_ISO = '2024-06-15T18:30:00.000Z';
const TEST_DATE = new Date(TEST_DATE_ISO);
const UTC_TZ = 'UTC';

describe('formatDate', () => {
  it('formats an ISO string to a localized date', () => {
    const result = formatDate(TEST_DATE_ISO, UTC_TZ);
    expect(result).toBe('6/15/2024');
  });

  it('formats a Date object to a localized date', () => {
    const result = formatDate(TEST_DATE, UTC_TZ);
    expect(result).toBe('6/15/2024');
  });

  it('returns "N/A" for null', () => {
    expect(formatDate(null)).toBe('N/A');
  });

  it('returns "N/A" for undefined', () => {
    expect(formatDate(undefined)).toBe('N/A');
  });

  it('returns "N/A" for empty string', () => {
    expect(formatDate('')).toBe('N/A');
  });

  it('returns "N/A" for an invalid date string', () => {
    expect(formatDate('not-a-date')).toBe('N/A');
  });

  it('respects timezone parameter', () => {
    // 2024-06-15T23:30:00Z is still June 15 in UTC but June 16 in Tokyo (+9)
    const lateUtcDate = '2024-06-15T23:30:00.000Z';
    expect(formatDate(lateUtcDate, 'Asia/Tokyo')).toBe('6/16/2024');
    expect(formatDate(lateUtcDate, UTC_TZ)).toBe('6/15/2024');
  });

  it('handles leap year date', () => {
    expect(formatDate('2024-02-29T12:00:00Z', UTC_TZ)).toBe('2/29/2024');
  });

  it('handles end-of-year date', () => {
    expect(formatDate('2024-12-31T23:59:59Z', UTC_TZ)).toBe('12/31/2024');
  });
});

describe('formatDateTime', () => {
  it('formats a date to full date with time', () => {
    const result = formatDateTime(TEST_DATE_ISO, UTC_TZ);
    expect(result).toContain('Saturday');
    expect(result).toContain('June');
    expect(result).toContain('15');
    expect(result).toContain('2024');
    expect(result).toContain('6:30');
    expect(result).toContain('PM');
  });

  it('returns "N/A" for null', () => {
    expect(formatDateTime(null)).toBe('N/A');
  });

  it('returns "N/A" for undefined', () => {
    expect(formatDateTime(undefined)).toBe('N/A');
  });

  it('returns "N/A" for invalid date', () => {
    expect(formatDateTime('garbage')).toBe('N/A');
  });

  it('accepts a Date object', () => {
    const result = formatDateTime(TEST_DATE, UTC_TZ);
    expect(result).toContain('June');
  });

  it('respects timezone parameter', () => {
    // 6:30 PM UTC = 2:30 PM Eastern (EDT, UTC-4 in June)
    const result = formatDateTime(TEST_DATE_ISO, 'America/New_York');
    expect(result).toContain('2:30');
    expect(result).toContain('PM');
  });
});

describe('formatShortDateTime', () => {
  it('formats a date to short date with time', () => {
    const result = formatShortDateTime(TEST_DATE_ISO, UTC_TZ);
    expect(result).toContain('Jun');
    expect(result).toContain('15');
    expect(result).toContain('6:30');
    expect(result).toContain('PM');
  });

  it('returns "N/A" for null', () => {
    expect(formatShortDateTime(null)).toBe('N/A');
  });

  it('returns "N/A" for undefined', () => {
    expect(formatShortDateTime(undefined)).toBe('N/A');
  });

  it('returns "N/A" for invalid date', () => {
    expect(formatShortDateTime('xyz')).toBe('N/A');
  });

  it('accepts a Date object', () => {
    const result = formatShortDateTime(TEST_DATE, UTC_TZ);
    expect(result).toContain('Jun');
  });
});

describe('formatTime', () => {
  it('formats time only from a date string', () => {
    const result = formatTime(TEST_DATE_ISO, UTC_TZ);
    expect(result).toBe('6:30 PM');
  });

  it('returns "N/A" for null', () => {
    expect(formatTime(null)).toBe('N/A');
  });

  it('returns "N/A" for undefined', () => {
    expect(formatTime(undefined)).toBe('N/A');
  });

  it('returns "N/A" for invalid date', () => {
    expect(formatTime('bad')).toBe('N/A');
  });

  it('respects timezone parameter', () => {
    const result = formatTime(TEST_DATE_ISO, 'America/New_York');
    expect(result).toBe('2:30 PM');
  });

  it('handles midnight in UTC', () => {
    const midnight = '2024-01-01T00:00:00.000Z';
    const result = formatTime(midnight, UTC_TZ);
    expect(result).toBe('12:00 AM');
  });

  it('handles noon in UTC', () => {
    const noon = '2024-01-01T12:00:00.000Z';
    const result = formatTime(noon, UTC_TZ);
    expect(result).toBe('12:00 PM');
  });
});

describe('formatForDateTimeInput', () => {
  it('formats a date for datetime-local input', () => {
    const result = formatForDateTimeInput(TEST_DATE_ISO, UTC_TZ);
    expect(result).toBe('2024-06-15T18:30');
  });

  it('returns empty string for null', () => {
    expect(formatForDateTimeInput(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(formatForDateTimeInput(undefined)).toBe('');
  });

  it('returns empty string for invalid date', () => {
    expect(formatForDateTimeInput('not-valid')).toBe('');
  });

  it('respects timezone parameter', () => {
    const result = formatForDateTimeInput(TEST_DATE_ISO, 'America/New_York');
    expect(result).toBe('2024-06-15T14:30');
  });

  it('handles a Date object', () => {
    const result = formatForDateTimeInput(TEST_DATE, UTC_TZ);
    expect(result).toBe('2024-06-15T18:30');
  });
});

describe('localToUTC', () => {
  it('returns empty string for falsy input', () => {
    expect(localToUTC(null)).toBe('');
    expect(localToUTC(undefined)).toBe('');
    expect(localToUTC('')).toBe('');
  });

  it('converts a datetime-local string in UTC back to ISO', () => {
    const result = localToUTC('2024-06-15T18:30', UTC_TZ);
    expect(result).toBe('2024-06-15T18:30:00.000Z');
  });

  it('converts a datetime-local in a specific timezone to UTC', () => {
    // 2:30 PM Eastern (EDT, UTC-4) = 6:30 PM UTC
    const result = localToUTC('2024-06-15T14:30', 'America/New_York');
    expect(result).toBe('2024-06-15T18:30:00.000Z');
  });

  it('handles a date without time part', () => {
    const result = localToUTC('2024-06-15', UTC_TZ);
    expect(result).toBe('2024-06-15T00:00:00.000Z');
  });

  it('roundtrips with formatForDateTimeInput in UTC', () => {
    const original = '2024-06-15T18:30:00.000Z';
    const local = formatForDateTimeInput(original, UTC_TZ);
    const roundtripped = localToUTC(local, UTC_TZ);
    expect(roundtripped).toBe(original);
  });

  it('roundtrips with formatForDateTimeInput in a specific timezone', () => {
    const original = '2024-06-15T18:30:00.000Z';
    const tz = 'America/New_York';
    const local = formatForDateTimeInput(original, tz);
    const roundtripped = localToUTC(local, tz);
    expect(roundtripped).toBe(original);
  });

  it('roundtrips with formatForDateTimeInput in Chicago timezone', () => {
    const original = '2024-06-15T18:45:00.000Z';
    const tz = 'America/Chicago';
    const local = formatForDateTimeInput(original, tz);
    const roundtripped = localToUTC(local, tz);
    expect(roundtripped).toBe(original);
  });

  it('roundtrips with formatForDateTimeInput in Tokyo timezone', () => {
    const original = '2024-06-15T18:00:00.000Z';
    const tz = 'Asia/Tokyo';
    const local = formatForDateTimeInput(original, tz);
    const roundtripped = localToUTC(local, tz);
    expect(roundtripped).toBe(original);
  });

  it('handles timezone without explicit timezone (browser local)', () => {
    const result = localToUTC('2024-06-15T14:30');
    // Should produce a valid ISO string (exact value depends on test runner timezone)
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe('getTodayLocalDate', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a YYYY-MM-DD string', () => {
    const result = getTodayLocalDate(UTC_TZ);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns the correct date for UTC', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T23:30:00.000Z'));
    expect(getTodayLocalDate(UTC_TZ)).toBe('2024-06-15');
  });

  it('respects timezone and may differ from UTC', () => {
    vi.useFakeTimers();
    // 11:30 PM UTC on June 15 is already June 16 in Tokyo (+9)
    vi.setSystemTime(new Date('2024-06-15T23:30:00.000Z'));
    expect(getTodayLocalDate('Asia/Tokyo')).toBe('2024-06-16');
    expect(getTodayLocalDate(UTC_TZ)).toBe('2024-06-15');
  });
});

describe('toLocalDateString', () => {
  it('converts a Date to YYYY-MM-DD in UTC', () => {
    expect(toLocalDateString(TEST_DATE, UTC_TZ)).toBe('2024-06-15');
  });

  it('respects timezone parameter', () => {
    // 11:30 PM UTC on June 15 is June 16 in Tokyo
    const lateDate = new Date('2024-06-15T23:30:00.000Z');
    expect(toLocalDateString(lateDate, 'Asia/Tokyo')).toBe('2024-06-16');
  });
});

describe('daysUntil', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns positive days for a future date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00.000Z'));
    // 10 days in the future
    const result = daysUntil('2024-06-25T12:00:00.000Z');
    expect(result).toBe(10);
  });

  it('returns negative days for a past date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00.000Z'));
    const result = daysUntil('2024-06-10T12:00:00.000Z');
    expect(result).toBe(-5);
  });

  it('returns 0 for today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00.000Z'));
    const result = daysUntil('2024-06-15T12:00:00.000Z');
    expect(result).toBe(0);
  });

  it('returns NaN for invalid date', () => {
    expect(daysUntil('invalid')).toBeNaN();
  });

  it('accepts a Date object', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00.000Z'));
    const result = daysUntil(new Date('2024-06-20T12:00:00.000Z'));
    expect(result).toBe(5);
  });

  it('uses Math.floor so partial days round down', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00.000Z'));
    // 2.5 days in the future
    const result = daysUntil('2024-06-18T00:00:00.000Z');
    expect(result).toBe(2);
  });
});

describe('calculateDurationMinutes', () => {
  it('calculates positive duration for end > start', () => {
    const start = '2024-06-15T10:00:00.000Z';
    const end = '2024-06-15T11:30:00.000Z';
    expect(calculateDurationMinutes(start, end)).toBe(90);
  });

  it('returns 0 for identical dates', () => {
    const date = '2024-06-15T10:00:00.000Z';
    expect(calculateDurationMinutes(date, date)).toBe(0);
  });

  it('returns negative duration for end < start', () => {
    const start = '2024-06-15T11:30:00.000Z';
    const end = '2024-06-15T10:00:00.000Z';
    expect(calculateDurationMinutes(start, end)).toBe(-90);
  });

  it('returns NaN when start date is invalid', () => {
    expect(calculateDurationMinutes('invalid', '2024-06-15T10:00:00.000Z')).toBeNaN();
  });

  it('returns NaN when end date is invalid', () => {
    expect(calculateDurationMinutes('2024-06-15T10:00:00.000Z', 'bad')).toBeNaN();
  });

  it('returns NaN when both dates are invalid', () => {
    expect(calculateDurationMinutes('x', 'y')).toBeNaN();
  });

  it('accepts Date objects', () => {
    const start = new Date('2024-06-15T10:00:00.000Z');
    const end = new Date('2024-06-15T12:00:00.000Z');
    expect(calculateDurationMinutes(start, end)).toBe(120);
  });

  it('handles multi-day durations', () => {
    const start = '2024-06-15T00:00:00.000Z';
    const end = '2024-06-17T00:00:00.000Z';
    expect(calculateDurationMinutes(start, end)).toBe(2 * 24 * 60);
  });

  it('handles cross-midnight durations', () => {
    const start = '2024-06-15T23:00:00.000Z';
    const end = '2024-06-16T01:00:00.000Z';
    expect(calculateDurationMinutes(start, end)).toBe(120);
  });
});

describe('isPastDate', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true for a date in the past', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00.000Z'));
    expect(isPastDate('2024-06-14T12:00:00.000Z')).toBe(true);
  });

  it('returns false for a date in the future', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00.000Z'));
    expect(isPastDate('2024-06-16T12:00:00.000Z')).toBe(false);
  });

  it('returns false for an invalid date', () => {
    expect(isPastDate('not-a-date')).toBe(false);
  });

  it('accepts a Date object', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00.000Z'));
    expect(isPastDate(new Date('2020-01-01'))).toBe(true);
  });
});

describe('isFutureDate', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true for a date in the future', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00.000Z'));
    expect(isFutureDate('2024-06-16T12:00:00.000Z')).toBe(true);
  });

  it('returns false for a date in the past', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00.000Z'));
    expect(isFutureDate('2024-06-14T12:00:00.000Z')).toBe(false);
  });

  it('returns false for an invalid date', () => {
    expect(isFutureDate('not-a-date')).toBe(false);
  });

  it('accepts a Date object', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00.000Z'));
    expect(isFutureDate(new Date('2030-01-01'))).toBe(true);
  });
});
