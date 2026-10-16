import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dayHeading } from './dayHeading';

describe('dayHeading', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 01:00 UTC on the 16th is still the evening of the 15th in New York.
    vi.setSystemTime(new Date('2026-10-16T01:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('names the days either side of today in the viewer’s own calendar', () => {
    expect(dayHeading('2026-10-15', 'America/New_York')).toBe('Today');
    expect(dayHeading('2026-10-14', 'America/New_York')).toBe('Yesterday');
    expect(dayHeading('2026-10-16', 'America/New_York')).toBe('Tomorrow');
  });

  it('gives the weekday and date further out', () => {
    expect(dayHeading('2026-10-19', 'America/New_York')).toBe('Mon, Oct 19');
  });
});
