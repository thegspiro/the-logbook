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
import {
  addHours,
  addHoursExact,
  syncEndToStart,
  syncEndToStartExact,
  resolveEndUtc,
  DURATION_PRESET_HOURS,
} from './entryTimes';
import { localToUTC } from '../../../utils/dateFormatting';

const TZ = 'America/New_York';
const HOUR_MS = 60 * 60 * 1000;

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

// America/New_York falls back from 2:00am EDT to 1:00am EST on 2026-11-01, so
// every local time from 01:00 through 01:59 occurs twice that morning. A
// 2-hour preset starting at 00:30 EDT crosses the fold and should always
// submit as a full 2 hours, whichever of the two 01:30s the wall-clock string
// ends up denoting.
describe('DST fall-back fold (regression for the entryTimes.ts duration bug)', () => {
  const FOLD_START = '2026-11-01T00:30';

  it('addHoursExact computes the target instant as real elapsed time, not clock-face arithmetic', () => {
    const startUtcMs = new Date(localToUTC(FOLD_START, TZ)).getTime();
    const derived = addHoursExact(FOLD_START, 2, TZ);
    expect(derived).not.toBeNull();
    expect(derived?.utcMs).toBe(startUtcMs + 2 * HOUR_MS);
    // The display string is the ambiguous "01:30" — correct to show, but not
    // safe to re-parse on its own; that's exactly what utcMs is for.
    expect(derived?.local).toBe('2026-11-01T01:30');
  });

  it('re-parsing the derived string alone (no pin) silently collapses the duration to 1 hour — the bug', () => {
    const startUtcMs = new Date(localToUTC(FOLD_START, TZ)).getTime();
    const derived = addHoursExact(FOLD_START, 2, TZ);
    const naiveEndUtcMs = new Date(localToUTC(derived?.local ?? '', TZ)).getTime();
    // localToUTC always resolves an ambiguous fold string to its earlier
    // occurrence, so the naive round-trip is short by exactly the DST offset
    // change (1 hour) rather than the 2 hours the preset selected.
    expect(naiveEndUtcMs - startUtcMs).toBe(1 * HOUR_MS);
  });

  it('resolveEndUtc preserves the full selected duration across the fold via the pin', () => {
    const startUtcMs = new Date(localToUTC(FOLD_START, TZ)).getTime();
    const derived = addHoursExact(FOLD_START, 2, TZ);
    const resolved = resolveEndUtc(derived?.local ?? '', derived, TZ);
    expect(new Date(resolved).getTime() - startUtcMs).toBe(2 * HOUR_MS);
  });

  it('resolveEndUtc falls back to ordinary parsing once the field no longer matches the pin', () => {
    const derived = addHoursExact(FOLD_START, 2, TZ);
    const retyped = '2026-11-01T03:00';
    // The member typed over the preset-filled value by hand; the stale pin
    // (for a different string) must not be applied to it.
    expect(resolveEndUtc(retyped, derived, TZ)).toBe(localToUTC(retyped, TZ));
  });

  it('resolveEndUtc with no pin behaves exactly like plain localToUTC', () => {
    expect(resolveEndUtc('2026-09-01T18:00', null, TZ)).toBe(localToUTC('2026-09-01T18:00', TZ));
  });

  it('syncEndToStartExact fills a blank end across the fold with a pin, matching addHoursExact', () => {
    const { local, pin } = syncEndToStartExact('', FOLD_START, '', null, TZ);
    const derived = addHoursExact(FOLD_START, 1, TZ);
    expect(local).toBe(derived?.local);
    expect(pin).toEqual(derived);
  });

  it('syncEndToStartExact carries an existing pin through when only the start time-of-day changes', () => {
    const derived = addHoursExact(FOLD_START, 2, TZ);
    const result = syncEndToStartExact(FOLD_START, '2026-11-01T00:45', derived?.local ?? '', derived, TZ);
    expect(result.local).toBe(derived?.local);
    expect(result.pin).toEqual(derived);
  });

  it('syncEndToStartExact drops the pin when the start date shifts (no fixed instant to offer)', () => {
    const derived = addHoursExact(FOLD_START, 2, TZ);
    const result = syncEndToStartExact(FOLD_START, '2026-11-02T00:30', derived?.local ?? '', derived, TZ);
    expect(result.pin).toBeNull();
  });
});
