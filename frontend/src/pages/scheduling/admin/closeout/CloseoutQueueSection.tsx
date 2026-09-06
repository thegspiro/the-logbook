/**
 * The close-out queue — every shift that has been and gone unclosed.
 *
 * Finding these was the problem: a shift nobody closed leaves no trace on the
 * board, which draws the future. An officer learned about one from the hub's
 * "To close out" number, which says how many there are and not which. This is
 * the list behind that number.
 *
 * Which shifts are in it is the server's answer, not this page's:
 * `GET /scheduling/shifts/needing-closeout` reads the same predicate the hub's
 * **To close out** metric counts, so the number on the card and the length of
 * this list are one population read twice. They used to be two — the metric has
 * no earliest date while this page re-derived the set from a date range of its
 * own choosing, so a shift left unclosed before the range began was counted
 * there and missing here.
 *
 * `closeoutQueue` stays, as the presentation rule: it reads the board's own
 * `shiftEndInstant` for the waiting label, so an open-ended shift is described
 * here against the department's cushion exactly as the roster lock judges it.
 *
 * **There is one close-out implementation, not two.** A department recording a
 * call count gets the three-step wizard, opened in place on the row; every
 * other department's close-out is the finalize checklist inside the shift
 * panel, which reads that shift's attendance, equipment checks and manual
 * hours. Re-rendering that checklist here would be a second copy of a flow that
 * decides what goes on a member's record, so the row opens the shift instead.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Clock, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { schedulingService } from '../../../../modules/scheduling/services/api';
import type { ShiftRecord } from '../../../../modules/scheduling/services/api';
import { useSchedulingStore } from '../../../../modules/scheduling/store/schedulingStore';
import { useSchedulingClock, useSignupWindow } from '../../../../modules/scheduling/hooks/useSignupWindow';
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

/**
 * Rows read in one request.
 *
 * One page, not a paging loop. The endpoint returns the backlog itself, oldest
 * first — every row is work waiting — so the first page is the part to do
 * first and a department with more than this has not been told anything untrue
 * by being shown it. The loop this replaces existed because the generic shifts
 * endpoint returned mostly closed-out shifts, so the unclosed ones could sit on
 * page three and one page read as "nothing waiting".
 */
const PAGE_SIZE = 200;

const unitLabel = (shift: ShiftRecord): string =>
  shift.apparatus_unit_number || shift.apparatus_name || 'this apparatus';

const CloseoutQueueSection: React.FC = () => {
  const timezone = useTimezone();
  const window_ = useSignupWindow();
  // The tick, not just the subscription. `useSignupWindow` re-renders on the
  // clock but returns one identity across ticks, so a `useMemo` keyed on it
  // alone froze this queue at first render: a shift whose end passed, or an
  // open-ended one whose cushion expired, never appeared while the page stayed
  // open, and every waiting label stayed at the age it was first drawn.
  const clock = useSchedulingClock();
  const callTrackingMode = useSchedulingStore((s) => s.callTrackingMode);
  const requireEndOfShiftChecks = useSchedulingStore((s) => s.requireEndOfShiftChecks);
  const settingsLoaded = useSchedulingStore((s) => s.settingsLoaded);
  const loadSettings = useSchedulingStore((s) => s.loadSettings);
  const navigate = useNavigate();

  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // What the server says the whole backlog is, which is not always what was
  // returned: the list is capped at one page, and a cap nobody is told about
  // reads as the end of the work.
  const [total, setTotal] = useState(0);
  const [settingsTried, setSettingsTried] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [preparing, setPreparing] = useState<string | null>(null);
  const [checksFailed, setChecksFailed] = useState<string | null>(null);
  // Distinct from `checksFailed`: the lookup failed but the department does not
  // block on it, so close-out proceeds — and the row has to say the status is
  // unknown rather than let an absent answer read as zero outstanding.
  const [checksUnknown, setChecksUnknown] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, ShiftCheckSummary[]>>({});

  // The store deliberately leaves `settingsLoaded` false on a failed load, so
  // that the next mount retries rather than caching a permissive window for the
  // session — which means "not loaded" alone cannot tell a request still in
  // flight from one that failed. Waiting on the promise separates them; without
  // it a transient settings failure spins this page for ever.
  const loadDepartmentSettings = useCallback(() => {
    setSettingsTried(false);
    void loadSettings().finally(() => setSettingsTried(true));
  }, [loadSettings]);

  useEffect(() => {
    loadDepartmentSettings();
  }, [loadDepartmentSettings]);

  const settingsFailed = settingsTried && !settingsLoaded;

  // Kept, but no longer load-bearing, and that is worth writing down rather
  // than leaving for the next reader to work out. Two reads used to overlap
  // routinely: changing From and then To fired one each and the first could
  // land last. With the range gone the only callers are Refresh — disabled
  // while a read is in flight — and the finalize handler, so there is no
  // sequence left here that drives it. It stays because it is one comparison
  // and the hazard returns with the next caller, not because a test can still
  // reach it; the test that used to drive it typed into a date field that no
  // longer exists, and was removed rather than rewritten to pass on nothing.
  const requestId = useRef(0);
  // The same hazard one control over: `preparing` disables only the row that
  // was clicked, so a second row can be started while the first is still
  // fetching, and the slower answer would otherwise replace the wizard the
  // officer most recently opened.
  const openId = useRef(0);

  const load = useCallback(async () => {
    const mine = ++requestId.current;
    // A checklist request still in flight would otherwise stay current and
    // reopen its wizard on top of the refreshed list — the row the officer
    // closed by refreshing, coming back on its own a moment later.
    openId.current += 1;
    setOpenRow(null);
    setPreparing(null);
    setChecksFailed(null);
    setChecksUnknown(null);
    setLoading(true);
    setFailed(false);
    try {
      const result = await schedulingService.getShiftsNeedingCloseout({ limit: PAGE_SIZE });
      if (mine !== requestId.current) return;
      setShifts(result.shifts);
      // Coerced rather than trusted. `total` is typed as a number, but the
      // value is whatever the response carried, and an absent one compared
      // against a length silently answers false — which is the branch that
      // decides whether the officer is told the list is capped.
      setTotal(result.total ?? 0);
    } catch {
      // Said rather than swallowed: an empty queue and a failed load look
      // identical, and one of them tells an officer there is no work waiting.
      if (mine !== requestId.current) return;
      setFailed(true);
      setShifts([]);
      setTotal(0);
    } finally {
      if (mine === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The department's own cushion decides when an open-ended shift is over, so
  // the queue waits for the settings rather than listing against the default
  // and re-listing a moment later.
  const queue = useMemo(
    () => (settingsLoaded ? closeoutQueue(shifts, window_, Date.now()) : []),
    // `clock` is the dependency that matters and is deliberately not used in
    // the body: it advances every 30 seconds and is what re-reads `Date.now()`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shifts, window_, settingsLoaded, clock]
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
    //
    // Read every time, never cached. An officer who cancels the wizard while a
    // check is outstanding, waits for the crew to finish it, and reopens the
    // row was otherwise shown the same stale answer and made to record an
    // override for work that had since been done.
    const mine = ++openId.current;
    setPreparing(entry.shift.id);
    setChecksFailed(null);
    setChecksUnknown(null);
    try {
      const summaries = await equipmentCheckService.getShiftChecklists(entry.shift.id);
      if (mine !== openId.current) return;
      setChecks((current) => ({ ...current, [entry.shift.id]: summaries }));
    } catch {
      if (mine !== openId.current) return;
      // A failure is a failure, never an empty list: the endpoint wants
      // `inventory.check_view` or `inventory.check_submit`, neither of which
      // `scheduling.manage` implies, so it refuses an ordinary scheduling
      // officer. Reading that as "no checks outstanding" hides the wizard's
      // override control.
      //
      // But it only *blocks* where the server does. `finalize_shift` looks at
      // outstanding checks only when the department has enabled
      // `require_end_of_shift_checks`; everywhere else the count is a note on
      // the screen and nothing more. Refusing to open the wizard there would
      // shut an officer out of a close-out the API would have accepted — a
      // worse failure than the one this catch exists to prevent, and one this
      // page introduced by treating every lookup as load-bearing.
      setChecks((current) => {
        const next = { ...current };
        delete next[entry.shift.id];
        return next;
      });
      if (requireEndOfShiftChecks) {
        setChecksFailed(entry.shift.id);
        setPreparing(null);
        return;
      }
      // Proceeding is right — the server does not consult these checks here —
      // but proceeding *silently* would put the fabricated zero back, one
      // branch over from where it was taken out. Nothing read the status, and
      // the row says so.
      setChecksUnknown(entry.shift.id);
    }
    setPreparing(null);
    setOpenRow(entry.shift.id);
  };

  const outstandingChecks = (shiftId: string): number =>
    (checks[shiftId] ?? []).filter((check) => check.checkTiming === 'end_of_shift' && !isShiftCheckCompleted(check))
      .length;

  return (
    <div className="space-y-5">
      {/* No date range. This list is the backlog the server defines, not a
          query over it — a range is what let this page and the hub's count
          describe different populations, and narrowing a backlog is not a thing
          an officer needs to do to it. */}
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="btn-secondary mobile-touch-target inline-flex items-center gap-2 px-3 text-sm font-medium"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </button>
        <p className="text-theme-text-muted min-w-0 flex-1 text-sm" role="status" aria-live="polite">
          {loading || (!settingsLoaded && !settingsFailed)
            ? 'Checking…'
            : failed || settingsFailed
              ? ''
              : `${queue.length} shift${queue.length === 1 ? '' : 's'} waiting to be closed out`}
        </p>
      </div>

      {failed && (
        <div className="alert-warning flex items-center gap-2 text-sm" role="alert">
          <span className="flex-1">The close-out queue did not load, so nothing below is a complete answer.</span>
          <button
            type="button"
            className="mobile-touch-target px-2 font-semibold underline"
            onClick={() => void load()}
          >
            Retry
          </button>
        </div>
      )}

      {/* The cushion that decides when an open-ended shift is over comes from
          these settings, so without them the queue cannot be judged at all —
          and the store leaves them unloaded on failure rather than caching a
          fallback. Say so and offer the retry; a spinner that never stops is
          the same page with no explanation. */}
      {settingsFailed && (
        <div className="alert-warning flex items-center gap-2 text-sm" role="alert">
          <span className="flex-1">
            The department&rsquo;s scheduling settings did not load, so a shift with no recorded end cannot be judged
            against its cushion. Nothing is listed below.
          </span>
          <button
            type="button"
            className="mobile-touch-target px-2 font-semibold underline"
            onClick={loadDepartmentSettings}
          >
            Retry
          </button>
        </div>
      )}

      {/* Better a stated bound than a silent one. The rows below are the oldest
          of the backlog, which is the right part to work first — but the count
          in the hub is the whole of it, and an officer who closes these and
          sees the number still standing needs to know why. */}
      {!loading && !failed && total > shifts.length && (
        <div className="alert-warning text-sm" role="alert">
          The oldest {shifts.length} of {total} shifts waiting are listed. Close these out and refresh for the rest.
        </div>
      )}

      {(loading || (!settingsLoaded && !settingsFailed)) && (
        <div className="flex items-center justify-center py-16" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
        </div>
      )}

      {/* No date qualifier any more, and none is owed: this is the department's
          whole backlog, however far back it runs, so "every shift" is now the
          literal claim rather than a claim about a range the officer has to
          check. */}
      {!loading && settingsLoaded && !failed && queue.length === 0 && (
        <EmptyState
          icon={CheckCircle2}
          title="Every shift is closed out"
          description="A shift still running is not counted — one with no recorded end is judged against the department's open-ended cushion, the same number the roster lock uses."
        />
      )}

      {!loading &&
        settingsLoaded &&
        queue.map((entry) => {
          const shift = entry.shift;
          const isOpen = openRow === shift.id;
          // Only the count-only wizard holds unsaved state; the other branch
          // navigates away, so there is nothing on this page to protect.
          const blockedByOpenRow = openRow !== null && !isOpen && callTrackingMode === 'count_only';
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
              {isOpen && checksUnknown === shift.id && (
                <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  This shift&rsquo;s equipment check status could not be read, so it is not shown below. Your department
                  does not block close-out on it.
                </p>
              )}

              {isOpen && checksUnknown !== shift.id && pending > 0 && (
                <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {pending} end-of-shift equipment check{pending === 1 ? '' : 's'} still outstanding
                  {requireEndOfShiftChecks ? ' — these block close-out for your department' : ''}
                </p>
              )}

              {/* Named as a permission problem, because that is what it
                  usually is: the checklist endpoint wants an Inventory grant
                  that `scheduling.manage` does not imply. The wizard stays
                  shut — opening it on an empty list would hide the override
                  the officer needs and leave the finalize call refusing with
                  nothing on screen to explain it. */}
              {checksFailed === shift.id && (
                <div className="alert-warning flex items-center gap-2 text-sm" role="alert">
                  <span className="flex-1">
                    This shift&rsquo;s equipment checks could not be read, so close-out is not offered here. It needs an
                    Inventory checklist permission your account may not hold.
                  </span>
                  <button
                    type="button"
                    className="mobile-touch-target px-2 font-semibold underline"
                    onClick={() => void openCloseout(entry)}
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* The wizard renders nothing at all when its own state request
                  fails — it reports the error and returns null — and this row
                  has already hidden the button that opened it. Without a
                  row-level way out that leaves an empty card whose only escape
                  is the Refresh above, which does not look related to it. */}
              {isOpen && (
                <button
                  type="button"
                  onClick={() => setOpenRow(null)}
                  className="btn-secondary mobile-touch-target inline-flex items-center gap-2 px-4 text-sm font-medium"
                >
                  Close this row
                </button>
              )}

              {/* Held while another row's wizard is open. That wizard keeps the
                  step being edited — attendance times, call counts — in local
                  state until Next is pressed, and switching rows unmounts it,
                  so one click on a different row silently discarded typing. The
                  open row carries its own "Close this row", so switching is
                  still one deliberate step; it just is not an accident. */}
              {!isOpen && (
                <button
                  type="button"
                  onClick={() => void openCloseout(entry)}
                  disabled={preparing === shift.id || blockedByOpenRow}
                  title={blockedByOpenRow ? 'Close the open row first — it has unsaved close-out entries.' : undefined}
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
