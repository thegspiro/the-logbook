/**
 * My Shifts Tab
 *
 * Shows the current user's upcoming and past shift assignments.
 * Allows confirming/declining assignments, requesting swaps, and requesting time off.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Clock, Check, XCircle, ArrowLeftRight, CalendarOff,
  Loader2, ChevronDown, Users,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { schedulingService } from '../../services/api';
import type { ShiftRecord } from '../../services/api';
import { useTimezone } from '../../hooks/useTimezone';
import { formatTime } from '../../utils/dateFormatting';

interface Assignment {
  id: string;
  user_id: string;
  shift_id: string;
  position: string;
  status: string;
  assignment_status?: string;
  shift?: ShiftRecord;
}

const STATUS_COLORS: Record<string, string> = {
  assigned: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
  confirmed: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
  declined: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
  pending: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20',
  cancelled: 'bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/20',
  no_show: 'bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/20',
};

interface MyShiftsTabProps {
  onViewShift?: (shift: ShiftRecord) => void;
}

export const MyShiftsTab: React.FC<MyShiftsTabProps> = ({ onViewShift }) => {
  const tz = useTimezone();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [upcomingShifts, setUpcomingShifts] = useState<ShiftRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'upcoming' | 'past'>('upcoming');

  // Swap request modal
  const [showSwapModal, setShowSwapModal] = useState(false);
  const [swapAssignment, setSwapAssignment] = useState<Assignment | null>(null);
  const [swapForm, setSwapForm] = useState({ target_shift_id: '', reason: '' });
  const [submittingSwap, setSubmittingSwap] = useState(false);

  // Time off modal
  const [showTimeOffModal, setShowTimeOffModal] = useState(false);
  const [timeOffForm, setTimeOffForm] = useState({ start_date: '', end_date: '', reason: '' });
  const [submittingTimeOff, setSubmittingTimeOff] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [assignData, shiftsData] = await Promise.all([
        schedulingService.getMyAssignments(),
        schedulingService.getMyShifts({ limit: 20 }),
      ]);
      setAssignments(assignData as unknown as Assignment[]);
      setUpcomingShifts(shiftsData.shifts);
    } catch {
      toast.error('Failed to load your shifts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleConfirm = async (assignmentId: string) => {
    try {
      await schedulingService.confirmAssignment(assignmentId);
      toast.success('Shift confirmed');
      loadData();
    } catch {
      toast.error('Failed to confirm shift');
    }
  };

  const openSwapRequest = (assignment: Assignment) => {
    setSwapAssignment(assignment);
    setSwapForm({ target_shift_id: '', reason: '' });
    setShowSwapModal(true);
  };

  const handleSwapRequest = async () => {
    if (!swapAssignment) return;
    setSubmittingSwap(true);
    try {
      await schedulingService.createSwapRequest({
        offering_shift_id: swapAssignment.shift_id,
        requesting_shift_id: swapForm.target_shift_id || undefined,
        reason: swapForm.reason,
      });
      toast.success('Swap request submitted');
      setShowSwapModal(false);
      loadData();
    } catch {
      toast.error('Failed to submit swap request');
    } finally {
      setSubmittingSwap(false);
    }
  };

  const handleTimeOffRequest = async () => {
    if (!timeOffForm.start_date) { toast.error('Start date is required'); return; }
    setSubmittingTimeOff(true);
    try {
      await schedulingService.createTimeOff({
        start_date: timeOffForm.start_date,
        end_date: timeOffForm.end_date || timeOffForm.start_date,
        reason: timeOffForm.reason,
      });
      toast.success('Time off request submitted');
      setShowTimeOffModal(false);
      setTimeOffForm({ start_date: '', end_date: '', reason: '' });
    } catch {
      toast.error('Failed to submit time off request');
    } finally {
      setSubmittingTimeOff(false);
    }
  };

  const today = new Date().toISOString().split('T')[0];
  const upcoming = assignments.filter(a => {
    const shiftDate = a.shift?.shift_date || '';
    return shiftDate >= today && a.status !== 'declined' && a.status !== 'cancelled';
  });
  const past = assignments.filter(a => {
    const shiftDate = a.shift?.shift_date || '';
    return shiftDate < today;
  });

  const displayList = view === 'upcoming' ? upcoming : past;

  const inputCls = 'w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-4 py-2.5 text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-violet-500';

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-theme-text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Actions Bar */}
      <div className="flex items-center justify-between">
        <div className="flex bg-theme-input-bg rounded-lg p-1">
          <button onClick={() => setView('upcoming')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${view === 'upcoming' ? 'bg-violet-600 text-white' : 'text-theme-text-muted hover:text-theme-text-primary'}`}
          >
            Upcoming ({upcoming.length})
          </button>
          <button onClick={() => setView('past')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${view === 'past' ? 'bg-violet-600 text-white' : 'text-theme-text-muted hover:text-theme-text-primary'}`}
          >
            Past ({past.length})
          </button>
        </div>
        <button onClick={() => { setTimeOffForm({ start_date: '', end_date: '', reason: '' }); setShowTimeOffModal(true); }}
          className="flex items-center gap-2 px-4 py-2 text-sm border border-theme-surface-border rounded-lg text-theme-text-secondary hover:bg-theme-surface-hover transition-colors"
        >
          <CalendarOff className="w-4 h-4" /> Request Time Off
        </button>
      </div>

      {/* Shift List */}
      {displayList.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-theme-surface-border rounded-xl">
          <Clock className="w-12 h-12 text-theme-text-muted mx-auto mb-3" />
          <h3 className="text-lg font-medium text-theme-text-primary mb-1">
            {view === 'upcoming' ? 'No upcoming shifts' : 'No past shifts'}
          </h3>
          <p className="text-theme-text-muted text-sm">
            {view === 'upcoming' ? 'Check the Open Shifts tab to sign up for available shifts.' : 'Your past shift history will appear here.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayList.map(assignment => {
            const shift = assignment.shift;
            const statusColor = STATUS_COLORS[assignment.status] || STATUS_COLORS.assigned;
            const shiftDate = shift ? new Date(shift.shift_date + 'T12:00:00') : null;

            return (
              <div key={assignment.id}
                className="bg-theme-surface border border-theme-surface-border rounded-xl p-5 hover:border-theme-text-muted/30 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-lg bg-violet-500/10 flex items-center justify-center">
                      <Clock className="w-6 h-6 text-violet-500" />
                    </div>
                    <div>
                      <p className="text-base font-semibold text-theme-text-primary">
                        {shiftDate ? shiftDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : 'Unknown Date'}
                      </p>
                      <p className="text-sm text-theme-text-secondary">
                        {shift ? `${formatTime(shift.start_time, tz)}${shift.end_time ? ` - ${formatTime(shift.end_time, tz)}` : ''}` : ''}
                      </p>
                      <p className="text-xs text-theme-text-muted capitalize mt-0.5">
                        Position: {assignment.position}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2.5 py-1 text-xs font-medium rounded-full border capitalize ${statusColor}`}>
                      {assignment.status}
                    </span>
                    {view === 'upcoming' && assignment.status === 'assigned' && (
                      <button onClick={() => handleConfirm(assignment.id)}
                        className="p-2 text-green-600 hover:bg-green-500/10 rounded-lg transition-colors" title="Confirm shift"
                      >
                        <Check className="w-5 h-5" />
                      </button>
                    )}
                    {view === 'upcoming' && (
                      <button onClick={() => openSwapRequest(assignment)}
                        className="p-2 text-theme-text-muted hover:text-violet-500 hover:bg-violet-500/10 rounded-lg transition-colors" title="Request swap"
                      >
                        <ArrowLeftRight className="w-5 h-5" />
                      </button>
                    )}
                    {shift && onViewShift && (
                      <button onClick={() => onViewShift(shift)}
                        className="p-2 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg transition-colors" title="View details"
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
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true">
          <div className="bg-theme-surface-modal border border-theme-surface-border rounded-xl max-w-md w-full">
            <div className="p-6 border-b border-theme-surface-border">
              <h2 className="text-lg font-bold text-theme-text-primary">Request Shift Swap</h2>
              <p className="text-sm text-theme-text-secondary mt-1">
                Submit a swap request for your shift on {swapAssignment?.shift?.shift_date}
              </p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Target Shift ID (optional)</label>
                <input type="text" value={swapForm.target_shift_id}
                  onChange={e => setSwapForm(p => ({...p, target_shift_id: e.target.value}))}
                  placeholder="Leave blank for open swap request" className={inputCls}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Reason</label>
                <textarea value={swapForm.reason}
                  onChange={e => setSwapForm(p => ({...p, reason: e.target.value}))}
                  rows={3} placeholder="Why do you need to swap this shift?" className={inputCls + ' resize-none'}
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 p-6 border-t border-theme-surface-border">
              <button onClick={() => setShowSwapModal(false)} className="px-4 py-2 text-theme-text-secondary">Cancel</button>
              <button onClick={handleSwapRequest} disabled={submittingSwap}
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
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true">
          <div className="bg-theme-surface-modal border border-theme-surface-border rounded-xl max-w-md w-full">
            <div className="p-6 border-b border-theme-surface-border">
              <h2 className="text-lg font-bold text-theme-text-primary">Request Time Off</h2>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">Start Date *</label>
                  <input type="date" value={timeOffForm.start_date}
                    onChange={e => setTimeOffForm(p => ({...p, start_date: e.target.value}))} className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">End Date</label>
                  <input type="date" value={timeOffForm.end_date}
                    onChange={e => setTimeOffForm(p => ({...p, end_date: e.target.value}))} className={inputCls}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Reason</label>
                <textarea value={timeOffForm.reason}
                  onChange={e => setTimeOffForm(p => ({...p, reason: e.target.value}))}
                  rows={3} placeholder="Reason for time off..." className={inputCls + ' resize-none'}
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 p-6 border-t border-theme-surface-border">
              <button onClick={() => setShowTimeOffModal(false)} className="px-4 py-2 text-theme-text-secondary">Cancel</button>
              <button onClick={handleTimeOffRequest} disabled={submittingTimeOff || !timeOffForm.start_date}
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
