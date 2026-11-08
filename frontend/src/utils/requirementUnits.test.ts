import { describe, it, expect } from 'vitest';
import { requirementUnit } from './requirementUnits';

describe('requirementUnit', () => {
  it('names what each counted requirement type counts', () => {
    expect(requirementUnit('hours', 42)).toBe('hrs');
    expect(requirementUnit('courses', 4)).toBe('courses');
    expect(requirementUnit('shifts', 2)).toBe('shifts');
    expect(requirementUnit('calls', 10)).toBe('calls');
    expect(requirementUnit('session_attendance', 3)).toBe('sessions');
  });

  it('uses the singular for one', () => {
    expect(requirementUnit('hours', 1)).toBe('hr');
    expect(requirementUnit('courses', 1)).toBe('course');
  });

  it('gives no unit to a type graded done or not done', () => {
    expect(requirementUnit('certification', 1)).toBe('');
    expect(requirementUnit('checklist', 1)).toBe('');
  });

  it('reads an absent type as hours, as every card was labelled before', () => {
    expect(requirementUnit(undefined, 6)).toBe('hrs');
  });
});
