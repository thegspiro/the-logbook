import { describe, it, expect } from 'vitest';
import {
  formatCountdown,
  formatCountdownShort,
  formatDateOnly,
  toDateInputValue,
  windowElapsedFraction,
} from './formatting';

describe('formatDateOnly', () => {
  it('formats a date-only API value without shifting the day', () => {
    // The bug this guards: parsing "2026-09-01" as UTC midnight and rendering
    // it in a western timezone yields Aug 31.
    expect(formatDateOnly('2026-09-01')).toBe('Sep 1, 2026');
  });

  it('accepts a full timestamp and uses its date part', () => {
    expect(formatDateOnly('2026-09-01T00:00:00Z')).toBe('Sep 1, 2026');
  });

  it('returns an empty string for missing values', () => {
    expect(formatDateOnly(null)).toBe('');
    expect(formatDateOnly(undefined)).toBe('');
    expect(formatDateOnly('')).toBe('');
  });

  it('returns an empty string for a malformed value', () => {
    expect(formatDateOnly('not-a-date')).toBe('');
  });
});

describe('toDateInputValue', () => {
  it('keeps a bare date unchanged', () => {
    expect(toDateInputValue('2026-09-01')).toBe('2026-09-01');
  });

  it('trims the time portion off a timestamp', () => {
    expect(toDateInputValue('2026-09-01T12:30:00Z')).toBe('2026-09-01');
  });

  it('returns an empty string for missing values', () => {
    expect(toDateInputValue(null)).toBe('');
    expect(toDateInputValue(undefined)).toBe('');
  });
});

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('formatCountdown', () => {
  it('counts whole days while the deadline is far off', () => {
    expect(formatCountdown(5 * DAY + 3 * HOUR)).toBe('5 days');
    expect(formatCountdown(DAY + MINUTE)).toBe('1 day');
  });

  it('switches to hours and minutes inside the last day', () => {
    expect(formatCountdown(4 * HOUR + 12 * MINUTE)).toBe('4h 12m');
    expect(formatCountdown(23 * HOUR + 59 * MINUTE)).toBe('23h 59m');
  });

  it('switches to minutes inside the last hour', () => {
    expect(formatCountdown(43 * MINUTE)).toBe('43m');
  });

  it('never counts down to zero minutes while time remains', () => {
    // Rounding 30s down to "0m" reads as closed while ordering is still open.
    expect(formatCountdown(30_000)).toBe('1m');
  });

  it('returns null once the window has closed', () => {
    expect(formatCountdown(0)).toBeNull();
    expect(formatCountdown(-HOUR)).toBeNull();
    expect(formatCountdown(Number.NaN)).toBeNull();
  });
});

describe('formatCountdownShort', () => {
  it('compresses each unit for the phone pill', () => {
    expect(formatCountdownShort(5 * DAY)).toBe('5d left');
    expect(formatCountdownShort(4 * HOUR + 12 * MINUTE)).toBe('4h left');
    expect(formatCountdownShort(43 * MINUTE)).toBe('43m left');
    expect(formatCountdownShort(-1)).toBeNull();
  });
});

describe('windowElapsedFraction', () => {
  const opens = '2026-09-01T00:00:00Z';
  const closes = '2026-09-11T00:00:00Z';

  it('reports the fraction of the window already spent', () => {
    expect(windowElapsedFraction(opens, closes, Date.parse('2026-09-08T00:00:00Z'))).toBeCloseTo(0.7);
  });

  it('clamps outside the window rather than overflowing the bar', () => {
    expect(windowElapsedFraction(opens, closes, Date.parse('2026-08-20T00:00:00Z'))).toBe(0);
    expect(windowElapsedFraction(opens, closes, Date.parse('2026-10-01T00:00:00Z'))).toBe(1);
  });

  it('returns null when either end is unknown', () => {
    // A bar drawn without both ends would be inventing a deadline.
    expect(windowElapsedFraction(null, closes, Date.now())).toBeNull();
    expect(windowElapsedFraction(opens, null, Date.now())).toBeNull();
    expect(windowElapsedFraction('not-a-date', closes, Date.now())).toBeNull();
  });

  it('returns null for a window that closes before it opens', () => {
    expect(windowElapsedFraction(closes, opens, Date.now())).toBeNull();
  });
});
