/**
 * My Hours — the signed-in member's own shift hours and calls, month by month.
 *
 * Answers "how am I doing this year?" from the member's side. Everything here
 * is the caller's own attendance, so it needs no permission beyond being
 * signed in; the department-wide equivalent lives behind `scheduling.report`.
 *
 * **Credited and pending are never added together.** Hours count once an
 * officer finalizes the shift — the same rule the department's member-hours
 * report applies — so a member reading this screen and an officer reading that
 * report see the same number. Time already worked on a shift still awaiting
 * close-out is surfaced as its own line rather than folded into the total,
 * because a member who watched their hours drop after a close-out corrected a
 * check-out time would have no way to tell what happened.
 *
 * The three cards read this month, the selected year, and all time. The middle
 * one follows the year picker rather than pinning to the current year, so it
 * can never state a figure the table beneath it contradicts.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Flame, History, Loader2, TrendingUp } from 'lucide-react';
import { schedulingService } from '../../modules/scheduling/services/api';
import type { MemberHoursHistory } from '../../modules/scheduling/services/api';
import { useSchedulingStore } from '../../modules/scheduling/store/schedulingStore';
import { formatHours } from '../../utils/hoursFormatting';
import { formatNumber } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';

const MONTH_NAMES = [
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
];

const monthLabel = (month: number): string => MONTH_NAMES[month - 1] ?? '';

/**
 * Ceiling on the year picker's length. Not a limit on a member's career — it
 * bounds the list when one mistyped shift date (a shift filed under 1900)
 * would otherwise stretch the picker over a century of empty years.
 */
const MAX_YEARS_LISTED = 20;

interface StatCardProps {
  label: string;
  sublabel: string;
  hours: number;
  shifts: number;
  calls: number;
  showCalls: boolean;
  icon: React.ReactNode;
}

const StatCard: React.FC<StatCardProps> = ({ label, sublabel, hours, shifts, calls, showCalls, icon }) => (
  // Grouped and labelled so a screen reader announces which period a figure
  // belongs to; three bare numbers in a row carry that only visually.
  <div className="card p-4" role="group" aria-label={label}>
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="text-theme-text-secondary text-sm font-medium">{label}</p>
        <p className="text-theme-text-muted text-xs">{sublabel}</p>
      </div>
      <span className="text-violet-600 dark:text-violet-400" aria-hidden="true">
        {icon}
      </span>
    </div>
    <p className="text-theme-text-primary mt-3 text-3xl font-bold">
      {formatHours(hours)}
      <span className="text-theme-text-secondary ml-1 text-base font-medium">hrs</span>
    </p>
    <p className="text-theme-text-secondary mt-1 text-sm">
      {formatNumber(shifts)} {shifts === 1 ? 'shift' : 'shifts'}
      {showCalls ? ` · ${formatNumber(calls)} ${calls === 1 ? 'call' : 'calls'}` : ''}
    </p>
  </div>
);

export const MyHoursSummary: React.FC = () => {
  // 'off' hides the calls column outright: a department that does not record
  // call volume would otherwise read a column of zeros as a broken counter.
  const callTrackingMode = useSchedulingStore((s) => s.callTrackingMode);
  const loadSettings = useSchedulingStore((s) => s.loadSettings);
  const showCalls = callTrackingMode !== 'off';

  // Null until the first response names the year. The department's timezone
  // decides which year is current, and near midnight on 31 December the
  // browser's answer is the wrong one.
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [latestYear, setLatestYear] = useState<number | null>(null);
  const [history, setHistory] = useState<MemberHoursHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const load = useCallback(async (year: number | null) => {
    setLoading(true);
    setError(null);
    try {
      const data = await schedulingService.getMyHoursHistory(year ?? undefined);
      setHistory(data);
      setSelectedYear(data.year);
      setLatestYear((prev) => (prev === null ? data.current_month.year : prev));
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load your hours'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(null);
  }, [load]);

  const years = useMemo(() => {
    const newest = latestYear ?? history?.year ?? selectedYear;
    if (newest === null || newest === undefined) return [];
    const earliest = Math.min(history?.earliest_year ?? newest, selectedYear ?? newest, newest);
    const oldest = Math.max(earliest, newest - (MAX_YEARS_LISTED - 1));
    const list: number[] = [];
    for (let y = newest; y >= oldest; y--) list.push(y);
    return list;
  }, [history?.earliest_year, history?.year, latestYear, selectedYear]);

  const peakHours = useMemo(() => {
    if (!history) return 0;
    return history.months.reduce((max, m) => Math.max(max, m.hours), 0);
  }, [history]);

  if (loading && !history) {
    return (
      <div
        className="flex items-center justify-center py-20"
        role="status"
        aria-live="polite"
        aria-label="Loading your hours"
      >
        <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" aria-hidden="true" />
        <span className="sr-only">Loading your hours…</span>
      </div>
    );
  }

  if (error && !history) {
    return (
      <div className="alert-error flex items-start gap-2" role="alert">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div>
          <p>{error}</p>
          <button onClick={() => void load(selectedYear)} className="mt-2 text-sm font-medium underline">
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!history) return null;

  const { current_month: current, totals, all_time: allTime } = history;
  const pendingHours = totals.pending_hours;

  // The picker can sit on a past year, and "This year" would then be a lie
  // about the figure beside it. Read off the payload rather than the browser
  // clock: the department's timezone decides which year is current.
  const isCurrentYear = history.year === current.year;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-theme-text-primary text-lg font-semibold">My Hours</h3>
          <p className="text-theme-text-muted text-sm">Hours and calls credited to you once a shift is closed out.</p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="my-hours-year" className="form-label mb-0">
            Year
          </label>
          <select
            id="my-hours-year"
            value={selectedYear ?? history.year}
            onChange={(e) => void load(Number(e.target.value))}
            className="form-input w-32"
            disabled={loading}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          {loading && <Loader2 className="text-theme-text-muted h-4 w-4 animate-spin" aria-hidden="true" />}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="This month"
          sublabel={`${monthLabel(current.month)} ${current.year}`}
          hours={current.hours}
          shifts={current.shifts}
          calls={current.calls}
          showCalls={showCalls}
          icon={<Flame className="h-5 w-5" />}
        />
        <StatCard
          label={isCurrentYear ? 'This year' : String(history.year)}
          sublabel={isCurrentYear ? 'Year to date' : 'Full year'}
          hours={totals.hours}
          shifts={totals.shifts}
          calls={totals.calls}
          showCalls={showCalls}
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <StatCard
          label="All time"
          sublabel={history.earliest_year === null ? 'No shifts yet' : `Since ${history.earliest_year}`}
          hours={allTime.hours}
          shifts={allTime.shifts}
          calls={allTime.calls}
          showCalls={showCalls}
          icon={<History className="h-5 w-5" />}
        />
      </div>

      {pendingHours > 0 && (
        <p className="text-theme-text-muted text-sm">
          {formatHours(pendingHours)} more {pendingHours === 1 ? 'hour is' : 'hours are'} logged on shifts your officer
          has not closed out yet. Those count once the shift is finalized.
        </p>
      )}

      <div className="card overflow-hidden p-0">
        {/* `table-fixed` with explicit column widths, so the figures sit under
            their own headers. Under the default auto layout the bar column's
            width claim inflated every other column, spreading four numbers
            across the full width of the card. Below 768px `rwd-table` reflows
            the whole thing to stacked cards, where none of this applies.

            The widths are PERCENTAGES, not pixel classes, because this table
            is never as wide as the viewport: `AppLayout` reserves 256px for the
            sidebar from 768px up — the same breakpoint at which this table
            leaves its stacked mode — and the page adds another 48px of
            padding, so a 768px viewport leaves the card 447px. Pixel widths
            totalling 528px overflowed that, and the card is `overflow-hidden`,
            so the tail was clipped rather than scrollable. Percentages cannot
            exceed the table, whatever the sidebar takes. */}
        <table className="rwd-table w-full table-fixed text-sm">
          <caption className="sr-only">Your shift hours by month for {history.year}</caption>
          <thead>
            <tr className="border-theme-surface-border bg-theme-surface-secondary text-theme-text-secondary border-b text-left">
              <th scope="col" className="w-[26%] px-4 py-3 font-medium">
                Month
              </th>
              <th scope="col" className="w-[15%] px-4 py-3 text-right font-medium">
                Shifts
              </th>
              <th scope="col" className="w-[22%] px-4 py-3 text-right font-medium">
                Hours
              </th>
              {showCalls && (
                <th scope="col" className="w-[15%] px-4 py-3 text-right font-medium">
                  Calls
                </th>
              )}
              {/* No data-label on the matching cells, so the bar is dropped
                  from the stacked mobile view rather than reflowed into a row
                  of its own. The header is visible rather than sr-only: an
                  unlabelled bar reads as decoration, and nothing else on the
                  row says what it is measured against.

                  `table-col-tertiary` holds it back to 1024px rather than 768px.
                  Between those two widths the sidebar leaves too little room for
                  five columns, and a comparison a member can also read off the
                  Hours column is the one to drop — keeping it there is what
                  squeezed the Hours cell into wrapping and pulled its figure out
                  from under its heading. */}
              <th scope="col" className="table-col-tertiary px-4 py-3 font-medium">
                vs. busiest month
              </th>
            </tr>
          </thead>
          <tbody>
            {history.months.map((m) => (
              <tr
                key={m.month}
                className="border-theme-surface-border hover:bg-theme-surface-hover border-b last:border-b-0"
              >
                <td className="rwd-table-lead text-theme-text-primary px-4 py-3 font-medium" data-label="Month">
                  {monthLabel(m.month)}
                </td>
                <td className="text-theme-text-secondary px-4 py-3 text-right" data-label="Shifts">
                  {formatNumber(m.shifts)}
                </td>
                <td className="text-theme-text-primary px-4 py-3 text-right font-medium" data-label="Hours">
                  {formatHours(m.hours)}
                  {m.pending_hours > 0 && (
                    <span className="text-theme-text-muted ml-1 text-xs font-normal">
                      (+{formatHours(m.pending_hours)} pending)
                    </span>
                  )}
                </td>
                {showCalls && (
                  <td className="text-theme-text-secondary px-4 py-3 text-right" data-label="Calls">
                    {formatNumber(m.calls)}
                  </td>
                )}
                <td
                  className="table-col-tertiary px-4 py-3"
                  title={`${formatHours(m.hours)} of ${formatHours(peakHours)} hours in your busiest month of ${history.year}`}
                >
                  {/* aria-hidden: the same hours are announced from the Hours
                      cell of this row, so labelling the bar would read the
                      month out twice. */}
                  <div className="bg-theme-input-bg h-2 w-full rounded-full" aria-hidden="true">
                    <div
                      className="h-2 rounded-full bg-violet-600"
                      style={{ width: peakHours > 0 ? `${(m.hours / peakHours) * 100}%` : '0%' }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-theme-surface-border bg-theme-surface-secondary text-theme-text-primary border-t font-semibold">
              <td className="rwd-table-lead px-4 py-3" data-label="Total">
                Total
              </td>
              <td className="px-4 py-3 text-right" data-label="Shifts">
                {formatNumber(totals.shifts)}
              </td>
              <td className="px-4 py-3 text-right" data-label="Hours">
                {formatHours(totals.hours)}
              </td>
              {showCalls && (
                <td className="px-4 py-3 text-right" data-label="Calls">
                  {formatNumber(totals.calls)}
                </td>
              )}
              <td className="table-col-tertiary px-4 py-3" />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
};
