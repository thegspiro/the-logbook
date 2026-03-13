import React, { useEffect, useState, useCallback } from 'react';
import { ArrowDownToLine, CheckCircle, XCircle, Clock } from 'lucide-react';
import { inventoryService } from '../services/inventoryService';
import type { ReturnRequestItem } from '../services/eventServices';
import { getErrorMessage } from '../utils/errorHandling';
import { formatDate } from '../utils/dateFormatting';
import { useTimezone } from '../hooks/useTimezone';
import toast from 'react-hot-toast';
import { RequestStatus } from '../constants/enums';

const STATUS_BADGES: Record<string, string> = {
  pending: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
  approved: 'bg-green-500/10 text-green-700 dark:text-green-400',
  denied: 'bg-red-500/10 text-red-700 dark:text-red-400',
  completed: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
};

const CONDITION_OPTIONS = ['excellent', 'good', 'fair', 'poor', 'damaged', 'out_of_service'] as const;

const ReturnRequestsPanel: React.FC = () => {
  const tz = useTimezone();
  const [requests, setRequests] = useState<ReturnRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('pending');
  const [reviewModal, setReviewModal] = useState<{ open: boolean; request: ReturnRequestItem | null }>({ open: false, request: null });
  const [reviewAction, setReviewAction] = useState<'approved' | 'denied'>('approved');
  const [reviewNotes, setReviewNotes] = useState('');
  const [overrideCondition, setOverrideCondition] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadRequests = useCallback(async () => {
    setLoading(true);
    try {
      const data = await inventoryService.getReturnRequests({ status: filter || undefined });
      setRequests(data);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load return requests'));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void loadRequests(); }, [loadRequests]);

  const handleReview = async () => {
    if (!reviewModal.request) return;
    setSubmitting(true);
    try {
      await inventoryService.reviewReturnRequest(reviewModal.request.id, {
        status: reviewAction,
        review_notes: reviewNotes || undefined,
        override_condition: overrideCondition || undefined,
      });
      toast.success(`Return request ${reviewAction}`);
      setReviewModal({ open: false, request: null });
      setReviewNotes('');
      setOverrideCondition('');
      await loadRequests();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to review request'));
    } finally {
      setSubmitting(false);
    }
  };

  const pendingCount = requests.filter(r => r.status === RequestStatus.PENDING).length;

  return (
    <div className="space-y-4">
      {/* Header with count */}
      {pendingCount > 0 && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 flex items-center gap-2">
          <Clock className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
          <span className="text-sm text-yellow-700 dark:text-yellow-400 font-medium">
            {pendingCount} return request{pendingCount !== 1 ? 's' : ''} awaiting review
          </span>
        </div>
      )}

      {/* Filter */}
      <div className="flex items-center gap-2">
        <label htmlFor="rr-filter" className="text-sm text-theme-text-secondary">Status:</label>
        <select id="rr-filter" value={filter} onChange={(e) => setFilter(e.target.value)} className="form-input text-sm max-w-[200px]">
          <option value="pending">Pending</option>
          <option value="">All</option>
          <option value="completed">Completed</option>
          <option value="denied">Denied</option>
        </select>
      </div>

      {/* List */}
      {loading ? (
        <div className="bg-theme-surface rounded-lg p-8 border border-theme-surface-border text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500 mx-auto" />
        </div>
      ) : requests.length === 0 ? (
        <div className="bg-theme-surface rounded-lg p-8 border border-theme-surface-border text-center">
          <ArrowDownToLine className="w-12 h-12 text-theme-text-muted mx-auto mb-3" />
          <p className="text-theme-text-secondary">No return requests found.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => (
            <div key={req.id} className="bg-theme-surface rounded-lg border border-theme-surface-border p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="text-sm font-medium text-theme-text-primary truncate">{req.item_name}</h4>
                    {req.quantity_returning > 1 && (
                      <span className="text-xs text-theme-text-muted">x{req.quantity_returning}</span>
                    )}
                  </div>
                  <p className="text-xs text-theme-text-secondary">
                    {req.requester_name || 'Unknown member'} — <span className="capitalize">{req.return_type}</span>
                  </p>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-theme-text-muted">
                    <span>Reported condition: <span className="capitalize">{req.reported_condition.replace('_', ' ')}</span></span>
                    <span>{formatDate(req.created_at, tz)}</span>
                  </div>
                  {req.member_notes && (
                    <p className="text-xs text-theme-text-muted mt-1 italic">&ldquo;{req.member_notes}&rdquo;</p>
                  )}
                  {req.review_notes && (
                    <p className="text-xs text-theme-text-muted mt-1">Review: {req.review_notes}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGES[req.status] ?? ''}`}>
                    {req.status}
                  </span>
                  {req.status === RequestStatus.PENDING && (
                    <div className="flex gap-1">
                      <button
                        onClick={() => { setReviewModal({ open: true, request: req }); setReviewAction('approved'); setOverrideCondition(''); setReviewNotes(''); }}
                        className="p-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white transition-colors"
                        title="Approve return"
                      >
                        <CheckCircle className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => { setReviewModal({ open: true, request: req }); setReviewAction('denied'); setOverrideCondition(''); setReviewNotes(''); }}
                        className="p-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors"
                        title="Deny return"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Review Modal */}
      {reviewModal.open && reviewModal.request && (
        <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true" onKeyDown={(e) => { if (e.key === 'Escape') setReviewModal({ open: false, request: null }); }}>
          <div className="flex items-center justify-center min-h-screen px-4">
            <div className="fixed inset-0 bg-black/60" onClick={() => setReviewModal({ open: false, request: null })} aria-hidden="true" />
            <div className="relative bg-theme-surface-modal rounded-lg shadow-xl max-w-md w-full border border-theme-surface-border">
              <div className="px-4 sm:px-6 pt-5 pb-4">
                <h3 className="text-lg font-medium text-theme-text-primary mb-4">
                  {reviewAction === RequestStatus.APPROVED ? 'Approve Return' : 'Deny Return'}
                </h3>
                <div className="space-y-4">
                  <div className="bg-theme-surface-secondary rounded-lg p-3">
                    <p className="text-sm text-theme-text-primary font-medium">{reviewModal.request.item_name}</p>
                    <p className="text-xs text-theme-text-muted">
                      {reviewModal.request.requester_name} — Qty: {reviewModal.request.quantity_returning}
                    </p>
                    <p className="text-xs text-theme-text-muted capitalize mt-1">
                      Member reported: {reviewModal.request.reported_condition.replace('_', ' ')}
                    </p>
                    {reviewModal.request.member_notes && (
                      <p className="text-xs text-theme-text-muted mt-1 italic">&ldquo;{reviewModal.request.member_notes}&rdquo;</p>
                    )}
                  </div>

                  {reviewAction === RequestStatus.APPROVED && (
                    <div>
                      <label htmlFor="override-condition" className="block text-sm font-medium text-theme-text-secondary mb-1">
                        Actual Condition (override if different)
                      </label>
                      <select
                        id="override-condition"
                        value={overrideCondition}
                        onChange={(e) => setOverrideCondition(e.target.value)}
                        className="form-input"
                      >
                        <option value="">Use member&apos;s report ({reviewModal.request.reported_condition.replace('_', ' ')})</option>
                        {CONDITION_OPTIONS.map(c => (
                          <option key={c} value={c}>{c.replace('_', ' ')}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div>
                    <label htmlFor="review-notes" className="block text-sm font-medium text-theme-text-secondary mb-1">
                      Notes (optional)
                    </label>
                    <textarea
                      id="review-notes"
                      rows={2}
                      value={reviewNotes}
                      onChange={(e) => setReviewNotes(e.target.value)}
                      className="form-input"
                      placeholder={reviewAction === RequestStatus.DENIED ? 'Reason for denial...' : 'Any notes...'}
                    />
                  </div>
                </div>
              </div>
              <div className="bg-theme-input-bg px-4 sm:px-6 py-3 flex justify-end gap-3 rounded-b-lg">
                <button onClick={() => setReviewModal({ open: false, request: null })} className="px-4 py-2 border border-theme-input-border rounded-lg text-theme-text-secondary hover:bg-theme-surface-hover transition-colors">Cancel</button>
                <button
                  onClick={() => { void handleReview(); }}
                  disabled={submitting}
                  className={`px-4 py-2 rounded-lg text-white transition-colors disabled:opacity-50 ${
                    reviewAction === RequestStatus.APPROVED ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
                  }`}
                >
                  {submitting ? 'Processing...' : reviewAction === RequestStatus.APPROVED ? 'Approve & Return' : 'Deny'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReturnRequestsPanel;
