/**
 * Open Shifts Tab
 *
 * Browse upcoming shifts with unfilled positions and sign up for them.
 * Members can see available positions and volunteer for shifts they're qualified for.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Clock, Users, UserPlus, Truck, Loader2,
  CalendarDays, Filter, Check, MapPin,
} from 'lucide-react';
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
  const { positions: eligiblePositions, isExcluded, loading: eligibilityLoading } = useEligiblePositions(
    signupShiftId ?? undefined,
  );

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

  useEffect(() => { void loadShifts(); }, [loadShifts]);

  const handleSignup = async (shiftId: string) => {
    setSigningUp(true);
    try {
      await schedulingService.signupForShift(shiftId, { position: signupPosition });
      toast.success('Signed up for shift — a manager will confirm your assignment');
      setSignupShiftId(null);
      void loadShifts();
    } catch (signupErr) {
      const appError = toAppError(signupErr);
      if (canAssign && (appError.status === 403 || appError.status === 404)) {
        try {
          await schedulingService.createAssignment(shiftId, {
            user_id: user?.id ?? '',
            position: signupPosition,
          });
          toast.success('Signed up for shift — a manager will confirm your assignment');
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
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
        <div className="flex items-center gap-2 flex-1">
          <Filter className="w-4 h-4 text-theme-text-muted shrink-0" />
          <span className="text-sm text-theme-text-secondary shrink-0">From:</span>
          <input type="date" value={dateFilter}
            onChange={e => setDateFilter(e.target.value)}
            aria-label="Filter open shifts from date"
            className="flex-1 sm:flex-none bg-theme-input-bg border border-theme-input-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:outline-hidden focus:ring-2 focus:ring-violet-500"
          />
        </div>
        <button onClick={() => { void loadShifts(); }}
          className="px-3 py-2 text-sm text-violet-600 dark:text-violet-400 hover:bg-violet-500/10 rounded-lg transition-colors w-full sm:w-auto"
        >
          Refresh
        </button>
      </div>

      {/* Info */}
      <div className="flex items-start gap-3 p-4 bg-violet-500/5 border border-violet-500/20 rounded-xl">
        <UserPlus className="w-5 h-5 text-violet-600 dark:text-violet-400 shrink-0 mt-0.5" />
        <div className="text-sm text-theme-text-secondary">
          <p>Browse available shifts and sign up for open positions. A scheduling manager will review and confirm your signup.</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20" role="status">
          <Loader2 className="w-8 h-8 animate-spin text-theme-text-muted" aria-hidden="true" />
          <span className="sr-only">Loading open shifts…</span>
        </div>
      ) : sortedDates.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-theme-surface-border rounded-xl">
          <CalendarDays className="w-12 h-12 text-theme-text-muted mx-auto mb-3" />
          <h3 className="text-lg font-medium text-theme-text-primary mb-1">No open shifts available</h3>
          <p className="text-theme-text-muted text-sm">
            Check back later or adjust your date filter for more results.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {sortedDates.map(date => {
            const dateObj = new Date(date + 'T12:00:00');
            const dayShifts = groupedByDate[date];

            return (
              <div key={date}>
                <h3 className="text-sm font-semibold text-theme-text-secondary uppercase tracking-wider mb-3">
                  {formatDateCustom(dateObj, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }, tz)}
                </h3>
                <div className="space-y-3">
                  {dayShifts?.map(shift => (
                    <div key={shift.id}
                      className="bg-theme-surface border border-theme-surface-border rounded-xl p-4 sm:p-5 hover:border-violet-500/30 transition-colors"
                    >
                      <div className="flex items-start sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
                          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                            <Clock className="w-5 h-5 sm:w-6 sm:h-6 text-violet-500" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm sm:text-base font-semibold text-theme-text-primary">
                              {formatTime(shift.start_time, tz)}
                              {shift.end_time ? ` - ${formatTime(shift.end_time, tz)}` : ''}
                            </p>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
                              <span className="flex items-center gap-1 text-xs text-theme-text-muted">
                                <Users className="w-3 h-3" />
                                {shift.apparatus_positions && shift.apparatus_positions.length > 0
                                  ? `${shift.attendee_count} / ${shift.apparatus_positions.length} filled`
                                  : `${shift.attendee_count} assigned`
                                }
                              </span>
                              {shift.apparatus_unit_number && (
                                <span className="flex items-center gap-1 text-xs text-theme-text-muted">
                                  <Truck className="w-3 h-3" /> {shift.apparatus_unit_number}
                                  {shift.apparatus_name && <span className="hidden sm:inline"> — {shift.apparatus_name}</span>}
                                </span>
                              )}
                              {shift.shift_officer_name && (
                                <span className="hidden sm:flex items-center gap-1 text-xs text-theme-text-muted">
                                  <MapPin className="w-3 h-3" /> {shift.shift_officer_name}
                                </span>
                              )}
                            </div>
                            {shift.notes && (
                              <p className="text-xs text-theme-text-muted mt-1 truncate">{shift.notes}</p>
                            )}
                          </div>
                        </div>
                        {/* Desktop buttons (hidden on mobile when signup form is open) */}
                        {signupShiftId !== shift.id && (
                          <div className="flex items-center gap-2 shrink-0">
                            <button onClick={() => setSignupShiftId(shift.id)}
                              className="flex items-center gap-1.5 px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-xs sm:text-sm font-medium transition-colors"
                              aria-label="Sign up for this shift"
                            >
                              <UserPlus className="w-4 h-4" /> <span className="hidden sm:inline">Sign Up</span><span className="sm:hidden">Join</span>
                            </button>
                            {onViewShift && (
                              <button onClick={() => onViewShift(shift)}
                                className="hidden sm:block px-3 py-2 text-sm border border-theme-surface-border rounded-lg text-theme-text-secondary hover:bg-theme-surface-hover transition-colors"
                                aria-label="View shift details"
                              >
                                Details
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      {/* Signup form — stacks below card content on mobile */}
                      {signupShiftId === shift.id && (
                        <div className="mt-3 pt-3 border-t border-theme-surface-border">
                          {eligibilityLoading ? (
                            <div className="flex items-center justify-center py-3">
                              <Loader2 className="w-4 h-4 animate-spin text-theme-text-muted" />
                            </div>
                          ) : isExcluded || eligiblePositions.length === 0 ? (
                            <div className="flex items-center gap-2 py-2">
                              <p className="text-sm text-amber-600 dark:text-amber-400">
                                You are not eligible to sign up for this shift. Contact a scheduling admin for assistance.
                              </p>
                              <button onClick={() => setSignupShiftId(null)}
                                className="px-3 py-1.5 text-sm text-theme-text-muted hover:text-theme-text-primary border border-theme-surface-border rounded-lg shrink-0"
                              >
                                Close
                              </button>
                            </div>
                          ) : (
                          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                            <select value={signupPosition} onChange={e => setSignupPosition(e.target.value)}
                              aria-label="Position to sign up for"
                              className="flex-1 bg-theme-input-bg border border-theme-input-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:outline-hidden focus:ring-2 focus:ring-violet-500"
                            >
                              {eligiblePositions.map((pos) => (
                                <option key={pos} value={pos}>{POSITION_LABELS[pos] ?? pos}</option>
                              ))}
                            </select>
                            <div className="flex items-center gap-2">
                              <button onClick={() => { void handleSignup(shift.id); }} disabled={signingUp}
                                className="flex-1 sm:flex-none px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 inline-flex items-center justify-center gap-1"
                              >
                                {signingUp ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                Confirm
                              </button>
                              <button onClick={() => setSignupShiftId(null)}
                                className="px-3 py-2 text-sm text-theme-text-muted hover:text-theme-text-primary border border-theme-surface-border rounded-lg"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default OpenShiftsTab;
