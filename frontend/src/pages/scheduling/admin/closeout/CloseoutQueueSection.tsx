/**
 * The close-out queue — every shift that has been and gone unclosed.
 *
 * Finding these was the problem: a shift nobody closed leaves no trace on the
 * board, which draws the future. An officer learned about one from the hub's
 * "To close out" number, which says how many there are and not which. This is
 * the list behind that number.
 *
 * What counts as ended is `closeoutQueue`, which reads the board's own
 * `shiftEndInstant` — so an open-ended shift is judged against the department's
 * cushion here exactly as it is by the roster lock and by the server's own
 * backlog count.
 *
 * **There is one close-out implementation, not two.** A department recording a
 * call count gets the three-step wizard, opened in place on the row; every
 * other department's close-out is the finalize checklist inside the shift
 * panel, which reads that shift's attendance, equipment checks and manual
 * hours. Re-rendering that checklist here would be a second copy of a flow that
 * decides what goes on a member's record, so the row opens the shift instead.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Clock, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { schedulingService } from '../../../../modules/scheduling/services/api';
import type { ShiftRecord } from '../../../../modules/scheduling/services/api';
import { useSchedulingStore } from '../../../../modules/scheduling/store/schedulingStore';
import { useSignupWindow } from '../../../../modules/scheduling/hooks/useSignupWindow';
import {
  closeoutQueue,
  waitingLabel,
  type CloseoutQueueEntry,
} from '../../../../modules/scheduling/utils/closeoutQueue';
import { equipmentCheckService } from '../../../../modules/inventory/services/equipmentCheckApi';
import { isShiftCheckCompleted, type ShiftCheckSummary } from '../../../../modules/inventory/types/equipmentCheck';
import { formatCalendarDate, formatTime } from '../../../../utils/dateFormatting';
import { useTimezone } from '../../../../hooks/useTimezone';
import { EmptyState } from '../../../../components/ux/EmptyState';
import { ShiftCloseoutWizard } from '../../ShiftCloseoutWizard';

/** How far back the queue looks by default. A month of backlog is a real one. */
const DEFAULT_LOOKBACK_DAYS = 30;

/** Shifts fetched per request. The endpoint pages; a backlog is not a year. */
const FETCH_LIMIT = 200;

const isoDay = (date: Date): string => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const minusDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() - days);
  return next;
};

const unitLabel = (shift: ShiftRecord): string =>
  shift.apparatus_unit_number || shift.apparatus_name || 'this apparatus';

const CloseoutQueueSection: React.FC = () => {
  const timezone = useTimezone();
  const window_ = useSignupWindow();
  const callTrackingMode = useSchedulingStore((s) => s.callTrackingMode);
  const requireEndOfShiftChecks = useSchedulingStore((s) => s.requireEndOfShiftChecks);
  const settingsLoaded = useSchedulingStore((s) => s.settingsLoaded);
  const loadSettings = useSchedulingStore((s) => s.loadSettings);
  const navigate = useNavigate();

  const [from, setFrom] = useState(() => isoDay(minusDays(new Date(), DEFAULT_LOOKBACK_DAYS)));
  const [to, setTo] = useState(() => isoDay(new Date()));
  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [preparing, setPreparing] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, ShiftCheckSummary[]>>({});

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    setOpenRow(null);
    try {
      const result = await schedulingService.getShifts({ start_date: from, end_date: to, limit: FETCH_LIMIT });
      setShifts(result.shifts);
    } catch {
      // Said rather than swallowed: an empty queue and a failed load look
      // identical, and one of them tells an officer there is no work waiting.
      setFailed(true);
      setShifts([]);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  // The department's own cushion decides when an open-ended shift is over, so
  // the queue waits for the settings rather than listing against the default
  // and re-listing a moment later.
  const queue = useMemo(
    () => (settingsLoaded ? closeoutQueue(shifts, window_) : []),
    [shifts, window_, settingsLoaded]
  );

  const openCloseout = async (entry: CloseoutQueueEntry) => {
    if (callTrackingMode !== 'count_only') {
      void navigate(`/scheduling?shift=${entry.shift.id}`);
      return;
    }
    // Fetched *before* the row opens, not alongside it. Opening first renders
    // the wizard with nothing outstanding until the request lands, which for a
    // department that blocks on those checks is a window where the screen says
    // the close-out is clear to run and the server would refuse it. The server
    // is the gate either way; this is about not telling the officer otherwise.
    if (!checks[entry.shift.id]) {
      setPreparing(entry.shift.id);
      const summaries = await equipmentCheckService.getShiftChecklists(entry.shift.id).catch(() => []);
      setChecks((current) => ({ ...current, [entry.shift.id]: summaries }));
      setPreparing(null);
    }
    setOpenRow(entry.shift.id);
  };

  const outstandingChecks = (shiftId: string): number =>
    (checks[shiftId] ?? []).filter((check) => check.checkTiming === 'end_of_shift' && !isShiftCheckCompleted(check))
      .length;

  return (
    <div className="space-y-5">
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <label className="flex min-w-0 flex-col gap-1 text-sm">
          <span className="text-theme-text-muted text-xs font-medium">From</span>
          <input
            type="date"
            className="form-input px-3 text-sm"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-sm">
          <span className="text-theme-text-muted text-xs font-medium">To</span>
          <input type="date" className="form-input px-3 text-sm" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="btn-secondary mobile-touch-target inline-flex items-center gap-2 px-3 text-sm font-medium"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </button>
        <p className="text-theme-text-muted min-w-0 flex-1 text-right text-sm" role="status" aria-live="polite">
          {loading || !settingsLoaded
            ? 'Checking…'
            : failed
              ? ''
              : `${queue.length} shift${queue.length === 1 ? '' : 's'} waiting to be closed out`}
        </p>
      </div>

      {failed && (
        <div className="alert-warning flex items-center gap-2 text-sm" role="alert">
          <span className="flex-1">This range did not load, so nothing below is a complete answer.</span>
          <button type="button" className="font-semibold underline" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}

      {(loading || !settingsLoaded) && (
        <div className="flex items-center justify-center py-16" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
        </div>
      )}

      {!loading && settingsLoaded && !failed && queue.length === 0 && (
        <EmptyState
          icon={CheckCircle2}
          title="Every shift in this range is closed out"
          description="A shift still running is not counted — one with no recorded end is judged against the department's open-ended cushion, the same number the roster lock uses."
        />
      )}

      {!loading &&
        settingsLoaded &&
        queue.map((entry) => {
          const shift = entry.shift;
          const isOpen = openRow === shift.id;
          const pending = outstandingChecks(shift.id);
          return (
            <div key={shift.id} className="card space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-theme-text-primary text-sm font-semibold">
                    {formatCalendarDate(shift.shift_date, { weekday: 'short', month: 'short', day: 'numeric' })}
                    {' · '}
                    {formatTime(shift.start_time, timezone)}
                    {shift.end_time ? ` – ${formatTime(shift.end_time, timezone)}` : ' – no recorded end'}
                  </h3>
                  <p className="text-theme-text-muted mt-0.5 text-xs">
                    {unitLabel(shift)}
                    {shift.shift_officer_name ? ` · ${shift.shift_officer_name}` : ' · no officer named'}
                    {` · ${shift.attendee_count} on the crew`}
                  </p>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                  waiting {waitingLabel(entry)}
                </span>
              </div>

              {/* Above the wizard rather than inside it: a shift blocked on
                  somebody else's checklist is a different job from one that
                  only needs its times confirming, and the officer should see
                  which before starting the three steps. */}
              {isOpen && pending > 0 && (
                <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {pending} end-of-shift equipment check{pending === 1 ? '' : 's'} still outstanding
                  {requireEndOfShiftChecks ? ' — these block close-out for your department' : ''}
                </p>
              )}

              {!isOpen && (
                <button
                  type="button"
                  onClick={() => void openCloseout(entry)}
                  disabled={preparing === shift.id}
                  className="btn-primary mobile-touch-target inline-flex items-center gap-2 px-4 text-sm font-semibold disabled:opacity-50"
                >
                  {callTrackingMode === 'count_only' ? (
                    <>
                      {preparing === shift.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
                      )}
                      Close out
                    </>
                  ) : (
                    <>
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                      Open the shift to close it
                    </>
                  )}
                </button>
              )}

              {isOpen && callTrackingMode === 'count_only' && (
                <ShiftCloseoutWizard
                  shiftId={shift.id}
                  unitLabel={unitLabel(shift)}
                  tz={timezone}
                  outstandingChecks={pending}
                  requireChecks={requireEndOfShiftChecks}
                  onCancel={() => setOpenRow(null)}
                  onFinalized={() => {
                    setOpenRow(null);
                    // Re-read rather than dropping the row locally: the server
                    // decides what finalized means, and a row removed here on
                    // an optimistic guess is a shift nobody looks at again.
                    void load();
                  }}
                />
              )}
            </div>
          );
        })}
    </div>
  );
};

export default CloseoutQueueSection;
