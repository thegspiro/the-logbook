/**
 * My Shifts Tab
 *
 * Shows the current user's upcoming and past shift assignments.
 * Allows confirming/declining assignments, requesting swaps, and requesting time off.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Clock, Check, XCircle, ArrowLeftRight, CalendarOff,
  Loader2, ChevronDown, AlertTriangle,
  Bell,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { schedulingService } from '../../modules/scheduling/services/api';
import type { ShiftRecord } from '../../modules/scheduling/services/api';
import type { Assignment } from '../../types/scheduling';
import { useTimezone } from '../../hooks/useTimezone';
import { formatTime, getTodayLocalDate, formatDateCustom } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import { ASSIGNMENT_STATUS_COLORS, AssignmentStatus } from '../../constants/enums';

interface MyShiftsTabProps {
  onViewShift?: (shift: ShiftRecord) => void;
}

export const MyShiftsTab: React.FC<MyShiftsTabProps> = ({ onViewShift }) => {
  const tz = useTimezone();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'upcoming' | 'past'>('upcoming');

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
      const assignData = await schedulingService.getMyAssignments();
      setAssignments(assignData);
    } catch {
      toast.error('Failed to load your shifts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

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
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
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
      setAvailableShifts(data.shifts.filter(s => s.id !== assignment.shift_id));
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
        requesting_shift_id: (swapForm.target_shift_id && swapForm.target_shift_id !== 'pick') ? swapForm.target_shift_id : undefined,
        reason: swapForm.reason,
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
    return assignments.filter(a => {
      const shiftDate = a.shift?.shift_date || '';
      return shiftDate >= start && shiftDate <= end &&
        a.status !== AssignmentStatus.DECLINED && a.status !== AssignmentStatus.CANCELLED;
    });
  }, [assignments, timeOffForm.start_date, timeOffForm.end_date]);

  const handleTimeOffRequest = async () => {
    if (!timeOffForm.start_date) { toast.error('Start date is required'); return; }
    setSubmittingTimeOff(true);
    try {
      await schedulingService.createTimeOff({
        start_date: timeOffForm.start_date,
        end_date: timeOffForm.end_date || timeOffForm.start_date,
        reason: timeOffForm.reason,
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
  const upcoming = assignments.filter(a => {
    const shiftDate = a.shift?.shift_date || '';
    return shiftDate >= today && a.status !== AssignmentStatus.DECLINED && a.status !== AssignmentStatus.CANCELLED;
  });
  const past = assignments.filter(a => {
    const shiftDate = a.shift?.shift_date || '';
    return shiftDate < today;
  });

  const displayList = view === 'upcoming' ? upcoming : past;

  // Bulk selection helpers — must be after 'upcoming' is defined
  const pendingAssigned = upcoming.filter(a => a.status === AssignmentStatus.ASSIGNED);
  const allPendingSelected = pendingAssigned.length > 0 && pendingAssigned.every(a => selectedIds.has(a.id));

  const toggleSelectAll = () => {
    if (allPendingSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingAssigned.map(a => a.id)));
    }
  };

  const handleBulkConfirm = async () => {
    setBulkActioning(true);
    let count = 0;
    for (const id of selectedIds) {
      try {
        await schedulingService.confirmAssignment(id);
        count++;
      } catch { /* individual failures handled silently */ }
    }
    if (count > 0) toast.success(`${count} shift${count > 1 ? 's' : ''} confirmed`);
    setSelectedIds(new Set());
    setBulkActioning(false);
    void loadData();
  };

  const handleBulkDecline = async () => {
    setBulkActioning(true);
    let count = 0;
    for (const id of selectedIds) {
      try {
        await schedulingService.updateAssignment(id, { assignment_status: 'declined' });
        count++;
      } catch { /* individual failures handled silently */ }
    }
    if (count > 0) toast.success(`${count} shift${count > 1 ? 's' : ''} declined`);
    setSelectedIds(new Set());
    setBulkActioning(false);
    void loadData();
  };

  const inputCls = 'w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-4 py-2.5 text-theme-text-primary placeholder-theme-text-muted focus:outline-hidden focus:ring-2 focus:ring-violet-500';

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20" role="status" aria-label="Loading shifts">
        <Loader2 className="w-8 h-8 animate-spin text-theme-text-muted" aria-hidden="true" />
        <span className="sr-only">Loading your shifts…</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Actions Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex bg-theme-input-bg rounded-lg p-1">
          <button onClick={() => setView('upcoming')}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-sm font-medium transition-colors ${view === 'upcoming' ? 'bg-violet-600 text-white' : 'text-theme-text-muted hover:text-theme-text-primary'}`}
          >
            Upcoming ({upcoming.length})
          </button>
          <button onClick={() => setView('past')}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-sm font-medium transition-colors ${view === 'past' ? 'bg-violet-600 text-white' : 'text-theme-text-muted hover:text-theme-text-primary'}`}
          >
            Past ({past.length})
          </button>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button onClick={() => { setTimeOffForm({ start_date: '', end_date: '', reason: '' }); setShowTimeOffModal(true); }}
            className="flex items-center justify-center gap-2 px-4 py-2 text-sm border border-theme-surface-border rounded-lg text-theme-text-secondary hover:bg-theme-surface-hover transition-colors flex-1 sm:flex-none"
          >
            <CalendarOff className="w-4 h-4" /> Request Time Off
          </button>
          <Link to="/notifications?filter=schedule_change"
            className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm text-theme-text-muted hover:text-violet-600 dark:hover:text-violet-400 hover:bg-theme-surface-hover rounded-lg transition-colors"
            title="View scheduling notification history"
          >
            <Bell className="w-4 h-4" />
            <span className="hidden sm:inline">Alerts</span>
          </Link>
        </div>
      </div>

      {/* Bulk action bar */}
      {view === 'upcoming' && pendingAssigned.length > 1 && (
        <div className="flex items-center justify-between gap-3 p-3 bg-theme-surface-hover/50 border border-theme-surface-border rounded-lg">
          <label className="flex items-center gap-2 text-sm text-theme-text-secondary cursor-pointer select-none">
            <input type="checkbox" checked={allPendingSelected} onChange={toggleSelectAll}
              className="w-4 h-4 rounded border-theme-input-border text-violet-600 focus:ring-violet-500"
            />
            {selectedIds.size > 0 ? `${selectedIds.size} selected` : `Select all ${pendingAssigned.length} pending`}
          </label>
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2">
              <button onClick={() => { void handleBulkConfirm(); }} disabled={bulkActioning}
                className="px-3 py-1.5 text-xs font-medium bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50 inline-flex items-center gap-1"
              >
                <Check className="w-3.5 h-3.5" /> Confirm All
              </button>
              <button onClick={() => { void handleBulkDecline(); }} disabled={bulkActioning}
                className="px-3 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50 inline-flex items-center gap-1"
              >
                <XCircle className="w-3.5 h-3.5" /> Decline All
              </button>
            </div>
          )}
        </div>
      )}

      {/* Shift List */}
      {displayList.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-theme-surface-border rounded-xl">
          <Clock className="w-12 h-12 text-theme-text-muted mx-auto mb-3" />
          <h3 className="text-lg font-medium text-theme-text-primary mb-1">
            {view === 'upcoming' ? 'No upcoming shifts' : 'No past shifts found'}
          </h3>
          <p className="text-theme-text-muted text-sm max-w-sm mx-auto">
            {view === 'upcoming'
              ? 'You have no scheduled shifts coming up. Check the Open Shifts tab to browse and sign up for available shifts.'
              : 'Your completed shift history will appear here once you have past assignments.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayList.map(assignment => {
            const shift = assignment.shift;
            const statusColor = ASSIGNMENT_STATUS_COLORS[assignment.status] || ASSIGNMENT_STATUS_COLORS.assigned;
            const shiftDate = shift ? new Date(shift.shift_date + 'T12:00:00') : null;

            return (
              <div key={assignment.id}
                className="bg-theme-surface border border-theme-surface-border rounded-xl p-4 sm:p-5 hover:border-theme-text-muted/30 transition-colors"
              >
                <div className="flex items-start sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                    {view === 'upcoming' && assignment.status === AssignmentStatus.ASSIGNED && pendingAssigned.length > 1 && (
                      <input type="checkbox" checked={selectedIds.has(assignment.id)}
                        onChange={() => toggleSelection(assignment.id)}
                        className="w-4 h-4 rounded border-theme-input-border text-violet-600 focus:ring-violet-500 shrink-0"
                        aria-label={`Select shift for ${shiftDate ? formatDateCustom(shiftDate, { weekday: 'short', month: 'short', day: 'numeric' }, tz) : 'unknown date'}`}
                      />
                    )}
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                      <Clock className="w-5 h-5 sm:w-6 sm:h-6 text-violet-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm sm:text-base font-semibold text-theme-text-primary truncate">
                        {shiftDate ? formatDateCustom(shiftDate, { weekday: 'short', month: 'short', day: 'numeric' }, tz) : 'Unknown Date'}
                      </p>
                      <p className="text-xs sm:text-sm text-theme-text-secondary">
                        {shift?.start_time ? `${formatTime(shift.start_time, tz)}${shift.end_time ? ` - ${formatTime(shift.end_time, tz)}` : ''}` : ''}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-xs text-theme-text-muted capitalize">
                          Position: {assignment.position}
                        </p>
                        <span className={`px-2 py-0.5 text-[10px] sm:hidden font-medium rounded-full border capitalize ${statusColor}`}>
                          {assignment.status}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                    <span className={`hidden sm:inline-block px-2.5 py-1 text-xs font-medium rounded-full border capitalize ${statusColor}`}>
                      {assignment.status}
                    </span>
                    {view === 'upcoming' && assignment.status === AssignmentStatus.ASSIGNED && confirmingDecline !== assignment.id && (
                      <>
                        <button onClick={() => { void handleConfirm(assignment.id); }}
                          disabled={confirmingId === assignment.id}
                          className="p-2 text-green-600 hover:bg-green-500/10 rounded-lg transition-colors min-w-[40px] min-h-[40px] flex items-center justify-center" title="Confirm shift" aria-label="Confirm shift assignment"
                        >
                          {confirmingId === assignment.id ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
                        </button>
                        <button onClick={() => setConfirmingDecline(assignment.id)}
                          className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg transition-colors min-w-[40px] min-h-[40px] flex items-center justify-center" title="Decline shift" aria-label="Decline shift assignment"
                        >
                          <XCircle className="w-5 h-5" />
                        </button>
                      </>
                    )}
                    {confirmingDecline === assignment.id && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-red-500">Decline?</span>
                        <button onClick={() => { void handleDecline(assignment.id); }}
                          className="btn-primary px-2 py-1 rounded-md text-xs" aria-label="Confirm decline"
                        >Yes</button>
                        <button onClick={() => setConfirmingDecline(null)}
                          className="px-2 py-1 text-xs text-theme-text-muted hover:text-theme-text-primary" aria-label="Cancel decline"
                        >No</button>
                      </div>
                    )}
                    {view === 'upcoming' && (
                      <button onClick={() => { void openSwapRequest(assignment); }}
                        className="p-2 text-theme-text-muted hover:text-violet-500 hover:bg-violet-500/10 rounded-lg transition-colors min-w-[40px] min-h-[40px] flex items-center justify-center" title="Request swap" aria-label="Request shift swap"
                      >
                        <ArrowLeftRight className="w-5 h-5" />
                      </button>
                    )}
                    {shift && onViewShift && (
                      <button onClick={() => onViewShift(shift)}
                        className="p-2 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg transition-colors min-w-[40px] min-h-[40px] flex items-center justify-center" title="View details" aria-label="View shift details"
                      >
                        <ChevronDown className="w-5 h-5" />
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
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label="Request shift swap">
          <div ref={swapModalRef} className="bg-theme-surface-modal border border-theme-surface-border rounded-xl max-w-md w-full">
            <div className="p-6 border-b border-theme-surface-border">
              <h2 className="text-lg font-bold text-theme-text-primary">Request Shift Swap</h2>
              <p className="text-sm text-theme-text-secondary mt-1">
                {swapAssignment?.shift?.shift_date
                  ? `Submit a swap request for your shift on ${formatDateCustom(swapAssignment.shift.shift_date + 'T12:00:00', { weekday: 'short', month: 'short', day: 'numeric' }, tz)}`
                  : 'Submit a swap request for your shift'}
              </p>
            </div>
            <div className="p-6 space-y-4">
              {/* Swap type selector */}
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">Swap Type</label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button"
                    onClick={() => setSwapForm(p => ({...p, target_shift_id: ''}))}
                    className={`p-3 rounded-lg border text-left text-sm transition-colors ${
                      !swapForm.target_shift_id
                        ? 'border-violet-500 bg-violet-500/10 text-theme-text-primary'
                        : 'border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover'
                    }`}
                  >
                    <span className="font-medium block">Open Swap</span>
                    <span className="text-xs text-theme-text-muted">Any member can pick it up</span>
                  </button>
                  <button type="button"
                    onClick={() => setSwapForm(p => ({...p, target_shift_id: availableShifts[0]?.id ?? 'pick'}))}
                    className={`p-3 rounded-lg border text-left text-sm transition-colors ${
                      swapForm.target_shift_id
                        ? 'border-violet-500 bg-violet-500/10 text-theme-text-primary'
                        : 'border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover'
                    }`}
                  >
                    <span className="font-medium block">Specific Shift</span>
                    <span className="text-xs text-theme-text-muted">Choose which shift you want</span>
                  </button>
                </div>
              </div>
              {/* Target shift picker — only shown when "Specific Shift" is selected */}
              {swapForm.target_shift_id && (
                <div>
                  <label htmlFor="swap-target-shift" className="block text-sm font-medium text-theme-text-secondary mb-1">Select Shift</label>
                  <select id="swap-target-shift" value={swapForm.target_shift_id}
                    onChange={e => setSwapForm(p => ({...p, target_shift_id: e.target.value}))}
                    className={inputCls}
                  >
                    {availableShifts.length === 0 && (
                      <option value="pick" disabled>Loading shifts...</option>
                    )}
                    {availableShifts.map(s => {
                      const d = new Date(s.shift_date + 'T12:00:00');
                      return (
                        <option key={s.id} value={s.id}>
                          {formatDateCustom(d, { weekday: 'short', month: 'short', day: 'numeric' }, tz)}
                          {' '}{formatTime(s.start_time, tz)}
                          {s.end_time ? ` - ${formatTime(s.end_time, tz)}` : ''}
                          {s.apparatus_unit_number ? ` (${s.apparatus_unit_number})` : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}
              <div>
                <label htmlFor="swap-reason" className="block text-sm font-medium text-theme-text-secondary mb-1">Reason</label>
                <textarea id="swap-reason" value={swapForm.reason}
                  onChange={e => setSwapForm(p => ({...p, reason: e.target.value}))}
                  rows={3} placeholder="Reason for swap request" className={inputCls + ' resize-none'}
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 p-6 border-t border-theme-surface-border">
              <button onClick={() => setShowSwapModal(false)} className="px-4 py-2 text-theme-text-secondary">Cancel</button>
              <button onClick={() => { void handleSwapRequest(); }} disabled={submittingSwap}
                className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg disabled:opacity-50"
              >
                {submittingSwap ? 'Submitting...' : 'Submit Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Time Off Modal */}
      {showTimeOffModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label="Request time off">
          <div ref={timeOffModalRef} className="bg-theme-surface-modal border border-theme-surface-border rounded-xl max-w-md w-full">
            <div className="p-6 border-b border-theme-surface-border">
              <h2 className="text-lg font-bold text-theme-text-primary">Request Time Off</h2>
            </div>
            <div className="p-6 space-y-4">
              <div className="form-grid-2">
                <div>
                  <label htmlFor="timeoff-start" className="block text-sm font-medium text-theme-text-secondary mb-1">Start Date *</label>
                  <input id="timeoff-start" type="date" value={timeOffForm.start_date}
                    onChange={e => setTimeOffForm(p => ({...p, start_date: e.target.value}))} className={inputCls}
                  />
                </div>
                <div>
                  <label htmlFor="timeoff-end" className="block text-sm font-medium text-theme-text-secondary mb-1">End Date</label>
                  <input id="timeoff-end" type="date" value={timeOffForm.end_date}
                    onChange={e => setTimeOffForm(p => ({...p, end_date: e.target.value}))} className={inputCls}
                  />
                </div>
              </div>
              <div>
                <label htmlFor="timeoff-reason" className="block text-sm font-medium text-theme-text-secondary mb-1">Reason</label>
                <textarea id="timeoff-reason" value={timeOffForm.reason}
                  onChange={e => setTimeOffForm(p => ({...p, reason: e.target.value}))}
                  rows={3} placeholder="Reason for time off (helps your manager understand the request)" className={inputCls + ' resize-none'}
                />
              </div>
              {timeOffConflicts.length > 0 && (
                <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div className="text-sm text-amber-700 dark:text-amber-300">
                    <p className="font-medium">You have {timeOffConflicts.length} shift{timeOffConflicts.length > 1 ? 's' : ''} during this period:</p>
                    <ul className="mt-1 space-y-0.5 text-xs">
                      {timeOffConflicts.map(a => (
                        <li key={a.id}>
                          {a.shift?.shift_date ? formatDateCustom(a.shift.shift_date + 'T12:00:00', { weekday: 'short', month: 'short', day: 'numeric' }, tz) : 'Unknown date'}
                          {a.shift?.start_time ? ` at ${formatTime(a.shift.start_time, tz)}` : ''}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1 text-xs">Your manager will need to find coverage or reassign these shifts.</p>
                  </div>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 p-6 border-t border-theme-surface-border">
              <button onClick={() => setShowTimeOffModal(false)} className="px-4 py-2 text-theme-text-secondary">Cancel</button>
              <button onClick={() => { void handleTimeOffRequest(); }} disabled={submittingTimeOff || !timeOffForm.start_date}
                className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg disabled:opacity-50"
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
