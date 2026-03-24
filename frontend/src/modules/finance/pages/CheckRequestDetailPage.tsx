/**
 * Check Request Detail Page
 *
 * Displays detailed info for a single check request including
 * request info, approval timeline, and action buttons.
 */

import React, { useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  AlertTriangle,
  FileCheck,
  CheckCircle,
  Clock,
  XCircle,
  Ban,
  Send,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useFinanceStore } from '../store/financeStore';
import { checkRequestService } from '../services/api';
import { Skeleton } from '@/components/ux/Skeleton';
import { EmptyState } from '@/components/ux/EmptyState';
import { Breadcrumbs } from '@/components/ux/Breadcrumbs';
import { formatDateTime } from '@/utils/dateFormatting';
import { useTimezone } from '@/hooks/useTimezone';
import { formatCurrency } from '@/utils/currencyFormatting';
import {
  CheckRequestStatus,
  CHECK_REQUEST_STATUS_COLORS,
  APPROVAL_STEP_STATUS_COLORS,
} from '../types';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  denied: 'Denied',
  issued: 'Issued',
  voided: 'Voided',
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

const DetailSkeleton: React.FC = () => (
  <div className="space-y-6" aria-label="Loading check request" role="status" aria-live="polite">
    <span className="sr-only">Loading...</span>
    <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-6">
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
  </div>
);

const CheckRequestDetailPage: React.FC = () => {
  const tz = useTimezone();
  const { id } = useParams<{ id: string }>();
  const {
    selectedCheckRequest: cr,
    isLoading,
    error,
    fetchCheckRequest,
    submitCheckRequest,
  } = useFinanceStore();

  useEffect(() => {
    if (id) {
      void fetchCheckRequest(id);
    }
  }, [id, fetchCheckRequest]);

  const handleSubmit = async () => {
    if (!id) return;
    try {
      await submitCheckRequest(id);
      toast.success('Check request submitted for approval');
    } catch {
      // Error handled by store
    }
  };

  const handleIssue = async () => {
    if (!id || !cr) return;
    const checkNumber = window.prompt('Enter check number:');
    if (!checkNumber) return;
    try {
      await checkRequestService.issue(id, checkNumber);
      toast.success('Check issued');
      void fetchCheckRequest(id);
    } catch {
      toast.error('Failed to issue check');
    }
  };

  const handleVoid = async () => {
    if (!id) return;
    try {
      await checkRequestService.void(id);
      toast.success('Check request voided');
      void fetchCheckRequest(id);
    } catch {
      toast.error('Failed to void check request');
    }
  };

  if (isLoading && !cr) {
    return (
      <div className="space-y-6">
        <Breadcrumbs />
        <Link
          to="/finance/check-requests"
          className="inline-flex items-center gap-2 text-sm text-theme-text-secondary hover:text-theme-text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Check Requests
        </Link>
        <DetailSkeleton />
      </div>
    );
  }

  if (!cr) {
    return (
      <div className="space-y-6">
        <Breadcrumbs />
        <Link
          to="/finance/check-requests"
          className="inline-flex items-center gap-2 text-sm text-theme-text-secondary hover:text-theme-text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Check Requests
        </Link>
        <EmptyState
          icon={FileCheck}
          title="Check request not found"
          description="The check request you are looking for does not exist or has been removed."
        />
      </div>
    );
  }

  const canSubmit = cr.status === CheckRequestStatus.DRAFT;
  const canIssue = cr.status === CheckRequestStatus.APPROVED;
  const canVoid =
    cr.status !== CheckRequestStatus.VOIDED &&
    cr.status !== CheckRequestStatus.CANCELLED;

  return (
    <div className="space-y-6">
      <Breadcrumbs />
      <Link
        to="/finance/check-requests"
        className="inline-flex items-center gap-2 text-sm text-theme-text-secondary hover:text-theme-text-primary"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Check Requests
      </Link>

      {error && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-theme-text-primary">
                {cr.payeeName}
              </h1>
              <span
                className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${CHECK_REQUEST_STATUS_COLORS[cr.status] ?? 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-400'}`}
              >
                {STATUS_LABELS[cr.status] ?? cr.status}
              </span>
            </div>
            <p className="mt-1 text-sm text-theme-text-secondary">
              {cr.requestNumber}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canSubmit && (
              <button
                type="button"
                onClick={() => void handleSubmit()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                <Send className="h-3.5 w-3.5" />
                Submit
              </button>
            )}
            {canIssue && (
              <button
                type="button"
                onClick={() => void handleIssue()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
              >
                <CheckCircle className="h-3.5 w-3.5" />
                Issue Check
              </button>
            )}
            {canVoid && (
              <button
                type="button"
                onClick={() => void handleVoid()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
              >
                <XCircle className="h-3.5 w-3.5" />
                Void
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <div>
            <p className="text-xs text-theme-text-secondary">Amount</p>
            <p className="text-sm font-semibold text-theme-text-primary">
              {formatCurrency(cr.amount)}
            </p>
          </div>
          <div>
            <p className="text-xs text-theme-text-secondary">Payee</p>
            <p className="text-sm text-theme-text-primary">{cr.payeeName}</p>
          </div>
          {cr.checkNumber && (
            <div>
              <p className="text-xs text-theme-text-secondary">Check Number</p>
              <p className="text-sm text-theme-text-primary">{cr.checkNumber}</p>
            </div>
          )}
          <div>
            <p className="text-xs text-theme-text-secondary">Created</p>
            <p className="text-sm text-theme-text-primary">
              {formatDateTime(cr.createdAt, tz)}
            </p>
          </div>
          {cr.approvedAt && (
            <div>
              <p className="text-xs text-theme-text-secondary">Approved</p>
              <p className="text-sm text-theme-text-primary">
                {formatDateTime(cr.approvedAt, tz)}
              </p>
            </div>
          )}
          {cr.checkDate && (
            <div>
              <p className="text-xs text-theme-text-secondary">Check Date</p>
              <p className="text-sm text-theme-text-primary">
                {formatDateTime(cr.checkDate, tz)}
              </p>
            </div>
          )}
        </div>

        {cr.payeeAddress && (
          <div className="mt-4 border-t border-theme-surface-border pt-4">
            <p className="text-xs font-medium text-theme-text-secondary">Payee Address</p>
            <p className="mt-1 text-sm text-theme-text-primary">{cr.payeeAddress}</p>
          </div>
        )}

        {cr.purpose && (
          <div className="mt-4 border-t border-theme-surface-border pt-4">
            <p className="text-xs font-medium text-theme-text-secondary">Purpose</p>
            <p className="mt-1 text-sm text-theme-text-primary">{cr.purpose}</p>
          </div>
        )}

        {cr.memo && (
          <div className="mt-4 border-t border-theme-surface-border pt-4">
            <p className="text-xs font-medium text-theme-text-secondary">Memo</p>
            <p className="mt-1 text-sm text-theme-text-primary">{cr.memo}</p>
          </div>
        )}

        {cr.denialReason && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-xs font-medium text-red-700">Denial Reason</p>
            <p className="mt-0.5 text-sm text-red-600">{cr.denialReason}</p>
          </div>
        )}
      </div>

      {cr.approvalSteps.length > 0 && (
        <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-6">
          <h2 className="mb-4 text-lg font-semibold text-theme-text-primary">
            Approval Timeline
          </h2>
          <div className="space-y-0">
            {[...cr.approvalSteps]
              .sort((a, b) => (a.stepOrder ?? 0) - (b.stepOrder ?? 0))
              .map((step, idx, arr) => {
                const isLast = idx === arr.length - 1;
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
                    {!isLast && (
                      <div className="absolute left-4 top-8 h-full w-0.5 bg-theme-surface-border" />
                    )}
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
                    <div className="flex-1 pt-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-theme-text-primary">
                          {step.stepName ?? `Step ${String((step.stepOrder ?? 0) + 1)}`}
                        </span>
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${APPROVAL_STEP_STATUS_COLORS[step.status] ?? 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-400'}`}
                        >
                          {APPROVAL_STEP_LABELS[step.status] ?? step.status}
                        </span>
                      </div>
                      {step.actedAt && (
                        <p className="mt-0.5 text-xs text-theme-text-secondary">
                          {formatDateTime(step.actedAt, tz)}
                        </p>
                      )}
                      {step.notes && (
                        <p className="mt-1 text-sm text-theme-text-secondary">{step.notes}</p>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
};

export default CheckRequestDetailPage;
