/**
 * Write-Offs Page
 *
 * Admin page for reviewing loss/damage write-off requests.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, FileX, RefreshCw, Check, XCircle, Loader2 } from 'lucide-react';
import { inventoryService } from '../../../services/api';
import type { WriteOffRequestItem } from '../types';
import { getErrorMessage } from '../../../utils/errorHandling';
import { Modal } from '../../../components/Modal';
import toast from 'react-hot-toast';

const STATUS_BADGES: Record<string, string> = {
  pending: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
  approved: 'bg-green-500/10 text-green-700 dark:text-green-400',
  denied: 'bg-red-500/10 text-red-700 dark:text-red-400',
};

const WriteOffsPage: React.FC = () => {
  const [writeOffs, setWriteOffs] = useState<WriteOffRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [reviewModal, setReviewModal] = useState<{ open: boolean; item: WriteOffRequestItem | null }>({ open: false, item: null });
  const [reviewNotes, setReviewNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadWriteOffs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await inventoryService.getWriteOffRequests(statusFilter ? { status: statusFilter } : {});
      setWriteOffs(data || []);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load write-offs'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void loadWriteOffs();
  }, [loadWriteOffs]);

  const handleReview = async (decision: 'approved' | 'denied') => {
    if (!reviewModal.item) return;
    setSubmitting(true);
    try {
      await inventoryService.reviewWriteOff(reviewModal.item.id, {
        status: decision,
        review_notes: reviewNotes || undefined,
      });
      toast.success(`Write-off ${decision}`);
      setReviewModal({ open: false, item: null });
      setReviewNotes('');
      void loadWriteOffs();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to review write-off'));
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '--';
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

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
            <div className="bg-red-600 rounded-lg p-2">
              <FileX className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-theme-text-primary">Write-Off Requests</h1>
              <p className="text-sm text-theme-text-muted">Process loss and damage write-off requests</p>
            </div>
          </div>
          <button
            onClick={() => { void loadWriteOffs(); }}
            className="flex items-center gap-2 px-3 py-2 border border-theme-surface-border rounded-lg text-sm text-theme-text-primary hover:bg-theme-surface-hover transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Filter */}
        <div className="mb-6">
          <label htmlFor="writeoff-status-filter" className="sr-only">Filter by status</label>
          <select
            id="writeoff-status-filter"
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

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-theme-text-muted" />
          </div>
        ) : writeOffs.length === 0 ? (
          <div className="card-secondary p-8 text-center">
            <FileX className="w-12 h-12 text-theme-text-muted mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-theme-text-primary mb-2">No Write-Offs</h3>
            <p className="text-theme-text-muted text-sm">No {statusFilter || 'write-off'} requests found.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {writeOffs.map((wo) => (
              <div key={wo.id} className="card-secondary p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-semibold text-theme-text-primary">{wo.item_name}</h3>
                      <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${STATUS_BADGES[wo.status] ?? 'bg-theme-surface-secondary text-theme-text-muted'}`}>
                        {wo.status}
                      </span>
                    </div>
                    <p className="text-xs text-theme-text-muted">
                      Reason: {wo.reason} &middot; Requested by {wo.requester_name ?? 'Unknown'} on {formatDate(wo.created_at)}
                    </p>
                    {wo.description && (
                      <p className="text-xs text-theme-text-secondary mt-1">{wo.description}</p>
                    )}
                    {(wo.item_serial_number || wo.item_asset_tag) && (
                      <p className="text-xs text-theme-text-muted mt-1">
                        {wo.item_serial_number && `S/N: ${wo.item_serial_number}`}
                        {wo.item_serial_number && wo.item_asset_tag && ' | '}
                        {wo.item_asset_tag && `AT: ${wo.item_asset_tag}`}
                      </p>
                    )}
                    {wo.item_value != null && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                        Value: ${Number(wo.item_value).toFixed(2)}
                      </p>
                    )}
                    {wo.review_notes && (
                      <p className="text-xs text-theme-text-muted mt-1 italic">Review: {wo.review_notes}</p>
                    )}
                  </div>
                  {wo.status === 'pending' && (
                    <button
                      onClick={() => {
                        setReviewModal({ open: true, item: wo });
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

        {/* Review Modal */}
        <Modal
          isOpen={reviewModal.open}
          onClose={() => setReviewModal({ open: false, item: null })}
          title={`Review Write-Off: ${reviewModal.item?.item_name ?? ''}`}
          size="sm"
        >
          {reviewModal.item && (
            <div className="space-y-4">
              <div className="text-sm text-theme-text-secondary space-y-1">
                <p>Reason: {reviewModal.item.reason}</p>
                <p>Description: {reviewModal.item.description}</p>
                {reviewModal.item.item_value != null && (
                  <p>Item Value: ${Number(reviewModal.item.item_value).toFixed(2)}</p>
                )}
              </div>

              <div>
                <label htmlFor="writeoff-review-notes" className="block text-sm font-medium text-theme-text-primary mb-1">
                  Review Notes (optional)
                </label>
                <textarea
                  id="writeoff-review-notes"
                  rows={3}
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  className="form-input"
                  placeholder="Optional notes..."
                />
              </div>

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => { void handleReview('denied'); }}
                  disabled={submitting}
                  className="flex items-center gap-1.5 px-4 py-2 border border-red-500/30 text-red-700 dark:text-red-400 rounded-lg hover:bg-red-500/10 transition-colors disabled:opacity-50"
                >
                  <XCircle className="w-4 h-4" />
                  Deny
                </button>
                <button
                  onClick={() => { void handleReview('approved'); }}
                  disabled={submitting}
                  className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50"
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

export default WriteOffsPage;
