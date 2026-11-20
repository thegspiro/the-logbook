/**
 * A member's shifts, the department's own and those worked for other
 * departments, in one list: by year, then by month, newest first.
 *
 * The headings come from the hours history the cards and chart above read —
 * a year's total and each month's subtotal are those figures, never a sum of
 * the rows — so the list cannot disagree with the summary it sits under. The
 * rows are fetched a year at a time, when that year is opened.
 *
 * Outside shifts are the member's own entries. On their own My Hours they
 * log, correct and withdraw them here, and see one awaiting approval or
 * rejected with its reason; an entry an officer rejected is locked so the
 * claim that was reviewed stays as it was. Department shifts come from the
 * schedule and are not edited here. On someone else's profile the list is
 * read-only.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertCircle, ChevronDown, Loader2, Pencil, Plus, QrCode, Trash2 } from 'lucide-react';
import { schedulingService } from '../../modules/scheduling/services/api';
import type {
  ExternalShiftEntry,
  MemberDepartmentShift,
  MemberHoursYear,
  MemberShiftHistory as MemberShiftHistoryData,
} from '../../modules/scheduling/services/api';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useTimezone } from '../../hooks/useTimezone';
import { formatCalendarDate, formatNumber } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import { formatHours } from '../../utils/hoursFormatting';
import { PreceptorLinkDialog } from '../../components/training/PreceptorLinkDialog';
import { ExternalShiftFormModal } from './ExternalShiftFormModal';
import { externalShiftTimeRange } from './externalShiftTimes';
import { ExternalShiftEvaluationBadge } from './ExternalShiftEvaluationBadge';
import { positionLabel } from '../../modules/scheduling/utils/positionLabels';
import { monthName, monthTotalHours } from './hoursMonths';

type Filter = 'all' | 'department' | 'external';

type Row =
  | { kind: 'department'; key: string; date: string; sortTime: string; shift: MemberDepartmentShift }
  | { kind: 'external'; key: string; date: string; sortTime: string; entry: ExternalShiftEntry };

interface YearState {
  data: MemberShiftHistoryData | null;
  loading: boolean;
  error: string | null;
}

interface MemberShiftHistoryProps {
  /** Every year on record, newest first, from the hours history. */
  years: MemberHoursYear[];
  /** The year the page is showing; its heading opens on its own. */
  selectedYear: number;
  departmentLabel: string;
  showCalls: boolean;
  /** Absent on the member's own My Hours; present on their profile. */
  memberId?: string | undefined;
  /** A month chosen on the chart, in the selected year: opened and marked. */
  highlightMonth: number | null;
  /** Called after any change, so the totals above refresh. */
  onChanged: () => void;
}

const rowsFor = (data: MemberShiftHistoryData): Row[] => {
  const rows: Row[] = [
    ...data.department_shifts.map((shift): Row => ({
      kind: 'department',
      key: `d-${shift.shift_id}-${shift.start_time}`,
      date: shift.shift_date,
      sortTime: shift.start_time,
      shift,
    })),
    ...data.external_shifts.map((entry): Row => ({
      kind: 'external',
      key: `e-${entry.id}`,
      date: entry.shift_date,
      sortTime: entry.start_at ?? '',
      entry,
    })),
  ];
  return rows.sort((a, b) => b.date.localeCompare(a.date) || b.sortTime.localeCompare(a.sortTime));
};

const monthOf = (isoDate: string): number => Number(isoDate.slice(5, 7));

export const MemberShiftHistory: React.FC<MemberShiftHistoryProps> = ({
  years,
  selectedYear,
  departmentLabel,
  showCalls,
  memberId,
  highlightMonth,
  onChanged,
}) => {
  const own = memberId === undefined;
  const { confirm } = useConfirm();
  const tz = useTimezone();
  const [open, setOpen] = useState<Set<number>>(() => new Set([selectedYear]));
  const [byYear, setByYear] = useState<Record<number, YearState>>({});
  const [filter, setFilter] = useState<Filter>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ExternalShiftEntry | null>(null);
  const [linkFor, setLinkFor] = useState<ExternalShiftEntry | null>(null);

  const loadYear = useCallback(
    async (year: number) => {
      setByYear((prev) => ({ ...prev, [year]: { data: prev[year]?.data ?? null, loading: true, error: null } }));
      try {
        const data =
          memberId === undefined
            ? await schedulingService.getMyShiftHistory(year)
            : await schedulingService.getMemberShiftHistory(memberId, year);
        setByYear((prev) => ({ ...prev, [year]: { data, loading: false, error: null } }));
      } catch (err) {
        setByYear((prev) => ({
          ...prev,
          [year]: {
            data: prev[year]?.data ?? null,
            loading: false,
            error: getErrorMessage(err, 'Failed to load these shifts'),
          },
        }));
      }
    },
    [memberId]
  );

  // The selected year opens whenever it changes, so the picker and the list
  // never point at different years.
  useEffect(() => {
    setOpen((prev) => (prev.has(selectedYear) ? prev : new Set(prev).add(selectedYear)));
  }, [selectedYear]);

  // Only a year with a heading is ever shown, so only one is ever fetched: the
  // selected year starts open even for a member with nothing in it yet.
  const shownOpen = useMemo(() => years.map((y) => y.year).filter((y) => open.has(y)), [years, open]);

  // Fetch each open year once; a reload after an edit goes through refresh().
  useEffect(() => {
    for (const year of shownOpen) {
      if (!byYear[year]) void loadYear(year);
    }
  }, [shownOpen, byYear, loadYear]);

  const refresh = useCallback(() => {
    // An edit can move an entry to another year, so every open year reloads
    // and a closed year forgets its rows, to be fetched afresh when opened.
    setByYear((prev) => {
      const kept: Record<number, YearState> = {};
      for (const year of shownOpen) {
        const state = prev[year];
        if (state) kept[year] = state;
      }
      return kept;
    });
    for (const year of shownOpen) void loadYear(year);
    onChanged();
  }, [shownOpen, loadYear, onChanged]);

  // Bring the first shift of a month chosen on the chart into view.
  const highlightReady = highlightMonth !== null && Boolean(byYear[selectedYear]?.data);
  useEffect(() => {
    if (!highlightReady) return;
    const first = document.querySelector('[data-highlighted="true"]');
    if (first instanceof HTMLElement && typeof first.scrollIntoView === 'function') {
      first.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [highlightReady, highlightMonth]);

  const maxYearHours = useMemo(
    () => years.reduce((max, y) => Math.max(max, y.totals.hours + (y.totals.external_hours ?? 0)), 0),
    [years]
  );

  const toggleYear = (year: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });

  const handleDelete = async (entry: ExternalShiftEntry) => {
    const ok = await confirm({
      title: 'Delete this shift?',
      message: `${formatHours(entry.hours)} hours with ${entry.agency_name} on ${formatCalendarDate(entry.shift_date)} will no longer count toward your hours.`,
      confirmLabel: 'Delete shift',
      cancelLabel: 'Keep it',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await schedulingService.deleteExternalShift(entry.id);
      toast.success('Shift deleted');
      refresh();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to delete the shift'));
    }
  };

  const filterLabels: Record<Filter, string> = {
    all: 'All',
    department: departmentLabel,
    external: 'Other departments',
  };

  const renderRow = (row: Row, highlighted: boolean) => {
    const base =
      'grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-l-4 py-3 pr-3 pl-3 sm:grid-cols-[5.5rem_minmax(0,12rem)_4.5rem_minmax(0,1fr)_auto] sm:items-center sm:pl-10';
    const tone = highlighted ? 'bg-violet-50 dark:bg-violet-950/40' : '';
    const day = (
      <div className="text-theme-text-primary font-semibold">
        {formatCalendarDate(row.date, { month: 'short', day: 'numeric' })}
        <span className="text-theme-text-muted block text-xs font-normal">
          {formatCalendarDate(row.date, { weekday: 'short' })}
        </span>
      </div>
    );

    if (row.kind === 'department') {
      const { shift } = row;
      const times = externalShiftTimeRange({ start_at: shift.start_time, end_at: shift.end_time }, tz);
      const detail = [shift.template_name, shift.unit, shift.position ? positionLabel(shift.position) : null]
        .filter(Boolean)
        .join(' · ');
      return (
        <li
          key={row.key}
          className={`${base} ${tone} border-violet-600 dark:border-violet-400`}
          data-highlighted={highlighted ? 'true' : undefined}
        >
          {day}
          <div className="text-theme-text-secondary col-span-2 text-sm sm:col-span-1">{times ?? ''}</div>
          <div className="text-theme-text-primary col-start-2 row-start-1 text-right font-bold sm:col-start-auto sm:row-start-auto">
            {formatHours(shift.hours)} h
          </div>
          <div className="col-span-2 flex min-w-0 flex-wrap items-center gap-2 sm:col-span-1">
            <span className="badge bg-violet-100 text-violet-900 dark:bg-violet-900 dark:text-white">
              {departmentLabel}
            </span>
            {detail && <span className="text-theme-text-secondary text-sm">{detail}</span>}
            {shift.on_call && (
              <span className="badge bg-theme-surface-secondary text-theme-text-secondary">On call</span>
            )}
            {!shift.credited && (
              <span className="badge bg-amber-500/10 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
                Awaiting close-out
              </span>
            )}
          </div>
          <div className="text-theme-text-secondary col-span-2 text-sm sm:col-span-1 sm:text-right">
            {showCalls && shift.calls !== null
              ? `${formatNumber(shift.calls)} ${shift.calls === 1 ? 'call' : 'calls'}`
              : ''}
          </div>
        </li>
      );
    }

    const { entry } = row;
    const rejected = entry.status === 'rejected';
    const pending = entry.status === 'pending';
    const detail = [entry.apparatus_name, entry.role].filter(Boolean).join(' · ');
    const times = externalShiftTimeRange(entry, tz);
    return (
      <li
        key={row.key}
        className={`${base} ${tone} border-sky-600 dark:border-sky-400`}
        data-highlighted={highlighted ? 'true' : undefined}
      >
        {day}
        <div className="text-theme-text-secondary col-span-2 text-sm sm:col-span-1">{times ?? ''}</div>
        <div
          className={`col-start-2 row-start-1 text-right font-bold sm:col-start-auto sm:row-start-auto ${rejected ? 'text-theme-text-muted line-through' : 'text-theme-text-primary'}`}
        >
          {formatHours(entry.hours)} h
        </div>
        <div className="col-span-2 min-w-0 sm:col-span-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge bg-sky-100 text-sky-900 dark:bg-sky-900 dark:text-white">{entry.agency_name}</span>
            {detail && <span className="text-theme-text-secondary text-sm">{detail}</span>}
            {rejected && (
              <span className="badge bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400">Not counted</span>
            )}
            {pending && (
              <span className="badge bg-amber-500/10 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
                Awaiting approval
              </span>
            )}
            <ExternalShiftEvaluationBadge status={entry.evaluation_status} />
          </div>
          {pending && (
            <p className="text-theme-text-secondary mt-1 text-sm">
              Not in {own ? 'your' : 'the'} totals yet: it counts once a scheduling officer approves it.
            </p>
          )}
          {rejected && entry.rejection_reason && (
            <p className="text-theme-text-secondary mt-1 text-sm">
              <span className="font-medium">Reason:</span> {entry.rejection_reason}
            </p>
          )}
        </div>
        <div className="col-span-2 flex flex-wrap justify-end gap-1 sm:col-span-1">
          {own && !rejected && (
            <>
              {(entry.evaluation_status === 'needed' || entry.evaluation_status === 'draft') && (
                <button
                  type="button"
                  className="btn-secondary inline-flex items-center gap-1"
                  onClick={() => setLinkFor(entry)}
                >
                  <QrCode className="h-4 w-4" aria-hidden="true" /> Preceptor link
                </button>
              )}
              <button
                type="button"
                className="btn-icon"
                aria-label={`Edit shift with ${entry.agency_name} on ${formatCalendarDate(entry.shift_date)}`}
                onClick={() => {
                  setEditing(entry);
                  setFormOpen(true);
                }}
              >
                <Pencil className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="btn-icon"
                aria-label={`Delete shift with ${entry.agency_name} on ${formatCalendarDate(entry.shift_date)}`}
                onClick={() => void handleDelete(entry)}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      </li>
    );
  };

  const renderYearBody = (summary: MemberHoursYear) => {
    const state = byYear[summary.year];
    if (!state || (state.loading && !state.data)) {
      return (
        <div className="flex justify-center py-6" role="status" aria-label={`Loading shifts for ${summary.year}`}>
          <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" aria-hidden="true" />
        </div>
      );
    }
    if (state.error && !state.data) {
      return (
        <div className="alert-danger m-3 flex items-start gap-2" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p>{state.error}</p>
            <button onClick={() => void loadYear(summary.year)} className="mt-2 text-sm font-medium underline">
              Try again
            </button>
          </div>
        </div>
      );
    }
    if (!state.data) return null;

    const rows = rowsFor(state.data).filter((r) => filter === 'all' || r.kind === filter);
    if (rows.length === 0) {
      return (
        <p className="text-theme-text-muted px-4 py-4 text-sm sm:pl-10">
          {filter === 'all' ? 'No shifts in this year.' : `No ${filterLabels[filter]} shifts in this year.`}
        </p>
      );
    }

    const months = [...new Set(rows.map((r) => monthOf(r.date)))];
    const shownExternal = state.data.external_shifts.length;
    return (
      <>
        {months.map((m) => {
          const monthSummary = summary.months.find((x) => x.month === m);
          const highlighted = summary.year === selectedYear && highlightMonth === m;
          return (
            <section key={m} aria-label={`${monthName(m)} ${summary.year}`}>
              <h5 className="border-theme-surface-border text-theme-text-secondary flex justify-between border-t px-3 pt-2 pb-1 text-xs font-semibold tracking-wide uppercase sm:pl-10">
                <span>{monthName(m)}</span>
                {monthSummary && (
                  <span className="tracking-normal normal-case">
                    {monthTotalHours(monthSummary) === 0 && monthSummary.pending_hours > 0
                      ? `${formatHours(monthSummary.pending_hours)} hrs awaiting close-out`
                      : `${formatHours(monthTotalHours(monthSummary))} hrs`}
                  </span>
                )}
              </h5>
              <ul className="divide-theme-surface-border divide-y">
                {rows.filter((r) => monthOf(r.date) === m).map((r) => renderRow(r, highlighted))}
              </ul>
            </section>
          );
        })}
        {state.data.external_total > shownExternal && (
          <p className="text-theme-text-muted px-3 py-2 text-xs sm:pl-10">
            Showing the {formatNumber(shownExternal)} most recent shifts with other departments in {summary.year}.
          </p>
        )}
      </>
    );
  };

  return (
    <section className="card overflow-hidden p-0" aria-labelledby="member-shift-history-heading">
      <div className="split-row gap-3 p-4 sm:items-start">
        <div className="split-row-main">
          <h4 id="member-shift-history-heading" className="text-theme-text-primary font-semibold">
            All shifts
          </h4>
          <p className="text-theme-text-muted text-sm">
            {departmentLabel} shifts and shifts with other departments, newest first.
          </p>
        </div>
        <div className="split-row-aside flex flex-wrap items-center gap-2">
          <div className="hscroll flex gap-1" role="group" aria-label="Show">
            {(Object.keys(filterLabels) as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={`touch-target-phone rounded-lg px-3 py-1.5 text-sm font-medium ${filter === f ? 'bg-violet-700 text-white' : 'text-theme-text-secondary hover:text-theme-text-primary'}`}
              >
                {filterLabels[f]}
              </button>
            ))}
          </div>
          {own && (
            <button
              type="button"
              className="btn-primary flex shrink-0 items-center gap-2"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Log outside shift
            </button>
          )}
        </div>
      </div>

      {years.length === 0 ? (
        <p className="text-theme-text-muted border-theme-surface-border border-t px-4 py-4 text-sm">
          {own ? "You haven't worked or logged any shifts yet." : 'No shifts recorded yet.'}
        </p>
      ) : (
        years.map((summary) => {
          const isOpen = open.has(summary.year);
          const { totals } = summary;
          const yearHours = totals.hours + (totals.external_hours ?? 0);
          const counts = [
            totals.shifts > 0 ? `${formatNumber(totals.shifts)} ${departmentLabel}` : '',
            (totals.external_shifts ?? 0) > 0 ? `${formatNumber(totals.external_shifts ?? 0)} other dept.` : '',
          ]
            .filter(Boolean)
            .join(' · ');
          const bodyId = `member-shift-history-${summary.year}`;
          return (
            <div key={summary.year} className="border-theme-surface-border border-t">
              <button
                type="button"
                className={`hover:bg-theme-surface-hover grid min-h-12 w-full grid-cols-[1.25rem_3.5rem_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-left sm:grid-cols-[1.25rem_3.5rem_minmax(0,1fr)_7rem_6rem] ${isOpen ? 'bg-theme-surface-secondary' : ''}`}
                aria-expanded={isOpen}
                aria-controls={bodyId}
                onClick={() => toggleYear(summary.year)}
              >
                <ChevronDown
                  className={`text-theme-text-muted h-4 w-4 transition-transform ${isOpen ? '' : '-rotate-90'}`}
                  aria-hidden="true"
                />
                <span className="text-theme-text-primary text-base font-bold">{summary.year}</span>
                <span className="text-theme-text-secondary min-w-0 truncate text-sm">
                  {counts || 'No credited shifts'}
                  {totals.pending_hours > 0 && (
                    <span className="text-amber-800 dark:text-amber-300">
                      {' '}
                      · {formatHours(totals.pending_hours)} hrs awaiting close-out
                    </span>
                  )}
                </span>
                <span
                  className="bg-theme-input-bg hidden h-1.5 overflow-hidden rounded-full sm:flex"
                  aria-hidden="true"
                >
                  <span
                    className="h-full bg-violet-600 dark:bg-violet-400"
                    style={{ width: maxYearHours > 0 ? `${(totals.hours / maxYearHours) * 100}%` : '0%' }}
                  />
                  <span
                    className="h-full bg-sky-600 dark:bg-sky-400"
                    style={{
                      width: maxYearHours > 0 ? `${((totals.external_hours ?? 0) / maxYearHours) * 100}%` : '0%',
                    }}
                  />
                </span>
                <span className="text-theme-text-primary text-right font-bold">{formatHours(yearHours)} hrs</span>
              </button>
              {isOpen && <div id={bodyId}>{renderYearBody(summary)}</div>}
            </div>
          );
        })
      )}

      {linkFor && (
        <PreceptorLinkDialog
          isOpen
          onClose={() => {
            setLinkFor(null);
            refresh();
          }}
          entryId={linkFor.id}
          shiftLabel={`${linkFor.agency_name} ${linkFor.apparatus_name} · ${formatCalendarDate(linkFor.shift_date)}`}
        />
      )}
      {own && (
        <ExternalShiftFormModal
          isOpen={formOpen}
          entry={editing}
          onClose={() => setFormOpen(false)}
          onSaved={refresh}
        />
      )}
    </section>
  );
};

export default MemberShiftHistory;
