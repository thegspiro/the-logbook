/**
 * Equipment Requests Page
 *
 * Admin page for reviewing member equipment requests (checkout, assignment).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  RefreshCw,
  Check,
  XCircle,
  Loader2,
  Filter,
  PackageCheck,
} from 'lucide-react';
import { FloatingActionButton } from '../../../components/ux/FloatingActionButton';
import { inventoryService } from '../../../services/api';
import type { EquipmentRequestItem, InventoryItem } from '../types';
import { REQUEST_STATUS_BADGES } from '../types';
import { getErrorMessage } from '../../../utils/errorHandling';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate } from '../../../utils/dateFormatting';
import { Modal } from '../../../components/Modal';
import toast from 'react-hot-toast';

const EquipmentRequestsPage: React.FC = () => {
  const pageSize = 25;
  const tz = useTimezone();
  const [requests, setRequests] = useState<EquipmentRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [reviewModal, setReviewModal] = useState<{ open: boolean; request: EquipmentRequestItem | null }>({
    open: false,
    request: null,
  });
  const [reviewNotes, setReviewNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Fulfillment of an approved request
  const [fulfillModal, setFulfillModal] = useState<{ open: boolean; request: EquipmentRequestItem | null }>({
    open: false,
    request: null,
  });
  const [fulfillItemId, setFulfillItemId] = useState('');
  const [fulfillQuantity, setFulfillQuantity] = useState('1');
  const [fulfillReturnAt, setFulfillReturnAt] = useState('');
  const [fulfillOverride, setFulfillOverride] = useState(false);
  const [items, setItems] = useState<InventoryItem[]>([]);

  const loadRequests = useCallback(async () => {
    setLoading(true);
    try {
      const data = await inventoryService.getEquipmentRequests({
        ...(statusFilter ? { status: statusFilter } : {}),
        skip: page * pageSize,
        limit: pageSize,
      });
      setRequests(data.requests || []);
      setTotal(data.total);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load requests'));
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

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

  const openFulfill = (req: EquipmentRequestItem) => {
    setFulfillItemId(req.item_id ?? '');
    setFulfillQuantity(String(req.quantity || 1));
    setFulfillReturnAt('');
    setFulfillOverride(false);
    setFulfillModal({ open: true, request: req });
    if (items.length === 0) {
      void inventoryService
        .getItems({ active_only: true, limit: 500 })
        .then((res) => setItems(res.items))
        .catch((err: unknown) => toast.error(getErrorMessage(err, 'Failed to load items')));
    }
  };

  const handleFulfill = async () => {
    if (!fulfillModal.request) return;
    if (!fulfillItemId.trim()) {
      toast.error('An item is required to fulfill this request');
      return;
    }
    setSubmitting(true);
    try {
      await inventoryService.fulfillEquipmentRequest(fulfillModal.request.id, {
        item_id: fulfillItemId.trim() || undefined,
        quantity: Number(fulfillQuantity) || undefined,
        expected_return_at: fulfillReturnAt || undefined,
        override_allowance: fulfillOverride,
      });
      toast.success('Request fulfilled');
      setFulfillModal({ open: false, request: null });
      void loadRequests();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to fulfill request'));
    } finally {
      setSubmitting(false);
    }
  };

  const fmtDate = (dateStr: string) => formatDate(dateStr, tz);

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
            <div className="rounded-lg bg-purple-600 p-2">
              <ClipboardList className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-theme-text-primary text-xl font-bold">Equipment Requests</h1>
              <p className="text-theme-text-muted text-sm">Review member requests for equipment</p>
            </div>
          </div>
          <button
            onClick={() => {
              void loadRequests();
            }}
            className="btn-secondary btn-md"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Filter */}
        <div className="mb-6">
          <label htmlFor="status-filter" className="sr-only">
            Filter by status
          </label>
          <select
            id="status-filter"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(0);
            }}
            className="form-input w-48"
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="fulfilled">Fulfilled</option>
            <option value="denied">Denied</option>
            <option value="">All</option>
          </select>
        </div>

        {/* Requests list */}
        {loading ? (
          <div className="flex justify-center py-12" role="status" aria-live="polite">
            <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
          </div>
        ) : requests.length === 0 ? (
          <div className="card-secondary p-8 text-center">
            <ClipboardList className="text-theme-text-muted mx-auto mb-4 h-12 w-12" />
            <h3 className="text-theme-text-primary mb-2 text-lg font-semibold">No Requests</h3>
            <p className="text-theme-text-muted text-sm">No {statusFilter || 'equipment'} requests found.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {requests.map((req) => (
              <div key={req.id} className="card-secondary p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <h3 className="text-theme-text-primary text-sm font-semibold">{req.item_name}</h3>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${REQUEST_STATUS_BADGES[req.status] ?? 'bg-theme-surface-secondary text-theme-text-muted'}`}
                      >
                        {req.status}
                      </span>
                      <span className="bg-theme-surface-secondary text-theme-text-muted rounded-full px-2 py-0.5 text-xs">
                        {req.request_type}
                      </span>
                    </div>
                    <p className="text-theme-text-muted text-xs">
                      Requested by {req.requester_name ?? 'Unknown'} on {fmtDate(req.created_at)}
                      {req.quantity > 1 && ` — Qty: ${req.quantity}`}
                    </p>
                    {req.reason && <p className="text-theme-text-secondary mt-1 text-xs">{req.reason}</p>}
                    {req.review_notes && (
                      <p className="text-theme-text-muted mt-1 text-xs italic">Review: {req.review_notes}</p>
                    )}
                    {req.status === 'fulfilled' && req.fulfillment_type && (
                      <p className="mt-1 text-xs text-green-600 dark:text-green-400">
                        Fulfilled via {req.fulfillment_type}
                        {req.fulfilled_at ? ` on ${fmtDate(req.fulfilled_at)}` : ''}
                      </p>
                    )}
                  </div>
                  {req.status === 'pending' && (
                    <button
                      onClick={() => {
                        setReviewModal({ open: true, request: req });
                        setReviewNotes('');
                      }}
                      className="btn-info shrink-0 px-3 py-1.5 text-xs"
                    >
                      Review
                    </button>
                  )}
                  {req.status === 'approved' && (
                    <button
                      onClick={() => openFulfill(req)}
                      className="btn-success inline-flex shrink-0 items-center gap-1 px-3 py-1.5 text-xs"
                    >
                      <PackageCheck className="h-3.5 w-3.5" />
                      Fulfill
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && total > 0 && (
          <nav className="mt-6 flex items-center justify-between gap-4" aria-label="Equipment request pagination">
            <p className="text-theme-text-muted text-sm">
              Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary btn-sm inline-flex items-center gap-1"
                disabled={page === 0}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </button>
              <button
                type="button"
                className="btn-secondary btn-sm inline-flex items-center gap-1"
                disabled={(page + 1) * pageSize >= total}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </nav>
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
              onClick: () => {
                setPage(0);
                setStatusFilter((prev) =>
                  prev === 'pending' ? 'approved' : prev === 'approved' ? 'denied' : prev === 'denied' ? '' : 'pending'
                );
              },
              color: 'bg-purple-600',
            },
            {
              id: 'refresh',
              label: 'Refresh',
              icon: <RefreshCw className="h-5 w-5" />,
              onClick: () => {
                void loadRequests();
              },
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
              <div className="text-theme-text-secondary text-sm">
                <p>Requester: {reviewModal.request.requester_name ?? 'Unknown'}</p>
                <p>Type: {reviewModal.request.request_type}</p>
                <p>Quantity: {reviewModal.request.quantity}</p>
                {reviewModal.request.reason && <p className="mt-1">Reason: {reviewModal.request.reason}</p>}
              </div>

              <div>
                <label htmlFor="review-notes" className="text-theme-text-primary mb-1 block text-sm font-medium">
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

        {/* Fulfill Modal */}
        <Modal
          isOpen={fulfillModal.open}
          onClose={() => setFulfillModal({ open: false, request: null })}
          title={`Fulfill: ${fulfillModal.request?.item_name ?? ''}`}
          size="sm"
        >
          {fulfillModal.request && (
            <div className="space-y-4">
              <div className="text-theme-text-secondary text-sm">
                <p>Requester: {fulfillModal.request.requester_name ?? 'Unknown'}</p>
                <p>Type: {fulfillModal.request.request_type}</p>
              </div>

              <div>
                <label htmlFor="fulfill-item" className="text-theme-text-primary mb-1 block text-sm font-medium">
                  Item to fulfill with
                </label>
                <select
                  id="fulfill-item"
                  value={fulfillItemId}
                  onChange={(e) => setFulfillItemId(e.target.value)}
                  className="form-input w-full"
                >
                  <option value="">Select an item…</option>
                  {items.map((it) => {
                    const tag = it.serial_number || it.asset_tag || it.barcode;
                    return (
                      <option key={it.id} value={it.id}>
                        {it.name}
                        {tag ? ` — ${tag}` : ''}
                        {it.tracking_type === 'pool' ? ` (pool: ${it.quantity} on hand)` : ''}
                      </option>
                    );
                  })}
                </select>
                <p className="text-theme-text-muted mt-1 text-xs">
                  Pool items are issued; individual items are{' '}
                  {fulfillModal.request.request_type === 'checkout' ? 'checked out' : 'assigned'}.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="fulfill-qty" className="text-theme-text-primary mb-1 block text-sm font-medium">
                    Quantity
                  </label>
                  <input
                    id="fulfill-qty"
                    type="number"
                    min={1}
                    value={fulfillQuantity}
                    onChange={(e) => setFulfillQuantity(e.target.value)}
                    className="form-input w-full"
                  />
                </div>
                {fulfillModal.request.request_type === 'checkout' && (
                  <div>
                    <label htmlFor="fulfill-return" className="text-theme-text-primary mb-1 block text-sm font-medium">
                      Expected Return
                    </label>
                    <input
                      id="fulfill-return"
                      type="date"
                      value={fulfillReturnAt}
                      onChange={(e) => setFulfillReturnAt(e.target.value)}
                      className="form-input w-full"
                    />
                  </div>
                )}
              </div>

              <label className="text-theme-text-primary inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={fulfillOverride}
                  onChange={(e) => setFulfillOverride(e.target.checked)}
                  className="form-checkbox"
                />
                Override issuance allowance limit
              </label>

              <div className="flex flex-col-reverse items-stretch justify-end gap-2 sm:flex-row sm:items-center sm:gap-3">
                <button
                  onClick={() => setFulfillModal({ open: false, request: null })}
                  className="btn-secondary btn-md"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    void handleFulfill();
                  }}
                  disabled={submitting || !fulfillItemId.trim()}
                  className="btn-success btn-md flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
                  Fulfill Request
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
