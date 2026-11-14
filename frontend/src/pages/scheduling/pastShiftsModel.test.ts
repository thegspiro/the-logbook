import { describe, it, expect } from 'vitest';
import type { Assignment } from '../../types/scheduling';
import type { ShiftAttendanceRecord } from '../../modules/scheduling/services/api';
import {
  ALL_TIME,
  UNDATED_KEY,
  buildPastRows,
  groupByMonth,
  hoursWorked,
  monthHeading,
  resolveScope,
  rowsInScope,
  summarizeYears,
  totalsFor,
} from './pastShiftsModel';

const assignment = (id: string, shiftDate: string): Assignment =>
  ({
    id,
    user_id: 'u1',
    shift_id: `s-${id}`,
    position: 'emt',
    status: 'confirmed',
    shift: { id: `s-${id}`, shift_date: shiftDate, start_time: `${shiftDate}T07:00:00Z` },
  }) as unknown as Assignment;

const attendance = (shiftId: string, minutes: number | undefined, checkedOut = true): ShiftAttendanceRecord => ({
  id: `att-${shiftId}`,
  shift_id: shiftId,
  user_id: 'u1',
  created_at: '2026-01-01T00:00:00Z',
  checked_in_at: '2026-01-01T07:00:00Z',
  ...(checkedOut ? { checked_out_at: '2026-01-01T19:00:00Z' } : {}),
  ...(minutes !== undefined ? { duration_minutes: minutes } : {}),
});

describe('hoursWorked', () => {
  it('counts only a completed check-out with a duration', () => {
    expect(hoursWorked(attendance('a', 90))).toBe(1.5);
    expect(hoursWorked(attendance('a', 90, false))).toBeNull();
    expect(hoursWorked(attendance('a', undefined))).toBeNull();
    expect(hoursWorked(undefined)).toBeNull();
  });
});

describe('buildPastRows', () => {
  it('reads the year and month from the calendar date and the hours from attendance', () => {
    const rows = buildPastRows(
      [assignment('1', '2025-10-11'), assignment('2', '')],
      new Map([['s-1', attendance('s-1', 720)]])
    );
    expect(rows.map((r) => [r.year, r.month, r.hours])).toEqual([
      [2025, 10, 12],
      [null, null, null],
    ]);
  });
});

describe('totalsFor', () => {
  it('averages over shifts with hours logged, not over every shift', () => {
    const rows = buildPastRows(
      [assignment('1', '2026-08-01'), assignment('2', '2026-08-02'), assignment('3', '2026-08-03')],
      new Map([
        ['s-1', attendance('s-1', 720)],
        ['s-2', attendance('s-2', 180)],
      ])
    );
    expect(totalsFor(rows)).toEqual({ shifts: 3, hours: 15, loggedShifts: 2, averageHours: 7.5 });
  });

  it('adds the quarter-rounded hours each row shows, so the total matches its rows', () => {
    // 8 minutes rounds to a quarter hour on each row (0.25 + 0.25 = 0.5);
    // rounding the raw 16-minute sum would give 0.25 and disagree with them.
    const rows = buildPastRows(
      [assignment('1', '2026-08-01'), assignment('2', '2026-08-02')],
      new Map([
        ['s-1', attendance('s-1', 8)],
        ['s-2', attendance('s-2', 8)],
      ])
    );
    expect(totalsFor(rows).hours).toBe(0.5);
  });

  it('reports zero, not NaN, when nothing is logged', () => {
    expect(totalsFor([])).toEqual({ shifts: 0, hours: 0, loggedShifts: 0, averageHours: 0 });
  });
});

describe('year and month grouping', () => {
  const rows = buildPastRows(
    [
      assignment('a', '2026-10-24'),
      assignment('b', '2026-10-11'),
      assignment('c', '2026-08-28'),
      assignment('d', '2025-10-11'),
      assignment('e', '2023-06-11'),
      assignment('f', ''),
    ],
    new Map([
      ['s-a', attendance('s-a', 705)],
      ['s-d', attendance('s-d', 75)],
    ])
  );

  it('lists each year with shifts, newest first, with its own totals', () => {
    expect(summarizeYears(rows).map((y) => [y.year, y.shifts, y.hours])).toEqual([
      [2026, 3, 11.75],
      [2025, 1, 1.25],
      [2023, 1, 0],
    ]);
  });

  it('keeps the same day in different years apart', () => {
    const in2026 = groupByMonth(rowsInScope(rows, '2026'));
    expect(in2026.map((g) => g.key)).toEqual(['2026-10', '2026-08']);
    expect(in2026[0]?.rows.map((r) => r.assignment.id)).toEqual(['a', 'b']);
    expect(groupByMonth(rowsInScope(rows, '2025')).map((g) => g.key)).toEqual(['2025-10']);
  });

  it('shows undated shifts under All time only, after every dated month', () => {
    const all = groupByMonth(rowsInScope(rows, ALL_TIME));
    expect(all.map((g) => g.key)).toEqual(['2026-10', '2026-08', '2025-10', '2023-06', UNDATED_KEY]);
    expect(rowsInScope(rows, '2026').some((r) => r.year === null)).toBe(false);
  });
});

describe('resolveScope', () => {
  const years = summarizeYears(
    buildPastRows([assignment('a', '2026-01-01'), assignment('b', '2024-01-01')], new Map())
  );

  it('defaults to the newest year on record', () => {
    expect(resolveScope(null, years)).toBe('2026');
  });

  it('keeps a chosen year or All time', () => {
    expect(resolveScope('2024', years)).toBe('2024');
    expect(resolveScope(ALL_TIME, years)).toBe(ALL_TIME);
  });

  it('falls back to the newest year when the chosen one no longer has shifts', () => {
    expect(resolveScope('2019', years)).toBe('2026');
  });

  it('falls back to All time when no shift is dated', () => {
    expect(resolveScope(null, [])).toBe(ALL_TIME);
  });
});

describe('soonest-first grouping, for the Upcoming list', () => {
  const rows = buildPastRows(
    [assignment('a', '2026-12-05'), assignment('b', '2026-12-20'), assignment('c', '2027-01-02')],
    new Map()
  );

  it('puts the next month first, across a year boundary', () => {
    const groups = groupByMonth(rows, 'soonest');
    expect(groups.map((g) => g.key)).toEqual(['2026-12', '2027-01']);
    expect(groups[0]?.rows.map((r) => r.assignment.id)).toEqual(['a', 'b']);
    expect(groups.map((g) => g.shifts)).toEqual([2, 1]);
  });

  it('still puts the latest month first by default', () => {
    expect(groupByMonth(rows).map((g) => g.key)).toEqual(['2027-01', '2026-12']);
  });
});

describe('monthHeading', () => {
  it('names the year with the month', () => {
    expect(monthHeading({ year: 2027, month: 1 })).toBe('January 2027');
    expect(monthHeading({ year: null, month: null })).toBe('No shift date');
  });
});
