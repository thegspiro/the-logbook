import { describe, it, expect } from 'vitest';
import { certificationStatusOf } from './certificationState';
import type { RequirementDetail } from '../types/training';

const cpr: RequirementDetail = {
  id: 'req-cpr',
  name: 'CPR/BLS Certification',
  requirement_type: 'certification',
  frequency: 'biannual',
  required_hours: 1,
  completed_hours: 1,
  progress_percentage: 100,
  is_met: true,
  due_date: null,
  days_until_due: null,
  expiry_date: '2027-03-14',
};

describe('certificationStatusOf', () => {
  it('reads a met certification as on file with its expiry', () => {
    expect(certificationStatusOf(cpr)).toEqual({ state: 'on_file', expiry: '2027-03-14' });
  });

  it('reads a certificate that never expires as on file with no date', () => {
    expect(certificationStatusOf({ ...cpr, expiry_date: null })).toEqual({ state: 'on_file', expiry: null });
  });

  it('reads an unmet certification with a date as expired on that date', () => {
    expect(certificationStatusOf({ ...cpr, is_met: false, expiry_date: '2026-03-14' })).toEqual({
      state: 'expired',
      expiry: '2026-03-14',
    });
  });

  it('reads an unmet certification with no date as not recorded', () => {
    expect(certificationStatusOf({ ...cpr, is_met: false, expiry_date: null })).toEqual({
      state: 'missing',
      expiry: null,
    });
  });

  it('says nothing when the department withholds certification status', () => {
    expect(certificationStatusOf({ ...cpr, is_met: false, certification_status_hidden: true })).toBeNull();
  });

  it('says nothing about other requirement types or ungraded ones', () => {
    expect(certificationStatusOf({ ...cpr, requirement_type: 'hours' })).toBeNull();
    expect(certificationStatusOf({ ...cpr, not_applicable: true })).toBeNull();
  });
});
