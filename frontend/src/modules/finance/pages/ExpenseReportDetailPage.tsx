/**
 * Expense Report Detail Page
 *
 * Displays detailed info for a single expense report including
 * line items, approval timeline, and action buttons.
 */

import React, { useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  AlertTriangle,
  Receipt,
  Send,
  CheckCircle,
  Clock,
  XCircle,
  Ban,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useFinanceStore } from '../store/financeStore';
import { Skeleton } from '@/components/ux/Skeleton';
import { EmptyState } from '@/components/ux/EmptyState';
import { formatDateTime } from '@/utils/dateFormatting';
import { useTimezone } from '@/hooks/useTimezone';
import { formatCurrency } from '@/utils/currencyFormatting';
import {
  ExpenseReportStatus,
  EXPENSE_REPORT_STATUS_COLORS,
  APPROVAL_STEP_STATUS_COLORS,
} from '../types';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  denied: 'Denied',
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

const DetailSkeleton: React.FC = () => (
  <div className="space-y-6" aria-label="Loading expense report" role="status" aria-live="polite">
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

const ExpenseReportDetailPage: React.FC = () => {
  const tz = useTimezone();
  const { id } = useParams<{ id: string }>();
  const {
    selectedExpenseReport: er,
    isLoading,
    error,
    fetchExpenseReport,
    submitExpenseReport,
  } = useFinanceStore();

  useEffect(() => {
    if (id) {
      void fetchExpenseReport(id);
    }
  }, [id, fetchExpenseReport]);

  const handleSubmit = async () => {
    if (!id) return;
    try {
      await submitExpenseReport(id);
      toast.success('Expense report submitted for approval');
    } catch {
      // Error handled by store
    }
  };

  if (isLoading && !er) {
    return (
      <div className="space-y-6">
        <Link
          to="/finance/expenses"
          className="inline-flex items-center gap-2 text-sm text-theme-text-secondary hover:text-theme-text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Expense Reports
        </Link>
        <DetailSkeleton />
      </div>
    );
  }

  if (!er) {
    return (
      <div className="space-y-6">
        <Link
          to="/finance/expenses"
          className="inline-flex items-center gap-2 text-sm text-theme-text-secondary hover:text-theme-text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Expense Reports
        </Link>
        <EmptyState
          icon={Receipt}
          title="Expense report not found"
          description="The expense report you are looking for does not exist or has been removed."
        />
      </div>
    );
  }

  const canSubmit = er.status === ExpenseReportStatus.DRAFT;

  return (
    <div className="space-y-6">
      <Link
        to="/finance/expenses"
        className="inline-flex items-center gap-2 text-sm text-theme-text-secondary hover:text-theme-text-primary"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Expense Reports
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
                {er.title}
              </h1>
              <span
                className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${EXPENSE_REPORT_STATUS_COLORS[er.status] ?? 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-400'}`}
              >
                {STATUS_LABELS[er.status] ?? er.status}
              </span>
            </div>
            <p className="mt-1 text-sm text-theme-text-secondary">
              {er.reportNumber}
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
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <div>
            <p className="text-xs text-theme-text-secondary">Total Amount</p>
            <p className="text-sm font-semibold text-theme-text-primary">
              {formatCurrency(er.totalAmount)}
            </p>
          </div>
          <div>
            <p className="text-xs text-theme-text-secondary">Created</p>
            <p className="text-sm text-theme-text-primary">
              {formatDateTime(er.createdAt, tz)}
            </p>
          </div>
          {er.approvedAt && (
            <div>
              <p className="text-xs text-theme-text-secondary">Approved</p>
              <p className="text-sm text-theme-text-primary">
                {formatDateTime(er.approvedAt, tz)}
              </p>
            </div>
          )}
          {er.paidAt && (
            <div>
              <p className="text-xs text-theme-text-secondary">Paid</p>
              <p className="text-sm text-theme-text-primary">
                {formatDateTime(er.paidAt, tz)}
              </p>
            </div>
          )}
          {er.paymentMethod && (
            <div>
              <p className="text-xs text-theme-text-secondary">Payment Method</p>
              <p className="text-sm capitalize text-theme-text-primary">{er.paymentMethod}</p>
            </div>
          )}
        </div>

        {er.description && (
          <div className="mt-4 border-t border-theme-surface-border pt-4">
            <p className="text-xs font-medium text-theme-text-secondary">Description</p>
            <p className="mt-1 text-sm text-theme-text-primary">{er.description}</p>
          </div>
        )}

        {er.denialReason && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-xs font-medium text-red-700">Denial Reason</p>
            <p className="mt-0.5 text-sm text-red-600">{er.denialReason}</p>
          </div>
        )}
      </div>

      {/* Line Items */}
      {er.lineItems.length > 0 && (
        <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-6">
          <h2 className="mb-4 text-lg font-semibold text-theme-text-primary">
            Line Items
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-theme-surface-border">
                <tr>
                  <th scope="col" className="px-4 py-2 text-left text-xs text-theme-text-muted uppercase">Description</th>
                  <th scope="col" className="px-4 py-2 text-left text-xs text-theme-text-muted uppercase">Type</th>
                  <th scope="col" className="px-4 py-2 text-right text-xs text-theme-text-muted uppercase">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-theme-surface-border">
                {er.lineItems.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3 text-sm text-theme-text-primary">{item.description}</td>
                    <td className="px-4 py-3 text-sm capitalize text-theme-text-secondary">{item.expenseType ?? '--'}</td>
                    <td className="px-4 py-3 text-right text-sm text-theme-text-primary">{formatCurrency(item.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-theme-surface-border">
                  <td colSpan={2} className="px-4 py-3 text-sm font-semibold text-theme-text-primary">Total</td>
                  <td className="px-4 py-3 text-right text-sm font-semibold text-theme-text-primary">{formatCurrency(er.totalAmount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Approval Timeline */}
      {er.approvalSteps.length > 0 && (
        <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-6">
          <h2 className="mb-4 text-lg font-semibold text-theme-text-primary">
            Approval Timeline
          </h2>
          <div className="space-y-0">
            {[...er.approvalSteps]
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

export default ExpenseReportDetailPage;
