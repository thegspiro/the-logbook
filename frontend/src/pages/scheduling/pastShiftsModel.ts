/**
 * Grouping and totals for the Past view of My Shifts.
 *
 * Kept free of React so the stat tiles, the chart and the month headers all
 * read one computation, tested once.
 *
 * **The hours are the Hours tab's hours.** Every total here is folded from the
 * credited month buckets `/scheduling/my-hours-history` returns: attendance on
 * finalized shifts plus approved pre-shift prep, with time on a shift still
 * awaiting close-out reported apart as pending. Before, this view summed raw
 * check-in to check-out time and read higher than the Hours tab for any year
 * with an unfinalized shift in it (Pitfall #29: the screen reports what the
 * backend decided).
 *
 * A row still shows its own time worked, tagged credited or awaiting close-out.
 * Credited rows can sum to less than their month header, because approved
 * prep counts toward the month but belongs to no single row.
 */

import type { Assignment } from '../../types/scheduling';
import { sumHoursToQuarter } from '../../utils/hoursFormatting';
import type { MemberHoursMonth, ShiftAttendanceRecord } from '../../modules/scheduling/services/api';

/** The dropdown value for every year at once. */
export const ALL_TIME = 'all';

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export interface PastShiftRow {
  assignment: Assignment;
  /** Calendar year of the shift, or null when the shift carries no usable date. */
  year: number | null;
  /** 1–12, or null alongside a null year. */
  month: number | null;
  /** Hours worked, or null when the member has not checked out of it. */
  hours: number | null;
  /** True once an officer has finalized the shift, which makes its hours credit. */
  credited: boolean;
}

export interface PeriodTotals {
  /** Shifts listed — the rows on screen, not the credited count. */
  shifts: number;
}

export interface YearSummary extends PeriodTotals {
  year: number;
}

export interface MonthGroup extends PeriodTotals {
  /** `YYYY-MM`, or `undated` for shifts without a usable date. */
  key: string;
  year: number | null;
  month: number | null;
  rows: PastShiftRow[];
}

/** Credited and pending figures for a period, in the Hours tab's terms. */
export interface CreditedTotals {
  /** Finalized shifts attended. */
  shifts: number;
  hours: number;
  pendingShifts: number;
  pendingHours: number;
  /** Credited hours per credited shift; 0 when there are none. */
  averageHours: number;
}

export const UNDATED_KEY = 'undated';

const DATE_PATTERN = /^(\d{4})-(\d{2})-\d{2}/;

/**
 * Hours worked on a shift, from its attendance record. Mirrors the row pill:
 * only a completed check-out with a duration counts, so a member still checked
 * in contributes nothing until they leave.
 */
export const hoursWorked = (attendance: ShiftAttendanceRecord | undefined): number | null => {
  if (!attendance?.checked_out_at || !attendance.duration_minutes) return null;
  return attendance.duration_minutes / 60;
};

export const buildPastRows = (
  past: Assignment[],
  attendanceByShift: Map<string, ShiftAttendanceRecord>
): PastShiftRow[] =>
  past.map((assignment) => {
    const match = DATE_PATTERN.exec(assignment.shift?.shift_date ?? '');
    const year = match ? Number(match[1]) : null;
    const month = match ? Number(match[2]) : null;
    const shiftId = assignment.shift?.id ?? assignment.shift_id;
    const attendance = shiftId ? attendanceByShift.get(shiftId) : undefined;
    return {
      assignment,
      year,
      month: month !== null && month >= 1 && month <= 12 ? month : null,
      hours: hoursWorked(attendance),
      credited: attendance?.shift_is_finalized === true,
    };
  });

export const monthKey = (year: number, month: number): string => `${year}-${String(month).padStart(2, '0')}`;

/**
 * Totals over credited month buckets, folded the way the backend's `_fold`
 * in `get_my_hours_history` folds them: each bucket's already-rounded hours
 * summed through `sumHoursToQuarter`. So a year folded here is the year the
 * Hours tab shows, and all of `history` folded is its all-time figure.
 */
export const foldCredit = (months: MemberHoursMonth[]): CreditedTotals => {
  const shifts = months.reduce((sum, m) => sum + m.shifts, 0);
  const hours = sumHoursToQuarter(months.map((m) => m.hours));
  return {
    shifts,
    hours,
    pendingShifts: months.reduce((sum, m) => sum + m.pending_shifts, 0),
    pendingHours: sumHoursToQuarter(months.map((m) => m.pending_hours)),
    // An average is not recorded time, so it is not quarter-rounded; two
    // places keeps it readable without float drift.
    averageHours: shifts > 0 ? Math.round((hours / shifts) * 100) / 100 : 0,
  };
};

/** The credited buckets a dropdown choice covers. */
export const creditInScope = (history: MemberHoursMonth[], scope: string): MemberHoursMonth[] =>
  scope === ALL_TIME ? history : history.filter((m) => String(m.year) === scope);

export const creditByMonth = (history: MemberHoursMonth[]): Map<string, MemberHoursMonth> =>
  new Map(history.map((m) => [monthKey(m.year, m.month), m]));

export const creditByYear = (history: MemberHoursMonth[]): Map<number, CreditedTotals> => {
  const byYear = new Map<number, MemberHoursMonth[]>();
  for (const m of history) {
    const bucket = byYear.get(m.year);
    if (bucket) bucket.push(m);
    else byYear.set(m.year, [m]);
  }
  return new Map([...byYear.entries()].map(([year, months]) => [year, foldCredit(months)]));
};

/** Every year with at least one shift, newest first. */
export const summarizeYears = (rows: PastShiftRow[]): YearSummary[] => {
  const byYear = new Map<number, PastShiftRow[]>();
  for (const row of rows) {
    if (row.year === null) continue;
    const bucket = byYear.get(row.year);
    if (bucket) bucket.push(row);
    else byYear.set(row.year, [row]);
  }
  return [...byYear.entries()].sort(([a], [b]) => b - a).map(([year, list]) => ({ year, shifts: list.length }));
};

/**
 * The rows a dropdown choice covers. A shift with no usable date belongs to no
 * year, so it is listed under All time only — rather than vanishing, or being
 * filed under a year it may not belong to.
 */
export const rowsInScope = (rows: PastShiftRow[], scope: string): PastShiftRow[] =>
  scope === ALL_TIME ? rows : rows.filter((row) => row.year !== null && String(row.year) === scope);

/**
 * Month sections, with undated shifts last. `newest` (history) puts the latest
 * month first; `soonest` (the Upcoming list) puts the next month first. Rows
 * keep the order they arrive in, which the caller has already sorted to match.
 */
export const groupByMonth = (rows: PastShiftRow[], order: 'newest' | 'soonest' = 'newest'): MonthGroup[] => {
  const groups = new Map<string, { year: number | null; month: number | null; rows: PastShiftRow[] }>();
  for (const row of rows) {
    const dated = row.year !== null && row.month !== null;
    const key = row.year !== null && row.month !== null ? monthKey(row.year, row.month) : UNDATED_KEY;
    const group = groups.get(key);
    if (group) group.rows.push(row);
    else groups.set(key, { year: dated ? row.year : null, month: dated ? row.month : null, rows: [row] });
  }
  return [...groups.entries()]
    .sort(([a], [b]) => {
      if (a === UNDATED_KEY) return 1;
      if (b === UNDATED_KEY) return -1;
      return order === 'newest' ? b.localeCompare(a) : a.localeCompare(b);
    })
    .map(([key, group]) => ({ key, ...group, shifts: group.rows.length }));
};

/** "October 2026" — the year is always named, so December and January read apart. */
export const monthHeading = (group: Pick<MonthGroup, 'year' | 'month'>): string =>
  group.year !== null && group.month !== null ? `${MONTH_NAMES[group.month - 1] ?? ''} ${group.year}` : 'No shift date';

/**
 * The scope to show when the member has not picked one, or has picked a year
 * that no longer has shifts after a reload: the newest year on record, which is
 * the one most members open the tab to read. All time when nothing is dated.
 */
export const resolveScope = (requested: string | null, years: YearSummary[]): string => {
  if (requested === ALL_TIME) return ALL_TIME;
  if (requested !== null && years.some((y) => String(y.year) === requested)) return requested;
  const newest = years[0];
  return newest ? String(newest.year) : ALL_TIME;
};
