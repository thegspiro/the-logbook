/**
 * A certification requirement read as a state with its date: "On file"
 * (expiring on `expiry`, or never), "Expired" on `expiry`, or "Not recorded".
 *
 * One definition for every screen that words a member's certification this
 * way: the requirement card on My Training and the officer's member view, and
 * the member profile's certifications list. The server decides whether the
 * requirement is met and which certificate it graded (`is_met`,
 * `expiry_date`); this only names the result.
 *
 * Null when the requirement is not a certification, when no session it
 * depends on has been held, or when the department withholds certification
 * status from members (`certification_status_hidden`): then the server sent
 * no date to read, and saying "Not recorded" would misstate a certificate
 * that may well be on file.
 */

import type { RequirementDetail } from '../types/training';

export type CertificationState = 'on_file' | 'expired' | 'missing';

export interface CertificationStatus {
  state: CertificationState;
  /** The graded certificate's expiry (YYYY-MM-DD), or null when none applies. */
  expiry: string | null;
}

export const certificationStatusOf = (req: RequirementDetail): CertificationStatus | null => {
  if (req.requirement_type !== 'certification' || req.not_applicable === true) return null;
  if (req.certification_status_hidden === true) return null;
  const expiry = req.expiry_date ?? null;
  if (req.is_met) return { state: 'on_file', expiry };
  return expiry ? { state: 'expired', expiry } : { state: 'missing', expiry: null };
};
