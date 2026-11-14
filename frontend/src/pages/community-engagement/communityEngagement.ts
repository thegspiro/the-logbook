/**
 * The Community Engagement tab's presentation rules, kept free of React so they
 * can be tested on their own. Every figure here is one the backend computed
 * (community_engagement_service.py); this file only decides how it reads.
 */

import type {
  CommunityEventReach,
  CommunityPeriod,
  CommunityReachTotals,
  CommunityTypeBucket,
} from '../../services/api';
import { formatCalendarDate, formatDateCustom, formatNumber } from '../../utils/dateFormatting';
import type { CsvValue } from '../../utils/csv';

export interface PeriodOption {
  value: CommunityPeriod;
  label: string;
  /** What the change figures compare against, finishing "compared with …". */
  previous: string | null;
}

export const COMMUNITY_PERIODS: PeriodOption[] = [
  { value: 'month', label: 'This month', previous: 'the same point last month' },
  { value: 'quarter', label: 'This quarter', previous: 'the same point last quarter' },
  { value: 'year', label: 'This year', previous: 'the same point last year' },
  { value: 'rolling_12', label: 'Last 12 months', previous: 'the 12 months before' },
  { value: 'all', label: 'All time', previous: null },
];

export const DEFAULT_COMMUNITY_PERIOD: CommunityPeriod = 'year';

/**
 * The period a `?period=` value asks for. The dashboard's pulse card links here
 * with its own period, which can be "rolling_30": the nearest period this
 * screen offers is the month.
 */
export const parseCommunityPeriod = (raw: string | null): CommunityPeriod => {
  if (raw === 'rolling_30') return 'month';
  const match = COMMUNITY_PERIODS.find((p) => p.value === raw);
  return match ? match.value : DEFAULT_COMMUNITY_PERIOD;
};

export interface Change {
  direction: 'up' | 'down' | 'flat';
  text: string;
}

/**
 * How a figure moved against the comparison period: a percentage where there
 * was something to compare with, the plain difference where the earlier
 * figure was zero (a percentage of nothing is not a number).
 */
export const describeChange = (current: number, previous: number | null | undefined): Change | null => {
  if (previous == null) return null;
  const diff = current - previous;
  if (Math.abs(diff) < 1e-9) return { direction: 'flat', text: 'no change' };
  const direction = diff > 0 ? 'up' : 'down';
  const sign = diff > 0 ? '+' : '−';
  if (previous === 0) return { direction, text: `${sign}${formatNumber(Math.abs(diff))}` };
  const pct = Math.round((Math.abs(diff) / previous) * 100);
  return { direction, text: `${sign}${pct}%` };
};

/** Totals that may be compared one-for-one between periods. */
export type ComparableFigure = keyof Pick<
  CommunityReachTotals,
  'events_held' | 'people_reached' | 'member_hours' | 'requests_received'
>;

export const changeFor = (
  current: CommunityReachTotals,
  previous: CommunityReachTotals | null,
  figure: ComparableFigure
): Change | null => describeChange(current[figure], previous ? previous[figure] : null);

export interface TypeSlice extends CommunityTypeBucket {
  other: boolean;
}

/**
 * The largest three types by people reached, then everything else folded into
 * Other: more than four bars in a narrow card stops being comparable at a
 * glance.
 */
export const topTypes = (types: CommunityTypeBucket[], keep = 3): TypeSlice[] => {
  const sorted = [...types].sort((a, b) => b.people_reached - a.people_reached || b.events - a.events);
  if (sorted.length <= keep + 1) return sorted.map((t) => ({ ...t, other: false }));
  const head = sorted.slice(0, keep).map((t) => ({ ...t, other: false }));
  const rest = sorted.slice(keep);
  head.push({
    label: 'Other',
    events: rest.reduce((n, t) => n + t.events, 0),
    people_reached: rest.reduce((n, t) => n + t.people_reached, 0),
    other: true,
  });
  return head;
};

/** "Sep" on the axis, "September 2026" in the tooltip; a year bucket is just its year. */
export const bucketLabel = (period: string, long = false): string => {
  if (/^\d{4}$/.test(period)) return period;
  return formatCalendarDate(`${period}-01`, long ? { month: 'long', year: 'numeric' } : { month: 'short' });
};

/** Share of the expected audience that signed in, as a whole percentage. */
export const turnoutPercent = (signedIn: number, expected: number): number | null =>
  expected > 0 ? Math.round((signedIn / expected) * 100) : null;

/** A round axis top a little above the tallest bar, so gridlines land on readable values. */
export const niceMax = (value: number): number => {
  if (value <= 0) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const top = step * magnitude;
    if (top >= value) return top;
  }
  return 10 * magnitude;
};

/** The reach cell's words, so the table, the phone list and the export agree. */
export const reachText = (row: CommunityEventReach): string => {
  if (row.reach_is_estimate) return `~${formatNumber(row.people_reached)} est.`;
  if (row.signed_in > 0) return `${formatNumber(row.signed_in)} signed in`;
  return '—';
};

/** "of ~30 expected" beneath a signed-in count, where the requester gave one. */
export const expectedText = (row: CommunityEventReach): string | null =>
  !row.reach_is_estimate && row.signed_in > 0 && row.expected != null
    ? `of ~${formatNumber(row.expected)} expected`
    : null;

export const eventDate = (row: CommunityEventReach, timezone: string): string =>
  formatDateCustom(row.start_datetime, { month: 'short', day: 'numeric', year: 'numeric' }, timezone);

export const CSV_HEADER = [
  'Date',
  'Event',
  'Requested by',
  'Type',
  'Signed in',
  'Expected',
  'People reached',
  'Reach is an estimate',
  'Crew',
  'Member hours',
] as const;

export const csvRows = (rows: CommunityEventReach[], timezone: string): CsvValue[][] => [
  [...CSV_HEADER],
  ...rows.map((r) => [
    formatDateCustom(r.start_datetime, { year: 'numeric', month: '2-digit', day: '2-digit' }, timezone),
    r.title,
    r.organization_name ?? '',
    r.type_label,
    r.signed_in,
    r.expected ?? '',
    r.people_reached,
    r.reach_is_estimate ? 'yes' : 'no',
    r.crew,
    // Already on the quarter from the backend; a bare number so a spreadsheet can total it.
    r.member_hours,
  ]),
];
