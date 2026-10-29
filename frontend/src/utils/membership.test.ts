/**
 * The member-class helpers, and the one shape they must not have.
 *
 * Mirrors `backend/tests/test_administrative_rank_restriction.py`. The rule is
 * enforced on the server; these helpers only decide which controls a screen
 * greys out, and getting them wrong greys out the wrong departments.
 */

import { describe, it, expect } from 'vitest';
import {
  canonicalMemberStatus,
  effectiveMemberClass,
  isAdministrativeMember,
  isBuiltinStatus,
  memberClassAndStatusFor,
  memberClassLabel,
  memberStatusLabel,
  statusOptionsFor,
} from './membership';

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

describe('canonicalMemberStatus', () => {
  it.each([
    ['active', 'regular'],
    ['Active ', 'regular'],
    ['probationary', 'probationary'],
    ['life', 'life'],
    ['regular', 'regular'],
    ['administrative', 'regular'],
    ['senior', 'senior'],
    ['Senior', 'senior'],
  ])('spells %s as %s, the way the column stores it', (value, expected) => {
    expect(canonicalMemberStatus(value)).toBe(expected);
  });

  it('is nothing for a blank', () => {
    expect(canonicalMemberStatus('')).toBeUndefined();
    expect(canonicalMemberStatus('   ')).toBeUndefined();
    expect(canonicalMemberStatus(null)).toBeUndefined();
    expect(canonicalMemberStatus(undefined)).toBeUndefined();
  });

  it('knows the seven built-in statuses', () => {
    expect(isBuiltinStatus('life')).toBe(true);
    expect(isBuiltinStatus('senior')).toBe(false);
    expect(isBuiltinStatus('active')).toBe(false);
  });
});

describe('memberStatusLabel', () => {
  const tiers = [
    { id: 'active', name: 'Active Member', years_required: 1, sort_order: 1, benefits: {} },
    { id: 'senior', name: 'Senior Member', years_required: 10, sort_order: 2, benefits: {} },
  ];

  it('labels a built-in status', () => {
    expect(memberStatusLabel('life')).toBe('Life');
    expect(memberStatusLabel('probationary')).toBe('Probationary');
  });

  it("uses the department's own name for a tier when the ladder is at hand", () => {
    expect(memberStatusLabel('senior', tiers)).toBe('Senior Member');
    // The regular status is the ladder's "active" rung, under that name.
    expect(memberStatusLabel('regular', tiers)).toBe('Active Member');
  });

  it('humanises a tier id the ladder does not name', () => {
    expect(memberStatusLabel('senior')).toBe('Senior');
    expect(memberStatusLabel('distinguished_service')).toBe('Distinguished service');
  });

  it('is empty for nothing', () => {
    expect(memberStatusLabel(null)).toBe('');
  });
});

describe('statusOptionsFor', () => {
  const tiers = [
    { id: 'probationary', name: 'Probie', years_required: 0, sort_order: 0, benefits: {} },
    { id: 'active', name: 'Active Member', years_required: 1, sort_order: 1, benefits: {} },
    { id: 'senior', name: 'Senior Member', years_required: 10, sort_order: 2, benefits: {} },
  ];

  it('offers the seven built-ins with no ladder', () => {
    expect(statusOptionsFor().map((o) => o.value)).toEqual([
      'prospective',
      'probationary',
      'regular',
      'life',
      'retired',
      'honorary',
      'junior',
    ]);
  });

  it('merges the ladder in, one entry per standing', () => {
    const options = statusOptionsFor(tiers);
    const values = options.map((o) => o.value);
    expect(values).toContain('senior');
    expect(values).not.toContain('active');
    expect(values.filter((v) => v === 'regular')).toHaveLength(1);
    expect(options.find((o) => o.value === 'regular')?.label).toBe('Active Member');
    expect(options.find((o) => o.value === 'probationary')?.label).toBe('Probie');
  });

  it('keeps a stored value neither list names, so it can still be selected', () => {
    const options = statusOptionsFor(tiers, ['cadet', 'life', 'Active']);
    expect(options.find((o) => o.value === 'cadet')).toEqual({ value: 'cadet', label: 'Cadet' });
    expect(options.filter((o) => o.value === 'life')).toHaveLength(1);
    expect(options.filter((o) => o.value === 'regular')).toHaveLength(1);
  });
});

describe('memberClassLabel', () => {
  it('labels the three classes and nothing else', () => {
    expect(memberClassLabel('operational')).toBe('Operational');
    expect(memberClassLabel('Administrative')).toBe('Administrative');
    expect(memberClassLabel('social')).toBe('Social');
    expect(memberClassLabel(undefined)).toBe('');
    expect(memberClassLabel('senior')).toBe('');
  });
});
