/**
 * Open Shifts Tab
 *
 * Browse upcoming shifts with unfilled positions and sign up for them.
 * Members can see available positions and volunteer for shifts they're qualified for.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Clock, Users, UserPlus, Truck, Loader2, CalendarDays, Filter, Check, MapPin } from 'lucide-react';
import toast from 'react-hot-toast';
import { schedulingService } from '../../modules/scheduling/services/api';
import type { ShiftRecord } from '../../modules/scheduling/services/api';
import { useAuthStore } from '../../stores/authStore';
import { useTimezone } from '../../hooks/useTimezone';
import { formatTime, getTodayLocalDate, toLocalDateString, formatDateCustom } from '../../utils/dateFormatting';
import { getErrorMessage, toAppError } from '../../utils/errorHandling';
import { POSITION_LABELS } from '../../constants/enums';
import { useEligiblePositions } from '../../hooks/useEligiblePositions';

interface OpenShiftsTabProps {
  onViewShift?: (shift: ShiftRecord) => void;
}

export const OpenShiftsTab: React.FC<OpenShiftsTabProps> = ({ onViewShift }) => {
  const { user, checkPermission } = useAuthStore();
  const canAssign = checkPermission('scheduling.assign') || checkPermission('scheduling.manage');
  const tz = useTimezone();

  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState('');
  const [signupShiftId, setSignupShiftId] = useState<string | null>(null);
  const [signupPosition, setSignupPosition] = useState('firefighter');
  const [signingUp, setSigningUp] = useState(false);

  // Fetch eligible positions for the currently selected shift
  const {
    positions: eligiblePositions,
    isExcluded,
    loading: eligibilityLoading,
  } = useEligiblePositions(signupShiftId ?? undefined);

  const loadShifts = useCallback(async () => {
    setLoading(true);
    try {
      // Try the open shifts endpoint first, fall back to regular shifts
      try {
        const data = await schedulingService.getOpenShifts({
          start_date: dateFilter || undefined,
        });
        setShifts(data);
      } catch {
        // Fallback: get upcoming shifts
        const today = getTodayLocalDate(tz);
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 30);
        const data = await schedulingService.getShifts({
          start_date: dateFilter || today,
          end_date: toLocalDateString(endDate, tz),
          limit: 50,
        });
        setShifts(data.shifts);
      }
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to load shifts'));
    } finally {
      setLoading(false);
    }
  }, [dateFilter, tz]);

  useEffect(() => {
    void loadShifts();
  }, [loadShifts]);

  const surfaceWarnings = (res: { evoc_warnings?: { message: string }[]; overtime_warnings?: string[] }) => {
    const messages = [...(res.evoc_warnings ?? []).map((w) => w.message), ...(res.overtime_warnings ?? [])];
    if (messages.length > 0) toast(messages.join(' '), { icon: '⚠️' });
  };

  const handleSignup = async (shiftId: string) => {
    setSigningUp(true);
    try {
      const res = await schedulingService.signupForShift(shiftId, { position: signupPosition });
      toast.success('Signed up for shift — a manager will confirm your assignment');
      surfaceWarnings(res);
      setSignupShiftId(null);
      void loadShifts();
    } catch (signupErr) {
      const appError = toAppError(signupErr);
      if (canAssign && user?.id && (appError.status === 403 || appError.status === 404)) {
        try {
          const res = await schedulingService.createAssignment(shiftId, {
            user_id: user.id,
            position: signupPosition,
          });
          toast.success('Signed up for shift — a manager will confirm your assignment');
          surfaceWarnings(res);
          setSignupShiftId(null);
          void loadShifts();
          return;
        } catch {
          // Both paths failed — fall through to show original error
        }
      }
      toast.error(getErrorMessage(signupErr, 'Failed to sign up for shift'));
    } finally {
      setSigningUp(false);
    }
  };

  const groupedByDate = shifts.reduce<Record<string, ShiftRecord[]>>((acc, shift) => {
    const date = shift.shift_date;
    if (!acc[date]) acc[date] = [];
    acc[date].push(shift);
    return acc;
  }, {});

  const sortedDates = Object.keys(groupedByDate).sort();

  return (
    <div className="space-y-6">
      {/* Filter Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex flex-1 items-center gap-2">
          <Filter className="text-theme-text-muted h-4 w-4 shrink-0" />
          <span className="text-theme-text-secondary shrink-0 text-sm">From:</span>
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            aria-label="Filter open shifts from date"
            // `form-input` carries w-full. Under `sm:flex-none` that resolves
            // against the whole row rather than the space left beside the icon
            // and the "From:" label, so the field overflowed its container by
            // exactly their width and painted over the Refresh button. An
            // explicit desktop width is also all a date field needs.
            className="form-input flex-1 sm:w-44 sm:flex-none"
          />
        </div>
        <button
          onClick={() => {
            void loadShifts();
          }}
          className="w-full rounded-lg px-3 py-2 text-sm text-violet-600 transition-colors hover:bg-violet-500/10 sm:w-auto dark:text-violet-400"
        >
          Refresh
        </button>
      </div>

      {/* Info */}
      <div className="flex items-start gap-3 rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
        <UserPlus className="mt-0.5 h-5 w-5 shrink-0 text-violet-600 dark:text-violet-400" />
        <div className="text-theme-text-secondary text-sm">
          <p>
            Browse available shifts and sign up for open positions. A scheduling manager will review and confirm your
            signup.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" aria-hidden="true" />
          <span className="sr-only">Loading open shifts…</span>
        </div>
      ) : sortedDates.length === 0 ? (
        <div className="border-theme-surface-border rounded-xl border border-dashed py-16 text-center">
          <CalendarDays className="text-theme-text-muted mx-auto mb-3 h-12 w-12" />
          <h3 className="text-theme-text-primary mb-1 text-lg font-medium">No open shifts available</h3>
          <p className="text-theme-text-muted text-sm">Check back later or adjust your date filter for more results.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {sortedDates.map((date) => {
            const dateObj = new Date(date + 'T12:00:00');
            const dayShifts = groupedByDate[date];

            return (
              <div key={date}>
                <h3 className="text-theme-text-secondary mb-3 text-sm font-semibold tracking-wider uppercase">
                  {formatDateCustom(dateObj, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }, tz)}
                </h3>
                <div className="space-y-3">
                  {dayShifts?.map((shift) => (
                    <div
                      key={shift.id}
                      className="bg-theme-surface border-theme-surface-border rounded-xl border p-4 transition-colors hover:border-violet-500/30 sm:p-5"
                    >
                      <div className="flex items-start justify-between gap-3 sm:items-center">
                        <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 sm:h-12 sm:w-12">
                            <Clock className="h-5 w-5 text-violet-500 sm:h-6 sm:w-6" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-theme-text-primary text-sm font-semibold sm:text-base">
                              {formatTime(shift.start_time, tz)}
                              {shift.end_time ? ` - ${formatTime(shift.end_time, tz)}` : ''}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                              <span className="text-theme-text-muted flex items-center gap-1 text-xs">
                                <Users className="h-3 w-3" />
                                {shift.apparatus_positions && shift.apparatus_positions.length > 0
                                  ? `${shift.attendee_count} / ${shift.apparatus_positions.length} filled`
                                  : `${shift.attendee_count} assigned`}
                              </span>
                              {shift.apparatus_unit_number && (
                                <span className="text-theme-text-muted flex items-center gap-1 text-xs">
                                  <Truck className="h-3 w-3" /> {shift.apparatus_unit_number}
                                  {shift.apparatus_name && (
                                    <span className="hidden sm:inline"> — {shift.apparatus_name}</span>
                                  )}
                                </span>
                              )}
                              {shift.shift_officer_name && (
                                <span className="text-theme-text-muted hidden items-center gap-1 text-xs sm:flex">
                                  <MapPin className="h-3 w-3" /> {shift.shift_officer_name}
                                </span>
                              )}
                            </div>
                            {shift.notes && (
                              <p className="text-theme-text-muted mt-1 truncate text-xs">{shift.notes}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            onClick={() => setSignupShiftId(shift.id)}
                            className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-violet-700 sm:text-sm"
                            aria-label="Sign up for this shift"
                          >
                            <UserPlus className="h-4 w-4" /> <span className="hidden sm:inline">Sign Up</span>
                            <span className="sm:hidden">Join</span>
                          </button>
                          {onViewShift && (
                            <button
                              onClick={() => onViewShift(shift)}
                              className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover hidden rounded-lg border px-3 py-2 text-sm transition-colors sm:block"
                              aria-label="View shift details"
                            >
                              Details
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {/* Signup Modal */}
      {signupShiftId &&
        (() => {
          const targetShift = shifts.find((s) => s.id === signupShiftId);
          return (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
              role="dialog"
              aria-modal="true"
              aria-label="Sign up for shift"
              onKeyDown={(e) => {
                if (e.key === 'Escape') setSignupShiftId(null);
              }}
            >
              <div className="bg-theme-surface-modal border-theme-surface-border w-full max-w-sm rounded-xl border">
                <div className="border-theme-surface-border border-b p-5">
                  <h2 className="text-theme-text-primary text-lg font-bold">Sign Up for Shift</h2>
                  {targetShift && (
                    <p className="text-theme-text-secondary mt-1 text-sm">
                      {formatDateCustom(
                        targetShift.shift_date + 'T12:00:00',
                        { weekday: 'short', month: 'short', day: 'numeric' },
                        tz
                      )}{' '}
                      {formatTime(targetShift.start_time, tz)}
                      {targetShift.end_time ? ` - ${formatTime(targetShift.end_time, tz)}` : ''}
                      {targetShift.apparatus_unit_number ? ` (${targetShift.apparatus_unit_number})` : ''}
                    </p>
                  )}
                </div>
                <div className="space-y-4 p-5">
                  {eligibilityLoading ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="text-theme-text-muted h-5 w-5 animate-spin" />
                    </div>
                  ) : isExcluded || eligiblePositions.length === 0 ? (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                      <p className="text-sm text-amber-600 dark:text-amber-400">
                        You are not eligible to sign up for this shift. Contact a scheduling admin for assistance.
                      </p>
                    </div>
                  ) : (
                    <div>
                      <label
                        htmlFor="signup-position"
                        className="text-theme-text-secondary mb-1 block text-sm font-medium"
                      >
                        Position
                      </label>
                      <select
                        id="signup-position"
                        value={signupPosition}
                        onChange={(e) => setSignupPosition(e.target.value)}
                        className="form-input"
                      >
                        {eligiblePositions.map((pos) => (
                          <option key={pos} value={pos}>
                            {POSITION_LABELS[pos] ?? pos}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
                <div className="border-theme-surface-border flex justify-end gap-3 border-t p-5">
                  <button
                    onClick={() => setSignupShiftId(null)}
                    className="text-theme-text-secondary hover:text-theme-text-primary px-4 py-2 text-sm"
                  >
                    Cancel
                  </button>
                  {!isExcluded && eligiblePositions.length > 0 && (
                    <button
                      onClick={() => {
                        void handleSignup(signupShiftId);
                      }}
                      disabled={signingUp}
                      className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                    >
                      {signingUp ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      Confirm Sign Up
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
    </div>
  );
};

export default OpenShiftsTab;
