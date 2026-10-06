import { describe, it, expect } from 'vitest';
import type { InstructorQualification } from '../types/training';
import { qualificationStanding } from './instructorQualifications';

const qual = (overrides: Partial<InstructorQualification> = {}): InstructorQualification => ({
  id: 'q1',
  organization_id: 'org-1',
  user_id: 'u1',
  qualification_type: 'instructor',
  active: true,
  verified: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('qualificationStanding', () => {
  it('reads a lapsed qualification as expired, verified or not', () => {
    expect(qualificationStanding(qual({ expiration_date: '2026-10-04' }), '2026-10-05')).toBe('expired');
    expect(qualificationStanding(qual({ verified: false, expiration_date: '2026-01-01' }), '2026-10-05')).toBe(
      'expired'
    );
  });

  it('counts the expiry day itself as still valid', () => {
    expect(qualificationStanding(qual({ expiration_date: '2026-10-05' }), '2026-10-05')).toBe('verified');
  });

  it('falls back to inactive, then verification', () => {
    expect(qualificationStanding(qual({ active: false }), '2026-10-05')).toBe('inactive');
    expect(qualificationStanding(qual({ verified: false }), '2026-10-05')).toBe('pending');
    expect(qualificationStanding(qual(), '2026-10-05')).toBe('verified');
  });
});
