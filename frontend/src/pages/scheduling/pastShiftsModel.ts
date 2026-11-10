/**
 * Grouping and totals for the Past view of My Shifts.
 *
 * Kept free of React so the arithmetic the stat tiles, the chart and the month
 * headers all show is one computation, tested once. The three must agree: a
 * chart bar reading 36.5 over a month header reading 34 is the kind of quiet
 * disagreement a member notices and nobody can explain.
 *
 * Hours here are the member's own check-in to check-out time — the same figure
 * each row's "Xh worked" pill shows — so a year's total is exactly the sum of
 * the pills beneath it. The Hours tab reports *credited* hours (counted once an
 * officer closes the shift out), which can differ; that tab says so itself.
 */

import type { Assignment } from '../../types/scheduling';
import { sumHoursToQuarter } from '../../utils/hoursFormatting';
import type { ShiftAttendanceRecord } from '../../modules/scheduling/services/api';

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
}

export interface PeriodTotals {
  shifts: number;
  hours: number;
  /** Shifts that have hours logged — the divisor for the average. */
  loggedShifts: number;
  /** Mean hours across shifts with hours logged; 0 when none are. */
  averageHours: number;
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
    return {
      assignment,
      year,
      month: month !== null && month >= 1 && month <= 12 ? month : null,
      hours: hoursWorked(shiftId ? attendanceByShift.get(shiftId) : undefined),
    };
  });

/**
 * Each row's hours are quarter-rounded before they are added, the way the
 * member adds up the pills on screen — so a month header never reads a quarter
 * off the rows beneath it.
 */
export const totalsFor = (rows: PastShiftRow[]): PeriodTotals => {
  const logged = rows.flatMap((row) => (row.hours === null ? [] : [row.hours]));
  const hours = sumHoursToQuarter(logged);
  return {
    shifts: rows.length,
    hours,
    loggedShifts: logged.length,
    // An average is not recorded time, so it is not quarter-rounded; two
    // places keeps it readable without float drift.
    averageHours: logged.length > 0 ? Math.round((hours / logged.length) * 100) / 100 : 0,
  };
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
  return [...byYear.entries()].sort(([a], [b]) => b - a).map(([year, list]) => ({ year, ...totalsFor(list) }));
};

/**
 * The rows a dropdown choice covers. A shift with no usable date belongs to no
 * year, so it is listed under All time only — rather than vanishing, or being
 * filed under a year it may not belong to.
 */
export const rowsInScope = (rows: PastShiftRow[], scope: string): PastShiftRow[] =>
  scope === ALL_TIME ? rows : rows.filter((row) => row.year !== null && String(row.year) === scope);

/**
 * Month sections, newest first, with undated shifts last. Rows keep the order
 * they arrive in, which the caller has already sorted newest first.
 */
export const groupByMonth = (rows: PastShiftRow[]): MonthGroup[] => {
  const groups = new Map<string, { year: number | null; month: number | null; rows: PastShiftRow[] }>();
  for (const row of rows) {
    const dated = row.year !== null && row.month !== null;
    const key = dated ? `${row.year}-${String(row.month).padStart(2, '0')}` : UNDATED_KEY;
    const group = groups.get(key);
    if (group) group.rows.push(row);
    else groups.set(key, { year: dated ? row.year : null, month: dated ? row.month : null, rows: [row] });
  }
  return [...groups.entries()]
    .sort(([a], [b]) => {
      if (a === UNDATED_KEY) return 1;
      if (b === UNDATED_KEY) return -1;
      return b.localeCompare(a);
    })
    .map(([key, group]) => ({ key, ...group, ...totalsFor(group.rows) }));
};

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
