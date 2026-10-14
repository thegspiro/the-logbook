/**
 * What a member needs to act on soon, assembled from the my-training summary.
 *
 * Every date and "days until" figure here is the server's: the page reports
 * what the compliance service decided and does not re-derive it. The one
 * calculation done client-side is the distance to `next_window_opens`, which
 * the server sends as a date only.
 */

import type { MyTrainingSummary, RequirementDetail } from '../types/training';
import { countingWindowLabel } from './requirementMonths';

/** How far ahead the list looks, in days. */
export const UPCOMING_WINDOW_DAYS = 183;

/** Inside this many days an item reads as due soon rather than merely upcoming. */
export const DUE_SOON_DAYS = 90;

export type UpcomingKind = 'requirement' | 'certification' | 'skill' | 'window' | 'shortfall';
export type UpcomingUrgency = 'overdue' | 'soon' | 'later';

export interface UpcomingItem {
  key: string;
  kind: UpcomingKind;
  title: string;
  detail: string;
  /**
   * The date the item turns on: a deadline, an expiry or a window opening.
   * Null for a shortfall, which has no date: it is short on every day.
   */
  date: string | null;
  days: number | null;
  /** Hours still to earn, for a shortfall. */
  hoursShort?: number;
  urgency: UpcomingUrgency;
}

const MS_PER_DAY = 86_400_000;

/** Whole days from `fromIso` to `toIso`, both `YYYY-MM-DD`; negative when past. */
export const daysBetween = (fromIso: string, toIso: string): number => {
  const parse = (iso: string): number => {
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
    return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((parse(toIso) - parse(fromIso)) / MS_PER_DAY);
};

const urgencyFor = (days: number): UpcomingUrgency => {
  if (days < 0) return 'overdue';
  return days <= DUE_SOON_DAYS ? 'soon' : 'later';
};

const requirementItems = (details: RequirementDetail[], today: string): UpcomingItem[] =>
  details.flatMap((req): UpcomingItem[] => {
    if (req.is_met) {
      // Met for this cycle: the only thing left to do is take it early for the
      // next one, once its window opens.
      if (!req.next_window_opens) return [];
      const days = daysBetween(today, req.next_window_opens);
      if (days > UPCOMING_WINDOW_DAYS) return [];
      return [
        {
          key: `window-${req.id}`,
          kind: 'window',
          title: req.name,
          detail: 'Next completion window opens',
          date: req.next_window_opens,
          days,
          urgency: days <= 0 ? 'soon' : 'later',
        },
      ];
    }
    const date = req.catch_up_deadline ?? req.due_date;
    if (!date) {
      // An hours requirement counted over a rolling window has no deadline: it
      // is met or short on any day. Left out, an unmet 72-hour requirement
      // would be the one obligation on the page the list never mentioned.
      if (!req.monthly_hours?.length) return [];
      return [
        {
          key: `short-${req.id}`,
          kind: 'shortfall',
          title: req.name,
          detail: `${req.completed_hours}/${req.required_hours} hrs · counting ${countingWindowLabel(req.monthly_hours)}`,
          date: null,
          days: null,
          hoursShort: Math.max(req.required_hours - req.completed_hours, 0),
          urgency: 'soon',
        },
      ];
    }
    const days = req.catch_up_deadline ? daysBetween(today, req.catch_up_deadline) : (req.days_until_due ?? 0);
    if (days > UPCOMING_WINDOW_DAYS) return [];
    return [
      {
        key: `req-${req.id}`,
        kind: 'requirement',
        title: req.name,
        detail: `${req.completed_hours}/${req.required_hours} hrs complete`,
        date,
        days,
        urgency: urgencyFor(days),
      },
    ];
  });

/**
 * One row per certification, the newest by expiry. `certifications` is built
 * from every record that carries an expiry date, so a renewed certificate
 * keeps its lapsed predecessor in the list; reading both would report a
 * credential as expired the day after it was renewed.
 */
const certificationItems = (certs: NonNullable<MyTrainingSummary['certifications']>): UpcomingItem[] => {
  const newest = new Map<string, (typeof certs)[number]>();
  for (const cert of certs) {
    if (!cert.expiration_date) continue;
    const held = newest.get(cert.course_name);
    if (!held || (held.expiration_date ?? '') < cert.expiration_date) newest.set(cert.course_name, cert);
  }
  return [...newest.values()].flatMap((cert): UpcomingItem[] => {
    if (cert.expiration_date == null || cert.days_until_expiry == null) return [];
    if (cert.days_until_expiry > UPCOMING_WINDOW_DAYS) return [];
    return [
      {
        key: `cert-${cert.id}`,
        kind: 'certification',
        title: cert.course_name,
        detail: cert.is_expired ? 'Certification expired' : 'Certification expires',
        date: cert.expiration_date,
        days: cert.days_until_expiry,
        urgency: urgencyFor(cert.days_until_expiry),
      },
    ];
  });
};

const skillItems = (tests: NonNullable<MyTrainingSummary['skill_test_expirations']>): UpcomingItem[] =>
  tests.flatMap((test): UpcomingItem[] => {
    if (test.days_until_expiry > UPCOMING_WINDOW_DAYS) return [];
    return [
      {
        key: `skill-${test.id}`,
        kind: 'skill',
        title: test.template_name,
        detail: test.days_until_expiry < 0 ? 'Skills test expired' : 'Skills test expires',
        date: test.expiration_date,
        days: test.days_until_expiry,
        urgency: urgencyFor(test.days_until_expiry),
      },
    ];
  });

/**
 * Overdue first, then soonest, then anything short with no date. Requirement rows are left out when the
 * department hides requirement details, and certification rows when it hides
 * certification status — the server omits the underlying lists in that case.
 */
export const buildUpcomingItems = (
  data: MyTrainingSummary,
  today: string,
  includeSkillTests = true
): UpcomingItem[] => {
  const certs = certificationItems(data.certifications ?? []);
  const certTitles = new Set(certs.map((c) => c.title.trim().toLowerCase()));
  // A certification requirement and the record it is graded on are one
  // obligation; the certification row carries the actual expiry.
  const requirements = requirementItems(data.requirements_detail ?? [], today).filter(
    (r) => r.kind !== 'requirement' || !certTitles.has(r.title.trim().toLowerCase())
  );
  const skills = includeSkillTests ? skillItems(data.skill_test_expirations ?? []) : [];
  return [...requirements, ...certs, ...skills].sort((a, b) => {
    // Dated items by how soon, then the ones with no date, which are short
    // every day and so have no "soonest".
    if (a.days === null || b.days === null) return Number(a.days === null) - Number(b.days === null);
    return a.days - b.days;
  });
};
