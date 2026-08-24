/**
 * Organization-wide reporting dashboard for completed admin-hours entries.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, Clock3, Info, ListChecks } from 'lucide-react';
import { useAdminHoursStore } from '../store/adminHoursStore';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDateCustom } from '../../../utils/dateFormatting';
import { formatHours } from '../../../utils/hoursFormatting';
import { endOfReportingDayUTC, startOfReportingDayUTC } from '../utils/reportingRange';

type DatePreset = 'all' | '30-days' | 'year' | 'custom';

interface SummaryTabProps {
  onNavigate?: (tab: 'pending' | 'all') => void;
}

const toDateInput = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const dateRangeFor = (preset: DatePreset): { startDate?: string; endDate?: string } => {
  if (preset === 'all' || preset === 'custom') return {};
  const today = new Date();
  const start = preset === 'year' ? new Date(today.getFullYear(), 0, 1) : new Date(today);
  if (preset === '30-days') start.setDate(today.getDate() - 29);
  return { startDate: toDateInput(start), endDate: toDateInput(today) };
};

const SummaryTab: React.FC<SummaryTabProps> = ({ onNavigate }) => {
  const summary = useAdminHoursStore((s) => s.summary);
  const fetchSummary = useAdminHoursStore((s) => s.fetchSummary);
  const timezone = useTimezone();
  const [preset, setPreset] = useState<DatePreset>('all');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  useEffect(() => {
    const range = dateRangeFor(preset);
    if (preset === 'custom') return;
    void fetchSummary({
      ...(range.startDate ? { startDate: startOfReportingDayUTC(range.startDate, timezone) } : {}),
      ...(range.endDate ? { endDate: endOfReportingDayUTC(range.endDate, timezone) } : {}),
    });
  }, [fetchSummary, preset, timezone]);

  const applyCustomRange = () => {
    void fetchSummary({
      ...(customStart ? { startDate: startOfReportingDayUTC(customStart, timezone) } : {}),
      ...(customEnd ? { endDate: endOfReportingDayUTC(customEnd, timezone) } : {}),
    });
  };

  const periodLabel = useMemo(() => {
    if (!summary?.periodStart && !summary?.periodEnd) return 'All recorded time';
    // The echoed bounds are UTC instants converted from reporting-day edges,
    // so they must be rendered back in the reporting timezone — in UTC, the
    // end bound of "Mar 31" west of UTC lands on Apr 1.
    const format = (value: string | null) =>
      value ? formatDateCustom(value, { dateStyle: 'medium' }, timezone) : 'first record';
    return `${format(summary.periodStart)} – ${format(summary.periodEnd)}`;
  }, [summary, timezone]);

  const totalCategoryMinutes = useMemo(
    () => (summary?.byCategory ?? []).reduce((total, category) => total + category.totalMinutes, 0),
    [summary]
  );

  return (
    <div className="space-y-6">
      <section className="card p-5">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div>
            <h2 className="text-theme-text-primary text-xl font-semibold">Hours summary</h2>
            <p className="text-theme-text-secondary mt-1 max-w-2xl text-sm">
              Organization-wide completed sessions, grouped by each entry&apos;s current category (including any
              recategorization made during review).
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:bg-blue-950/40 dark:text-blue-200">
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
            <span className="font-medium">{periodLabel}</span>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-end gap-3" aria-label="Summary date range">
          <label className="text-theme-text-secondary text-sm">
            <span className="mb-1 block font-medium">Reporting period</span>
            <select
              value={preset}
              onChange={(event) => setPreset(event.target.value as DatePreset)}
              className="form-input min-w-44 px-3"
            >
              <option value="all">All time</option>
              <option value="30-days">Last 30 days</option>
              <option value="year">This calendar year</option>
              <option value="custom">Custom range</option>
            </select>
          </label>
          {preset === 'custom' && (
            <>
              <label className="text-theme-text-secondary text-sm">
                <span className="mb-1 block font-medium">From</span>
                <input
                  type="date"
                  value={customStart}
                  onChange={(event) => setCustomStart(event.target.value)}
                  className="form-input px-3"
                />
              </label>
              <label className="text-theme-text-secondary text-sm">
                <span className="mb-1 block font-medium">Through</span>
                <input
                  type="date"
                  value={customEnd}
                  min={customStart || undefined}
                  onChange={(event) => setCustomEnd(event.target.value)}
                  className="form-input px-3"
                />
              </label>
              <button
                type="button"
                onClick={applyCustomRange}
                disabled={Boolean(customStart && customEnd && customStart > customEnd)}
                className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                Apply range
              </button>
            </>
          )}
        </div>
      </section>

      {!summary ? (
        <div className="text-theme-text-secondary py-10 text-center" role="status">
          Loading summary…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <article className="card p-5">
              <div className="flex items-center justify-between">
                <p className="text-theme-text-secondary text-sm font-medium">Counted hours</p>
                <Clock3 className="h-5 w-5 text-blue-500" aria-hidden="true" />
              </div>
              <p className="text-theme-text-primary mt-2 text-3xl font-bold">
                {formatHours(summary.totalHours)}
                <span className="ml-1 text-base font-medium">hrs</span>
              </p>
              <p className="text-theme-text-muted mt-1 text-xs">{summary.totalEntries} approved or pending entries</p>
            </article>
            <article className="card border-green-200 p-5 dark:border-green-900">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-green-700 dark:text-green-400">Approved</p>
                <CheckCircle2 className="h-5 w-5 text-green-600" aria-hidden="true" />
              </div>
              <p className="mt-2 text-3xl font-bold text-green-700 dark:text-green-400">
                {formatHours(summary.approvedHours)}
                <span className="ml-1 text-base font-medium">hrs</span>
              </p>
              <p className="text-theme-text-muted mt-1 text-xs">{summary.approvedEntries} finalized entries</p>
            </article>
            <article className="card border-amber-200 p-5 dark:border-amber-900">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Needs review</p>
                <ListChecks className="h-5 w-5 text-amber-600" aria-hidden="true" />
              </div>
              <p className="mt-2 text-3xl font-bold text-amber-700 dark:text-amber-400">
                {formatHours(summary.pendingHours)}
                <span className="ml-1 text-base font-medium">hrs</span>
              </p>
              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="text-theme-text-muted text-xs">{summary.pendingEntries} pending entries</p>
                {summary.pendingEntries > 0 && onNavigate && (
                  <button
                    type="button"
                    onClick={() => onNavigate('pending')}
                    className="text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400"
                  >
                    Review now →
                  </button>
                )}
              </div>
            </article>
          </div>

          <section className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-theme-text-primary font-semibold">Where the hours came from</h3>
                <p className="text-theme-text-secondary mt-1 text-sm">
                  Approved and pending hours combined, ranked by category.
                </p>
              </div>
              {onNavigate && (
                <button
                  type="button"
                  onClick={() => onNavigate('all')}
                  className="text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400"
                >
                  View source entries →
                </button>
              )}
            </div>
            {summary.byCategory.length === 0 ? (
              <p className="text-theme-text-secondary py-8 text-center text-sm">
                No completed entries match this reporting period.
              </p>
            ) : (
              <div className="mt-5 space-y-4">
                {[...summary.byCategory]
                  .sort((a, b) => b.totalMinutes - a.totalMinutes)
                  .map((category) => {
                    // Shares divide exact minutes, not the independently
                    // rounded totalHours: with small totals the rounded basis
                    // is materially wrong (two 1-minute categories each showed
                    // as 67%). The summary exposes no total-minutes field, so
                    // the denominator is the categories' own minutes.
                    const exactShare =
                      totalCategoryMinutes > 0
                        ? Math.min(100, Math.max(0, (category.totalMinutes / totalCategoryMinutes) * 100))
                        : 0;
                    const share = Math.round(exactShare);
                    return (
                      <div key={category.categoryId}>
                        <div className="mb-1.5 flex items-baseline justify-between gap-4">
                          <span className="text-theme-text-primary flex items-center gap-2 text-sm font-medium">
                            <span
                              className="h-3 w-3 rounded-full"
                              style={{ backgroundColor: category.categoryColor ?? '#6B7280' }}
                            />
                            {category.categoryName}
                          </span>
                          <span className="text-theme-text-primary text-sm font-semibold">
                            {formatHours(category.totalHours)} hrs{' '}
                            <span className="text-theme-text-muted font-normal">
                              · {category.entryCount} entries · {share}%
                            </span>
                          </span>
                        </div>
                        <div
                          className="bg-theme-surface-hover h-2 overflow-hidden rounded-full"
                          role="progressbar"
                          aria-label={`${category.categoryName}: ${share}% of counted hours`}
                          aria-valuenow={share}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        >
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${exactShare}%`, backgroundColor: category.categoryColor ?? '#6B7280' }}
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </section>

          <aside className="flex gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100">
            <Info className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold">How this summary is calculated</p>
              <p className="mt-1">
                Totals use each completed entry’s recorded duration and clock-in date. Active sessions, rejected
                entries, and deleted entries are excluded. “Counted hours” includes both approved hours and hours still
                awaiting review, so use the approved total for finalized reporting.
              </p>
            </div>
          </aside>
        </>
      )}
    </div>
  );
};

export default SummaryTab;
