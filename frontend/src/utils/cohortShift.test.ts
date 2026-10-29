import { describe, it, expect } from 'vitest';
import { MAX_COHORT_SHIFT_DAYS } from '@/constants/config';
import { shiftDaysError } from './cohortShift';

describe('shiftDaysError', () => {
  it.each(['1', '-1', '7', '14', '-14', ' 3 '])('allows %j', (raw) => {
    expect(shiftDaysError(raw)).toBeNull();
  });

  it.each(['15', '-15', '365', '2147483648'])('refuses %j as too far', (raw) => {
    expect(shiftDaysError(raw)).toBe(`Classes can be moved by at most ${MAX_COHORT_SHIFT_DAYS} days either way`);
  });

  it.each(['', '  ', '0', '1.5', 'abc'])('refuses %j as not a usable number', (raw) => {
    expect(shiftDaysError(raw)).toBe('Enter a whole number of days');
  });

  it('mirrors the API limit of 14 days', () => {
    expect(MAX_COHORT_SHIFT_DAYS).toBe(14);
  });
});
