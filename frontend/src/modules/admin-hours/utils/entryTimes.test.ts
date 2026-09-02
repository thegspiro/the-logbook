/**
 * The end field follows the start's calendar date and nothing else. These
 * assertions pin that asymmetry, because the obvious "simplification" —
 * preserving the duration whenever the start moves — silently destroys an
 * overnight entry and fights the quick-duration buttons.
 *
 * A non-UTC department timezone throughout: arithmetic that happens to work in
 * UTC is exactly the arithmetic that ships broken here.
 */

import { describe, it, expect } from 'vitest';
import { addHours, syncEndToStart, DURATION_PRESET_HOURS } from './entryTimes';

const TZ = 'America/New_York';

describe('DURATION_PRESET_HOURS', () => {
  it('offers the same presets as the Create Events form', () => {
    expect([...DURATION_PRESET_HOURS]).toEqual([1, 2, 4, 8]);
  });
});

describe('addHours', () => {
  it('adds within the same day', () => {
    expect(addHours('2026-09-01T18:00', 2, TZ)).toBe('2026-09-01T20:00');
  });

  it('rolls the date past midnight', () => {
    expect(addHours('2026-09-01T23:00', 4, TZ)).toBe('2026-09-02T03:00');
  });

  it('rolls across a month boundary', () => {
    expect(addHours('2026-09-30T22:00', 4, TZ)).toBe('2026-10-01T02:00');
  });

  it('returns empty for a blank start rather than an invalid string', () => {
    expect(addHours('', 2, TZ)).toBe('');
  });
});

describe('syncEndToStart', () => {
  it('fills a blank end with one hour after the new start', () => {
    expect(syncEndToStart('', '2026-09-01T18:00', '', TZ)).toBe('2026-09-01T19:00');
  });

  it('puts the prefilled end on the same day the member just picked', () => {
    // The picker emits its 09:00 default when only a date has been chosen.
    expect(syncEndToStart('', '2026-09-01T09:00', '', TZ)).toBe('2026-09-01T10:00');
  });

  it('leaves the end alone when only the start time changed', () => {
    // The member sets the real start time, then presses a duration button. An
    // end that chased the start time would be fighting that press.
    expect(syncEndToStart('2026-09-01T09:00', '2026-09-01T18:00', '2026-09-01T10:00', TZ)).toBe('2026-09-01T10:00');
  });

  it('moves the end date by the same number of days as the start', () => {
    expect(syncEndToStart('2026-09-01T18:00', '2026-09-03T18:00', '2026-09-01T20:00', TZ)).toBe('2026-09-03T20:00');
  });

  it('moves the end date backwards too', () => {
    expect(syncEndToStart('2026-09-03T18:00', '2026-09-01T18:00', '2026-09-03T20:00', TZ)).toBe('2026-09-01T20:00');
  });

  it('keeps an overnight end overnight', () => {
    // The member hand-set an end on the following day; correcting the start
    // date must not collapse the entry onto a single day.
    expect(syncEndToStart('2026-09-01T22:00', '2026-09-02T22:00', '2026-09-02T02:00', TZ)).toBe('2026-09-03T02:00');
  });

  it('carries the end across a month boundary with the start', () => {
    expect(syncEndToStart('2026-09-30T18:00', '2026-10-01T18:00', '2026-09-30T20:00', TZ)).toBe('2026-10-01T20:00');
  });

  it('keeps the end when the start is cleared', () => {
    expect(syncEndToStart('2026-09-01T18:00', '', '2026-09-01T20:00', TZ)).toBe('2026-09-01T20:00');
  });

  it('does not move an end set before any start date existed', () => {
    expect(syncEndToStart('', '2026-09-01T18:00', '2026-09-04T20:00', TZ)).toBe('2026-09-04T20:00');
  });
});
