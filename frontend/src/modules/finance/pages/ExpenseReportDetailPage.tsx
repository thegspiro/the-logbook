/**
 * Expense Report Detail Page
 *
 * Displays detailed info for a single expense report including
 * line items, approval timeline, and action buttons.
 *
 * Each line carries its receipt. On a draft the requester attaches one per
 * line, and the report cannot be submitted until every line has one (the
 * API refuses; the page says so beside the button). The report's approvers
 * read it here too, receipts included.
 */

import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router';
import {
  ArrowLeft,
  AlertTriangle,
  Receipt,
  Send,
  CheckCircle,
  Clock,
  XCircle,
  Ban,
  CreditCard,
  FileText,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useFinanceStore } from '../store/financeStore';
import { useFinanceRequestAccess } from '../hooks/useFinanceRequestAccess';
import { LateLinesBadge } from '../components/LateLinesBadge';
import { ManualApprovalPanel } from '../components/ManualApprovalPanel';
import { ReceiptControl } from '../components/ReceiptControl';
import { PayByCheckDialog } from '../components/PayByCheckDialog';
import { ExpenseLineDialog } from '../components/ExpenseLineDialog';
import { ApprovalRoutePreview } from '../components/ApprovalRoutePreview';
import { expenseReportService, functionalClassService } from '../services/api';
import { FunctionalClassControl } from '../components/FunctionalClassControl';
import { FundShortfallNotice } from '../components/FundShortfallNotice';
import { Skeleton } from '@/components/ux/Skeleton';
import { EmptyState } from '@/components/ux/EmptyState';
import { Breadcrumbs } from '@/components/ux/Breadcrumbs';
import { formatDateTime } from '@/utils/dateFormatting';
import { useTimezone } from '@/hooks/useTimezone';
import { useSubmitGuard } from '@/hooks/useSubmitGuard';
import { useConfirm } from '@/contexts/ConfirmContext';
import { getErrorMessage } from '@/utils/errorHandling';
import { formatCurrency } from '@/utils/currencyFormatting';
import {
  ApprovalEntityType,
  ExpenseReportStatus,
  EXPENSE_REPORT_STATUS_COLORS,
  APPROVAL_STEP_STATUS_COLORS,
  EXPENSE_TYPE_LABELS,
  type ExpenseLineItem,
} from '../types';
import { ApprovalStepActions } from '../components/ApprovalStepActions';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  denied: 'Denied',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

const CHECK_STATUS_LABELS: Record<string, string> = {
  draft: 'draft',
  submitted: 'submitted',
  pending_approval: 'awaiting approval',
  approved: 'approved, not yet issued',
  issued: 'issued',
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
  </div>
);

const ExpenseReportDetailPage: React.FC = () => {
  const tz = useTimezone();
  const { id } = useParams<{ id: string }>();
  const { busy, run } = useSubmitGuard();
  const { selectedExpenseReport: er, isLoading, error, fetchExpenseReport, submitExpenseReport } = useFinanceStore();
  const access = useFinanceRequestAccess();
  const { confirm } = useConfirm();
  const navigate = useNavigate();
  const [payingByCheck, setPayingByCheck] = useState(false);
  // The line being edited, 'new' while one is being added.
  const [editingLine, setEditingLine] = useState<ExpenseLineItem | 'new' | null>(null);

  useEffect(() => {
    if (id) {
      void fetchExpenseReport(id);
    }
  }, [id, fetchExpenseReport]);

  const handleSubmit = () =>
    run(async () => {
      if (!id) return;
      try {
        await submitExpenseReport(id);
        toast.success('Expense report submitted for approval');
      } catch {
        // Error handled by store
      }
    });

  // POST /expense-reports/{id}/mark-paid existed with no control calling it,
  // so an approved report could never be recorded as reimbursed (W64). The
  // API decides who may (finance.manage, not the submitter) and posts the
  // spending; this only asks, and shows its refusal in its own words.
  const handleMarkPaid = () =>
    run(async () => {
      if (!id || !er) return;
      const ok = await confirm({
        title: 'Mark as paid?',
        message: `Record ${er.reportNumber} (${formatCurrency(er.totalAmount)}) as reimbursed to the member. This cannot be undone from this screen.`,
        confirmLabel: 'Mark as paid',
        cancelLabel: 'Not yet',
        variant: 'warning',
      });
      if (!ok) return;
      try {
        await expenseReportService.markPaid(id);
        toast.success('Marked as paid');
        void fetchExpenseReport(id);
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Could not mark the report as paid'));
      }
    });

  const handleRemoveLine = (item: ExpenseLineItem) =>
    run(async () => {
      if (!id) return;
      const ok = await confirm({
        title: 'Remove this line?',
        message: `"${item.description}" (${formatCurrency(item.amount)}) is taken off the report. Its receipt stays on file.`,
        confirmLabel: 'Remove line',
        cancelLabel: 'Keep it',
        variant: 'danger',
      });
      if (!ok) return;
      try {
        await expenseReportService.deleteLineItem(id, item.id);
        toast.success('Line removed');
        void fetchExpenseReport(id);
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Could not remove the line'));
      }
    });

  // A member withdraws only their own draft; the finance office cancels one
  // further along (FinanceService.cancel_expense_report decides, and says why
  // when it will not).
  const handleCancel = () =>
    run(async () => {
      if (!id || !er) return;
      const withdrawing = er.status === ExpenseReportStatus.DRAFT;
      const ok = await confirm({
        title: withdrawing ? 'Withdraw this report?' : 'Cancel this report?',
        message: withdrawing
          ? `${er.reportNumber} is closed and nobody is asked to approve it. It cannot be reopened; start a new report to claim these expenses later.`
          : `${er.reportNumber} is closed for good: any approval still outstanding is withdrawn and emailed approval links stop working. Nothing has been paid on it, so no budget line changes.`,
        confirmLabel: withdrawing ? 'Withdraw report' : 'Cancel report',
        cancelLabel: 'Keep it',
        variant: 'danger',
      });
      if (!ok) return;
      try {
        await expenseReportService.cancel(id);
        toast.success(withdrawing ? 'Report withdrawn' : 'Report cancelled');
        void fetchExpenseReport(id);
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Could not cancel the report'));
      }
    });

  if (isLoading && !er) {
    return (
      <div className="space-y-6">
        <Breadcrumbs />
        <Link
          to="/finance/expenses"
          className="touch:min-h-11 text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-2 text-sm"
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
          className="touch:min-h-11 text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-2 text-sm"
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

  // A check already paying the report is how it gets paid; the server refuses
  // paying it another way, or by a second check, until that one is denied.
  const paidByLiveCheck = Boolean(er.reimbursementCheckId);
  const canMarkPaid = er.status === ExpenseReportStatus.APPROVED && access.canManage && !paidByLiveCheck;
  const canPayByCheck = canMarkPaid && Number(er.amountOwed ?? er.totalAmount) > 0;
  // Lines change only while the report is a draft, by whoever may submit it.
  const canEditLines = er.status === ExpenseReportStatus.DRAFT && access.canActAsRequester(er.submittedBy);
  const canCancel = access.canManage
    ? (
        [
          ExpenseReportStatus.DRAFT,
          ExpenseReportStatus.SUBMITTED,
          ExpenseReportStatus.PENDING_APPROVAL,
          ExpenseReportStatus.APPROVED,
        ] as string[]
      ).includes(er.status) && !paidByLiveCheck
    : er.status === ExpenseReportStatus.DRAFT && access.canActAsRequester(er.submittedBy);
  // Submitting is the requester's action (or the finance office's).
  const canSubmit = er.status === ExpenseReportStatus.DRAFT && access.canActAsRequester(er.submittedBy);
  // Every line needs an uploaded receipt before the report is submitted;
  // the API refuses otherwise, and this says why beside the button.
  const missingReceipts = er.lineItems.filter((item) => !item.receiptDocumentId).length;
  // Mirrors _ER_RECEIPT_OPEN_TO_REQUESTER / _ER_RECEIPT_CLOSED in
  // backend/app/api/v1/endpoints/finance.py: a requester changes receipts only
  // while the report is editable; the finance office until it is closed out.
  const canAttachReceipt =
    access.canActAsRequester(er.submittedBy) &&
    (access.canManage
      ? er.status !== ExpenseReportStatus.DENIED && er.status !== ExpenseReportStatus.CANCELLED
      : er.status === ExpenseReportStatus.DRAFT || er.status === ExpenseReportStatus.SUBMITTED);

  return (
    <div className="space-y-6">
      {/* The loading and not-found branches above both render this; the loaded
          page did not — so the trail appeared while the report was fetching
          and vanished the moment it arrived. */}
      <Breadcrumbs />
      <Link
        to="/finance/expenses"
        className="touch:min-h-11 text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-2 text-sm"
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

      <div className="card p-6">
        <div className="page-header mb-4 gap-3 sm:items-center">
          <div className="page-header-title">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-theme-text-primary text-xl font-bold">{er.title}</h1>
              <span
                className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${EXPENSE_REPORT_STATUS_COLORS[er.status] ?? 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-400'}`}
              >
                {STATUS_LABELS[er.status] ?? er.status}
              </span>
            </div>
            <p className="text-theme-text-secondary mt-1 text-sm">{er.reportNumber}</p>
          </div>
          <div className="page-header-actions flex flex-wrap items-center gap-2">
            {canSubmit && missingReceipts > 0 && (
              <p id="expense-receipts-needed" className="text-xs text-amber-800 dark:text-amber-300">
                Attach a receipt to {missingReceipts === 1 ? 'the remaining line' : `${String(missingReceipts)} lines`}{' '}
                before submitting.
              </p>
            )}
            {canSubmit && (
              <button
                type="button"
                disabled={busy || missingReceipts > 0}
                aria-describedby={missingReceipts > 0 ? 'expense-receipts-needed' : undefined}
                onClick={() => void handleSubmit()}
                className="touch:min-h-11 inline-flex items-center gap-1.5 rounded-lg bg-red-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" />
                Submit for Approval
              </button>
            )}
            {canPayByCheck && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setPayingByCheck(true)}
                className="touch:min-h-11 inline-flex items-center gap-1.5 rounded-lg bg-red-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                Pay by Check
              </button>
            )}
            {canMarkPaid && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleMarkPaid()}
                className="touch:min-h-11 inline-flex items-center gap-1.5 rounded-lg bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <CreditCard className="h-3.5 w-3.5" aria-hidden="true" />
                Mark Paid
              </button>
            )}
            {canCancel && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleCancel()}
                className="touch:min-h-11 inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-500/10"
              >
                <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                {er.status === ExpenseReportStatus.DRAFT ? 'Withdraw Report' : 'Cancel Report'}
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
          {er.qbExportedAt && (
            <div>
              <p className="text-theme-text-secondary text-xs">Sent to QuickBooks</p>
              <p className="text-theme-text-primary text-sm">{formatDateTime(er.qbExportedAt, tz)}</p>
            </div>
          )}
          {er.purchaseRequestId && (
            <div>
              <p className="text-theme-text-secondary text-xs">Claims back purchase</p>
              <p className="text-theme-text-primary text-sm">
                <Link
                  to={`/finance/purchase-requests/${er.purchaseRequestId}`}
                  className="font-medium text-red-700 hover:underline dark:text-red-400"
                >
                  {er.purchaseRequestNumber ?? 'Purchase request'}
                </Link>
              </p>
            </div>
          )}
          {er.reimbursementCheckId && (
            <div>
              <p className="text-theme-text-secondary text-xs">Reimbursement check</p>
              <p className="text-theme-text-primary text-sm">
                <Link
                  to={`/finance/check-requests/${er.reimbursementCheckId}`}
                  className="font-medium text-red-700 hover:underline dark:text-red-400"
                >
                  {er.reimbursementCheckNumber ?? 'Check request'}
                </Link>
                {er.reimbursementCheckStatus && (
                  <span className="text-theme-text-secondary">
                    {' '}
                    ({CHECK_STATUS_LABELS[er.reimbursementCheckStatus] ?? er.reimbursementCheckStatus})
                  </span>
                )}
              </p>
            </div>
          )}
          {er.advanceId && (
            <div>
              <p className="text-theme-text-secondary text-xs">Accounts for cash advance</p>
              <p className="text-theme-text-primary text-sm">
                <Link
                  to={`/finance/check-requests/${er.advanceId}`}
                  className="text-red-700 hover:underline dark:text-red-400"
                >
                  View the advance
                </Link>
              </p>
              <p className="text-theme-text-secondary text-xs">
                {er.advanceApplied != null
                  ? `${formatCurrency(er.advanceApplied)} of this report is covered by the advance; the rest is reimbursed`
                  : 'How much the advance covers is fixed when the report is submitted'}
              </p>
            </div>
          )}
        </div>

        {er.description && (
          <div className="border-theme-surface-border mt-4 border-t pt-4">
            <p className="text-theme-text-secondary text-xs font-medium">Description</p>
            <p className="text-theme-text-primary mt-1 text-sm">{er.description}</p>
          </div>
        )}

        {(er.lateLineCount ?? 0) > 0 && (
          <div className="alert-warning mt-4">
            <p className="text-theme-alert-warning-title text-sm font-medium">
              {er.lateLineCount === 1
                ? '1 line was submitted after the department’s deadline for claiming expenses.'
                : `${er.lateLineCount} lines were submitted after the department’s deadline for claiming expenses.`}
            </p>
            <p className="text-theme-alert-warning-text mt-0.5 text-sm">
              Reimbursing late expenses falls outside the accountable plan, so the department may have to report them as
              taxable pay.{' '}
              {er.lateAcknowledgedAt
                ? `An approver confirmed reviewing them on ${formatDateTime(er.lateAcknowledgedAt, tz)}.`
                : 'An approver has to confirm reviewing them before the report is approved.'}
            </p>
          </div>
        )}

        <FundShortfallNotice shortfall={er.fundShortfall} />

        {er.denialReason && (
          <div className="alert-danger mt-4">
            <p className="text-theme-alert-danger-title text-xs font-medium">Denial Reason</p>
            <p className="text-theme-alert-danger-text mt-0.5 text-sm">{er.denialReason}</p>
          </div>
        )}
      </div>

      {/* Line Items */}
      {(er.lineItems.length > 0 || canEditLines) && (
        <div className="card p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-theme-text-primary text-lg font-semibold">Line Items</h2>
            {canEditLines && (
              <button
                type="button"
                className="btn-secondary inline-flex items-center gap-2"
                onClick={() => setEditingLine('new')}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add line
              </button>
            )}
          </div>
          {er.lineItems.length === 0 && (
            <p className="text-theme-text-secondary text-sm">
              No lines yet. Add one, with its receipt, before submitting the report.
            </p>
          )}
          {er.lineItems.length > 0 && (
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
                    <th scope="col" className="text-theme-text-muted px-4 py-2 text-left text-xs uppercase">
                      Receipt
                    </th>
                    <th scope="col" className="text-theme-text-muted px-4 py-2 text-right text-xs uppercase">
                      Amount
                    </th>
                    {canEditLines && (
                      <th scope="col" className="px-4 py-2">
                        <span className="sr-only">Actions</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-theme-surface-border divide-y">
                  {er.lineItems.map((item) => (
                    <tr key={item.id}>
                      <td className="text-theme-text-primary px-4 py-3 text-sm">
                        {item.description}
                        {item.substantiatedLate && (
                          <div className="mt-1">
                            <LateLinesBadge />
                          </div>
                        )}
                        {item.fundName && (
                          <p className="text-theme-text-secondary mt-1 text-xs">Restricted fund: {item.fundName}</p>
                        )}
                      </td>
                      <td className="text-theme-text-secondary px-4 py-3 text-sm">
                        <span className="capitalize">
                          {item.expenseType ? (EXPENSE_TYPE_LABELS[item.expenseType] ?? item.expenseType) : '--'}
                        </span>
                        <div className="mt-1">
                          <FunctionalClassControl
                            compact
                            value={item.functionalClass}
                            effective={item.effectiveFunctionalClass}
                            subject={item.description}
                            onChange={async (next) => {
                              await functionalClassService.setExpenseLine(er.id, item.id, next);
                              await fetchExpenseReport(er.id);
                            }}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {canAttachReceipt || item.receiptFileUrl || item.receiptUrl ? (
                          <ReceiptControl
                            subject={item.description}
                            receiptFileUrl={item.receiptFileUrl}
                            receiptUrl={item.receiptUrl}
                            canAttach={canAttachReceipt}
                            onUpload={async (file) => {
                              await expenseReportService.uploadLineItemReceipt(er.id, item.id, file);
                              await fetchExpenseReport(er.id);
                            }}
                            onDownload={() => expenseReportService.downloadLineItemReceipt(er.id, item.id)}
                          />
                        ) : (
                          <span className="text-theme-text-muted">--</span>
                        )}
                      </td>
                      <td className="text-theme-text-primary px-4 py-3 text-right text-sm">
                        {formatCurrency(item.amount)}
                      </td>
                      {canEditLines && (
                        <td className="px-2 py-3 text-right whitespace-nowrap">
                          <button
                            type="button"
                            className="btn-icon text-theme-text-secondary hover:text-theme-text-primary"
                            aria-label={`Edit line: ${item.description}`}
                            onClick={() => setEditingLine(item)}
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            className="btn-icon text-theme-text-secondary hover:text-red-700"
                            aria-label={`Remove line: ${item.description}`}
                            onClick={() => void handleRemoveLine(item)}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-theme-surface-border border-t-2">
                    <td colSpan={3} className="text-theme-text-primary px-4 py-3 text-sm font-semibold">
                      Total
                    </td>
                    <td className="text-theme-text-primary px-4 py-3 text-right text-sm font-semibold">
                      {formatCurrency(er.totalAmount)}
                    </td>
                    {canEditLines && <td />}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      <ManualApprovalPanel
        entityType={ApprovalEntityType.EXPENSE_REPORT}
        entityId={er.id}
        status={er.status}
        approvalStepCount={er.approvalSteps.length}
        awaitingSecondApproval={er.awaitingSecondApproval}
        firstApprovedBy={er.firstApprovedBy}
        lateLineCount={er.lateLineCount}
        awaitingLateAcknowledgement={er.awaitingLateAcknowledgement}
        requesterId={er.submittedBy}
        onDecided={() => void fetchExpenseReport(er.id)}
      />

      {er.status === ExpenseReportStatus.DRAFT && (
        <div className="card p-6">
          <ApprovalRoutePreview entityType={ApprovalEntityType.EXPENSE_REPORT} amount={Number(er.totalAmount)} />
        </div>
      )}

      {/* Approval Timeline */}
      {er.approvalSteps.length > 0 && (
        <div className="card p-6">
          <h2 className="text-theme-text-primary mb-4 text-lg font-semibold">Approval Timeline</h2>
          <ApprovalStepActions
            isPendingApproval={er.status === ExpenseReportStatus.PENDING_APPROVAL}
            steps={er.approvalSteps}
            subject={`${er.title} (${er.reportNumber})`}
            onDecided={() => void fetchExpenseReport(er.id)}
            lateLines={er.lateLineCount}
          />
          <div className="space-y-0">
            {[...er.approvalSteps]
              .sort((a, b) => (a.stepOrder ?? 0) - (b.stepOrder ?? 0))
              .map((step, idx, arr) => {
                const isLast = idx === arr.length - 1;
                const iconColor =
                  step.status === 'approved' || step.status === 'auto_approved'
                    ? 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400'
                    : step.status === 'denied'
                      ? 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400'
                      : step.status === 'pending'
                        ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400'
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
        </div>
      )}

      {editingLine && (
        <ExpenseLineDialog
          reportId={er.id}
          line={editingLine === 'new' ? undefined : editingLine}
          onClose={() => setEditingLine(null)}
          onSaved={() => {
            setEditingLine(null);
            void fetchExpenseReport(er.id);
          }}
        />
      )}

      {payingByCheck && (
        <PayByCheckDialog
          report={er}
          onClose={() => setPayingByCheck(false)}
          onRequested={(check) => {
            setPayingByCheck(false);
            void navigate(`/finance/check-requests/${check.id}`);
          }}
        />
      )}
    </div>
  );
};

export default ExpenseReportDetailPage;
