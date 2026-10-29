/**
 * The "History" tab of My Training: every record the department holds for the
 * member, grouped by year, newest first.
 *
 * The year totals come from one request and each year's rows from its own, so
 * a member with a decade of records loads a page of the year they open rather
 * than the lot. The newest year starts open; older ones open on demand.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Download, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { trainingModuleConfigService } from '../../services/api';
import { TRAINING_TYPE_LABELS } from '../../constants/enums';
import { formatDate } from '../../utils/dateFormatting';
import { formatHours } from '../../utils/hoursFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import { getTrainingStatusColor, getTrainingStatusLabel } from '../../utils/trainingColors';
import { useTimezone } from '../../hooks/useTimezone';
import type {
  MemberVisibility,
  MyTrainingHistoryRecord,
  MyTrainingHistoryYear,
  MyTrainingSummary,
} from '../../types/training';

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;
const UNDATED_YEAR = 'undated';

interface YearRows {
  items: MyTrainingHistoryRecord[];
  total: number;
  page: number;
  loading: boolean;
  error: string | null;
}

// Undated is not the same as pending: a scheduled class has no completion date
// yet, but neither does a completed record imported without one. Each row
// carries its own status badge, so the group names only what its rows share.
const yearLabel = (year: string): string => (year === UNDATED_YEAR ? 'No completion date' : year);

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

const YearGroup: React.FC<{
  year: MyTrainingHistoryYear;
  open: boolean;
  rows: YearRows | undefined;
  showHours: boolean;
  onToggle: () => void;
  onMore: () => void;
}> = ({ year, open, rows, showHours, onToggle, onMore }) => {
  const tz = useTimezone();
  const panelId = `history-year-${year.year}`;
  return (
    <div className="card-secondary overflow-clip">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="hover:bg-theme-surface-hover flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors"
      >
        <span className="flex flex-wrap items-baseline gap-x-3">
          <span className="text-theme-text-primary text-lg font-semibold">{yearLabel(year.year)}</span>
          <span className="text-theme-text-muted text-sm">
            {plural(year.records, 'record', 'records')}
            {showHours && year.hours != null ? ` · ${formatHours(year.hours)} hrs` : ''}
          </span>
        </span>
        {open ? (
          <ChevronUp className="text-theme-text-muted h-5 w-5 shrink-0" aria-hidden="true" />
        ) : (
          <ChevronDown className="text-theme-text-muted h-5 w-5 shrink-0" aria-hidden="true" />
        )}
      </button>
      {open && (
        <div id={panelId} className="px-5 pb-5">
          {rows?.error && (
            <div className="alert-danger" role="alert">
              {rows.error}
            </div>
          )}
          {rows && rows.items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-theme-text-muted bg-theme-surface-secondary text-xs uppercase">
                  <tr>
                    <th scope="col" className="px-4 py-2">
                      Course
                    </th>
                    <th scope="col" className="px-4 py-2">
                      Type
                    </th>
                    <th scope="col" className="px-4 py-2">
                      Date
                    </th>
                    {showHours && (
                      <th scope="col" className="px-4 py-2">
                        Hours
                      </th>
                    )}
                    <th scope="col" className="px-4 py-2">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-theme-surface-border divide-y">
                  {rows.items.map((r) => (
                    <tr key={r.id} className="text-theme-text-secondary">
                      <td className="px-4 py-2">{r.course_name}</td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        {TRAINING_TYPE_LABELS[r.training_type] ?? r.training_type.replace('_', ' ')}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">{formatDate(r.completion_date, tz)}</td>
                      {showHours && <td className="px-4 py-2 whitespace-nowrap">{formatHours(r.hours_completed)}</td>}
                      <td className="px-4 py-2">
                        {r.voided_at ? (
                          <div className="flex flex-col gap-1">
                            <span className="w-fit rounded-sm bg-amber-500/10 px-2 py-1 text-xs text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
                              voided
                            </span>
                            {r.void_reason && (
                              <span className="text-theme-text-secondary text-xs whitespace-pre-line">
                                Reason: {r.void_reason}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className={`rounded-sm px-2 py-1 text-xs ${getTrainingStatusColor(r.status)}`}>
                            {getTrainingStatusLabel(r.status)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rows?.loading && <p className="text-theme-text-muted py-2 text-sm">Loading…</p>}
          {rows && !rows.loading && rows.items.length < rows.total && (
            <div className="mt-3 flex items-center justify-between">
              <span className="text-theme-text-muted text-xs">
                Showing {rows.items.length} of {rows.total}
              </span>
              <button type="button" onClick={onMore} className="btn-secondary btn-auto text-sm font-medium">
                Show more
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const MyTrainingHistory: React.FC<{
  visibility: MemberVisibility;
  hoursSummary: MyTrainingSummary['hours_summary'];
}> = ({ visibility, hoursSummary }) => {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [trainingType, setTrainingType] = useState('');
  const [years, setYears] = useState<MyTrainingHistoryYear[] | null>(null);
  const [openYears, setOpenYears] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<Record<string, YearRows>>({});
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  // Responses can arrive out of order when the filters change mid-request;
  // only the newest generation may write to state.
  const generation = useRef(0);

  const showHours = visibility.show_training_hours;

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const loadYear = useCallback(
    async (year: string, page: number, current: number) => {
      setRows((prev) => ({
        ...prev,
        [year]: {
          items: prev[year]?.items ?? [],
          total: prev[year]?.total ?? 0,
          page: prev[year]?.page ?? 0,
          loading: true,
          error: null,
        },
      }));
      try {
        const result = await trainingModuleConfigService.getMyTrainingRecords({
          year,
          search,
          trainingType,
          page,
          pageSize: PAGE_SIZE,
        });
        if (current !== generation.current) return;
        setRows((prev) => ({
          ...prev,
          [year]: {
            items: page === 1 ? result.items : [...(prev[year]?.items ?? []), ...result.items],
            total: result.total,
            page,
            loading: false,
            error: null,
          },
        }));
      } catch (err: unknown) {
        if (current !== generation.current) return;
        setRows((prev) => ({
          ...prev,
          [year]: {
            items: prev[year]?.items ?? [],
            total: prev[year]?.total ?? 0,
            page: prev[year]?.page ?? 0,
            loading: false,
            error: getErrorMessage(err, 'Failed to load these training records'),
          },
        }));
      }
    },
    [search, trainingType]
  );

  useEffect(() => {
    generation.current += 1;
    const current = generation.current;
    setRows({});
    setError(null);
    void (async () => {
      try {
        const result = await trainingModuleConfigService.getMyTrainingRecords({
          search,
          trainingType,
          page: 1,
          pageSize: 1,
        });
        if (current !== generation.current) return;
        setYears(result.years);
        // Newest dated year opens first; pending records, which sort ahead of
        // it, are few and are shown on request.
        const newest = result.years.find((y) => y.year !== UNDATED_YEAR);
        const initial = newest ? [newest.year] : result.years.slice(0, 1).map((y) => y.year);
        setOpenYears(new Set(initial));
        for (const year of initial) void loadYear(year, 1, current);
      } catch (err: unknown) {
        if (current !== generation.current) return;
        setError(getErrorMessage(err, 'Failed to load your training history'));
      }
    })();
  }, [search, trainingType, loadYear]);

  const toggle = (year: string) => {
    const opening = !openYears.has(year);
    setOpenYears((prev) => {
      const next = new Set(prev);
      if (opening) next.add(year);
      else next.delete(year);
      return next;
    });
    if (opening && !rows[year]) void loadYear(year, 1, generation.current);
  };

  const more = (year: string) => {
    void loadYear(year, (rows[year]?.page ?? 0) + 1, generation.current);
  };

  const handleExport = async (format: 'csv' | 'pdf') => {
    try {
      setExporting(true);
      const blob = await trainingModuleConfigService.exportMyTraining(format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `my_training_record.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to export training record'));
    } finally {
      setExporting(false);
    }
  };

  const filtering = search !== '' || trainingType !== '';
  const datedYears = (years ?? []).filter((y) => y.year !== UNDATED_YEAR).length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <div className="card-secondary p-4">
          <p className="text-theme-text-muted text-xs">All-time courses completed</p>
          <p className="mt-1 text-xl font-bold text-green-700 dark:text-green-400">
            {hoursSummary?.completed_courses ?? 0}
          </p>
        </div>
        {showHours && (
          <div className="card-secondary p-4">
            <p className="text-theme-text-muted text-xs">All-time hours</p>
            <p className="mt-1 text-xl font-bold text-blue-700 dark:text-blue-400">
              {formatHours(hoursSummary?.total_hours)}
            </p>
          </div>
        )}
        <div className="card-secondary p-4">
          <p className="text-theme-text-muted text-xs">Years on record</p>
          <p className="text-theme-text-primary mt-1 text-xl font-bold">{filtering ? '—' : datedYears}</p>
        </div>
      </div>

      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[14rem] flex-1">
          <label htmlFor="history-search" className="form-label">
            Search courses
          </label>
          <div className="relative">
            <Search
              className="text-theme-text-muted pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              id="history-search"
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              maxLength={100}
              placeholder="Course name"
              className="form-input pl-9"
            />
          </div>
        </div>
        <div>
          <label htmlFor="history-type" className="form-label">
            Type
          </label>
          <select
            id="history-type"
            value={trainingType}
            onChange={(e) => setTrainingType(e.target.value)}
            className="form-input"
          >
            <option value="">All types</option>
            {Object.entries(TRAINING_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {visibility.allow_member_report_export && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleExport('csv')}
              disabled={exporting}
              className="btn-secondary btn-auto text-theme-text-secondary flex items-center space-x-2 text-sm font-medium"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              <span>Export CSV</span>
            </button>
            <button
              type="button"
              onClick={() => void handleExport('pdf')}
              disabled={exporting}
              className="btn-secondary btn-auto text-theme-text-secondary flex items-center space-x-2 text-sm font-medium"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              <span>Export PDF</span>
            </button>
          </div>
        )}
      </div>
      {visibility.allow_member_report_export && (
        <p className="text-theme-text-muted -mt-3 text-xs">
          Exports cover your entire history, whatever is filtered here — for an audit or a new employer.
        </p>
      )}

      {error && (
        <div className="alert-danger" role="alert">
          {error}
        </div>
      )}
      {years === null && !error && <p className="text-theme-text-muted text-sm">Loading your history…</p>}
      {years !== null && years.length === 0 && (
        <div className="card-secondary p-6">
          <p className="text-theme-text-primary text-sm font-medium">
            {filtering ? 'No training records match.' : 'Nothing is on your training record yet.'}
          </p>
          {filtering && (
            <p className="text-theme-text-muted mt-1 text-sm">Clear the search or type to see everything.</p>
          )}
        </div>
      )}
      <div className="space-y-3">
        {(years ?? []).map((year) => (
          <YearGroup
            key={year.year}
            year={year}
            open={openYears.has(year.year)}
            rows={rows[year.year]}
            showHours={showHours}
            onToggle={() => toggle(year.year)}
            onMore={() => more(year.year)}
          />
        ))}
      </div>
    </div>
  );
};
