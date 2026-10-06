import type { InstructorQualification } from '../types/training';

export type QualificationStanding = 'expired' | 'inactive' | 'verified' | 'pending';

export const QUALIFICATION_STANDING: Record<QualificationStanding, { label: string; className: string }> = {
  expired: { label: 'Expired', className: 'bg-red-500/10 text-red-700 dark:text-red-400' },
  inactive: { label: 'Inactive', className: 'bg-theme-surface-secondary text-theme-text-secondary' },
  verified: { label: 'Verified', className: 'bg-green-500/10 text-green-700 dark:text-green-400' },
  pending: { label: 'Pending', className: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400' },
};

/**
 * Where a qualification stands today, in the department's own date. A lapsed
 * one used to read "Pending" because the column reported only `verified`;
 * expiry is checked first because an expired qualification no longer counts,
 * verified or not (the backend compares against the same org-local today).
 */
export function qualificationStanding(qual: InstructorQualification, todayIso: string): QualificationStanding {
  const expires = qual.expiration_date?.split('T')[0] ?? '';
  if (expires && expires < todayIso) return 'expired';
  if (!qual.active) return 'inactive';
  return qual.verified ? 'verified' : 'pending';
}
