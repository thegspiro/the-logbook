/**
 * The Past view of My Shifts: one year at a time, or all time, broken into
 * months.
 *
 * Most members open this to read a year's top-line number and then look at the
 * months behind it, so the newest year is the default and the stat tiles follow
 * the dropdown. A chart of hours sits between the two: by month for one year,
 * by year for all time. A tap on a month jumps to that month's list, and a tap
 * on a year opens that year.
 *
 * Every row has a full date in its month header, which the flat list it
 * replaced did not — "Sat, Oct 11" appeared twice there with nothing to tell
 * the two years apart.
 */

import React, { useMemo, useState } from 'react';
import { ChevronDown, Clock, LogIn } from 'lucide-react';
import type { ShiftRecord, ShiftAttendanceRecord } from '../../modules/scheduling/services/api';
import type { Assignment } from '../../types/scheduling';
import { useTimezone } from '../../hooks/useTimezone';
import { formatCalendarDate, formatTime } from '../../utils/dateFormatting';
import { formatHours, formatHoursExact } from '../../utils/hoursFormatting';
import { ASSIGNMENT_STATUS_COLORS } from '../../constants/enums';
import { positionLabel } from '../../modules/scheduling/utils/positionLabels';
import {
  ALL_TIME,
  MONTH_NAMES,
  buildPastRows,
  groupByMonth,
  resolveScope,
  rowsInScope,
  summarizeYears,
  totalsFor,
} from './pastShiftsModel';
import type { MonthGroup, PastShiftRow, PeriodTotals } from './pastShiftsModel';

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

const periodLine = (totals: PeriodTotals): string =>
  `${plural(totals.shifts, 'shift', 'shifts')} · ${formatHours(totals.hours)} hrs`;

const sectionId = (key: string): string => `past-shifts-${key}`;

interface ChartBar {
  key: string;
  label: string;
  /** Read out in full by a screen reader and shown on hover. */
  description: string;
  hours: number;
  shifts: number;
  onSelect: () => void;
}

const HoursChart: React.FC<{ title: string; bars: ChartBar[] }> = ({ title, bars }) => {
  const peak = Math.max(0, ...bars.map((b) => b.hours));
  return (
    <div className="card p-4" role="group" aria-label={title}>
      <p className="text-theme-text-secondary mb-3 text-sm font-medium">{title}</p>
      <div className="flex h-28 items-end gap-1 sm:gap-1.5">
        {bars.map((bar, index) => {
          const empty = bar.shifts === 0;
          // A shift with no hours logged still gets a sliver, so a month the
          // member rode reads differently from one they did not.
          const height = empty ? 0 : peak > 0 ? Math.max(4, (bar.hours / peak) * 100) : 4;
          // Edge bars anchor their tooltip inward so it is not cut off by the
          // card on a phone, where a bar is about 25px wide.
          const tipAlign = index < 2 ? 'left-0' : index >= bars.length - 2 ? 'right-0' : 'left-1/2 -translate-x-1/2';
          return (
            <button
              key={bar.key}
              type="button"
              onClick={bar.onSelect}
              disabled={empty}
              aria-label={bar.description}
              className="group relative flex h-full min-w-0 flex-1 flex-col justify-end rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 disabled:cursor-default"
            >
              {empty ? (
                <span className="bg-theme-input-bg block h-0.5 w-full rounded-full" aria-hidden="true" />
              ) : (
                <span
                  className="block w-full rounded-t bg-violet-600 transition-colors group-hover:bg-violet-700 dark:bg-violet-500 dark:group-hover:bg-violet-400"
                  style={{ height: `${height}%` }}
                  aria-hidden="true"
                />
              )}
              {!empty && (
                <span
                  className={`popover-panel text-theme-text-primary pointer-events-none absolute bottom-full z-10 mb-1 hidden px-2 py-1 text-xs whitespace-nowrap group-hover:block group-focus-visible:block ${tipAlign}`}
                  aria-hidden="true"
                >
                  {bar.description}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1 sm:gap-1.5" aria-hidden="true">
        {bars.map((bar) => (
          <span key={bar.key} className="text-theme-text-muted min-w-0 flex-1 truncate text-center text-xs">
            {bar.label}
          </span>
        ))}
      </div>
    </div>
  );
};

const ShiftRow: React.FC<{
  row: PastShiftRow;
  attendance: ShiftAttendanceRecord | undefined;
  onViewShift: ((shift: ShiftRecord) => void) | undefined;
}> = ({ row, attendance, onViewShift }) => {
  const tz = useTimezone();
  const { assignment } = row;
  const shift = assignment.shift;
  const statusColor = ASSIGNMENT_STATUS_COLORS[assignment.status] || ASSIGNMENT_STATUS_COLORS.assigned;
  // Calendar dates, formatted as written, so a viewer far from the department
  // still sees the shift's own day.
  const dayNumber = shift?.shift_date ? formatCalendarDate(shift.shift_date, { day: 'numeric' }) : '—';
  const weekday = shift?.shift_date ? formatCalendarDate(shift.shift_date, { weekday: 'short' }) : '';
  const fullDay = shift?.shift_date
    ? formatCalendarDate(shift.shift_date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
    : 'an unknown date';
  const timeRange = shift?.start_time
    ? `${formatTime(shift.start_time, tz)}${shift.end_time ? ` - ${formatTime(shift.end_time, tz)}` : ''}`
    : '';

  let worked: React.ReactNode = null;
  if (row.hours !== null) {
    worked = (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-green-800 dark:text-green-400">
        <Clock className="h-3 w-3" aria-hidden="true" /> {formatHours(row.hours)}h worked
      </span>
    );
  } else if (attendance?.checked_in_at) {
    worked = (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-blue-700 dark:text-blue-400">
        <LogIn className="h-3 w-3" aria-hidden="true" /> Checked in
      </span>
    );
  }

  return (
    <li className="flex items-center gap-3 px-4 py-3 sm:gap-4 sm:px-5">
      <div className="flex w-10 shrink-0 flex-col items-center leading-tight" aria-hidden="true">
        <span className="text-theme-text-primary text-lg font-bold">{dayNumber}</span>
        <span className="text-theme-text-muted text-xs uppercase">{weekday}</span>
      </div>
      <div className="min-w-0 flex-1">
        <span className="sr-only">{fullDay}, </span>
        <p className="text-theme-text-primary text-sm font-semibold">{timeRange}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          {/* Keyed on either field: `unit_number` is the required identifier
            and `name` an optional nickname, so gating on the name would hide
            the rig for any apparatus without one. */}
          {(shift?.apparatus_unit_number || shift?.apparatus_name) && (
            <span className="text-theme-text-secondary text-xs font-medium">
              {[shift.apparatus_unit_number, shift.apparatus_name].filter(Boolean).join(' — ')}
            </span>
          )}
          <span className="text-theme-text-muted text-xs capitalize">
            {assignment.outreach_role_label
              ? `Role: ${assignment.outreach_role_label}`
              : `Position: ${positionLabel(assignment.position)}`}
          </span>
          <span className={`rounded-full border px-2 py-0.5 text-xs font-medium capitalize sm:hidden ${statusColor}`}>
            {assignment.status}
          </span>
          {worked}
        </div>
      </div>
      <span
        className={`hidden shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium capitalize sm:inline-block ${statusColor}`}
      >
        {assignment.status}
      </span>
      {shift && onViewShift && (
        <button
          type="button"
          onClick={() => onViewShift(shift)}
          className="text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-surface-hover mobile-touch-target flex shrink-0 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium transition-colors sm:px-3"
          title="Open the full shift details"
          aria-label={`Details for shift on ${fullDay}`}
        >
          <ChevronDown className="h-5 w-5" aria-hidden="true" />
          <span className="hidden sm:inline">Details</span>
        </button>
      )}
    </li>
  );
};

const monthHeading = (group: MonthGroup): string =>
  group.year !== null && group.month !== null ? `${MONTH_NAMES[group.month - 1] ?? ''} ${group.year}` : 'No shift date';

interface PastShiftsHistoryProps {
  /** Past assignments, newest first. Declined and cancelled seats are already removed. */
  past: Assignment[];
  attendanceByShift: Map<string, ShiftAttendanceRecord>;
  onViewShift?: ((shift: ShiftRecord) => void) | undefined;
}

export const PastShiftsHistory: React.FC<PastShiftsHistoryProps> = ({ past, attendanceByShift, onViewShift }) => {
  const [requestedScope, setRequestedScope] = useState<string | null>(null);

  const rows = useMemo(() => buildPastRows(past, attendanceByShift), [past, attendanceByShift]);
  const years = useMemo(() => summarizeYears(rows), [rows]);
  const scope = resolveScope(requestedScope, years);
  const scoped = useMemo(() => rowsInScope(rows, scope), [rows, scope]);
  const totals = useMemo(() => totalsFor(scoped), [scoped]);
  const months = useMemo(() => groupByMonth(scoped), [scoped]);
  const allTime = scope === ALL_TIME;
  const scopeLabel = allTime ? 'All time' : scope;

  const bars: ChartBar[] = useMemo(() => {
    if (allTime) {
      // Oldest on the left, so the chart reads as a career left to right.
      return [...years].reverse().map((y) => ({
        key: String(y.year),
        label: String(y.year),
        description: `${y.year}: ${formatHours(y.hours)} hrs, ${plural(y.shifts, 'shift', 'shifts')}`,
        hours: y.hours,
        shifts: y.shifts,
        onSelect: () => setRequestedScope(String(y.year)),
      }));
    }
    const byMonth = new Map(months.map((m) => [m.month, m]));
    return MONTH_NAMES.map((name, index) => {
      const group = byMonth.get(index + 1);
      const hours = group?.hours ?? 0;
      const shifts = group?.shifts ?? 0;
      return {
        key: name,
        label: name.slice(0, 3),
        description: `${name}: ${formatHours(hours)} hrs, ${plural(shifts, 'shift', 'shifts')}`,
        hours,
        shifts,
        onSelect: () => {
          if (group) document.getElementById(sectionId(group.key))?.scrollIntoView({ behavior: 'smooth' });
        },
      };
    });
  }, [allTime, years, months]);

  if (rows.length === 0) {
    return (
      <div className="border-theme-surface-border rounded-xl border border-dashed py-16 text-center">
        <Clock className="text-theme-text-muted mx-auto mb-3 h-12 w-12" aria-hidden="true" />
        <h3 className="text-theme-text-primary mb-1 text-lg font-medium">No past shifts</h3>
        <p className="text-theme-text-muted mx-auto max-w-sm text-sm">Shifts you have worked will appear here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="past-shifts-year" className="form-label mb-0">
          Year
        </label>
        <select
          id="past-shifts-year"
          value={scope}
          onChange={(e) => setRequestedScope(e.target.value)}
          className="form-input w-44"
        >
          {years.map((y) => (
            <option key={y.year} value={String(y.year)}>
              {y.year} ({plural(y.shifts, 'shift', 'shifts')})
            </option>
          ))}
          <option value={ALL_TIME}>All time ({plural(rows.length, 'shift', 'shifts')})</option>
        </select>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="card p-3 text-center" role="group" aria-label={`Hours worked, ${scopeLabel}`}>
          <p className="text-theme-text-primary text-xl font-bold">{formatHours(totals.hours)}</p>
          <p className="text-theme-text-muted text-xs">Hours worked · {scopeLabel}</p>
        </div>
        <div className="card p-3 text-center" role="group" aria-label={`Shifts, ${scopeLabel}`}>
          <p className="text-theme-text-primary text-xl font-bold">{totals.shifts}</p>
          <p className="text-theme-text-muted text-xs">Shifts · {scopeLabel}</p>
        </div>
        <div className="card p-3 text-center" role="group" aria-label={`Average hours per shift, ${scopeLabel}`}>
          <p className="text-theme-text-primary text-xl font-bold">{formatHoursExact(totals.averageHours)}</p>
          <p className="text-theme-text-muted text-xs">Avg hours/shift</p>
        </div>
      </div>

      {bars.length > 0 && (
        <HoursChart title={allTime ? 'Hours worked by year' : `Hours worked by month · ${scope}`} bars={bars} />
      )}

      {/* overflow-clip, not overflow-hidden: hidden would make this card the
        scroll container and the month headers would stop sticking to the page. */}
      <div className="card overflow-clip">
        {months.map((group) => (
          <section key={group.key} id={sectionId(group.key)} aria-labelledby={`${sectionId(group.key)}-heading`}>
            <div className="surface-secondary-opaque border-theme-surface-border sticky top-0 z-10 flex items-baseline justify-between gap-3 border-y px-4 py-2 sm:px-5">
              <h3
                id={`${sectionId(group.key)}-heading`}
                className="text-theme-text-primary text-sm font-semibold tracking-wide uppercase"
              >
                {monthHeading(group)}
              </h3>
              <span className="text-theme-text-muted text-xs">{periodLine(group)}</span>
            </div>
            <ul className="divide-theme-surface-border divide-y">
              {group.rows.map((row) => (
                <ShiftRow
                  key={row.assignment.id}
                  row={row}
                  attendance={attendanceByShift.get(row.assignment.shift?.id ?? row.assignment.shift_id)}
                  onViewShift={onViewShift}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
};
