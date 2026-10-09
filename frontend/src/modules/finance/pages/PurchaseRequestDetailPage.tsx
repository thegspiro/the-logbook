/**
 * Purchase Request Detail Page
 *
 * Displays detailed info for a single purchase request including
 * request info, approval timeline, and action buttons.
 */

import React, { useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router';
import {
  ArrowLeft,
  AlertTriangle,
  ClipboardList,
  Edit,
  Send,
  Package,
  Truck,
  CreditCard,
  XCircle,
  CheckCircle,
  Clock,
  Ban,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useFinanceStore } from '../store/financeStore';
import { useFinanceRequestAccess } from '../hooks/useFinanceRequestAccess';
import { purchaseRequestService } from '../services/api';
import { ManualApprovalPanel } from '../components/ManualApprovalPanel';
import { ReceiptControl } from '../components/ReceiptControl';
import { Skeleton } from '@/components/ux/Skeleton';
import { EmptyState } from '@/components/ux/EmptyState';
import { Breadcrumbs } from '@/components/ux/Breadcrumbs';
import { formatDateTime } from '@/utils/dateFormatting';
import { useTimezone } from '@/hooks/useTimezone';
import { useSubmitGuard } from '@/hooks/useSubmitGuard';
import { formatCurrency } from '@/utils/currencyFormatting';
import {
  ApprovalEntityType,
  PurchaseRequestStatus,
  PURCHASE_REQUEST_STATUS_COLORS,
  APPROVAL_STEP_STATUS_COLORS,
} from '../types';
import { ApprovalStepActions } from '../components/ApprovalStepActions';

// =============================================================================
// Status Labels
// =============================================================================

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  denied: 'Denied',
  ordered: 'Ordered',
  received: 'Received',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

const APPROVAL_STEP_LABELS: Record<string, string> = {
  pending: 'Pending',
  approved: 'Approved',
  denied: 'Denied',
  skipped: 'Skipped',
  auto_approved: 'Auto-Approved',
  sent: 'Sent',
};

// =============================================================================
// Loading Skeleton
// =============================================================================

const DetailSkeleton: React.FC = () => (
  <div className="space-y-6" aria-label="Loading purchase request" role="status" aria-live="polite">
    <span className="sr-only">Loading...</span>
    <div className="card p-6">
      <div className="mb-4 flex items-center gap-3">
        <Skeleton className="h-10 w-10" rounded="lg" />
        <div className="space-y-2">
          <Skeleton className="h-5 w-64" />
          <Skeleton className="h-3 w-32" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={`f-${String(i)}`} className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-5 w-28" />
          </div>
        ))}
      </div>
    </div>
    <div className="card p-6">
      <Skeleton className="mb-4 h-5 w-40" />
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={`s-${String(i)}`} className="mb-3 h-12 w-full" />
      ))}
    </div>
  </div>
);

// =============================================================================
// Approval Timeline
// =============================================================================

interface ApprovalTimelineProps {
  isDraft: boolean;
  steps: {
    id: string;
    stepName?: string;
    stepOrder?: number;
    status: string;
    actedBy?: string;
    actedAt?: string;
    notes?: string;
  }[];
}

const ApprovalTimeline: React.FC<ApprovalTimelineProps> = ({ isDraft, steps }) => {
  const tz = useTimezone();
  const sorted = [...steps].sort((a, b) => (a.stepOrder ?? 0) - (b.stepOrder ?? 0));

  if (sorted.length === 0) {
    return (
      <p className="text-theme-text-secondary py-4 text-center text-sm">
        {/* Steps are created on submit, from whichever approval chain matches,
            so a draft has none yet rather than none at all. */}
        {isDraft ? 'Approval steps are added when you submit this request.' : 'This request has no approval steps.'}
      </p>
    );
  }

  return (
    <div className="space-y-0">
      {sorted.map((step, idx) => {
        const isLast = idx === sorted.length - 1;
        const iconColor =
          step.status === 'approved' || step.status === 'auto_approved'
            ? 'bg-green-100 text-green-600 dark:bg-green-500/20 dark:text-green-400'
            : step.status === 'denied'
              ? 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400'
              : step.status === 'pending'
                ? 'bg-yellow-100 text-yellow-600 dark:bg-yellow-500/20 dark:text-yellow-400'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-500/20 dark:text-gray-400';

        return (
          <div key={step.id} className="relative flex gap-4 pb-6">
            {/* Vertical line */}
            {!isLast && <div className="bg-theme-surface-border absolute top-8 left-4 h-full w-0.5" />}
            {/* Icon */}
            <div className={`z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${iconColor}`}>
              {step.status === 'approved' || step.status === 'auto_approved' ? (
                <CheckCircle className="h-4 w-4" />
              ) : step.status === 'denied' ? (
                <XCircle className="h-4 w-4" />
              ) : step.status === 'pending' ? (
                <Clock className="h-4 w-4" />
              ) : (
                <Ban className="h-4 w-4" />
              )}
            </div>
            {/* Content */}
            <div className="flex-1 pt-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-theme-text-primary text-sm font-medium">
                  {step.stepName ?? `Step ${String((step.stepOrder ?? 0) + 1)}`}
                </span>
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${APPROVAL_STEP_STATUS_COLORS[step.status] ?? 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-400'}`}
                >
                  {APPROVAL_STEP_LABELS[step.status] ?? step.status}
                </span>
              </div>
              {step.actedAt && (
                <p className="text-theme-text-secondary mt-0.5 text-xs">{formatDateTime(step.actedAt, tz)}</p>
              )}
              {step.notes && <p className="text-theme-text-secondary mt-1 text-sm">{step.notes}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// =============================================================================
// Main Page Component
// =============================================================================

const PurchaseRequestDetailPage: React.FC = () => {
  const tz = useTimezone();
  const { id } = useParams<{ id: string }>();
  const { busy, run } = useSubmitGuard();
  const navigate = useNavigate();
  const {
    selectedPurchaseRequest: pr,
    isLoading,
    error,
    fetchPurchaseRequest,
    submitPurchaseRequest,
  } = useFinanceStore();
  const access = useFinanceRequestAccess();

  useEffect(() => {
    if (id) {
      void fetchPurchaseRequest(id);
    }
  }, [id, fetchPurchaseRequest]);

  const handleSubmit = () =>
    run(async () => {
      if (!id) return;
      try {
        await submitPurchaseRequest(id);
        toast.success('Purchase request submitted for approval');
      } catch {
        // Error handled by store
      }
    });

  const handleMarkOrdered = async () => {
    if (!id) return;
    try {
      await purchaseRequestService.markOrdered(id);
      toast.success('Marked as ordered');
      void fetchPurchaseRequest(id);
    } catch {
      toast.error('Failed to mark as ordered');
    }
  };

  const handleMarkReceived = async () => {
    if (!id) return;
    try {
      await purchaseRequestService.markReceived(id);
      toast.success('Marked as received');
      void fetchPurchaseRequest(id);
    } catch {
      toast.error('Failed to mark as received');
    }
  };

  const handleMarkPaid = async () => {
    if (!id) return;
    try {
      await purchaseRequestService.markPaid(id);
      toast.success('Marked as paid');
      void fetchPurchaseRequest(id);
    } catch {
      toast.error('Failed to mark as paid');
    }
  };

  const handleCancel = async () => {
    if (!id) return;
    try {
      await purchaseRequestService.cancel(id);
      toast.success('Purchase request cancelled');
      void fetchPurchaseRequest(id);
    } catch {
      toast.error('Failed to cancel purchase request');
    }
  };

  if (isLoading && !pr) {
    return (
      <div className="space-y-6">
        <Breadcrumbs />
        <Link
          to="/finance/purchase-requests"
          className="text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-2 text-sm"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Purchase Requests
        </Link>
        <DetailSkeleton />
      </div>
    );
  }

  if (!pr) {
    return (
      <div className="space-y-6">
        <Breadcrumbs />
        <Link
          to="/finance/purchase-requests"
          className="text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-2 text-sm"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Purchase Requests
        </Link>
        <EmptyState
          icon={ClipboardList}
          title="Purchase request not found"
          description="The purchase request you are looking for does not exist or has been removed."
        />
      </div>
    );
  }

  // Each button is offered only to someone the endpoint behind it will
  // accept: the requester's own actions to the requester (or the finance
  // office), the order/receive/pay steps to finance.manage alone.
  const isRequester = access.canActAsRequester(pr.requestedBy);
  const isDraft = pr.status === PurchaseRequestStatus.DRAFT;
  const canEdit = isDraft && isRequester;
  const canSubmit = isDraft && isRequester;
  const canMarkOrdered = access.canManage && pr.status === PurchaseRequestStatus.APPROVED;
  const canMarkReceived = access.canManage && pr.status === PurchaseRequestStatus.ORDERED;
  const canMarkPaid = access.canManage && pr.status === PurchaseRequestStatus.RECEIVED;
  // A requester may withdraw only a draft; past that it is the finance
  // office's to cancel (FinanceService.cancel_purchase_request).
  const canCancel = access.canManage
    ? pr.status !== PurchaseRequestStatus.PAID && pr.status !== PurchaseRequestStatus.CANCELLED
    : isDraft && isRequester;
  // Mirrors _PR_RECEIPT_CLOSED / _PR_RECEIPT_CLOSED_TO_REQUESTER in
  // backend/app/api/v1/endpoints/finance.py.
  const receiptClosed =
    pr.status === PurchaseRequestStatus.DENIED ||
    pr.status === PurchaseRequestStatus.CANCELLED ||
    (!access.canManage && pr.status === PurchaseRequestStatus.PAID);
  const canAttachReceipt = isRequester && !receiptClosed;

  return (
    <div className="space-y-6">
      {/* Rendered by the loading and not-found branches above too — without it
          here the trail showed while the request was fetching and disappeared
          when it loaded. */}
      <Breadcrumbs />
      {/* Back link */}
      <Link
        to="/finance/purchase-requests"
        className="text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-2 text-sm"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Purchase Requests
      </Link>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Request Header */}
      <div className="card p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-theme-text-primary text-xl font-bold">{pr.title}</h1>
              <span
                className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${PURCHASE_REQUEST_STATUS_COLORS[pr.status] ?? 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-400'}`}
              >
                {STATUS_LABELS[pr.status] ?? pr.status}
              </span>
            </div>
            <p className="text-theme-text-secondary mt-1 text-sm">{pr.requestNumber}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit && (
              <button
                type="button"
                onClick={() => void navigate(`/finance/purchase-requests/${pr.id}/edit`)}
                className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium"
              >
                <Edit className="h-3.5 w-3.5" />
                Edit
              </button>
            )}
            {canSubmit && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleSubmit()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" />
                Submit for Approval
              </button>
            )}
            {canMarkOrdered && (
              <button
                type="button"
                onClick={() => void handleMarkOrdered()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
              >
                <Package className="h-3.5 w-3.5" />
                Mark Ordered
              </button>
            )}
            {canMarkReceived && (
              <button
                type="button"
                onClick={() => void handleMarkReceived()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800"
              >
                <Truck className="h-3.5 w-3.5" />
                Mark Received
              </button>
            )}
            {canMarkPaid && (
              <button
                type="button"
                onClick={() => void handleMarkPaid()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-800"
              >
                <CreditCard className="h-3.5 w-3.5" />
                Mark Paid
              </button>
            )}
            {canCancel && (
              <button
                type="button"
                onClick={() => void handleCancel()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
              >
                <XCircle className="h-3.5 w-3.5" />
                Cancel Request
              </button>
            )}
          </div>
        </div>

        {/* Details grid */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <div>
            <p className="text-theme-text-secondary text-xs">Estimated Amount</p>
            <p className="text-theme-text-primary text-sm font-semibold">{formatCurrency(pr.estimatedAmount)}</p>
          </div>
          {pr.actualAmount != null && (
            <div>
              <p className="text-theme-text-secondary text-xs">Actual Amount</p>
              <p className="text-theme-text-primary text-sm font-semibold">{formatCurrency(pr.actualAmount)}</p>
            </div>
          )}
          <div>
            <p className="text-theme-text-secondary text-xs">Vendor</p>
            <p className="text-theme-text-primary text-sm">{pr.vendor ?? '--'}</p>
          </div>
          <div>
            <p className="text-theme-text-secondary text-xs">Priority</p>
            <p className="text-theme-text-primary text-sm capitalize">{pr.priority}</p>
          </div>
          <div>
            <p className="text-theme-text-secondary text-xs">Created</p>
            <p className="text-theme-text-primary text-sm">{formatDateTime(pr.createdAt, tz)}</p>
          </div>
          {pr.approvedAt && (
            <div>
              <p className="text-theme-text-secondary text-xs">Approved</p>
              <p className="text-theme-text-primary text-sm">{formatDateTime(pr.approvedAt, tz)}</p>
            </div>
          )}
          {pr.orderedAt && (
            <div>
              <p className="text-theme-text-secondary text-xs">Ordered</p>
              <p className="text-theme-text-primary text-sm">{formatDateTime(pr.orderedAt, tz)}</p>
            </div>
          )}
          {pr.receivedAt && (
            <div>
              <p className="text-theme-text-secondary text-xs">Received</p>
              <p className="text-theme-text-primary text-sm">{formatDateTime(pr.receivedAt, tz)}</p>
            </div>
          )}
          {(canAttachReceipt || pr.receiptFileUrl || pr.receiptUrl) && (
            <div>
              <p className="text-theme-text-secondary text-xs">Receipt</p>
              <ReceiptControl
                subject={pr.title}
                receiptFileUrl={pr.receiptFileUrl}
                receiptUrl={pr.receiptUrl}
                canAttach={canAttachReceipt}
                onUpload={async (file) => {
                  await purchaseRequestService.uploadReceipt(pr.id, file);
                  await fetchPurchaseRequest(pr.id);
                }}
                onDownload={() => purchaseRequestService.downloadReceipt(pr.id)}
              />
            </div>
          )}
        </div>

        {/* Description */}
        {pr.description && (
          <div className="border-theme-surface-border mt-4 border-t pt-4">
            <p className="text-theme-text-secondary text-xs font-medium">Description</p>
            <p className="text-theme-text-primary mt-1 text-sm">{pr.description}</p>
          </div>
        )}

        {/* Denial reason */}
        {pr.denialReason && (
          <div className="alert-danger mt-4">
            <p className="text-theme-alert-danger-title text-xs font-medium">Denial Reason</p>
            <p className="text-theme-alert-danger-text mt-0.5 text-sm">{pr.denialReason}</p>
          </div>
        )}
      </div>

      <ManualApprovalPanel
        entityType={ApprovalEntityType.PURCHASE_REQUEST}
        entityId={pr.id}
        status={pr.status}
        approvalStepCount={pr.approvalSteps.length}
        requesterId={pr.requestedBy}
        onDecided={() => void fetchPurchaseRequest(pr.id)}
      />

      {/* Approval Timeline */}
      <div className="card p-6">
        <h2 className="text-theme-text-primary mb-4 text-lg font-semibold">Approval Timeline</h2>
        <ApprovalStepActions
          isPendingApproval={pr.status === PurchaseRequestStatus.PENDING_APPROVAL}
          steps={pr.approvalSteps}
          subject={`${pr.title} (${pr.requestNumber})`}
          onDecided={() => void fetchPurchaseRequest(pr.id)}
        />
        <ApprovalTimeline isDraft={pr.status === PurchaseRequestStatus.DRAFT} steps={pr.approvalSteps} />
      </div>
    </div>
  );
};

export default PurchaseRequestDetailPage;
