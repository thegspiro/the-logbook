/**
 * Check Log — expected-vs-actual check history.
 *
 * Two views over one dataset, answering two different questions:
 *
 * * **Grid** — "is the pattern okay?" A matrix of apparatus against duty days,
 *   read by colour. A block of amber on one row says something a list of
 *   individual rows never would.
 * * **Log** — "what happened on that one?" The same occasions chronologically,
 *   with who, when, and what they found.
 *
 * Rows for checks that *did not happen* are the reason this page exists;
 * `shift_equipment_checks` alone can only ever report 100% completion. The
 * server reconstructs the expected side, so a missed check arrives here as an
 * entry with no `checkId`.
 *
 * Used at two scopes. Fleet-wide as its own route, and scoped to one
 * apparatus as the Check log tab of the apparatus detail — same component,
 * `apparatusId` pinned.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, CalendarDays, ClipboardList, Grid3x3, List, Loader2, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { schedulingService } from '../../modules/scheduling/services/api';
import type { CheckLogEntry, CheckLogResponse } from '../../modules/scheduling/types/equipmentCheck';
import { CHECK_OUTCOME_LABELS } from '../../modules/scheduling/types/equipmentCheck';
import {
  OUTCOME_LEGEND,
  OUTCOME_PILL,
  OUTCOME_SWATCH,
  TIMING_LABELS,
  TIMING_SHORT,
  formatRate,
} from '../../modules/scheduling/utils/checkOutcome';
import { formatCalendarDate, formatTime } from '../../utils/dateFormatting';
import { useTimezone } from '../../hooks/useTimezone';
import { getErrorMessage } from '../../utils/errorHandling';
import { useRegisterPullToRefresh } from '../../hooks/useRegisterPullToRefresh';
import { EmptyState } from '../../components/ux';

const WINDOW_OPTIONS = [7, 14, 30] as const;

interface CheckLogPageProps {
  /** Pins the log to one apparatus — the apparatus detail's Check log tab. */
  apparatusId?: string;
  /** Hidden when the page already sits under an apparatus header. */
  showHeader?: boolean;
}

type ViewMode = 'grid' | 'log';

export const CheckLogPage: React.FC<CheckLogPageProps> = ({ apparatusId, showHeader = true }) => {
  const tz = useTimezone();
  const [data, setData] = useState<CheckLogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [windowDates, setWindowDates] = useState<number>(14);
  const [view, setView] = useState<ViewMode>('grid');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await schedulingService.getCheckLog({
        dates: windowDates,
        ...(apparatusId ? { apparatus_id: apparatusId } : {}),
      });
      setData(result);
      // A member scoped to their own checks gets no grid, so the toggle would
      // land on an empty view. Move them to the one that has content.
      if (result.scope === 'own') setView('log');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load check log'));
    } finally {
      setLoading(false);
    }
  }, [windowDates, apparatusId]);

  useEffect(() => {
    void load();
  }, [load]);

  useRegisterPullToRefresh(load);

  const entries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data?.entries ?? [];
    return (data?.entries ?? []).filter(
      (e) =>
        e.unitLabel.toLowerCase().includes(q) ||
        e.templateName.toLowerCase().includes(q) ||
        (e.checkedByName ?? '').toLowerCase().includes(q) ||
        e.findings.some((f) => f.toLowerCase().includes(q))
    );
  }, [data, search]);

  const canShowGrid = data?.scope === 'fleet' && data.rows.length > 0;
  const summary = data?.summary;

  return (
    <div className="space-y-4">
      {showHeader && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <ClipboardList className="text-theme-text-primary h-6 w-6 shrink-0" aria-hidden="true" />
            <div>
              <h1 className="text-theme-text-primary text-xl font-bold">Check log</h1>
              <p className="text-theme-text-muted text-xs">
                {data?.scope === 'own'
                  ? 'Checks you performed'
                  : 'Every expected check, including the ones that did not happen'}
              </p>
            </div>
          </div>
          <Link
            to="/scheduling/equipment"
            className="border-theme-surface-border bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover inline-flex items-center gap-1.5 self-start rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
          >
            &larr; Fleet
          </Link>
        </div>
      )}

      {/* Window + view controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="border-theme-surface-border bg-theme-surface flex items-center gap-0.5 rounded-lg border p-0.5"
          role="group"
          aria-label="Window length"
        >
          <CalendarDays className="text-theme-text-muted ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {WINDOW_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setWindowDates(option)}
              aria-pressed={windowDates === option}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                windowDates === option
                  ? 'bg-blue-600 text-white'
                  : 'text-theme-text-muted hover:text-theme-text-primary'
              }`}
            >
              Last {option}
            </button>
          ))}
        </div>

        {canShowGrid && (
          <div
            className="border-theme-surface-border bg-theme-surface flex items-center gap-0.5 rounded-lg border p-0.5"
            role="group"
            aria-label="View"
          >
            <button
              type="button"
              onClick={() => setView('grid')}
              aria-pressed={view === 'grid'}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                view === 'grid' ? 'bg-blue-600 text-white' : 'text-theme-text-muted hover:text-theme-text-primary'
              }`}
            >
              <Grid3x3 className="h-3.5 w-3.5" aria-hidden="true" /> Grid
            </button>
            <button
              type="button"
              onClick={() => setView('log')}
              aria-pressed={view === 'log'}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                view === 'log' ? 'bg-blue-600 text-white' : 'text-theme-text-muted hover:text-theme-text-primary'
              }`}
            >
              <List className="h-3.5 w-3.5" aria-hidden="true" /> Log
            </button>
          </div>
        )}

        <div className="relative ml-auto min-w-[12rem] flex-1 sm:max-w-xs sm:flex-none">
          <label htmlFor="check-log-search" className="sr-only">
            Filter the log
          </label>
          <Search
            className="text-theme-text-muted absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2"
            aria-hidden="true"
          />
          <input
            id="check-log-search"
            type="text"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by rig, member, item..."
            className="form-input-sm pr-3 pl-8"
          />
        </div>
      </div>

      {/* Summary */}
      {summary && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <LogTile label="Checks completed" value={formatRate(summary.completionRate)} tone="ok" />
          <LogTile label="Missed entirely" value={String(summary.missed)} tone={summary.missed > 0 ? 'crit' : ''} />
          <LogTile
            label="Found a problem"
            value={String(summary.withFindings)}
            tone={summary.withFindings > 0 ? 'warn' : ''}
          />
          <LogTile label="Expected in window" value={String(summary.expected)} tone="" />
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-5 w-5 animate-spin" aria-hidden="true" />
          <span className="text-theme-text-muted ml-2 text-sm">Loading check log...</span>
        </div>
      ) : !data || (data.entries.length === 0 && data.rows.length === 0) ? (
        <EmptyState
          icon={ClipboardList}
          title="Nothing in this window"
          description="No checks were expected on any apparatus over these duty days. Check templates are set up per apparatus or apparatus type."
        />
      ) : view === 'grid' && canShowGrid ? (
        <CheckGrid data={data} />
      ) : (
        <CheckEntries entries={entries} tz={tz} scoped={Boolean(apparatusId)} />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

const CheckGrid: React.FC<{ data: CheckLogResponse }> = ({ data }) => (
  <div className="space-y-3">
    <div className="border-theme-surface-border bg-theme-surface overflow-x-auto rounded-lg border p-3">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Check outcomes by apparatus over the last {data.dates.length} duty days</caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="text-theme-text-muted pr-3 pb-2 text-left font-mono text-[10px] tracking-wider uppercase"
            >
              Apparatus
            </th>
            {data.dates.map((day) => (
              <th
                key={day}
                scope="col"
                className="text-theme-text-muted px-0.5 pb-2 text-center font-mono text-[10px] font-semibold whitespace-nowrap"
              >
                {formatCalendarDate(day, { day: 'numeric' })}
              </th>
            ))}
            <th
              scope="col"
              className="text-theme-text-muted pb-2 pl-3 text-right font-mono text-[10px] tracking-wider uppercase"
            >
              Rate
            </th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={row.apparatusId} className="border-theme-surface-border border-t">
              <th scope="row" className="py-1.5 pr-3 text-left whitespace-nowrap">
                <Link
                  to={`/scheduling/equipment/${row.apparatusId}`}
                  className="text-theme-text-primary font-mono text-xs font-bold hover:text-blue-600"
                >
                  {row.unitLabel}
                </Link>
              </th>
              {row.cells.map((cell) => (
                <td key={cell.date} className="px-0.5 py-1.5">
                  <div className="flex justify-center gap-[2px]">
                    {cell.checks.length === 0 ? (
                      <span
                        className="bg-theme-surface-border/40 block h-5 w-3.5 rounded-[3px]"
                        title={`${formatCalendarDate(cell.date, {
                          month: 'short',
                          day: 'numeric',
                        })} — no check scheduled`}
                      />
                    ) : (
                      cell.checks.map((check, index) => (
                        <span
                          key={`${cell.date}-${check.checkId ?? index}`}
                          className={`block h-5 w-3.5 rounded-[3px] ${OUTCOME_SWATCH[check.status]}`}
                          title={`${formatCalendarDate(cell.date, { month: 'short', day: 'numeric' })} · ${
                            TIMING_SHORT[check.checkTiming] ?? check.checkTiming
                          } — ${CHECK_OUTCOME_LABELS[check.status]}${
                            check.findingCount > 0 ? ` (${check.findingCount})` : ''
                          }`}
                        />
                      ))
                    )}
                  </div>
                </td>
              ))}
              <td className="text-theme-text-secondary py-1.5 pl-3 text-right font-mono text-xs tabular-nums">
                {formatRate(row.completionRate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    <div className="text-theme-text-muted flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
      {OUTCOME_LEGEND.map(({ status, label }) => (
        <span key={status} className="inline-flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-[2px] ${OUTCOME_SWATCH[status]}`} aria-hidden="true" />
          {label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="bg-theme-surface-border/40 h-2.5 w-2.5 rounded-[2px]" aria-hidden="true" />
        Not scheduled
      </span>
      {/* Says why a weekly rig's row is mostly blank and still reads 100%. */}
      <span className="ml-auto">Each column is a duty day; a rate counts only the checks that apparatus expected.</span>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------

const CheckEntries: React.FC<{ entries: CheckLogEntry[]; tz: string; scoped: boolean }> = ({ entries, tz, scoped }) => {
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={Search}
        title="No matching checks"
        description="Nothing in this window matches the filter. Try a shorter search or a longer window."
      />
    );
  }

  return (
    <div className="space-y-2">
      {entries.map((entry) => {
        return (
          <div
            key={`${entry.shiftId}-${entry.templateId}`}
            className={`bg-theme-surface border-theme-surface-border flex flex-col gap-2 rounded-lg border border-l-[3px] px-3 py-2.5 sm:flex-row sm:items-center ${
              entry.status === 'passed'
                ? 'border-l-green-500'
                : entry.status === 'missed' || entry.status === 'out_of_service'
                  ? 'border-l-red-500'
                  : 'border-l-amber-500'
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {!scoped && (
                  <span className="text-theme-text-primary font-mono text-xs font-bold">{entry.unitLabel}</span>
                )}
                <span className="text-theme-text-primary text-sm font-medium">{entry.templateName}</span>
                <span
                  className={`rounded-full border px-1.5 py-0.5 text-[11px] font-semibold ${
                    OUTCOME_PILL[entry.status]
                  }`}
                >
                  {CHECK_OUTCOME_LABELS[entry.status]}
                </span>
              </div>
              <div className="text-theme-text-muted mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                <span>{formatCalendarDate(entry.shiftDate, { month: 'short', day: 'numeric' })}</span>
                {entry.checkedAt && <span>{formatTime(entry.checkedAt, tz)}</span>}
                <span>&middot;</span>
                <span>{TIMING_LABELS[entry.checkTiming] ?? entry.checkTiming}</span>
                {entry.checkedByName && (
                  <>
                    <span>&middot;</span>
                    <span>{entry.checkedByName}</span>
                  </>
                )}
                {entry.totalItems !== null && entry.totalItems !== undefined && (
                  <>
                    <span>&middot;</span>
                    <span>
                      {entry.completedItems ?? 0} of {entry.totalItems} items
                    </span>
                  </>
                )}
                {/* A missed check has nobody to name and no items to count —
                    the row exists because the check does not. The server sets
                    this status only where it found no submission, so the
                    absent checkId needs no separate test. */}
                {entry.status === 'missed' && <span>&middot; nobody submitted this check</span>}
              </div>
              {entry.findings.length > 0 && (
                <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                  <span>
                    {entry.findings.join(', ')}
                    {entry.findingCount > entry.findings.length
                      ? ` +${entry.findingCount - entry.findings.length} more`
                      : ''}
                  </span>
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const LOG_TILE_TONES: Record<string, string> = {
  ok: 'border-l-green-500',
  warn: 'border-l-amber-500',
  crit: 'border-l-red-500',
};

const LogTile: React.FC<{ label: string; value: string; tone: string }> = ({ label, value, tone }) => (
  <div
    className={`border-theme-surface-border bg-theme-surface rounded-lg border border-l-[3px] px-3 py-2 ${
      LOG_TILE_TONES[tone] ?? 'border-l-theme-surface-border'
    }`}
  >
    <p className="text-theme-text-primary text-xl leading-tight font-bold tabular-nums">{value}</p>
    <p className="text-theme-text-muted text-[11px]">{label}</p>
  </div>
);

export default CheckLogPage;
