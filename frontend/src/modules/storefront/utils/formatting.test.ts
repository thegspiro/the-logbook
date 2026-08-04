import { describe, it, expect } from 'vitest';
import { formatDateOnly, toDateInputValue } from './formatting';

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
