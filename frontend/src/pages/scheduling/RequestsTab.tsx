/**
 * Requests Tab
 *
 * Combined view for swap requests and time-off requests.
 * Members see their own requests; admins see all with approve/deny actions.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeftRight, CalendarOff, Check, X, Clock,
  Loader2, AlertCircle, Filter,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { schedulingService } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';

interface SwapRequest {
  id: string;
  user_id?: string;
  user_name?: string;
  offering_shift_id: string;
  requesting_shift_id?: string;
  target_user_id?: string;
  target_user_name?: string;
  reason?: string;
  status: string;
  reviewer_notes?: string;
  created_at: string;
}

interface TimeOffRequest {
  id: string;
  user_id?: string;
  user_name?: string;
  start_date: string;
  end_date: string;
  reason?: string;
  status: string;
  reviewer_notes?: string;
  created_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20',
  approved: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
  denied: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
  cancelled: 'bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/20',
};

export const RequestsTab: React.FC = () => {
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('scheduling.manage');

  const [activeView, setActiveView] = useState<'swaps' | 'timeoff'>('swaps');
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [swapRequests, setSwapRequests] = useState<SwapRequest[]>([]);
  const [timeOffRequests, setTimeOffRequests] = useState<TimeOffRequest[]>([]);
  const [loading, setLoading] = useState(true);

  // Review modal
  const [reviewing, setReviewing] = useState<{ type: 'swap' | 'timeoff'; id: string } | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> | undefined = statusFilter ? { status: statusFilter } : undefined;
      const [swaps, timeOff] = await Promise.all([
        schedulingService.getSwapRequests(params),
        schedulingService.getTimeOffRequests(params),
      ]);
      setSwapRequests(swaps as unknown as SwapRequest[]);
      setTimeOffRequests(timeOff as unknown as TimeOffRequest[]);
    } catch {
      toast.error('Failed to load requests');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleReview = async (action: 'approved' | 'denied') => {
    if (!reviewing) return;
    setSubmittingReview(true);
    try {
      if (reviewing.type === 'swap') {
        await schedulingService.reviewSwapRequest(reviewing.id, {
          status: action,
          reviewer_notes: reviewNotes,
        });
      } else {
        await schedulingService.reviewTimeOff(reviewing.id, {
          status: action,
          reviewer_notes: reviewNotes,
        });
      }
      toast.success(`Request ${action}`);
      setReviewing(null);
      setReviewNotes('');
      loadData();
    } catch {
      toast.error('Failed to process request');
    } finally {
      setSubmittingReview(false);
    }
  };

  const handleCancel = async (type: 'swap' | 'timeoff', id: string) => {
    if (!window.confirm('Cancel this request?')) return;
    try {
      if (type === 'swap') {
        await schedulingService.cancelSwapRequest(id);
      } else {
        await schedulingService.cancelTimeOff(id);
      }
      toast.success('Request cancelled');
      loadData();
    } catch {
      toast.error('Failed to cancel request');
    }
  };

  return (
    <div className="space-y-6">
      {/* Tab + Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex bg-theme-input-bg rounded-lg p-1">
          <button onClick={() => setActiveView('swaps')}
            className={`flex-1 sm:flex-none px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-1.5 sm:gap-2 ${activeView === 'swaps' ? 'bg-violet-600 text-white' : 'text-theme-text-muted hover:text-theme-text-primary'}`}
          >
            <ArrowLeftRight className="w-4 h-4" /> <span className="hidden sm:inline">Swap Requests</span><span className="sm:hidden">Swaps</span> ({swapRequests.length})
          </button>
          <button onClick={() => setActiveView('timeoff')}
            className={`flex-1 sm:flex-none px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-1.5 sm:gap-2 ${activeView === 'timeoff' ? 'bg-violet-600 text-white' : 'text-theme-text-muted hover:text-theme-text-primary'}`}
          >
            <CalendarOff className="w-4 h-4" /> Time Off ({timeOffRequests.length})
          </button>
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-theme-text-muted flex-shrink-0" />
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="flex-1 sm:flex-none bg-theme-input-bg border border-theme-input-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-violet-500"
          >
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="denied">Denied</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-theme-text-muted" />
        </div>
      ) : activeView === 'swaps' ? (
        /* Swap Requests */
        swapRequests.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-theme-surface-border rounded-xl">
            <ArrowLeftRight className="w-12 h-12 text-theme-text-muted mx-auto mb-3" />
            <h3 className="text-lg font-medium text-theme-text-primary mb-1">No swap requests</h3>
            <p className="text-theme-text-muted text-sm">
              Swap requests from your shifts will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {swapRequests.map(req => {
              const statusColor = STATUS_COLORS[req.status] || STATUS_COLORS.pending;
              return (
                <div key={req.id} className="bg-theme-surface border border-theme-surface-border rounded-xl p-4 sm:p-5">
                  <div className="flex items-start sm:items-center justify-between gap-3">
                    <div className="flex items-start sm:items-center gap-3 min-w-0">
                      <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-orange-500/10 flex items-center justify-center flex-shrink-0">
                        <ArrowLeftRight className="w-4 h-4 sm:w-5 sm:h-5 text-orange-500" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-theme-text-primary">
                            {req.user_name || 'Member'} requests swap
                          </p>
                          <span className={`px-2 py-0.5 text-[10px] sm:text-xs font-medium rounded-full border capitalize ${statusColor}`}>
                            {req.status}
                          </span>
                        </div>
                        <p className="text-xs text-theme-text-muted mt-0.5">
                          Shift: {req.offering_shift_id?.slice(0, 8)}...
                          {req.requesting_shift_id && ` for ${req.requesting_shift_id.slice(0, 8)}...`}
                        </p>
                        {req.reason && <p className="text-xs text-theme-text-secondary mt-1 line-clamp-2">{req.reason}</p>}
                        <p className="text-xs text-theme-text-muted mt-1">
                          {new Date(req.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {canManage && req.status === 'pending' && (
                        <button onClick={() => { setReviewing({ type: 'swap', id: req.id }); setReviewNotes(''); }}
                          className="p-2 text-theme-text-muted hover:text-green-600 hover:bg-green-500/10 rounded-lg min-w-[40px] min-h-[40px] flex items-center justify-center" title="Review"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                      )}
                      {req.status === 'pending' && (
                        <button onClick={() => handleCancel('swap', req.id)}
                          className="p-2 text-theme-text-muted hover:text-red-500 hover:bg-red-500/10 rounded-lg min-w-[40px] min-h-[40px] flex items-center justify-center" title="Cancel"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        /* Time Off Requests */
        timeOffRequests.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-theme-surface-border rounded-xl">
            <CalendarOff className="w-12 h-12 text-theme-text-muted mx-auto mb-3" />
            <h3 className="text-lg font-medium text-theme-text-primary mb-1">No time-off requests</h3>
            <p className="text-theme-text-muted text-sm">
              Your time-off requests will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {timeOffRequests.map(req => {
              const statusColor = STATUS_COLORS[req.status] || STATUS_COLORS.pending;
              return (
                <div key={req.id} className="bg-theme-surface border border-theme-surface-border rounded-xl p-4 sm:p-5">
                  <div className="flex items-start sm:items-center justify-between gap-3">
                    <div className="flex items-start sm:items-center gap-3 min-w-0">
                      <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                        <CalendarOff className="w-4 h-4 sm:w-5 sm:h-5 text-blue-500" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-theme-text-primary">
                            {req.user_name || 'Member'} — Time Off
                          </p>
                          <span className={`px-2 py-0.5 text-[10px] sm:text-xs font-medium rounded-full border capitalize ${statusColor}`}>
                            {req.status}
                          </span>
                        </div>
                        <p className="text-xs text-theme-text-muted mt-0.5">
                          {new Date(req.start_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          {req.end_date !== req.start_date && ` - ${new Date(req.end_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                        </p>
                        {req.reason && <p className="text-xs text-theme-text-secondary mt-1 line-clamp-2">{req.reason}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {canManage && req.status === 'pending' && (
                        <button onClick={() => { setReviewing({ type: 'timeoff', id: req.id }); setReviewNotes(''); }}
                          className="p-2 text-theme-text-muted hover:text-green-600 hover:bg-green-500/10 rounded-lg min-w-[40px] min-h-[40px] flex items-center justify-center" title="Review"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                      )}
                      {req.status === 'pending' && (
                        <button onClick={() => handleCancel('timeoff', req.id)}
                          className="p-2 text-theme-text-muted hover:text-red-500 hover:bg-red-500/10 rounded-lg min-w-[40px] min-h-[40px] flex items-center justify-center" title="Cancel"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* Review Modal */}
      {reviewing && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true">
          <div className="bg-theme-surface-modal border border-theme-surface-border rounded-xl max-w-md w-full">
            <div className="p-6 border-b border-theme-surface-border">
              <h2 className="text-lg font-bold text-theme-text-primary">Review Request</h2>
            </div>
            <div className="p-6">
              <label className="block text-sm font-medium text-theme-text-secondary mb-1">Reviewer Notes (optional)</label>
              <textarea value={reviewNotes} onChange={e => setReviewNotes(e.target.value)}
                rows={3} placeholder="Add any notes..."
                className="w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-4 py-2.5 text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
              />
            </div>
            <div className="flex justify-end gap-3 p-6 border-t border-theme-surface-border">
              <button onClick={() => setReviewing(null)} className="px-4 py-2 text-theme-text-secondary">Cancel</button>
              <button onClick={() => handleReview('denied')} disabled={submittingReview}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50"
              >
                Deny
              </button>
              <button onClick={() => handleReview('approved')} disabled={submittingReview}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50"
              >
                Approve
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RequestsTab;
