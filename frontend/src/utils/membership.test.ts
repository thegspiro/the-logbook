/**
 * The member-class helpers, and the one shape they must not have.
 *
 * Mirrors `backend/tests/test_administrative_rank_restriction.py`. The rule is
 * enforced on the server; these helpers only decide which controls a screen
 * greys out, and getting them wrong greys out the wrong departments.
 */

import { describe, it, expect } from 'vitest';
import { effectiveMemberClass, isAdministrativeMember, memberClassAndStatusFor } from './membership';

describe('effectiveMemberClass', () => {
  it('prefers the explicit class over the legacy field', () => {
    expect(effectiveMemberClass('operational', 'administrative')).toBe('operational');
    expect(effectiveMemberClass('administrative', 'active')).toBe('administrative');
  });

  it('normalizes case and surrounding space', () => {
    expect(effectiveMemberClass('  Administrative ')).toBe('administrative');
  });

  it('derives the class from the legacy field when none is set', () => {
    expect(effectiveMemberClass(undefined, 'active')).toBe('operational');
    expect(effectiveMemberClass(undefined, 'life')).toBe('operational');
    expect(effectiveMemberClass(undefined, 'honorary')).toBe('social');
    expect(effectiveMemberClass(undefined, 'administrative')).toBe('administrative');
  });

  it('answers nothing for a value it does not recognize', () => {
    // `membership_type` doubles as an org-configurable tier id. Guessing here
    // would enrol every custom tier in rules they were never part of.
    expect(effectiveMemberClass(undefined, 'senior')).toBeUndefined();
    expect(effectiveMemberClass('made_up')).toBeUndefined();
    expect(effectiveMemberClass()).toBeUndefined();
  });
});

describe('isAdministrativeMember', () => {
  it('is true only for the administrative class', () => {
    expect(isAdministrativeMember(undefined, 'administrative')).toBe(true);
    expect(isAdministrativeMember('administrative', 'active')).toBe(true);
  });

  it.each(['active', 'life', 'retired', 'probationary', 'honorary', 'prospective', 'senior', ''])(
    'leaves %s alone',
    (membershipType) => {
      expect(isAdministrativeMember(undefined, membershipType)).toBe(false);
    }
  );

  it('is not the negation of "operational"', () => {
    // The regression this function's shape exists to prevent: a custom tier
    // resolves to no class at all, so `!isOperational(...)` would be true for
    // every department running one and would grey out their rank fields.
    expect(effectiveMemberClass(undefined, 'senior')).toBeUndefined();
    expect(isAdministrativeMember(undefined, 'senior')).toBe(false);
  });
});

describe('memberClassAndStatusFor', () => {
  it('splits the administrative option onto the class', () => {
    expect(memberClassAndStatusFor('administrative')).toEqual({
      member_class: 'administrative',
      member_status: 'regular',
    });
  });

  it("maps the form's 'regular' onto the status it actually is", () => {
    expect(memberClassAndStatusFor('regular')).toEqual({
      member_class: 'operational',
      member_status: 'regular',
    });
  });

  it.each([
    ['prospective', 'prospective'],
    ['probationary', 'probationary'],
    ['life', 'life'],
    ['retired', 'retired'],
    ['active', 'regular'],
  ])('maps %s to the operational class with status %s', (selection, status) => {
    expect(memberClassAndStatusFor(selection)).toEqual({
      member_class: 'operational',
      member_status: status,
    });
  });

  it('falls back to a regular operational member for anything unexpected', () => {
    expect(memberClassAndStatusFor('nonsense')).toEqual({
      member_class: 'operational',
      member_status: 'regular',
    });
  });
});
