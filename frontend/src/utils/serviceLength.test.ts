import { describe, it, expect } from 'vitest';
import { formatServiceSpan, spanBetween, spanFromDays } from './serviceLength';

describe('spanBetween', () => {
  it('completes a year on its anniversary, not the day before', () => {
    expect(spanBetween('2016-09-24', '2026-09-24')).toEqual({ years: 10, months: 0 });
    expect(spanBetween('2016-09-25', '2026-09-24')).toEqual({ years: 9, months: 11 });
  });

  it('counts partial months only once the day of the month is reached', () => {
    expect(spanBetween('2026-01-15', '2026-03-14')).toEqual({ years: 0, months: 1 });
    expect(spanBetween('2026-01-15', '2026-03-15')).toEqual({ years: 0, months: 2 });
  });

  it('never goes negative, and tolerates unparseable input', () => {
    expect(spanBetween('2027-01-01', '2026-01-01')).toEqual({ years: 0, months: 0 });
    expect(spanBetween('not a date', '2026-01-01')).toEqual({ years: 0, months: 0 });
  });
});

describe('spanFromDays', () => {
  it('recovers the unbroken span a day count covers', () => {
    // 2016-09-24 -> 2026-09-24 is 3652 days.
    expect(spanFromDays(3652, '2026-09-24')).toEqual({ years: 10, months: 0 });
    expect(spanFromDays(3651, '2026-09-24')).toEqual({ years: 9, months: 11 });
  });

  it('is zero for no service', () => {
    expect(spanFromDays(0, '2026-09-24')).toEqual({ years: 0, months: 0 });
  });
});

describe('formatServiceSpan', () => {
  it('reads naturally', () => {
    expect(formatServiceSpan({ years: 7, months: 3 })).toBe('7 years, 3 months');
    expect(formatServiceSpan({ years: 1, months: 0 })).toBe('1 year');
    expect(formatServiceSpan({ years: 0, months: 1 })).toBe('1 month');
    expect(formatServiceSpan({ years: 0, months: 0 })).toBe('Less than a month');
  });
});
