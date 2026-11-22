/**
 * The department's leave calendar, for the officers who manage leave: who is
 * on recorded leave, whose request is still waiting, and who is covering for
 * an away approver, one month at a time. Plus the CSV export of leave records.
 *
 * The server chooses what touches the month (CLAUDE.md pitfall #29); this
 * only lays it out by day. Reasons are never sent, so none can be shown.
 *
 * A month grid from tablet width up; on a phone, a list of the days that
 * have anything on them, as seven narrow columns cannot hold a name.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import { leaveRequestService } from '../../services/leaveRequestService';
import { useTimezone } from '../../hooks/useTimezone';
import type {
  LeaveCalendar as LeaveCalendarData,
  LeaveCalendarCover,
  LeaveCalendarEntry,
} from '../../types/leaveRequest';
import { addCalendarDays, addCalendarMonths, formatCalendarDate, getTodayLocalDate } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import { saveBlob } from '../../utils/saveBlob';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// A grid cell shows this many names, then "+N more"; the phone list and the
// day's title show them all.
const CELL_LIMIT = 3;

const covers = (day: string, from: string, to: string | null): boolean => from <= day && (to === null || to >= day);

/** The weekday of a "YYYY-MM-DD" calendar date, 0 for Sunday, without a timezone. */
const weekday = (day: string): number => new Date(`${day}T00:00:00Z`).getUTCDay();

interface DayItems {
  day: string;
  entries: LeaveCalendarEntry[];
  covers: LeaveCalendarCover[];
}

const entryLabel = (e: LeaveCalendarEntry): string =>
  e.kind === 'request' ? `${e.member_name} (requested)` : e.member_name;

const coverLabel = (c: LeaveCalendarCover): string => `${c.stand_in_name} covers ${c.approver_name}`;

const ENTRY_STYLE: Record<LeaveCalendarEntry['kind'], string> = {
  leave: 'bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-white',
  request: 'border border-dashed border-amber-700 text-amber-900 dark:border-amber-300 dark:text-white',
};
const COVER_STYLE = 'bg-purple-100 text-purple-900 dark:bg-purple-900/40 dark:text-white';

const LeaveCalendar: React.FC = () => {
  const tz = useTimezone();
  const [month, setMonth] = useState(() => getTodayLocalDate(tz).slice(0, 7));
  const [data, setData] = useState<LeaveCalendarData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportRange, setExportRange] = useState({ start: '', end: '' });
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async (which: string) => {
    setError(null);
    try {
      const calendar = await leaveRequestService.getCalendar(which);
      setData(calendar);
      // The export defaults to the month on screen, set with it so the two
      // never disagree for a render.
      setExportRange({ start: calendar.month_start, end: calendar.month_end });
    } catch (err: unknown) {
      setData(null);
      setError(getErrorMessage(err, 'The calendar could not be loaded.'));
    }
  }, []);

  useEffect(() => {
    void load(month);
  }, [load, month]);

  const days = useMemo<DayItems[]>(() => {
    if (!data) return [];
    const out: DayItems[] = [];
    for (let day = data.month_start; day <= data.month_end; day = addCalendarDays(day, 1)) {
      out.push({
        day,
        entries: data.entries.filter((e) => covers(day, e.start_date, e.end_date)),
        covers: data.covers.filter((c) => covers(day, c.start_date, c.end_date)),
      });
    }
    return out;
  }, [data]);

  const shift = (months: number) => setMonth(addCalendarMonths(`${month}-01`, months).slice(0, 7));

  const download = async () => {
    if (!exportRange.start || !exportRange.end) return;
    setExporting(true);
    try {
      const blob = await leaveRequestService.exportRecords(exportRange.start, exportRange.end);
      saveBlob(blob, `leave-records-${exportRange.start}-to-${exportRange.end}.csv`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'The export could not be made.'));
    } finally {
      setExporting(false);
    }
  };

  const title = formatCalendarDate(`${month}-01`, { month: 'long', year: 'numeric' });
  const busyDays = days.filter((d) => d.entries.length > 0 || d.covers.length > 0);
  const leading = data ? weekday(data.month_start) : 0;

  return (
    <div className="space-y-6">
      <section className="card p-4" aria-labelledby="leave-calendar-heading">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="leave-calendar-heading" className="text-theme-text-primary font-semibold">
            {title}
          </h2>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary flex items-center gap-1" onClick={() => shift(-1)}>
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Previous month
            </button>
            <button type="button" className="btn-secondary flex items-center gap-1" onClick={() => shift(1)}>
              Next month
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
        <ul className="text-theme-text-secondary mb-3 flex flex-wrap gap-3 text-xs" aria-label="Key">
          <li>
            <span className={`rounded px-1.5 py-0.5 ${ENTRY_STYLE.leave}`}>Name</span> on leave
          </li>
          <li>
            <span className={`rounded px-1.5 py-0.5 ${ENTRY_STYLE.request}`}>Name (requested)</span> request waiting
          </li>
          <li>
            <span className={`rounded px-1.5 py-0.5 ${COVER_STYLE}`}>A covers B</span> stand-in for an approver
          </li>
        </ul>

        {error && (
          <p className="alert-warning text-sm" role="alert">
            {error}
          </p>
        )}

        {data && busyDays.length === 0 && (
          <p className="text-theme-text-muted text-sm">Nobody is on leave or covering this month.</p>
        )}

        {data && busyDays.length > 0 && (
          <>
            <div className="hidden grid-cols-7 gap-px md:grid" role="grid" aria-label={`Leave in ${title}`}>
              {WEEKDAYS.map((w) => (
                <div key={w} role="columnheader" className="text-theme-text-muted px-1 pb-1 text-xs font-medium">
                  {w}
                </div>
              ))}
              {Array.from({ length: leading }, (_, i) => (
                <div key={`blank-${i}`} aria-hidden="true" />
              ))}
              {days.map((d) => {
                const items = [
                  ...d.entries.map((e) => ({ key: e.id, label: entryLabel(e), style: ENTRY_STYLE[e.kind] })),
                  ...d.covers.map((c) => ({ key: `cover-${c.id}`, label: coverLabel(c), style: COVER_STYLE })),
                ];
                const hidden = items.length - CELL_LIMIT;
                return (
                  <div
                    key={d.day}
                    role="gridcell"
                    aria-label={`${formatCalendarDate(d.day, { weekday: 'long', month: 'long', day: 'numeric' })}: ${
                      items.length === 0 ? 'nothing' : items.map((i) => i.label).join(', ')
                    }`}
                    title={items.map((i) => i.label).join('\n')}
                    className={`border-theme-surface-border min-h-24 min-w-0 rounded border p-1 ${
                      data.today === d.day ? 'ring-theme-focus-ring ring-2' : ''
                    }`}
                  >
                    <p className="text-theme-text-secondary text-xs font-medium" aria-hidden="true">
                      {Number(d.day.slice(8))}
                    </p>
                    <ul className="mt-1 space-y-0.5" aria-hidden="true">
                      {items.slice(0, CELL_LIMIT).map((i) => (
                        <li key={i.key} className={`truncate rounded px-1 text-xs ${i.style}`}>
                          {i.label}
                        </li>
                      ))}
                      {hidden > 0 && <li className="text-theme-text-muted px-1 text-xs">+{hidden} more</li>}
                    </ul>
                  </div>
                );
              })}
            </div>

            <ul className="space-y-3 md:hidden" aria-label={`Leave in ${title}, by day`}>
              {busyDays.map((d) => (
                <li key={d.day}>
                  <h3 className="text-theme-text-primary text-sm font-medium">
                    {formatCalendarDate(d.day, { weekday: 'long', month: 'long', day: 'numeric' })}
                    {data.today === d.day ? ' (today)' : ''}
                  </h3>
                  <ul
                    className="mt-1 flex flex-wrap gap-1"
                    aria-label={`Away on ${formatCalendarDate(d.day, { month: 'long', day: 'numeric' })}`}
                  >
                    {d.entries.map((e) => (
                      <li key={e.id} className={`rounded px-2 py-0.5 text-sm ${ENTRY_STYLE[e.kind]}`}>
                        {entryLabel(e)}
                      </li>
                    ))}
                    {d.covers.map((c) => (
                      <li key={`cover-${c.id}`} className={`rounded px-2 py-0.5 text-sm ${COVER_STYLE}`}>
                        {coverLabel(c)}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="card p-4" aria-labelledby="leave-export-heading">
        <h2 id="leave-export-heading" className="text-theme-text-primary mb-1 font-semibold">
          Export leave records
        </h2>
        <p className="text-theme-text-muted mb-3 text-sm">
          A spreadsheet of every request, whatever its outcome, and every recorded leave in the dates you choose. It
          never includes the reasons members gave.
        </p>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void download();
          }}
        >
          <div>
            <label className="form-label" htmlFor="leave-export-start">
              From
            </label>
            <input
              id="leave-export-start"
              type="date"
              className="form-input"
              required
              value={exportRange.start}
              onChange={(e) => setExportRange({ ...exportRange, start: e.target.value })}
            />
          </div>
          <div>
            <label className="form-label" htmlFor="leave-export-end">
              To
            </label>
            <input
              id="leave-export-end"
              type="date"
              className="form-input"
              required
              min={exportRange.start || undefined}
              value={exportRange.end}
              onChange={(e) => setExportRange({ ...exportRange, end: e.target.value })}
            />
          </div>
          <button
            type="submit"
            className="btn-primary flex items-center gap-1"
            disabled={exporting || !exportRange.start || !exportRange.end}
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {exporting ? 'Preparing…' : 'Download CSV'}
          </button>
        </form>
      </section>
    </div>
  );
};

export default LeaveCalendar;
