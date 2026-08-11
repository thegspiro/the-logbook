/**
 * Shift Check-In Landing Page
 *
 * Handles QR code scans for shift check-in/check-out.
 * URL: /scheduling/checkin?shift=<id>
 */

import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import { LogIn, LogOut, Loader2, CheckCircle2, Clock, AlertCircle, ClipboardCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { schedulingService } from '../../modules/scheduling/services/api';
import type { ShiftRecord } from '../../modules/scheduling/services/api';
import { useTimezone } from '../../hooks/useTimezone';
import { formatCalendarDate, formatTime } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';

const ShiftCheckInPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const tz = useTimezone();
  const paramShiftId = searchParams.get('shift') || '';
  const paramApparatusId = searchParams.get('apparatus') || '';

  const [resolvedShiftId, setResolvedShiftId] = useState(paramShiftId);
  const [shift, setShift] = useState<ShiftRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [noActiveShift, setNoActiveShift] = useState(false);
  const [attendance, setAttendance] = useState<{
    checked_in_at?: string;
    checked_out_at?: string;
    duration_minutes?: number;
  } | null>(null);
  const [processing, setProcessing] = useState(false);
  /**
   * Whether this shift actually has an outstanding start-of-shift checklist.
   *
   * The button below points at one, and a department can have none configured —
   * or have already completed them — in which case sending a member to the
   * equipment-check tab promises something that is not there. Left false when
   * the lookup fails: we only offer the step when we know it exists.
   */
  const [hasStartChecklist, setHasStartChecklist] = useState(false);

  useEffect(() => {
    if (!paramShiftId && !paramApparatusId) {
      setLoading(false);
      return;
    }
    const load = async () => {
      try {
        let sid = paramShiftId;
        if (!sid && paramApparatusId) {
          const activeShift = await schedulingService.getActiveShiftForApparatus(paramApparatusId).catch(() => null);
          if (!activeShift) {
            setNoActiveShift(true);
            setLoading(false);
            return;
          }
          sid = activeShift.id;
        }
        setResolvedShiftId(sid);
        const [shiftData, attendanceData] = await Promise.all([
          schedulingService.getShift(sid),
          schedulingService.getMyAttendance(sid),
        ]);
        setShift(shiftData);
        setAttendance(attendanceData);
        const checklists = await schedulingService.getShiftChecklists(sid).catch(() => []);
        setHasStartChecklist(checklists.some((c) => c.checkTiming === 'start_of_shift' && !c.isCompleted));
      } catch {
        toast.error('Unable to load shift');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [paramShiftId, paramApparatusId]);

  /**
   * Re-read the shift when the page comes back into view.
   *
   * `checkin_open` is a verdict about *now*, taken once on load. A phone that
   * scanned the sticker and went back in a pocket would otherwise still show
   * the button it had when the window was shut — or an enabled one after the
   * window closed. Refreshing on visibility covers the way this page is
   * actually used without polling a timer against the clock.
   */
  useEffect(() => {
    if (!resolvedShiftId) return;
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      void schedulingService
        .getShift(resolvedShiftId)
        .then(setShift)
        .catch(() => {
          /* Leave the last known state; the action itself still reports. */
        });
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [resolvedShiftId]);

  const handleCheckIn = async () => {
    setProcessing(true);
    try {
      const result = await schedulingService.checkIn(resolvedShiftId);
      setAttendance(result);
      toast.success('Checked in successfully');
    } catch (err: unknown) {
      // Show what the server said. A bare "Failed to check in" threw away the
      // one sentence that explains it — "This shift ended too long ago to check
      // in to. Ask an officer to record your attendance." — and left the member
      // with nothing to act on.
      toast.error(getErrorMessage(err, 'Failed to check in'));
      // The refusal may be the window having moved since the page loaded, so
      // re-read the shift and let the button and its reason catch up.
      void schedulingService
        .getShift(resolvedShiftId)
        .then(setShift)
        .catch(() => {});
    } finally {
      setProcessing(false);
    }
  };

  const handleCheckOut = async () => {
    setProcessing(true);
    try {
      const result = await schedulingService.checkOut(resolvedShiftId);
      setAttendance(result);
      const hrs = Math.round(((result.duration_minutes ?? 0) / 60) * 10) / 10;
      toast.success(`Checked out - ${hrs} hours recorded`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to check out'));
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (noActiveShift) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center">
          <Clock className="mx-auto mb-3 h-12 w-12 text-amber-500" />
          <h1 className="text-theme-text-primary mb-1 text-xl font-bold">No Active Shift</h1>
          <p className="text-theme-text-muted mb-4 text-sm">
            There is no active or upcoming shift for this apparatus right now. Check back closer to your shift start
            time.
          </p>
          <button
            onClick={() => void navigate('/scheduling')}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700"
          >
            Go to Scheduling
          </button>
        </div>
      </div>
    );
  }

  if (!shift) {
    /* The old message — "This QR code may be invalid or you may not have access
       to this shift" — blamed a code that may never have been used: this page is
       also reached by typing the URL, from a notification, or from a stale
       bookmark. Two guesses, neither actionable. Whether a shift was asked for
       at all is the one thing we do know, so each case says its own sentence. */
    const askedForAShift = Boolean(paramShiftId || paramApparatusId);
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-sm text-center">
          <AlertCircle className="mx-auto mb-3 h-12 w-12 text-red-500" aria-hidden="true" />
          <h1 className="text-theme-text-primary mb-1 text-xl font-bold">
            {askedForAShift ? "We couldn't open that shift" : 'Which shift?'}
          </h1>
          <p className="text-theme-text-muted mb-4 text-sm">
            {askedForAShift
              ? 'The shift may have been deleted, or you may not be assigned to it. If you are working it, ask an officer to record your attendance.'
              : 'This page checks you in to one particular shift. Scan the code on the apparatus, or open the shift from My Shifts and check in from there.'}
          </p>
          <button
            onClick={() => void navigate('/scheduling?tab=my-shifts')}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700"
          >
            Go to My Shifts
          </button>
        </div>
      </div>
    );
  }

  const hrs = attendance?.duration_minutes ? Math.round((attendance.duration_minutes / 60) * 10) / 10 : null;

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="bg-theme-surface border-theme-surface-border w-full max-w-sm space-y-5 rounded-2xl border p-6 shadow-lg">
        {/* Shift info */}
        <div className="text-center">
          <h1 className="text-theme-text-primary text-xl font-bold">Shift Check-In</h1>
          <p className="text-theme-text-muted mt-1 text-sm">
            {/* Either identifier names the rig — `unit_number` is required and
                `name` an optional nickname — so falling back on the name alone
                left the generic word "Shift" on the one screen whose whole job
                is confirming which truck you are checking in to.

                `shift_date` is a calendar date, not an instant — formatting it
                in the org timezone shifted it a day earlier for anywhere west
                of UTC, so this card named yesterday's date. */}
            {[shift.apparatus_unit_number, shift.apparatus_name].filter(Boolean).join(' — ') || 'Shift'} &mdash;{' '}
            {formatCalendarDate(shift.shift_date, { year: 'numeric', month: 'numeric', day: 'numeric' })}
          </p>
          <p className="text-theme-text-muted text-xs">
            {formatTime(shift.start_time, tz)}
            {shift.end_time ? ` - ${formatTime(shift.end_time, tz)}` : ''}
          </p>
        </div>

        {/* Status and action */}
        {!attendance?.checked_in_at ? (
          <>
            <button
              onClick={() => {
                void handleCheckIn();
              }}
              disabled={processing || shift.is_finalized || shift.checkin_open === false}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 px-6 py-4 text-lg font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-50"
            >
              {processing ? <Loader2 className="h-6 w-6 animate-spin" /> : <LogIn className="h-6 w-6" />}
              Check In
            </button>
            {/* Say why it is unavailable. Offering a live-looking button that the
                API then refuses is the state this replaces. */}
            {shift.checkin_closed_reason && !shift.is_finalized && (
              <p className="text-center text-xs text-amber-600 dark:text-amber-400">{shift.checkin_closed_reason}</p>
            )}
          </>
        ) : !attendance?.checked_out_at ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg bg-green-500/10 p-3">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <div>
                <p className="text-sm font-medium text-green-700 dark:text-green-400">Checked in</p>
                <p className="text-xs text-green-600/70 dark:text-green-400/70">
                  <Clock className="mr-1 inline h-3 w-3" />
                  {formatTime(attendance.checked_in_at, tz)}
                </p>
              </div>
            </div>
            {/* Checking in used to lead nowhere, though the next thing to do —
                the start-of-shift checklist — is one tap away on another tab of
                another page. Only offered when the shift actually has one
                outstanding. Check Out stays the prominent button: it is the one
                that closes the shift out, hours later, from this same screen. */}
            {hasStartChecklist && (
              <button
                onClick={() => void navigate(`/scheduling?tab=equipment-checks&shift=${resolvedShiftId}`)}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-violet-500/40 px-6 py-3 text-base font-semibold text-violet-700 transition-colors hover:bg-violet-500/10 dark:text-violet-300"
              >
                <ClipboardCheck className="h-5 w-5" aria-hidden="true" />
                Start-of-shift checklist
              </button>
            )}
            <button
              onClick={() => {
                void handleCheckOut();
              }}
              disabled={processing || shift.is_finalized}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-6 py-4 text-lg font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
            >
              {processing ? <Loader2 className="h-6 w-6 animate-spin" /> : <LogOut className="h-6 w-6" />}
              Check Out
            </button>
            <button
              onClick={() => void navigate(`/scheduling?tab=equipment-checks&shift=${resolvedShiftId}`)}
              className="border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-hover flex w-full items-center justify-center rounded-xl border px-4 py-3 text-sm font-medium transition-colors"
            >
              Open today&apos;s checklists
            </button>
          </div>
        ) : (
          <div className="space-y-3 text-center">
            <div className="bg-theme-surface-hover rounded-lg p-4">
              <CheckCircle2 className="mx-auto mb-2 h-10 w-10 text-green-600" />
              <p className="text-theme-text-primary text-lg font-bold">{hrs} hours</p>
              <p className="text-theme-text-muted text-xs">
                {formatTime(attendance.checked_in_at, tz)} &rarr; {formatTime(attendance.checked_out_at, tz)}
              </p>
            </div>
            <p className="text-theme-text-muted text-sm">Shift complete. Thank you!</p>
          </div>
        )}

        {shift.is_finalized && (
          <p className="text-center text-xs text-amber-600 dark:text-amber-400">
            This shift has been finalized. Check-in/out is closed.
          </p>
        )}

        <button
          onClick={() => void navigate('/scheduling')}
          className="text-theme-text-muted hover:text-theme-text-primary w-full py-2 text-center text-sm transition-colors"
        >
          Go to Scheduling
        </button>
      </div>
    </div>
  );
};

export default ShiftCheckInPage;
