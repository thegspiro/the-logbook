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
  const [fulfillmentType, setFulfillmentType] = useState<'checkout' | 'assignment' | 'issuance'>('checkout');
  const [fulfillOverride, setFulfillOverride] = useState(false);
  const [substitutionOverride, setSubstitutionOverride] = useState(false);
  const [substitutionReason, setSubstitutionReason] = useState('');
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

  useEffect(() => {
    // A review/delete can remove the only row on the current page. Return to
    // the new last page instead of leaving the user on an empty stale offset.
    if (page > 0 && page * pageSize >= total) {
      setPage(Math.max(0, Math.ceil(total / pageSize) - 1));
    }
  }, [page, total]);

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
    setFulfillmentType(req.requested_duration === 'ongoing' ? 'assignment' : 'checkout');
    setFulfillOverride(false);
    setSubstitutionOverride(false);
    setSubstitutionReason('');
    setFulfillModal({ open: true, request: req });
    if (items.length === 0) {
      void inventoryService
        .getItems({ active_only: true, limit: 500 })
        .then((res) => setItems(res.items))
        .catch((err: unknown) => toast.error(getErrorMessage(err, 'Failed to load items')));
    }
  };

  const loadItems = () => {
    if (items.length > 0) return;
    void inventoryService
      .getItems({ active_only: true, limit: 500 })
      .then((res) => setItems(res.items))
      .catch((err: unknown) => toast.error(getErrorMessage(err, 'Failed to load items')));
  };

  const isCompatible = (req: EquipmentRequestItem | null, item: InventoryItem) =>
    req
      ? req.item_id
        ? item.id === req.item_id
        : req.category_id
          ? item.category_id === req.category_id
          : true
      : false;

  const availableQuantity = (item: InventoryItem) =>
    item.tracking_type === 'pool' ? item.quantity : item.status === 'available' ? 1 : 0;

  const handleApproveAndFulfill = async () => {
    if (!reviewModal.request) return;
    const request = reviewModal.request;
    setSubmitting(true);
    try {
      await inventoryService.reviewEquipmentRequest(request.id, {
        status: 'approved',
        review_notes: reviewNotes || undefined,
      });
      setReviewModal({ open: false, request: null });
      setReviewNotes('');
      openFulfill({ ...request, status: 'approved' });
      toast.success('Request approved — complete fulfillment');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to approve request'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleFulfill = async () => {
    if (!fulfillModal.request) return;
    if (!fulfillItemId.trim()) {
      toast.error('An item is required to fulfill this request');
      return;
    }
    if (substitutionOverride && !substitutionReason.trim()) {
      toast.error('Document a reason for the substitution override');
      return;
    }
    setSubmitting(true);
    try {
      await inventoryService.fulfillEquipmentRequest(fulfillModal.request.id, {
        fulfillment_type: fulfillmentType,
        item_id: fulfillItemId.trim() || undefined,
        quantity: Number(fulfillQuantity) || undefined,
        expected_return_at: fulfillReturnAt || undefined,
        override_allowance: fulfillOverride,
        substitution_override_reason: substitutionOverride ? substitutionReason.trim() : undefined,
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

        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="shrink-0 rounded-lg bg-purple-600 p-2">
              <ClipboardList className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-theme-text-primary text-xl font-bold">Gear Requests</h1>
              <p className="text-theme-text-muted text-sm">Review member requests for equipment</p>
            </div>
          </div>
          <button
            onClick={() => {
              void loadRequests();
            }}
            className="btn-secondary btn-md shrink-0 self-start sm:self-auto"
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
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <h3 className="text-theme-text-primary text-sm font-semibold">{req.item_name}</h3>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${REQUEST_STATUS_BADGES[req.status] ?? 'bg-theme-surface-secondary text-theme-text-muted'}`}
                      >
                        {req.status}
                      </span>
                      <span className="bg-theme-surface-secondary text-theme-text-muted rounded-full px-2 py-0.5 text-xs">
                        {req.requested_duration === 'ongoing' ? 'Ongoing need' : 'Temporary need'}
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
                        loadItems();
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
          <nav
            className="mt-6 flex flex-col items-center justify-between gap-4 sm:flex-row"
            aria-label="Equipment request pagination"
          >
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
                <p>
                  <strong>Requested:</strong> {reviewModal.request.item_name}
                  {reviewModal.request.category_name ? ` (${reviewModal.request.category_name})` : ''}
                </p>
                <p>
                  <strong>Requester:</strong> {reviewModal.request.requester_name ?? 'Unknown'}
                </p>
                <p>
                  <strong>Member intent:</strong>{' '}
                  {reviewModal.request.requested_duration === 'ongoing' ? 'Ongoing need' : 'Temporary need'} —{' '}
                  {reviewModal.request.reason || 'No reason provided'}
                </p>
                <p>
                  <strong>Quantity:</strong> {reviewModal.request.quantity}
                </p>
                <p>
                  <strong>Tracking:</strong>{' '}
                  {reviewModal.request.requested_item?.tracking_type ?? 'Determined when fulfilled'}
                </p>
                <p>
                  <strong>Availability:</strong>{' '}
                  {reviewModal.request.requested_item
                    ? `${reviewModal.request.requested_item.available_quantity} available (${reviewModal.request.requested_item.status})`
                    : 'No specific catalog item selected'}
                </p>
                <p>
                  <strong>Restrictions:</strong>{' '}
                  {reviewModal.request.requested_item?.min_rank_order != null ||
                  reviewModal.request.requested_item?.restricted_to_positions?.length
                    ? [
                        reviewModal.request.requested_item.min_rank_order != null
                          ? `minimum rank order ${reviewModal.request.requested_item.min_rank_order}`
                          : '',
                        reviewModal.request.requested_item.restricted_to_positions?.length
                          ? `positions: ${reviewModal.request.requested_item.restricted_to_positions.join(', ')}`
                          : '',
                      ]
                        .filter(Boolean)
                        .join('; ')
                    : 'None'}
                </p>
                <p>
                  <strong>Expected return:</strong>{' '}
                  {reviewModal.request.requested_duration === 'temporary'
                    ? 'Required at fulfillment'
                    : 'Not required (ongoing assignment)'}
                </p>
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
                  Approve for later fulfillment
                </button>
                <button
                  onClick={() => void handleApproveAndFulfill()}
                  disabled={
                    submitting ||
                    !items.some(
                      (item) =>
                        isCompatible(reviewModal.request, item) &&
                        availableQuantity(item) >= (reviewModal.request?.quantity ?? 1)
                    )
                  }
                  className="btn-success btn-md flex items-center justify-center gap-1.5 disabled:opacity-50"
                  title="Available only when catalog stock is immediately available"
                >
                  <PackageCheck className="h-4 w-4" />
                  Approve &amp; fulfill now
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
                <p>Requested duration: {fulfillModal.request.requested_duration}</p>
              </div>

              <div>
                <label htmlFor="fulfillment-type" className="text-theme-text-primary mb-1 block text-sm font-medium">
                  Final fulfillment method
                </label>
                <select
                  id="fulfillment-type"
                  value={fulfillmentType}
                  onChange={(e) => setFulfillmentType(e.target.value as 'checkout' | 'assignment' | 'issuance')}
                  className="form-input w-full"
                >
                  <option value="checkout">Checkout — returnable individual item</option>
                  <option value="assignment">Assignment — assigned individual gear</option>
                  <option value="issuance">Issuance — pool-tracked stock</option>
                </select>
                <p className="text-theme-text-muted mt-1 text-xs">
                  Select the actual transaction based on availability and department policy. Pool-tracked stock must use
                  issuance.
                </p>
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
                  {items
                    .filter((it) => substitutionOverride || isCompatible(fulfillModal.request, it))
                    .map((it) => {
                      const tag = it.serial_number || it.asset_tag || it.barcode;
                      return (
                        <option key={it.id} value={it.id}>
                          {it.name}
                          {tag ? ` — ${tag}` : ''}
                          {` — ${it.status}; ${availableQuantity(it)} available`}
                        </option>
                      );
                    })}
                </select>
                <p className="text-theme-text-muted mt-1 text-xs">
                  The selected item must support the final fulfillment method above.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                {fulfillmentType === 'checkout' && (
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

              <div className="border-theme-surface-border rounded-md border p-3">
                <label className="text-theme-text-primary inline-flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={substitutionOverride}
                    onChange={(e) => {
                      setSubstitutionOverride(e.target.checked);
                      setFulfillItemId('');
                    }}
                    className="form-checkbox"
                  />
                  Override requested item/category compatibility
                </label>
                <p className="text-theme-text-muted mt-1 text-xs">
                  This exposes other active inventory and records the substitution in the audit event.
                </p>
                {substitutionOverride && (
                  <div className="mt-3">
                    <label
                      htmlFor="substitution-reason"
                      className="text-theme-text-primary mb-1 block text-sm font-medium"
                    >
                      Substitution justification (required)
                    </label>
                    <textarea
                      id="substitution-reason"
                      rows={2}
                      value={substitutionReason}
                      onChange={(e) => setSubstitutionReason(e.target.value)}
                      className="form-input"
                      placeholder="Explain why this substitute is appropriate…"
                    />
                  </div>
                )}
              </div>

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
