/**
 * Equipment Requests Page
 *
 * Admin page for reviewing member equipment requests (checkout, assignment).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ClipboardList, RefreshCw, Check, XCircle, Loader2, Filter } from 'lucide-react';
import { FloatingActionButton } from '../../../components/ux/FloatingActionButton';
import { inventoryService } from '../../../services/api';
import type { EquipmentRequestItem } from '../types';
import { REQUEST_STATUS_BADGES } from '../types';
import { getErrorMessage } from '../../../utils/errorHandling';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate } from '../../../utils/dateFormatting';
import { Modal } from '../../../components/Modal';
import toast from 'react-hot-toast';

const EquipmentRequestsPage: React.FC = () => {
  const tz = useTimezone();
  const [requests, setRequests] = useState<EquipmentRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [reviewModal, setReviewModal] = useState<{ open: boolean; request: EquipmentRequestItem | null }>({ open: false, request: null });
  const [reviewNotes, setReviewNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadRequests = useCallback(async () => {
    setLoading(true);
    try {
      const data = await inventoryService.getEquipmentRequests(statusFilter ? { status: statusFilter } : {});
      setRequests(data.requests || []);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load requests'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  const handleReview = async (decision: 'approved' | 'denied') => {
    if (!reviewModal.request) return;
    setSubmitting(true);
    try {
      await inventoryService.reviewEquipmentRequest(reviewModal.request.id, {
        status: decision,
        review_notes: reviewNotes || undefined,
      });
      toast.success(`Request ${decision}`);
      setReviewModal({ open: false, request: null });
      setReviewNotes('');
      void loadRequests();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to review request'));
    } finally {
      setSubmitting(false);
    }
  };

  const fmtDate = (dateStr: string) => formatDate(dateStr, tz);

  return (
    <div className="min-h-screen">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <Link
          to="/inventory/admin"
          className="text-sm text-theme-text-muted hover:text-theme-text-secondary flex items-center gap-1 mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Admin
        </Link>

        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="bg-purple-600 rounded-lg p-2">
              <ClipboardList className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-theme-text-primary">Equipment Requests</h1>
              <p className="text-sm text-theme-text-muted">Review member requests for equipment</p>
            </div>
          </div>
          <button
            onClick={() => { void loadRequests(); }}
            className="btn-secondary btn-md"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Filter */}
        <div className="mb-6">
          <label htmlFor="status-filter" className="sr-only">Filter by status</label>
          <select
            id="status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="form-input w-48"
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="denied">Denied</option>
            <option value="">All</option>
          </select>
        </div>

        {/* Requests list */}
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-theme-text-muted" />
          </div>
        ) : requests.length === 0 ? (
          <div className="card-secondary p-8 text-center">
            <ClipboardList className="w-12 h-12 text-theme-text-muted mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-theme-text-primary mb-2">No Requests</h3>
            <p className="text-theme-text-muted text-sm">No {statusFilter || 'equipment'} requests found.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {requests.map((req) => (
              <div key={req.id} className="card-secondary p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-semibold text-theme-text-primary">{req.item_name}</h3>
                      <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${REQUEST_STATUS_BADGES[req.status] ?? 'bg-theme-surface-secondary text-theme-text-muted'}`}>
                        {req.status}
                      </span>
                      <span className="px-2 py-0.5 text-xs rounded-full bg-theme-surface-secondary text-theme-text-muted">
                        {req.request_type}
                      </span>
                    </div>
                    <p className="text-xs text-theme-text-muted">
                      Requested by {req.requester_name ?? 'Unknown'} on {fmtDate(req.created_at)}
                      {req.quantity > 1 && ` — Qty: ${req.quantity}`}
                    </p>
                    {req.reason && (
                      <p className="text-xs text-theme-text-secondary mt-1">{req.reason}</p>
                    )}
                    {req.review_notes && (
                      <p className="text-xs text-theme-text-muted mt-1 italic">Review: {req.review_notes}</p>
                    )}
                  </div>
                  {req.status === 'pending' && (
                    <button
                      onClick={() => {
                        setReviewModal({ open: true, request: req });
                        setReviewNotes('');
                      }}
                      className="btn-info px-3 py-1.5 text-xs shrink-0"
                    >
                      Review
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Mobile FAB */}
        <FloatingActionButton
          actions={[
            {
              id: 'filter',
              label: statusFilter === 'pending' ? 'Show Approved' : statusFilter === 'approved' ? 'Show Denied' : statusFilter === 'denied' ? 'Show All' : 'Show Pending',
              icon: <Filter className="w-5 h-5" />,
              onClick: () => setStatusFilter((prev) => prev === 'pending' ? 'approved' : prev === 'approved' ? 'denied' : prev === 'denied' ? '' : 'pending'),
              color: 'bg-purple-600',
            },
            {
              id: 'refresh',
              label: 'Refresh',
              icon: <RefreshCw className="w-5 h-5" />,
              onClick: () => { void loadRequests(); },
              color: 'bg-blue-600',
            },
          ]}
          color="bg-purple-600"
        />

        {/* Review Modal */}
        <Modal
          isOpen={reviewModal.open}
          onClose={() => setReviewModal({ open: false, request: null })}
          title={`Review: ${reviewModal.request?.item_name ?? ''}`}
          size="sm"
        >
          {reviewModal.request && (
            <div className="space-y-4">
              <div className="text-sm text-theme-text-secondary">
                <p>Requester: {reviewModal.request.requester_name ?? 'Unknown'}</p>
                <p>Type: {reviewModal.request.request_type}</p>
                <p>Quantity: {reviewModal.request.quantity}</p>
                {reviewModal.request.reason && <p className="mt-1">Reason: {reviewModal.request.reason}</p>}
              </div>

              <div>
                <label htmlFor="review-notes" className="block text-sm font-medium text-theme-text-primary mb-1">
                  Review Notes (optional)
                </label>
                <textarea
                  id="review-notes"
                  rows={3}
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  className="form-input"
                  placeholder="Optional notes for the requester..."
                />
              </div>

              <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 sm:gap-3">
                <button
                  onClick={() => { void handleReview('denied'); }}
                  disabled={submitting}
                  className="btn-primary btn-md flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <XCircle className="w-4 h-4" />
                  Deny
                </button>
                <button
                  onClick={() => { void handleReview('approved'); }}
                  disabled={submitting}
                  className="btn-success btn-md flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <Check className="w-4 h-4" />
                  Approve
                </button>
              </div>
            </div>
          )}
        </Modal>
      </div>
    </div>
  );
};

export default EquipmentRequestsPage;
