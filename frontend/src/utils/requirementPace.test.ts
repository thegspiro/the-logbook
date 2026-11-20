import { describe, it, expect } from 'vitest';
import { monthlyPaceOf, paceLabel, paceSpoken, perMonth } from './requirementPace';

describe('requirementPace', () => {
  it('is absent without an average', () => {
    expect(monthlyPaceOf(null, 6)).toBeNull();
    expect(monthlyPaceOf(undefined, undefined)).toBeNull();
  });

  it('prints one decimal and drops a trailing zero', () => {
    expect(perMonth(6.94)).toBe('6.9');
    expect(perMonth(6)).toBe('6');
    expect(perMonth(6.04)).toBe('6');
  });

  it('labels the average against the pace', () => {
    const pace = { average: 6.94, needed: 6 };
    expect(monthlyPaceOf(6.94, 6)).toEqual(pace);
    expect(paceLabel(pace)).toBe('6.9/6 hrs/mo avg');
    expect(paceSpoken(pace)).toBe('Averaging 6.9 hours a month of 6 needed');
  });

  it('labels the average alone when the requirement sets no pace', () => {
    const pace = { average: 4, needed: null };
    expect(monthlyPaceOf(4, undefined)).toEqual(pace);
    expect(paceLabel(pace)).toBe('4 hrs/mo avg');
    expect(paceSpoken(pace)).toBe('Averaging 4 hours a month');
  });
});
