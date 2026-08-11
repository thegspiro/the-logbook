/**
 * My Shifts Tab
 *
 * Shows the current user's upcoming and past shift assignments.
 * Allows confirming/declining assignments, requesting swaps, and requesting time off.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Clock,
  Check,
  XCircle,
  ArrowLeftRight,
  CalendarOff,
  Loader2,
  ChevronDown,
  AlertTriangle,
  Bell,
  LogIn,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import toast from 'react-hot-toast';
import { schedulingService } from '../../modules/scheduling/services/api';
import type { ShiftRecord, ShiftAttendanceRecord } from '../../modules/scheduling/services/api';
import type { Assignment } from '../../types/scheduling';
import { useTimezone } from '../../hooks/useTimezone';
import { formatTime, getTodayLocalDate, formatDateCustom } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import { ASSIGNMENT_STATUS_COLORS, AssignmentStatus } from '../../constants/enums';
import { useAuthStore } from '../../stores/authStore';
import { useSchedulingStore } from '../../modules/scheduling/store/schedulingStore';
import { CalendarSubscribeCard } from './CalendarSubscribeCard';

interface MyShiftsTabProps {
  onViewShift?: (shift: ShiftRecord) => void;
}

export const MyShiftsTab: React.FC<MyShiftsTabProps> = ({ onViewShift }) => {
  const tz = useTimezone();
  const platoon = useAuthStore((s) => s.user?.platoon);
  const platoonsEnabled = useSchedulingStore((s) => s.platoonsEnabled);
  const loadSettings = useSchedulingStore((s) => s.loadSettings);
  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);
  const [searchParams] = useSearchParams();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'upcoming' | 'past'>(searchParams.get('view') === 'past' ? 'past' : 'upcoming');

  // Attendance history for hours display, keyed by shift_id.
  const [attendanceMap, setAttendanceMap] = useState<Map<string, ShiftAttendanceRecord>>(new Map());

  // Swap request modal
  const [showSwapModal, setShowSwapModal] = useState(false);
  const [swapAssignment, setSwapAssignment] = useState<Assignment | null>(null);
  const [swapForm, setSwapForm] = useState({ target_shift_id: '', reason: '' });
  const [submittingSwap, setSubmittingSwap] = useState(false);
  const [availableShifts, setAvailableShifts] = useState<ShiftRecord[]>([]);

  // Time off modal
  const [showTimeOffModal, setShowTimeOffModal] = useState(false);
  const [timeOffForm, setTimeOffForm] = useState({ start_date: '', end_date: '', reason: '' });
  const [submittingTimeOff, setSubmittingTimeOff] = useState(false);

  // Inline confirmation for decline
  const [confirmingDecline, setConfirmingDecline] = useState<string | null>(null);

  // Per-button loading states
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  // Bulk selection for confirm/decline
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkActioning, setBulkActioning] = useState(false);

  // Refs for modal focus management
  const swapModalRef = useRef<HTMLDivElement>(null);
  const timeOffModalRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [assignData, attHistory] = await Promise.all([
        schedulingService.getMyAssignments(),
        schedulingService.getMyAttendanceHistory().catch(() => []),
      ]);
      setAssignments(assignData);
      const map = new Map<string, ShiftAttendanceRecord>();
      for (const att of attHistory) {
        map.set(att.shift_id, att);
      }
      setAttendanceMap(map);
    } catch {
      toast.error('Failed to load your shifts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleConfirm = async (assignmentId: string) => {
    setConfirmingId(assignmentId);
    try {
      await schedulingService.confirmAssignment(assignmentId);
      toast.success('Shift confirmed');
      void loadData();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to confirm shift'));
    } finally {
      setConfirmingId(null);
    }
  };

  const handleDecline = async (assignmentId: string) => {
    try {
      await schedulingService.updateAssignment(assignmentId, { assignment_status: 'declined' });
      toast.success('Shift declined');
      setConfirmingDecline(null);
      void loadData();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to decline shift'));
    }
  };

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Escape key closes modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showSwapModal) setShowSwapModal(false);
        else if (showTimeOffModal) setShowTimeOffModal(false);
        else if (confirmingDecline) setConfirmingDecline(null);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showSwapModal, showTimeOffModal, confirmingDecline]);

  // Focus management: auto-focus first interactive element when modal opens
  useEffect(() => {
    if (showSwapModal) swapModalRef.current?.querySelector<HTMLElement>('select, input, textarea')?.focus();
  }, [showSwapModal]);
  useEffect(() => {
    if (showTimeOffModal) timeOffModalRef.current?.querySelector<HTMLElement>('input')?.focus();
  }, [showTimeOffModal]);

  const openSwapRequest = async (assignment: Assignment) => {
    setSwapAssignment(assignment);
    setSwapForm({ target_shift_id: '', reason: '' });
    setShowSwapModal(true);
    // Load available shifts for the picker
    try {
      const today = getTodayLocalDate(tz);
      const data = await schedulingService.getShifts({ start_date: today, limit: 50 });
      // Filter out the current shift
      setAvailableShifts(data.shifts.filter((s) => s.id !== assignment.shift_id));
    } catch {
      // Non-critical — user can still submit open swap
    }
  };

  const handleSwapRequest = async () => {
    if (!swapAssignment) return;
    setSubmittingSwap(true);
    try {
      await schedulingService.createSwapRequest({
        offering_shift_id: swapAssignment.shift_id,
        requesting_shift_id:
          swapForm.target_shift_id && swapForm.target_shift_id !== 'pick' ? swapForm.target_shift_id : undefined,
        reason: swapForm.reason || undefined,
      });
      toast.success('Swap request submitted — check Requests tab for status');
      setShowSwapModal(false);
      void loadData();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to submit swap request'));
    } finally {
      setSubmittingSwap(false);
    }
  };

  // Check for conflicting assignments during time-off date range
  const timeOffConflicts = useMemo(() => {
    if (!timeOffForm.start_date) return [];
    const start = timeOffForm.start_date;
    const end = timeOffForm.end_date || timeOffForm.start_date;
    return assignments.filter((a) => {
      const shiftDate = a.shift?.shift_date || '';
      return (
        shiftDate >= start &&
        shiftDate <= end &&
        a.status !== AssignmentStatus.DECLINED &&
        a.status !== AssignmentStatus.CANCELLED
      );
    });
  }, [assignments, timeOffForm.start_date, timeOffForm.end_date]);

  const handleTimeOffRequest = async () => {
    if (!timeOffForm.start_date) {
      toast.error('Start date is required');
      return;
    }
    setSubmittingTimeOff(true);
    try {
      await schedulingService.createTimeOff({
        start_date: timeOffForm.start_date,
        end_date: timeOffForm.end_date || timeOffForm.start_date,
        reason: timeOffForm.reason || undefined,
      });
      toast.success('Time off request submitted — check Requests tab for status');
      setShowTimeOffModal(false);
      setTimeOffForm({ start_date: '', end_date: '', reason: '' });
      void loadData();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to submit time off request'));
    } finally {
      setSubmittingTimeOff(false);
    }
  };

  const today = getTodayLocalDate(tz);
  const upcoming = assignments.filter((a) => {
    const shiftDate = a.shift?.shift_date || '';
    return shiftDate >= today && a.status !== AssignmentStatus.DECLINED && a.status !== AssignmentStatus.CANCELLED;
  });
  const pastAssignments = assignments.filter((a) => {
    const shiftDate = a.shift?.shift_date || '';
    return shiftDate < today;
  });

  // Past shifts may exist as ShiftAttendance records without a corresponding
  // ShiftAssignment row (walk-on attendance, deleted assignments). Synthesize
  // assignment-shaped entries for those so the Past list matches the hours
  // counted on the dashboard. The synthetic 'completed' status isn't in the
  // backend AssignmentStatus enum, so we cast through unknown.
  const assignedShiftIds = new Set(pastAssignments.map((a) => a.shift_id).filter((id): id is string => Boolean(id)));
  const attendanceOnlyPast = [...attendanceMap.entries()]
    .filter(([shiftId, att]) => {
      if (assignedShiftIds.has(shiftId)) return false;
      const date = att.shift_date || '';
      return date && date < today;
    })
    .map(([shiftId, att]) => ({
      id: `attendance-${att.id}`,
      user_id: '',
      shift_id: shiftId,
      position: '—',
      status: 'completed',
      shift: {
        id: shiftId,
        shift_date: att.shift_date || '',
        start_time: att.shift_start_time || '',
        end_time: att.shift_end_time,
      },
    })) as unknown as Assignment[];

  const past = [...pastAssignments, ...attendanceOnlyPast].sort((a, b) => {
    const dateA = a.shift?.shift_date || '';
    const dateB = b.shift?.shift_date || '';
    return dateB.localeCompare(dateA);
  });

  const displayList = view === 'upcoming' ? upcoming : past;

  // Bulk selection helpers — must be after 'upcoming' is defined
  const pendingAssigned = upcoming.filter((a) => a.status === AssignmentStatus.ASSIGNED);
  const allPendingSelected = pendingAssigned.length > 0 && pendingAssigned.every((a) => selectedIds.has(a.id));

  const toggleSelectAll = () => {
    if (allPendingSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingAssigned.map((a) => a.id)));
    }
  };

  const handleBulkConfirm = async () => {
    setBulkActioning(true);
    let count = 0;
    let failed = 0;
    for (const id of selectedIds) {
      try {
        await schedulingService.confirmAssignment(id);
        count++;
      } catch {
        failed++;
      }
    }
    if (count > 0) toast.success(`${count} shift${count > 1 ? 's' : ''} confirmed`);
    if (failed > 0) toast.error(`${failed} shift${failed > 1 ? 's' : ''} could not be confirmed`);
    setSelectedIds(new Set());
    setBulkActioning(false);
    void loadData();
  };

  const handleBulkDecline = async () => {
    setBulkActioning(true);
    let count = 0;
    let failed = 0;
    for (const id of selectedIds) {
      try {
        await schedulingService.updateAssignment(id, { assignment_status: 'declined' });
        count++;
      } catch {
        failed++;
      }
    }
    if (count > 0) toast.success(`${count} shift${count > 1 ? 's' : ''} declined`);
    if (failed > 0) toast.error(`${failed} shift${failed > 1 ? 's' : ''} could not be declined`);
    setSelectedIds(new Set());
    setBulkActioning(false);
    void loadData();
  };

  const inputCls =
    'w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-4 py-2.5 text-theme-text-primary placeholder-theme-text-muted focus:outline-hidden focus:ring-2 focus:ring-violet-500';

  if (loading) {
    return (
      <div
        className="flex items-center justify-center py-20"
        role="status"
        aria-live="polite"
        aria-label="Loading shifts"
      >
        <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" aria-hidden="true" />
        <span className="sr-only">Loading your shifts…</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <CalendarSubscribeCard />
      {/* Actions Bar */}
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <div className="bg-theme-input-bg flex rounded-lg p-1">
            <button
              onClick={() => setView('upcoming')}
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors sm:flex-none ${view === 'upcoming' ? 'bg-violet-600 text-white' : 'text-theme-text-muted hover:text-theme-text-primary'}`}
            >
              Upcoming ({upcoming.length})
            </button>
            <button
              onClick={() => setView('past')}
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors sm:flex-none ${view === 'past' ? 'bg-violet-600 text-white' : 'text-theme-text-muted hover:text-theme-text-primary'}`}
            >
              Past ({past.length})
            </button>
          </div>
          {platoonsEnabled && platoon && (
            <span className="rounded-lg border border-violet-500/20 bg-violet-500/10 px-2.5 py-1 text-xs font-medium whitespace-nowrap text-violet-700 dark:text-violet-300">
              Platoon {platoon}
            </span>
          )}
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <button
            onClick={() => {
              setTimeOffForm({ start_date: '', end_date: '', reason: '' });
              setShowTimeOffModal(true);
            }}
            className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover flex flex-1 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm transition-colors sm:flex-none"
          >
            <CalendarOff className="h-4 w-4" /> Request Time Off
          </button>
          <Link
            to="/notifications?filter=schedule_change"
            className="text-theme-text-muted hover:bg-theme-surface-hover flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors hover:text-violet-600 dark:hover:text-violet-400"
            title="View scheduling notification history"
          >
            <Bell className="h-4 w-4" />
            <span className="hidden sm:inline">Alerts</span>
          </Link>
        </div>
      </div>

      {/* Hours summary for past shifts */}
      {view === 'past' && attendanceMap.size > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-theme-surface border-theme-surface-border rounded-lg border p-3 text-center">
            <p className="text-theme-text-primary text-xl font-bold">
              {Math.round(
                ([...attendanceMap.values()]
                  .filter((a) => a.duration_minutes)
                  .reduce((sum, a) => sum + (a.duration_minutes ?? 0), 0) /
                  60) *
                  10
              ) / 10}
            </p>
            <p className="text-theme-text-muted text-xs">Total Hours</p>
          </div>
          <div className="bg-theme-surface border-theme-surface-border rounded-lg border p-3 text-center">
            <p className="text-theme-text-primary text-xl font-bold">
              {[...attendanceMap.values()].filter((a) => a.checked_in_at).length}
            </p>
            <p className="text-theme-text-muted text-xs">Shifts Logged</p>
          </div>
          <div className="bg-theme-surface border-theme-surface-border rounded-lg border p-3 text-center">
            <p className="text-theme-text-primary text-xl font-bold">
              {attendanceMap.size > 0
                ? Math.round(
                    ([...attendanceMap.values()]
                      .filter((a) => a.duration_minutes)
                      .reduce((sum, a) => sum + (a.duration_minutes ?? 0), 0) /
                      [...attendanceMap.values()].filter((a) => a.duration_minutes).length /
                      60) *
                      10
                  ) / 10 || 0
                : 0}
            </p>
            <p className="text-theme-text-muted text-xs">Avg Hours/Shift</p>
          </div>
        </div>
      )}

      {/* Bulk action bar */}
      {view === 'upcoming' && pendingAssigned.length > 1 && (
        <div className="bg-theme-surface-hover/50 border-theme-surface-border flex items-center justify-between gap-3 rounded-lg border p-3">
          <label className="text-theme-text-secondary flex cursor-pointer items-center gap-2 text-sm select-none">
            <input
              type="checkbox"
              checked={allPendingSelected}
              onChange={toggleSelectAll}
              className="border-theme-input-border h-4 w-4 rounded text-violet-600 focus:ring-violet-500"
            />
            {/* "pending" contradicted the Assigned badge on every row it
                covered. These are assigned shifts awaiting the member's own
                confirmation, so say that. */}
            {selectedIds.size > 0
              ? `${selectedIds.size} selected`
              : `Select all ${pendingAssigned.length} awaiting your confirmation`}
          </label>
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  void handleBulkConfirm();
                }}
                disabled={bulkActioning}
                className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" /> Confirm All
              </button>
              <button
                onClick={() => {
                  void handleBulkDecline();
                }}
                disabled={bulkActioning}
                className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                <XCircle className="h-3.5 w-3.5" /> Decline All
              </button>
            </div>
          )}
        </div>
      )}

      {/* Shift List */}
      {displayList.length === 0 ? (
        <div className="border-theme-surface-border rounded-xl border border-dashed py-16 text-center">
          <Clock className="text-theme-text-muted mx-auto mb-3 h-12 w-12" />
          <h3 className="text-theme-text-primary mb-1 text-lg font-medium">
            {view === 'upcoming' ? 'No upcoming shifts' : 'No past shifts found'}
          </h3>
          <p className="text-theme-text-muted mx-auto max-w-sm text-sm">
            {view === 'upcoming'
              ? 'You have no scheduled shifts coming up. Check the Open Shifts tab to browse and sign up for available shifts.'
              : 'Your completed shift history will appear here once you have past assignments.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayList.map((assignment) => {
            const shift = assignment.shift;
            const statusColor = ASSIGNMENT_STATUS_COLORS[assignment.status] || ASSIGNMENT_STATUS_COLORS.assigned;
            const shiftDate = shift ? new Date(shift.shift_date + 'T12:00:00') : null;

            return (
              <div
                key={assignment.id}
                className="bg-theme-surface border-theme-surface-border hover:border-theme-text-muted/30 rounded-xl border p-4 transition-colors sm:p-5"
              >
                {/* Stacks on a phone so the actions get a full-width row of
                    their own. They carry visible labels, and a phone has no
                    hover to reveal a title attribute — four bare glyphs on the
                    screen members open most is where a mis-tap costs a seat on
                    the truck. */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                    {view === 'upcoming' &&
                      assignment.status === AssignmentStatus.ASSIGNED &&
                      pendingAssigned.length > 1 && (
                        <input
                          type="checkbox"
                          checked={selectedIds.has(assignment.id)}
                          onChange={() => toggleSelection(assignment.id)}
                          className="border-theme-input-border h-4 w-4 shrink-0 rounded text-violet-600 focus:ring-violet-500"
                          aria-label={`Select shift for ${shiftDate ? formatDateCustom(shiftDate, { weekday: 'short', month: 'short', day: 'numeric' }, tz) : 'unknown date'}`}
                        />
                      )}
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 sm:h-12 sm:w-12">
                      <Clock className="h-5 w-5 text-violet-500 sm:h-6 sm:w-6" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-theme-text-primary truncate text-sm font-semibold sm:text-base">
                        {shiftDate
                          ? formatDateCustom(shiftDate, { weekday: 'short', month: 'short', day: 'numeric' }, tz)
                          : 'Unknown Date'}
                      </p>
                      <p className="text-theme-text-secondary text-xs sm:text-sm">
                        {shift?.start_time
                          ? `${formatTime(shift.start_time, tz)}${shift.end_time ? ` - ${formatTime(shift.end_time, tz)}` : ''}`
                          : ''}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2">
                        {shift?.apparatus_name && (
                          <p className="text-theme-text-secondary text-xs font-medium">
                            {shift.apparatus_unit_number
                              ? `${shift.apparatus_unit_number} — ${shift.apparatus_name}`
                              : shift.apparatus_name}
                          </p>
                        )}
                        <p className="text-theme-text-muted text-xs capitalize">Position: {assignment.position}</p>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize sm:hidden ${statusColor}`}
                        >
                          {assignment.status}
                        </span>
                        {(() => {
                          const att = shift ? attendanceMap.get(shift.id) : undefined;
                          if (!att) return null;
                          if (att.checked_out_at && att.duration_minutes) {
                            const hrs = Math.round((att.duration_minutes / 60) * 10) / 10;
                            return (
                              <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:text-green-400">
                                <Clock className="h-3 w-3" /> {hrs}h
                              </span>
                            );
                          }
                          if (att.checked_in_at) {
                            return (
                              <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-400">
                                <LogIn className="h-3 w-3" /> Checked in
                              </span>
                            );
                          }
                          return null;
                        })()}
                      </div>
                    </div>
                  </div>
                  <div className="border-theme-surface-border flex shrink-0 flex-wrap items-center gap-2 border-t pt-3 sm:border-0 sm:pt-0">
                    <span
                      className={`hidden rounded-full border px-2.5 py-1 text-xs font-medium capitalize sm:inline-block ${statusColor}`}
                    >
                      {assignment.status}
                    </span>
                    {view === 'upcoming' &&
                      assignment.status === AssignmentStatus.ASSIGNED &&
                      confirmingDecline !== assignment.id && (
                        <>
                          <button
                            onClick={() => {
                              void handleConfirm(assignment.id);
                            }}
                            disabled={confirmingId === assignment.id}
                            className="mobile-touch-target flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-green-700 transition-colors hover:bg-green-500/10 dark:text-green-400 dark:hover:bg-green-500/20"
                            title="Confirm you are working this shift"
                            aria-label="Confirm shift assignment"
                          >
                            {confirmingId === assignment.id ? (
                              <Loader2 className="h-5 w-5 animate-spin" />
                            ) : (
                              <Check className="h-5 w-5" />
                            )}
                            {/* Same verb as the bulk bar and the status badge —
                                a third phrasing for one action is the drift
                                this module already has too much of. */}
                            <span>Confirm</span>
                          </button>
                          <button
                            onClick={() => setConfirmingDecline(assignment.id)}
                            className="mobile-touch-target flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
                            title="Give this shift up so it can be re-filled"
                            aria-label="Decline shift assignment"
                          >
                            <XCircle className="h-5 w-5" />
                            <span>Decline</span>
                          </button>
                        </>
                      )}
                    {confirmingDecline === assignment.id && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-red-500 dark:text-red-400">Decline?</span>
                        <button
                          onClick={() => {
                            void handleDecline(assignment.id);
                          }}
                          className="btn-primary rounded-md px-2 py-1 text-xs"
                          aria-label="Confirm decline"
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => setConfirmingDecline(null)}
                          className="text-theme-text-muted hover:text-theme-text-primary px-2 py-1 text-xs"
                          aria-label="Cancel decline"
                        >
                          No
                        </button>
                      </div>
                    )}
                    {view === 'upcoming' && (
                      <button
                        onClick={() => {
                          void openSwapRequest(assignment);
                        }}
                        className="text-theme-text-secondary mobile-touch-target flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-violet-500/10 hover:text-violet-600"
                        title="Ask someone to trade shifts with you"
                        aria-label="Request shift swap"
                      >
                        <ArrowLeftRight className="h-5 w-5" />
                        <span>Swap</span>
                      </button>
                    )}
                    {shift && onViewShift && (
                      <button
                        onClick={() => onViewShift(shift)}
                        className="text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-surface-hover mobile-touch-target flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                        title="Open the full shift details"
                        aria-label="View shift details"
                      >
                        <ChevronDown className="h-5 w-5" />
                        <span>Details</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Swap Request Modal */}
      {showSwapModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Request shift swap"
        >
          <div
            ref={swapModalRef}
            className="bg-theme-surface-modal border-theme-surface-border w-full max-w-md rounded-xl border"
          >
            <div className="border-theme-surface-border border-b p-6">
              <h2 className="text-theme-text-primary text-lg font-bold">Request Shift Swap</h2>
              <p className="text-theme-text-secondary mt-1 text-sm">
                {swapAssignment?.shift?.shift_date
                  ? `Submit a swap request for your shift on ${formatDateCustom(swapAssignment.shift.shift_date + 'T12:00:00', { weekday: 'short', month: 'short', day: 'numeric' }, tz)}`
                  : 'Submit a swap request for your shift'}
              </p>
            </div>
            <div className="space-y-4 p-6">
              {/* Swap type selector */}
              <div>
                <label className="text-theme-text-secondary mb-2 block text-sm font-medium">Swap Type</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSwapForm((p) => ({ ...p, target_shift_id: '' }))}
                    className={`rounded-lg border p-3 text-left text-sm transition-colors ${
                      !swapForm.target_shift_id
                        ? 'text-theme-text-primary border-violet-500 bg-violet-500/10'
                        : 'border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover'
                    }`}
                  >
                    <span className="block font-medium">Open Swap</span>
                    <span className="text-theme-text-muted text-xs">Any member can pick it up</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSwapForm((p) => ({ ...p, target_shift_id: availableShifts[0]?.id ?? 'pick' }))}
                    className={`rounded-lg border p-3 text-left text-sm transition-colors ${
                      swapForm.target_shift_id
                        ? 'text-theme-text-primary border-violet-500 bg-violet-500/10'
                        : 'border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover'
                    }`}
                  >
                    <span className="block font-medium">Specific Shift</span>
                    <span className="text-theme-text-muted text-xs">Choose which shift you want</span>
                  </button>
                </div>
              </div>
              {/* Target shift picker — only shown when "Specific Shift" is selected */}
              {swapForm.target_shift_id && (
                <div>
                  <label
                    htmlFor="swap-target-shift"
                    className="text-theme-text-secondary mb-1 block text-sm font-medium"
                  >
                    Select Shift
                  </label>
                  <select
                    id="swap-target-shift"
                    value={swapForm.target_shift_id}
                    onChange={(e) => setSwapForm((p) => ({ ...p, target_shift_id: e.target.value }))}
                    className={inputCls}
                  >
                    {availableShifts.length === 0 && (
                      <option value="pick" disabled>
                        Loading shifts...
                      </option>
                    )}
                    {availableShifts.map((s) => {
                      const d = new Date(s.shift_date + 'T12:00:00');
                      return (
                        <option key={s.id} value={s.id}>
                          {formatDateCustom(d, { weekday: 'short', month: 'short', day: 'numeric' }, tz)}{' '}
                          {formatTime(s.start_time, tz)}
                          {s.end_time ? ` - ${formatTime(s.end_time, tz)}` : ''}
                          {s.apparatus_unit_number ? ` (${s.apparatus_unit_number})` : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}
              <div>
                <label htmlFor="swap-reason" className="text-theme-text-secondary mb-1 block text-sm font-medium">
                  Reason
                </label>
                <textarea
                  id="swap-reason"
                  value={swapForm.reason}
                  onChange={(e) => setSwapForm((p) => ({ ...p, reason: e.target.value }))}
                  rows={3}
                  placeholder="Reason for swap request"
                  className={inputCls + ' resize-none'}
                />
              </div>
            </div>
            <div className="border-theme-surface-border flex justify-end gap-3 border-t p-6">
              <button onClick={() => setShowSwapModal(false)} className="text-theme-text-secondary px-4 py-2">
                Cancel
              </button>
              <button
                onClick={() => {
                  void handleSwapRequest();
                }}
                disabled={submittingSwap}
                className="rounded-lg bg-violet-600 px-4 py-2 text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {submittingSwap ? 'Submitting...' : 'Submit Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Time Off Modal */}
      {showTimeOffModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Request time off"
        >
          <div
            ref={timeOffModalRef}
            className="bg-theme-surface-modal border-theme-surface-border w-full max-w-md rounded-xl border"
          >
            <div className="border-theme-surface-border border-b p-6">
              <h2 className="text-theme-text-primary text-lg font-bold">Request Time Off</h2>
            </div>
            <div className="space-y-4 p-6">
              <div className="form-grid-2">
                <div>
                  <label htmlFor="timeoff-start" className="text-theme-text-secondary mb-1 block text-sm font-medium">
                    Start Date *
                  </label>
                  <input
                    id="timeoff-start"
                    type="date"
                    value={timeOffForm.start_date}
                    onChange={(e) => setTimeOffForm((p) => ({ ...p, start_date: e.target.value }))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label htmlFor="timeoff-end" className="text-theme-text-secondary mb-1 block text-sm font-medium">
                    End Date
                  </label>
                  <input
                    id="timeoff-end"
                    type="date"
                    value={timeOffForm.end_date}
                    onChange={(e) => setTimeOffForm((p) => ({ ...p, end_date: e.target.value }))}
                    className={inputCls}
                  />
                </div>
              </div>
              <div>
                <label htmlFor="timeoff-reason" className="text-theme-text-secondary mb-1 block text-sm font-medium">
                  Reason
                </label>
                <textarea
                  id="timeoff-reason"
                  value={timeOffForm.reason}
                  onChange={(e) => setTimeOffForm((p) => ({ ...p, reason: e.target.value }))}
                  rows={3}
                  placeholder="Reason for time off (helps your manager understand the request)"
                  className={inputCls + ' resize-none'}
                />
              </div>
              {timeOffConflicts.length > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="text-sm text-amber-700 dark:text-amber-300">
                    <p className="font-medium">
                      You have {timeOffConflicts.length} shift{timeOffConflicts.length > 1 ? 's' : ''} during this
                      period:
                    </p>
                    <ul className="mt-1 space-y-0.5 text-xs">
                      {timeOffConflicts.map((a) => (
                        <li key={a.id}>
                          {a.shift?.shift_date
                            ? formatDateCustom(
                                a.shift.shift_date + 'T12:00:00',
                                { weekday: 'short', month: 'short', day: 'numeric' },
                                tz
                              )
                            : 'Unknown date'}
                          {a.shift?.start_time ? ` at ${formatTime(a.shift.start_time, tz)}` : ''}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1 text-xs">Your manager will need to find coverage or reassign these shifts.</p>
                  </div>
                </div>
              )}
            </div>
            <div className="border-theme-surface-border flex justify-end gap-3 border-t p-6">
              <button onClick={() => setShowTimeOffModal(false)} className="text-theme-text-secondary px-4 py-2">
                Cancel
              </button>
              <button
                onClick={() => {
                  void handleTimeOffRequest();
                }}
                disabled={submittingTimeOff || !timeOffForm.start_date}
                className="rounded-lg bg-violet-600 px-4 py-2 text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {submittingTimeOff ? 'Submitting...' : 'Submit Request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MyShiftsTab;
