import { describe, it, expect } from 'vitest';
import { ORGANIZATION_PROFILE_MAX_LENGTH, organizationEmailError } from './organizationProfile';

describe('organizationEmailError', () => {
  it('accepts an ordinary address', () => {
    expect(organizationEmailError('office@station12.org')).toBeNull();
  });

  it('accepts a blank, which clears the field', () => {
    expect(organizationEmailError('')).toBeNull();
    expect(organizationEmailError('   ')).toBeNull();
  });

  it('ignores surrounding spaces', () => {
    expect(organizationEmailError('  office@station12.org ')).toBeNull();
  });

  it.each(['office.station12.org', 'office@station12', 'office @station12.org', '@station12.org'])(
    'refuses %s',
    (value) => {
      expect(organizationEmailError(value)).toMatch(/enter an email address/i);
    }
  );
});

describe('ORGANIZATION_PROFILE_MAX_LENGTH', () => {
  it('matches the Organization columns', () => {
    // Mirrors backend/tests/test_organization_profile_limits.py, which pins
    // OrganizationProfileUpdate to the same columns. Change both together.
    expect(ORGANIZATION_PROFILE_MAX_LENGTH).toEqual({
      name: 255,
      phone: 20,
      email: 255,
      website: 255,
      county: 100,
      addressLine: 255,
      city: 100,
      state: 50,
      zip: 20,
    });
  });
});
