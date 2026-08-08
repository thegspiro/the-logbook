/**
 * Write-Offs Page
 *
 * Admin page for reviewing loss/damage write-off requests.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, FileX, RefreshCw, Check, XCircle, Loader2, Filter } from 'lucide-react';
import { FloatingActionButton } from '../../../components/ux/FloatingActionButton';
import { inventoryService } from '../../../services/api';
import type { WriteOffRequestItem } from '../types';
import { REQUEST_STATUS_BADGES } from '../types';
import { getErrorMessage } from '../../../utils/errorHandling';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate } from '../../../utils/dateFormatting';
import { Modal } from '../../../components/Modal';
import toast from 'react-hot-toast';

const WriteOffsPage: React.FC = () => {
  const tz = useTimezone();
  const [writeOffs, setWriteOffs] = useState<WriteOffRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [reviewModal, setReviewModal] = useState<{ open: boolean; item: WriteOffRequestItem | null }>({
    open: false,
    item: null,
  });
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

  const fmtDate = (dateStr?: string) => {
    if (!dateStr) return '--';
    return formatDate(dateStr, tz);
  };

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <Link
          to="/inventory/admin"
          className="text-theme-text-muted hover:text-theme-text-secondary mb-6 flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Admin
        </Link>

        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-red-600 p-2">
              <FileX className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-theme-text-primary text-xl font-bold">Write-Off Requests</h1>
              <p className="text-theme-text-muted text-sm">Process loss and damage write-off requests</p>
            </div>
          </div>
          <button
            onClick={() => {
              void loadWriteOffs();
            }}
            className="btn-secondary btn-md"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Filter */}
        <div className="mb-6">
          <label htmlFor="writeoff-status-filter" className="sr-only">
            Filter by status
          </label>
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
          <div className="flex justify-center py-12" role="status" aria-live="polite">
            <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
          </div>
        ) : writeOffs.length === 0 ? (
          <div className="card-secondary p-8 text-center">
            <FileX className="text-theme-text-muted mx-auto mb-4 h-12 w-12" />
            <h3 className="text-theme-text-primary mb-2 text-lg font-semibold">No Write-Offs</h3>
            <p className="text-theme-text-muted text-sm">No {statusFilter || 'write-off'} requests found.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {writeOffs.map((wo) => (
              <div key={wo.id} className="card-secondary p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <h3 className="text-theme-text-primary text-sm font-semibold">{wo.item_name}</h3>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${REQUEST_STATUS_BADGES[wo.status] ?? 'bg-theme-surface-secondary text-theme-text-muted'}`}
                      >
                        {wo.status}
                      </span>
                    </div>
                    <p className="text-theme-text-muted text-xs">
                      Reason: {wo.reason} &middot; Requested by {wo.requester_name ?? 'Unknown'} on{' '}
                      {fmtDate(wo.created_at)}
                    </p>
                    {wo.description && <p className="text-theme-text-secondary mt-1 text-xs">{wo.description}</p>}
                    {(wo.item_serial_number || wo.item_asset_tag) && (
                      <p className="text-theme-text-muted mt-1 text-xs">
                        {wo.item_serial_number && `S/N: ${wo.item_serial_number}`}
                        {wo.item_serial_number && wo.item_asset_tag && ' | '}
                        {wo.item_asset_tag && `AT: ${wo.item_asset_tag}`}
                      </p>
                    )}
                    {wo.item_value != null && (
                      <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                        Value: ${Number(wo.item_value).toFixed(2)}
                      </p>
                    )}
                    {wo.review_notes && (
                      <p className="text-theme-text-muted mt-1 text-xs italic">Review: {wo.review_notes}</p>
                    )}
                  </div>
                  {wo.status === 'pending' && (
                    <button
                      onClick={() => {
                        setReviewModal({ open: true, item: wo });
                        setReviewNotes('');
                      }}
                      className="btn-info shrink-0 px-3 py-1.5 text-xs"
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
              label:
                statusFilter === 'pending'
                  ? 'Show Approved'
                  : statusFilter === 'approved'
                    ? 'Show Denied'
                    : statusFilter === 'denied'
                      ? 'Show All'
                      : 'Show Pending',
              icon: <Filter className="h-5 w-5" />,
              onClick: () =>
                setStatusFilter((prev) =>
                  prev === 'pending' ? 'approved' : prev === 'approved' ? 'denied' : prev === 'denied' ? '' : 'pending'
                ),
              color: 'bg-red-600',
            },
            {
              id: 'refresh',
              label: 'Refresh',
              icon: <RefreshCw className="h-5 w-5" />,
              onClick: () => {
                void loadWriteOffs();
              },
              color: 'bg-blue-600',
            },
          ]}
          color="bg-red-600"
        />

        {/* Review Modal */}
        <Modal
          isOpen={reviewModal.open}
          onClose={() => setReviewModal({ open: false, item: null })}
          title={`Review Write-Off: ${reviewModal.item?.item_name ?? ''}`}
          size="sm"
        >
          {reviewModal.item && (
            <div className="space-y-4">
              <div className="text-theme-text-secondary space-y-1 text-sm">
                <p>Reason: {reviewModal.item.reason}</p>
                <p>Description: {reviewModal.item.description}</p>
                {reviewModal.item.item_value != null && (
                  <p>Item Value: ${Number(reviewModal.item.item_value).toFixed(2)}</p>
                )}
              </div>

              <div>
                <label
                  htmlFor="writeoff-review-notes"
                  className="text-theme-text-primary mb-1 block text-sm font-medium"
                >
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

              <div className="flex flex-col-reverse items-stretch justify-end gap-2 sm:flex-row sm:items-center sm:gap-3">
                <button
                  onClick={() => {
                    void handleReview('denied');
                  }}
                  disabled={submitting}
                  className="btn-primary btn-md flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <XCircle className="h-4 w-4" />
                  Deny
                </button>
                <button
                  onClick={() => {
                    void handleReview('approved');
                  }}
                  disabled={submitting}
                  className="btn-success btn-md flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <Check className="h-4 w-4" />
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
