/**
 * Readiness verdict — can this member respond tonight?
 *
 * Drawn from certifications and, where the department tracks them, medical
 * screening compliance. It is still not a complete check — SCBA fit-test dates
 * are not modelled anywhere in the product — so whatever renders this must name
 * the inputs it actually had on screen rather than implying a clearance.
 *
 * Counts only, never names. The screening figures arrive as counts from the
 * backend for a reason: this renders on tablets left at stations, where naming
 * a screening discloses it to whoever walks past.
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
 * The member's own screening compliance, as counts. Never names a screening —
 * see the backend `MyComplianceSummary` for why.
 */
export interface ReadinessScreenings {
  total_requirements: number;
  non_compliant_count: number;
  expiring_soon_count: number;
  /** Days until the soonest still-valid screening lapses; null when none is due. */
  days_until_next_expiration?: number | null | undefined;
}

/**
 * Reduce a certification list to the credential currently held for each course.
 *
 * `/training/module-config/my-training` returns every training record carrying
 * an expiration date, which is a *history*: a member who renewed EMT-B has both
 * the lapsed 2024 record and the valid 2026 one. Counting the lapsed row would
 * ground them permanently for having done the right thing, so only the newest
 * credential per course is judged.
 *
 * A record with no expiry outranks any dated one — it does not lapse, so no
 * later renewal supersedes it.
 */
export const currentCredentials = (certs: ReadinessCert[]): ReadinessCert[] => {
  const newest = new Map<string, ReadinessCert>();

  for (const cert of certs) {
    const held = newest.get(cert.course_name);
    if (!held) {
      newest.set(cert.course_name, cert);
      continue;
    }
    if (held.expiration_date === null) continue;
    if (cert.expiration_date === null || cert.expiration_date > held.expiration_date) {
      newest.set(cert.course_name, cert);
    }
  }

  return [...newest.values()];
};

/** "a, b and c" — the Oxford-less list the scope note and details read as. */
export const joinClauses = (parts: string[]): string => {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
};

/**
 * Reduce a member's certifications and screenings to a single verdict.
 *
 * Returns `null` when the department tracks neither for this member. That case
 * is not "clear" — it is *unknown*, and a green verdict derived from an empty
 * set would assert something the department has no basis for. Callers render
 * nothing rather than guess.
 *
 * `screenings` being undefined means the read failed or has not landed, which
 * is also not "clear": those requirements simply do not enter the verdict, and
 * the caller narrows the scope note to match.
 */
export const computeReadiness = (certs: ReadinessCert[], screenings?: ReadinessScreenings | null): Readiness | null => {
  const trackedScreenings = screenings && screenings.total_requirements > 0 ? screenings : null;
  const held = currentCredentials(certs);

  // Nothing tracked at all is *unknown*, not clear. With either input present
  // there is something real to say.
  if (held.length === 0 && !trackedScreenings) return null;

  const expired = held.filter((c) => c.is_expired);
  const expiring = held
    .filter((c) => !c.is_expired && c.days_until_expiry !== null && c.days_until_expiry <= READINESS_WINDOW_DAYS)
    .sort((a, b) => (a.days_until_expiry ?? Infinity) - (b.days_until_expiry ?? Infinity));

  // The detail counts rather than names. Naming the soonest certification
  // reproduced the row directly beneath it word for word — the "said twice"
  // fault the dashboard redesign existed to remove. The verdict summarises and
  // gives the total; the rows below carry the names and the buttons, and they
  // show at most two, so the count here is the part they cannot state.
  //
  // Expired outranks expiring: a member who is grounded must not be told they
  // are clear because a different card also happens to be near renewal.
  const overdue: string[] = [];
  if (expired.length > 0) overdue.push(`${plural(expired.length, 'certification')} expired`);
  if (trackedScreenings && trackedScreenings.non_compliant_count > 0) {
    overdue.push(`${plural(trackedScreenings.non_compliant_count, 'screening')} overdue`);
  }

  const soon: string[] = [];
  if (expiring.length > 0) {
    soon.push(`${plural(expiring.length, 'certification')} expiring within ${READINESS_WINDOW_DAYS} days`);
  }
  // Not expiring_soon_count: the backend counts a 30-day window, so a
  // screening lapsing in 45 days would read as current while a certification at
  // the same distance is a condition. The countdown is judged against the same
  // window as certifications, and includes one lapsing today, which the
  // backend's `0 < days` bound excludes.
  const screeningDays = trackedScreenings?.days_until_next_expiration ?? null;
  if (screeningDays !== null && screeningDays >= 0 && screeningDays <= READINESS_WINDOW_DAYS) {
    soon.push(`a screening expiring in ${plural(screeningDays, 'day')}`);
  }

  if (overdue.length > 0) {
    return {
      level: 'not-clear',
      headline: 'Not clear to respond',
      detail: joinClauses(overdue),
    };
  }

  if (soon.length > 0) {
    return {
      level: 'conditions',
      headline: 'Clear, with conditions',
      detail: joinClauses(soon),
    };
  }

  const current: string[] = [];
  if (held.length > 0) current.push(`${plural(held.length, 'certification')}`);
  if (trackedScreenings) current.push(`${plural(trackedScreenings.total_requirements, 'screening')}`);

  return {
    level: 'clear',
    headline: 'Clear to respond',
    detail: `${joinClauses(current)} current`,
  };
};
