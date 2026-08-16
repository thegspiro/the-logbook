/**
 * Readiness verdict — can this member respond tonight?
 *
 * Derived from certifications alone. It is deliberately NOT a full readiness
 * check: SCBA fit-test dates, medical currency and the qualifications each
 * apparatus seat requires are not modelled yet, so anything rendering this
 * verdict must state that scope on screen rather than implying it checked more
 * than it did.
 */

/** The certification shape the verdict reads, as returned by
 *  `trainingModuleConfigService.getMyTraining()`. */
export interface ReadinessCert {
  id: string;
  course_name: string;
  expiration_date: string | null;
  is_expired: boolean;
  days_until_expiry: number | null;
}

export type ReadinessLevel = 'clear' | 'conditions' | 'not-clear';

export interface Readiness {
  level: ReadinessLevel;
  headline: string;
  detail: string;
}

/** Days out at which an approaching expiry becomes a "condition". Matches the
 *  window the dashboard's "Needs you" panel uses to surface a certification, so
 *  the verdict and the rows beneath it never disagree about what is urgent. */
export const READINESS_WINDOW_DAYS = 60;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Reduce a member's certifications to a single verdict.
 *
 * Returns `null` when the member holds no tracked certifications. That case is
 * not "clear" — it is *unknown*, and a green verdict derived from an empty set
 * would assert something the department has no basis for. Callers render
 * nothing rather than guess.
 */
export const computeReadiness = (certs: ReadinessCert[]): Readiness | null => {
  if (certs.length === 0) return null;

  const expired = certs.filter((c) => c.is_expired);
  const expiring = certs
    .filter((c) => !c.is_expired && c.days_until_expiry !== null && c.days_until_expiry <= READINESS_WINDOW_DAYS)
    .sort((a, b) => (a.days_until_expiry ?? Infinity) - (b.days_until_expiry ?? Infinity));

  // Expired outranks expiring: a member who is grounded must not be told they
  // are clear because a different card also happens to be near renewal.
  if (expired.length > 0) {
    const first = expired[0];
    return {
      level: 'not-clear',
      headline: 'Not clear to respond',
      detail:
        expired.length === 1 && first
          ? `${first.course_name} has expired`
          : `${plural(expired.length, 'certification')} expired`,
    };
  }

  if (expiring.length > 0) {
    const first = expiring[0];
    const lead =
      first && first.days_until_expiry !== null
        ? `${first.course_name} expires in ${plural(first.days_until_expiry, 'day')}`
        : 'A certification expires soon';
    return {
      level: 'conditions',
      headline: 'Clear, with conditions',
      detail: expiring.length > 1 ? `${lead}, ${expiring.length - 1} more expiring` : lead,
    };
  }

  return {
    level: 'clear',
    headline: 'Clear to respond',
    detail: `${plural(certs.length, 'certification')} current`,
  };
};
