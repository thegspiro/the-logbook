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
import { Link, useSearchParams } from 'react-router';
import {
  AlertTriangle,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  Grid3x3,
  List,
  Loader2,
  Search,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { equipmentCheckService } from '@/modules/inventory/services/equipmentCheckApi';
import type {
  CheckLogCell,
  CheckLogEntry,
  CheckLogResponse,
  CheckLogRow,
  CheckOutcome,
} from '../../../modules/inventory/types/equipmentCheck';
import { CHECK_OUTCOME_LABELS } from '../../../modules/inventory/types/equipmentCheck';
import {
  OUTCOME_LEGEND,
  OUTCOME_PILL,
  OUTCOME_SWATCH,
  TIMING_LABELS,
  TIMING_SHORT,
  formatRate,
} from '../../../modules/inventory/utils/checkOutcome';
import { formatCalendarDate, formatTime } from '../../../utils/dateFormatting';
import { dayHeading } from '../../../modules/inventory/utils/dayHeading';
import { useTimezone } from '../../../hooks/useTimezone';
import { getErrorMessage } from '../../../utils/errorHandling';
import { useRegisterPullToRefresh } from '../../../hooks/useRegisterPullToRefresh';
import { EmptyState } from '../../../components/ux';
import { ScrollCueRow } from '../../../components/ux/ScrollCueRow';
import { Modal } from '../../../components/Modal';
import { OperationsPageHeader } from '../../../components/operations/OperationsPageHeader';

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

  /**
   * `?status=` narrows the log to one or more outcomes, comma-separated.
   *
   * The chief dashboard's failed-checks card has linked here since the
   * checklist move and nothing read the parameter, so the card counted
   * exceptions and then dropped the officer into an unfiltered fortnight to
   * find them by eye.
   *
   * It takes a **list** because one outcome cannot express what that card
   * counts. The card counts `overall_status in (fail, incomplete)`, and
   * `EquipmentReadinessService._status_for_check` collapses those to three
   * different log outcomes: an incomplete check reads as `partial`, and any
   * check holding an out-of-service item reads as `out_of_service` whatever
   * its overall status. Filtering on `failed` alone would hide records the
   * card counted — a department whose exceptions are all incomplete checks
   * would click a non-zero count and land on an empty log, which is worse
   * than the unfiltered list this set out to fix.
   *
   * Validated with `hasOwnProperty`, not `in`: `in` walks the prototype
   * chain, so `?status=constructor` would pass and then index the label map
   * with a function, which React throws on rendering.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = useMemo<CheckOutcome[]>(() => {
    const raw = searchParams.get('status');
    if (!raw) return [];
    const seen: CheckOutcome[] = [];
    for (const part of raw.split(',')) {
      const value = part.trim();
      if (!Object.prototype.hasOwnProperty.call(CHECK_OUTCOME_LABELS, value)) continue;
      const outcome = value as CheckOutcome;
      if (!seen.includes(outcome)) seen.push(outcome);
    }
    return seen;
  }, [searchParams]);
  const hasStatusFilter = statusFilter.length > 0;

  /**
   * `?submitted=1` narrows to occasions a crew actually submitted.
   *
   * `out_of_service` is the one outcome with two sources.
   * `_build_occasions` uses it both for a submitted check holding an
   * out-of-service item and for a day when the rig was unavailable and *no
   * check exists at all*. The dashboard card counts only persisted
   * `ShiftEquipmentCheck` rows, so linking on status alone padded its count
   * with "the truck was in the shop" rows nobody had recorded a check for.
   *
   * A submitted occasion is exactly one with a `checkId` — the server leaves
   * it unset for anything it reconstructed. Kept as its own parameter rather
   * than folded into the status list, because "which outcomes" and "did
   * anyone actually do it" are different questions, and `?status=missed`
   * still has to work for the occasions that by definition have no check.
   */
  const submittedOnly = ['1', 'true'].includes((searchParams.get('submitted') ?? '').toLowerCase());

  /**
   * `?findings=1` narrows to occasions where the crew recorded a finding —
   * the "Found a problem" summary chip.
   *
   * Not `?status=failed`: the chip's count is the server's `withFindings`,
   * which counts any occasion with a finding, and a check holding an
   * out-of-service item or left incomplete can carry findings under a
   * different outcome. Filtering on the outcome would list fewer checks than
   * the chip had just promised.
   */
  const findingsOnly = ['1', 'true'].includes((searchParams.get('findings') ?? '').toLowerCase());

  const clearStatusFilter = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('status');
    next.delete('submitted');
    next.delete('findings');
    // replace: the filter came from a link on another page, so backing out of
    // it should return there rather than stepping through filter states.
    setSearchParams(next, { replace: true });
    // Stay on the log. Clearing the filter widens what is listed; it is not a
    // request to leave the list for the matrix, and `view` still holds the
    // 'grid' default nobody chose while the toggle was withdrawn.
    setView('log');
  }, [searchParams, setSearchParams]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await equipmentCheckService.getCheckLog({
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
    let rows = data?.entries ?? [];
    if (hasStatusFilter) rows = rows.filter((e) => statusFilter.includes(e.status));
    if (submittedOnly) rows = rows.filter((e) => Boolean(e.checkId));
    if (findingsOnly) rows = rows.filter((e) => e.findingCount > 0);
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (e) =>
        e.unitLabel.toLowerCase().includes(q) ||
        e.templateName.toLowerCase().includes(q) ||
        (e.checkedByName ?? '').toLowerCase().includes(q) ||
        e.findings.some((f) => f.toLowerCase().includes(q))
    );
  }, [data, search, statusFilter, hasStatusFilter, submittedOnly, findingsOnly]);

  /**
   * The grid is a rig-by-day matrix with no status dimension, so it cannot
   * honour the filter. Rather than forcing `view` to 'log' in an effect —
   * which left the Grid button live, so one click showed the unfiltered
   * matrix under a "Showing only" banner that now contradicted it — the
   * toggle is withdrawn while filtering and the rendered view is derived.
   */
  const isFiltered = hasStatusFilter || submittedOnly || findingsOnly;
  const canShowGrid = data?.scope === 'fleet' && data.rows.length > 0 && !isFiltered;
  const effectiveView: ViewMode = isFiltered ? 'log' : view;
  const summary = data?.summary;

  const missedChipActive = statusFilter.length === 1 && statusFilter[0] === 'missed' && !submittedOnly && !findingsOnly;
  const findingsChipActive = findingsOnly && !hasStatusFilter && !submittedOnly;

  /**
   * The summary chips are shortcuts onto the same URL filters a dashboard
   * link uses, so the banner, the back button and a shared link all behave
   * as they already do. Tapping the active chip again clears it. Either way
   * the list is where the answer is, so the view moves there.
   */
  const toggleQuickFilter = useCallback(
    (key: 'missed' | 'findings', active: boolean) => {
      const next = new URLSearchParams(searchParams);
      next.delete('status');
      next.delete('submitted');
      next.delete('findings');
      if (!active) {
        if (key === 'missed') next.set('status', 'missed');
        else next.set('findings', '1');
      }
      setSearchParams(next, { replace: true });
      setView('log');
    },
    [searchParams, setSearchParams]
  );

  const [openDay, setOpenDay] = useState<{ row: CheckLogRow; cell: CheckLogCell } | null>(null);

  return (
    <div className={showHeader ? 'mx-auto max-w-7xl space-y-4' : 'space-y-4'}>
      {/* No back link: the section strip and the trail above the title carry
          the way out, and for a member reading their own log the strip's My
          Checklists row is the link the old "← My checklists" was. */}
      {showHeader && (
        <OperationsPageHeader
          icon={ClipboardList}
          title="Check log"
          subtitle={
            data?.scope === 'own'
              ? 'Checks you performed'
              : 'Every expected check, including the ones that did not happen'
          }
        />
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
                windowDates === option ? 'bg-red-800 text-white' : 'text-theme-text-muted hover:text-theme-text-primary'
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
              aria-pressed={effectiveView === 'grid'}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                effectiveView === 'grid'
                  ? 'bg-red-800 text-white'
                  : 'text-theme-text-muted hover:text-theme-text-primary'
              }`}
            >
              <Grid3x3 className="h-3.5 w-3.5" aria-hidden="true" /> Grid
            </button>
            <button
              type="button"
              onClick={() => setView('log')}
              aria-pressed={effectiveView === 'log'}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                effectiveView === 'log'
                  ? 'bg-red-800 text-white'
                  : 'text-theme-text-muted hover:text-theme-text-primary'
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

      {/* An active status filter has to be visible and removable. Arriving
          from the dashboard on a filtered log that looked unfiltered would
          read as "the fortnight only had three checks in it". */}
      {isFiltered && (
        // role=status so the narrowing is announced, not just drawn — the
        // filter arrives from a link on another page, so a screen-reader user
        // never saw it being applied.
        <div className="flex flex-wrap items-center gap-2" role="status" aria-label="Active filter">
          <span className="text-theme-text-muted text-xs">Showing only</span>
          {statusFilter.map((outcome) => (
            <span key={outcome} className={`badge border ${OUTCOME_PILL[outcome]}`}>
              {CHECK_OUTCOME_LABELS[outcome]}
            </span>
          ))}
          {submittedOnly && (
            <span className="badge border-theme-surface-border text-theme-text-secondary border">
              checks someone submitted
            </span>
          )}
          {findingsOnly && (
            <span className="badge border border-amber-500/40 text-amber-700 dark:text-amber-400">
              checks that found a problem
            </span>
          )}
          <button
            type="button"
            onClick={clearStatusFilter}
            className="text-theme-text-muted hover:text-theme-text-primary mobile-touch-target inline-flex items-center gap-1 text-xs font-medium underline-offset-2 hover:underline"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Show all checks
          </button>
        </div>
      )}

      {/* Summary — one line, so the grid or the list starts above the fold
          on a phone. The two counts worth acting on are chips that open the
          list narrowed to them; a chip with nothing behind it is left out. */}
      {summary && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="check-log-summary">
          <p className="text-theme-text-secondary text-sm">
            <span className="text-theme-text-primary font-bold tabular-nums">{formatRate(summary.completionRate)}</span>{' '}
            completed &middot; <span className="tabular-nums">{summary.expected}</span> expected
          </p>
          {(summary.missed > 0 || missedChipActive || summary.withFindings > 0 || findingsChipActive) && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Show only">
              {(summary.missed > 0 || missedChipActive) && (
                <SummaryChip
                  count={summary.missed}
                  label="missed"
                  tone={CHIP_TONES.crit}
                  active={missedChipActive}
                  onClick={() => toggleQuickFilter('missed', missedChipActive)}
                />
              )}
              {(summary.withFindings > 0 || findingsChipActive) && (
                <SummaryChip
                  count={summary.withFindings}
                  label="found a problem"
                  tone={CHIP_TONES.warn}
                  active={findingsChipActive}
                  onClick={() => toggleQuickFilter('findings', findingsChipActive)}
                />
              )}
            </div>
          )}
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
      ) : effectiveView === 'grid' && canShowGrid ? (
        <CheckGrid data={data} onOpenDay={(row, cell) => setOpenDay({ row, cell })} />
      ) : (
        <CheckEntries entries={entries} tz={tz} scoped={Boolean(apparatusId)} />
      )}

      <DaySheet day={openDay} tz={tz} onClose={() => setOpenDay(null)} />
    </div>
  );
};

const CHIP_TONES = {
  warn: 'text-amber-700 dark:text-amber-400',
  crit: 'text-red-700 dark:text-red-400',
};

const SummaryChip: React.FC<{
  count: number;
  label: string;
  tone: string;
  active: boolean;
  onClick: () => void;
}> = ({ count, label, tone, active, onClick }) => (
  <button
    type="button"
    aria-pressed={active}
    onClick={onClick}
    className={`touch-target-phone flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium whitespace-nowrap transition-colors ${
      active
        ? 'border-theme-text-primary bg-theme-surface-secondary text-theme-text-primary'
        : `border-theme-surface-border hover:bg-theme-surface-hover ${tone}`
    }`}
  >
    <span className="font-bold tabular-nums">{count}</span> {label}
  </button>
);

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

/**
 * The unit column is pinned while the days scroll beneath it, so a phone
 * that shows six days at a time still says which rig each row is. Sticky
 * cells need an opaque fill or the squares show through them; the card's
 * surface is translucent in dark mode, so it is layered over the opaque page
 * colour to read the same as the rest of the card.
 */
const PINNED_CELL =
  'bg-theme-bg sticky left-0 z-10 [background-image:linear-gradient(var(--surface-bg),var(--surface-bg))] shadow-[1px_0_0_var(--surface-border)]';

const cellLabel = (row: CheckLogRow, cell: CheckLogCell): string =>
  `${row.unitLabel}, ${formatCalendarDate(cell.date, { weekday: 'short', month: 'short', day: 'numeric' })}: ${cell.checks
    .map(
      (check) =>
        `${TIMING_SHORT[check.checkTiming] ?? check.checkTiming} ${CHECK_OUTCOME_LABELS[check.status].toLowerCase()}`
    )
    .join(', ')}`;

const CheckGrid: React.FC<{
  data: CheckLogResponse;
  onOpenDay: (row: CheckLogRow, cell: CheckLogCell) => void;
}> = ({ data, onOpenDay }) => (
  <div className="space-y-3">
    <div className="border-theme-surface-border bg-theme-surface rounded-lg border">
      {/* Opens on the newest day: what happened this morning is the usual
          question, and it is the column a phone would otherwise hide. */}
      <ScrollCueRow startAtEnd className="rounded-lg">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Check outcomes by apparatus over the last {data.dates.length} duty days</caption>
          <thead>
            <tr>
              <th
                scope="col"
                data-scroll-pin
                className={`${PINNED_CELL} text-theme-text-muted pt-3 pr-3 pb-2 pl-3 text-left font-mono text-[10px] tracking-wider uppercase`}
              >
                Apparatus
              </th>
              {data.dates.map((day) => (
                <th
                  key={day}
                  scope="col"
                  className="text-theme-text-muted px-0.5 pt-3 pb-2 text-center font-mono text-[10px] font-semibold whitespace-nowrap"
                >
                  {formatCalendarDate(day, { day: 'numeric' })}
                </th>
              ))}
              <th
                scope="col"
                className="text-theme-text-muted pt-3 pr-3 pb-2 pl-3 text-right font-mono text-[10px] tracking-wider uppercase"
              >
                Rate
              </th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.apparatusId} className="border-theme-surface-border border-t">
                <th scope="row" className={`${PINNED_CELL} py-1 pr-3 pl-3 text-left whitespace-nowrap`}>
                  <Link
                    to={`/inventory/checklists/apparatus/${row.apparatusId}`}
                    className="text-theme-text-primary font-mono text-xs font-bold hover:text-blue-600"
                  >
                    {row.unitLabel}
                  </Link>
                </th>
                {row.cells.map((cell) => (
                  <td key={cell.date} className="px-0.5 py-1">
                    {cell.checks.length === 0 ? (
                      <span
                        className="bg-theme-surface-border/40 touch:h-8 touch:w-9 mx-auto block h-5 w-3.5 rounded-[3px]"
                        title={`${formatCalendarDate(cell.date, {
                          month: 'short',
                          day: 'numeric',
                        })} — no check scheduled`}
                      />
                    ) : (
                      // The whole day is one target: two squares a few pixels
                      // wide each are not separately tappable, and the sheet
                      // lists every check that day anyway.
                      <button
                        type="button"
                        onClick={() => onOpenDay(row, cell)}
                        aria-label={cellLabel(row, cell)}
                        title={cellLabel(row, cell)}
                        className="touch:min-h-11 touch:w-9 mx-auto flex items-center justify-center gap-[2px] rounded-md focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:outline-none"
                      >
                        {cell.checks.map((check, index) => (
                          <span
                            key={`${cell.date}-${check.checkId ?? index}`}
                            aria-hidden="true"
                            className={`touch:h-8 touch:w-auto touch:min-w-2 touch:flex-1 block h-5 w-3.5 rounded-[3px] ${OUTCOME_SWATCH[check.status]}`}
                          />
                        ))}
                      </button>
                    )}
                  </td>
                ))}
                <td className="text-theme-text-secondary py-1 pr-3 pl-3 text-right font-mono text-xs tabular-nums">
                  {formatRate(row.completionRate)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollCueRow>
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
      <span className="ml-auto">
        Each column is a duty day; tap one to see its checks. A rate counts only the checks that apparatus expected.
      </span>
    </div>
  </div>
);

/** One rig on one day: what the squares in that cell stand for, in words. */
const DaySheet: React.FC<{
  day: { row: CheckLogRow; cell: CheckLogCell } | null;
  tz: string;
  onClose: () => void;
}> = ({ day, tz, onClose }) => (
  <Modal
    isOpen={day !== null}
    onClose={onClose}
    size="sm"
    title={day ? `${day.row.unitLabel} · ${dayHeading(day.cell.date, tz)}` : ''}
  >
    {day && (
      <div className="space-y-3">
        <p className="text-theme-text-muted text-xs">
          {formatCalendarDate(day.cell.date, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
        <ul className="space-y-2" aria-label="Checks that day">
          {day.cell.checks.map((check, index) => (
            <li
              key={`${check.checkId ?? 'expected'}-${index}`}
              className="border-theme-surface-border flex items-start gap-2.5 rounded-lg border px-3 py-2"
            >
              <span
                className={`mt-1 block h-4 w-3 shrink-0 rounded-[3px] ${OUTCOME_SWATCH[check.status]}`}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="text-theme-text-primary text-sm font-medium">{check.templateName}</p>
                <p className="text-theme-text-muted mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <span>{TIMING_LABELS[check.checkTiming] ?? check.checkTiming}</span>
                  <span
                    className={`rounded-full border px-1.5 py-0.5 text-[11px] font-semibold ${OUTCOME_PILL[check.status]}`}
                  >
                    {CHECK_OUTCOME_LABELS[check.status]}
                  </span>
                  {check.findingCount > 0 && (
                    <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                      {check.findingCount} {check.findingCount === 1 ? 'finding' : 'findings'}
                    </span>
                  )}
                </p>
              </div>
            </li>
          ))}
        </ul>
        <Link
          to={`/inventory/checklists/apparatus/${day.row.apparatusId}`}
          className="text-theme-text-primary hover:bg-theme-surface-hover border-theme-surface-border touch-target-phone flex items-center justify-between rounded-lg border px-3 py-2 text-sm font-medium"
        >
          Open {day.row.unitLabel}
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    )}
  </Modal>
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

  // The server sends entries newest day first, and every filter here keeps
  // that order, so consecutive runs are the days.
  const days: { date: string; entries: CheckLogEntry[] }[] = [];
  for (const entry of entries) {
    const last = days[days.length - 1];
    if (last && last.date === entry.shiftDate) last.entries.push(entry);
    else days.push({ date: entry.shiftDate, entries: [entry] });
  }

  return (
    <div className="space-y-4">
      {days.map((group) => (
        <section key={group.date} aria-label={dayHeading(group.date, tz)} className="space-y-2">
          {/* Pinned below the fixed mobile header (top-0 from 768px) on an
              opaque layer, so a long day keeps saying which day it is. */}
          <h2 className="bg-theme-bg text-theme-text-primary mobile-header-inset sticky z-10 py-1.5 text-sm font-semibold md:top-0">
            {dayHeading(group.date, tz)}
          </h2>
          {group.entries.map((entry) => (
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
                  {/* The day heading carries the date, so the line starts at
                    the time — and a missed check, which has none, at its
                    timing. */}
                  {[
                    entry.checkedAt ? formatTime(entry.checkedAt, tz) : null,
                    TIMING_SHORT[entry.checkTiming] ?? entry.checkTiming,
                    entry.checkedByName ?? null,
                    entry.totalItems !== null && entry.totalItems !== undefined
                      ? `${entry.completedItems ?? 0} of ${entry.totalItems} items`
                      : null,
                  ]
                    .filter((part): part is string => Boolean(part))
                    .map((part, index) => (
                      <React.Fragment key={part}>
                        {index > 0 && <span aria-hidden="true">&middot;</span>}
                        <span>{part}</span>
                      </React.Fragment>
                    ))}
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
          ))}
        </section>
      ))}
    </div>
  );
};

export default CheckLogPage;
