/**
 * Where a waiver or leave of absence stands on a given day.
 *
 * Shared by the Waivers screen and the member profile so the two cannot
 * disagree (CLAUDE.md pitfall #29). The backend's `active` flag only says the
 * record has not been cancelled; whether it is in force depends on its dates,
 * so a leave starting next month and one that ended years ago both arrive
 * with `active: true`.
 *
 * Dates are compared as `YYYY-MM-DD` strings: start and end are calendar
 * dates, and `today` must be the organization's local date
 * (`getTodayLocalDate(tz)`), not the UTC one.
 */

export interface WaiverDates {
  start_date: string;
  end_date: string | null;
  active: boolean;
}

export interface WaiverStatusBadge {
  label: 'Inactive' | 'Future' | 'Permanent' | 'Expired' | 'Active';
  color: string;
}

export function getWaiverStatusBadge(waiver: WaiverDates, today: string): WaiverStatusBadge {
  if (!waiver.active) {
    return { label: 'Inactive', color: 'bg-theme-surface-secondary text-theme-text-muted' };
  }
  if (waiver.start_date > today) {
    return { label: 'Future', color: 'bg-blue-500/20 text-blue-700 dark:text-blue-400' };
  }
  if (!waiver.end_date) {
    return { label: 'Permanent', color: 'bg-purple-500/20 text-purple-700 dark:text-purple-400' };
  }
  if (waiver.end_date < today) {
    return { label: 'Expired', color: 'bg-yellow-500/20 text-yellow-800 dark:text-yellow-400' };
  }
  return { label: 'Active', color: 'bg-green-500/20 text-green-800 dark:text-green-400' };
}
