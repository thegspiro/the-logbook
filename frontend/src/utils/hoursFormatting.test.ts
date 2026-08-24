import { describe, it, expect } from 'vitest';
import { QUARTER_HOUR, roundHoursToQuarter, sumHoursToQuarter, formatHours, formatHoursExact } from './hoursFormatting';

describe('roundHoursToQuarter', () => {
  it('leaves values already on a quarter untouched', () => {
    expect(roundHoursToQuarter(0)).toBe(0);
    expect(roundHoursToQuarter(1)).toBe(1);
    expect(roundHoursToQuarter(2.25)).toBe(2.25);
    expect(roundHoursToQuarter(2.5)).toBe(2.5);
    expect(roundHoursToQuarter(66.75)).toBe(66.75);
  });

  it('rounds to the nearest quarter', () => {
    expect(roundHoursToQuarter(66.7)).toBe(66.75);
    expect(roundHoursToQuarter(2.9)).toBe(3);
    expect(roundHoursToQuarter(1.1)).toBe(1);
    expect(roundHoursToQuarter(1.2)).toBe(1.25);
    expect(roundHoursToQuarter(69.6)).toBe(69.5);
  });

  it('breaks a tie upward', () => {
    expect(roundHoursToQuarter(1.125)).toBe(1.25);
    expect(roundHoursToQuarter(1.375)).toBe(1.5);
    expect(roundHoursToQuarter(0.125)).toBe(0.25);
  });

  it('returns a clean quarter rather than the float drift it was given', () => {
    expect(roundHoursToQuarter(69.60000000000001)).toBe(69.5);
    expect(roundHoursToQuarter(0.1 + 0.2)).toBe(0.25);
  });

  it('rounds negative variances toward positive infinity, and never returns -0', () => {
    expect(roundHoursToQuarter(-2.9)).toBe(-3);
    expect(roundHoursToQuarter(-1.125)).toBe(-1);
    expect(Object.is(roundHoursToQuarter(-0.1), 0)).toBe(true);
  });

  it('treats absent and non-finite values as zero', () => {
    expect(roundHoursToQuarter(null)).toBe(0);
    expect(roundHoursToQuarter(undefined)).toBe(0);
    expect(roundHoursToQuarter(NaN)).toBe(0);
    expect(roundHoursToQuarter(Infinity)).toBe(0);
  });
});

describe('sumHoursToQuarter', () => {
  it('adds the rounded parts, so a total matches the parts shown beside it', () => {
    // The dashboard case: training 0, standby 66.7, administrative 2.9.
    expect(sumHoursToQuarter([0, 66.7, 2.9])).toBe(69.75);
    expect(formatHours(66.7) + ' + ' + formatHours(2.9)).toBe('66.75 + 3');
  });

  it('handles an empty list and absent members', () => {
    expect(sumHoursToQuarter([])).toBe(0);
    expect(sumHoursToQuarter([null, undefined, 1.1])).toBe(1);
  });
});

describe('formatHours', () => {
  it('drops trailing zeros and separates thousands', () => {
    expect(formatHours(3)).toBe('3');
    expect(formatHours(69.75)).toBe('69.75');
    expect(formatHours(66.5)).toBe('66.5');
    expect(formatHours(1840.4)).toBe('1,840.5');
  });

  it('rounds before formatting', () => {
    expect(formatHours(2.9)).toBe('3');
    expect(formatHours(69.60000000000001)).toBe('69.5');
  });

  it('shows an absent value as zero', () => {
    expect(formatHours(null)).toBe('0');
    expect(formatHours(undefined)).toBe('0');
  });
});

describe('formatHoursExact', () => {
  it('keeps a derived average off the quarter', () => {
    // 2.5 hours over three shifts. Quarter-rounding would print 0.75 and
    // misreport the metric by a tenth of an hour.
    expect(formatHoursExact(2.5 / 3)).toBe('0.83');
    expect(formatHours(2.5 / 3)).toBe('0.75');
  });

  it('never rounds a percentage-derived credit ceiling upward', () => {
    // An hour of attendance mapped at 40% credits 0.4 hours. "Credits up to
    // 0.5" promises more than check-out will award.
    expect(formatHoursExact(0.4)).toBe('0.4');
  });

  it('still strips float drift and trailing zeros', () => {
    expect(formatHoursExact(0.1 + 0.2)).toBe('0.3');
    expect(formatHoursExact(2)).toBe('2');
    expect(formatHoursExact(null)).toBe('0');
    expect(formatHoursExact(NaN)).toBe('0');
  });
});

describe('QUARTER_HOUR', () => {
  it('is the increment the rounding is built on', () => {
    expect(QUARTER_HOUR).toBe(0.25);
    expect(roundHoursToQuarter(QUARTER_HOUR)).toBe(QUARTER_HOUR);
  });
});
