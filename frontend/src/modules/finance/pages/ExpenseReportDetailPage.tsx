/**
 * Expense Report Detail Page
 *
 * Displays detailed info for a single expense report including
 * line items, approval timeline, and action buttons.
 */

import React, { useEffect } from 'react';
import { useParams, Link } from 'react-router';
import { ArrowLeft, AlertTriangle, Receipt, Send, CheckCircle, Clock, XCircle, Ban } from 'lucide-react';
import toast from 'react-hot-toast';
import { useFinanceStore } from '../store/financeStore';
import { Skeleton } from '@/components/ux/Skeleton';
import { EmptyState } from '@/components/ux/EmptyState';
import { Breadcrumbs } from '@/components/ux/Breadcrumbs';
import { formatDateTime } from '@/utils/dateFormatting';
import { useTimezone } from '@/hooks/useTimezone';
import { formatCurrency } from '@/utils/currencyFormatting';
import { ExpenseReportStatus, EXPENSE_REPORT_STATUS_COLORS, APPROVAL_STEP_STATUS_COLORS } from '../types';

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
    <div className="border-theme-surface-border bg-theme-surface rounded-lg border p-6">
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
  const { selectedExpenseReport: er, isLoading, error, fetchExpenseReport, submitExpenseReport } = useFinanceStore();

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
        <Breadcrumbs />
        <Link
          to="/finance/expenses"
          className="text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-2 text-sm"
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
        <Breadcrumbs />
        <Link
          to="/finance/expenses"
          className="text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-2 text-sm"
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
      {/* The loading and not-found branches above both render this; the loaded
          page did not — so the trail appeared while the report was fetching
          and vanished the moment it arrived. */}
      <Breadcrumbs />
      <Link
        to="/finance/expenses"
        className="text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-2 text-sm"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Expense Reports
      </Link>

      {error && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      <div className="border-theme-surface-border bg-theme-surface rounded-lg border p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-theme-text-primary text-xl font-bold">{er.title}</h1>
              <span
                className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${EXPENSE_REPORT_STATUS_COLORS[er.status] ?? 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-400'}`}
              >
                {STATUS_LABELS[er.status] ?? er.status}
              </span>
            </div>
            <p className="text-theme-text-secondary mt-1 text-sm">{er.reportNumber}</p>
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
            <p className="text-theme-text-secondary text-xs">Total Amount</p>
            <p className="text-theme-text-primary text-sm font-semibold">{formatCurrency(er.totalAmount)}</p>
          </div>
          <div>
            <p className="text-theme-text-secondary text-xs">Created</p>
            <p className="text-theme-text-primary text-sm">{formatDateTime(er.createdAt, tz)}</p>
          </div>
          {er.approvedAt && (
            <div>
              <p className="text-theme-text-secondary text-xs">Approved</p>
              <p className="text-theme-text-primary text-sm">{formatDateTime(er.approvedAt, tz)}</p>
            </div>
          )}
          {er.paidAt && (
            <div>
              <p className="text-theme-text-secondary text-xs">Paid</p>
              <p className="text-theme-text-primary text-sm">{formatDateTime(er.paidAt, tz)}</p>
            </div>
          )}
          {er.paymentMethod && (
            <div>
              <p className="text-theme-text-secondary text-xs">Payment Method</p>
              <p className="text-theme-text-primary text-sm capitalize">{er.paymentMethod}</p>
            </div>
          )}
        </div>

        {er.description && (
          <div className="border-theme-surface-border mt-4 border-t pt-4">
            <p className="text-theme-text-secondary text-xs font-medium">Description</p>
            <p className="text-theme-text-primary mt-1 text-sm">{er.description}</p>
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
        <div className="border-theme-surface-border bg-theme-surface rounded-lg border p-6">
          <h2 className="text-theme-text-primary mb-4 text-lg font-semibold">Line Items</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-theme-surface-border border-b">
                <tr>
                  <th scope="col" className="text-theme-text-muted px-4 py-2 text-left text-xs uppercase">
                    Description
                  </th>
                  <th scope="col" className="text-theme-text-muted px-4 py-2 text-left text-xs uppercase">
                    Type
                  </th>
                  <th scope="col" className="text-theme-text-muted px-4 py-2 text-right text-xs uppercase">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody className="divide-theme-surface-border divide-y">
                {er.lineItems.map((item) => (
                  <tr key={item.id}>
                    <td className="text-theme-text-primary px-4 py-3 text-sm">{item.description}</td>
                    <td className="text-theme-text-secondary px-4 py-3 text-sm capitalize">
                      {item.expenseType ?? '--'}
                    </td>
                    <td className="text-theme-text-primary px-4 py-3 text-right text-sm">
                      {formatCurrency(item.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-theme-surface-border border-t-2">
                  <td colSpan={2} className="text-theme-text-primary px-4 py-3 text-sm font-semibold">
                    Total
                  </td>
                  <td className="text-theme-text-primary px-4 py-3 text-right text-sm font-semibold">
                    {formatCurrency(er.totalAmount)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Approval Timeline */}
      {er.approvalSteps.length > 0 && (
        <div className="border-theme-surface-border bg-theme-surface rounded-lg border p-6">
          <h2 className="text-theme-text-primary mb-4 text-lg font-semibold">Approval Timeline</h2>
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
                    {!isLast && <div className="bg-theme-surface-border absolute top-8 left-4 h-full w-0.5" />}
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
        </div>
      )}
    </div>
  );
};

export default ExpenseReportDetailPage;
