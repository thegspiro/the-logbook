/**
 * Budget amendments awaiting confirmation — the confirmer's queue.
 *
 * Owner decision, 2026-11-01 ("Email + pending queue"): every amendment and
 * reversal entered and not yet confirmed or rejected, across the department's
 * lines, in one place. The officers who may confirm one — `finance.budget_review`
 * or `finance.manage` holders other than whoever entered it — are also
 * emailed when it is entered, with a link here.
 *
 * Each row names its line and fiscal year, because a reviewer holding only
 * `finance.budget_review` may not be able to open the line itself, and offers
 * Confirm and Reject here. Confirm is hidden on the viewer's own entry, where
 * Reject reads Withdraw; a locked year's row offers neither. The backend
 * enforces each of those rules; the page offers only what it would accept, and
 * re-reads the queue after every decision (CLAUDE.md pitfall #11).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { budgetService } from '../services/api';
import type { PendingBudgetAmendment } from '../types';
import { useAuthStore } from '@/stores/authStore';
import { useConfirm } from '@/contexts/ConfirmContext';
import { PromptDialog } from '@/components/ux/PromptDialog';
import { SkeletonPage } from '@/components/ux/Skeleton';
import { EmptyState } from '@/components/ux/EmptyState';
import { Breadcrumbs } from '@/components/ux/Breadcrumbs';
import { formatCurrency } from '@/utils/currencyFormatting';
import { formatDate, formatDateTime } from '@/utils/dateFormatting';
import { getErrorMessage } from '@/utils/errorHandling';
import { useTimezone } from '@/hooks/useTimezone';

const lineLabel = (row: PendingBudgetAmendment): string => {
  const category = row.categoryName || 'Unknown category';
  return row.stationName ? `${category} · ${row.stationName}` : category;
};

const PendingAmendmentsPage: React.FC = () => {
  const tz = useTimezone();
  const { confirm } = useConfirm();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [rows, setRows] = useState<PendingBudgetAmendment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [rejecting, setRejecting] = useState<PendingBudgetAmendment | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await budgetService.listPendingAmendments());
      setError(null);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not load the pending amendments'));
      setRows((current) => current ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const confirmRow = async (row: PendingBudgetAmendment) => {
    const ok = await confirm({
      title: 'Confirm amendment',
      message: row.isReversal
        ? `This lowers the line's budget by ${formatCurrency(Math.abs(Number(row.amount)))}. Confirm only if the reversal matches what was approved.`
        : `This raises the line's budget by ${formatCurrency(row.amount)}. Confirm only if it matches what ${row.approvedBy} approved.`,
      confirmLabel: 'Confirm amendment',
      cancelLabel: 'Not yet',
      variant: 'warning',
    });
    if (!ok) return;
    setDeciding(true);
    try {
      await budgetService.confirmAmendment(row.budgetId, row.id);
      toast.success('Amendment confirmed');
      void load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not confirm the amendment'));
    } finally {
      setDeciding(false);
    }
  };

  const rejectRow = async (row: PendingBudgetAmendment, note: string) => {
    setDeciding(true);
    try {
      await budgetService.rejectAmendment(row.budgetId, row.id, { note: note.trim() });
      toast.success('Amendment rejected');
      setRejecting(null);
      void load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not reject the amendment'));
    } finally {
      setDeciding(false);
    }
  };

  if (rows === null) return <SkeletonPage />;

  const ownRejecting = rejecting !== null && rejecting.createdBy === currentUserId;

  return (
    <div className="space-y-6">
      <Breadcrumbs />
      <div>
        <h1 className="text-theme-text-primary text-2xl font-bold">Budget amendments awaiting confirmation</h1>
        <p className="text-theme-text-secondary mt-1 text-sm">
          Amendments and reversals move a line&apos;s budget only once a second officer confirms them. Every one still
          waiting is listed here, oldest first.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {rows.length === 0 && !error ? (
        <EmptyState
          icon={CheckCircle2}
          title="No amendments are waiting for confirmation."
          description="When the Treasurer enters an amendment or a reversal, it appears here until a second officer confirms or rejects it."
        />
      ) : (
        <div className="card p-6">
          <ul className="divide-theme-surface-border divide-y" aria-label="Pending amendments">
            {rows.map((row) => {
              const own = Boolean(currentUserId) && row.createdBy === currentUserId;
              const amount = Number(row.amount);
              const label = row.isReversal
                ? `reversal of ${formatCurrency(Math.abs(amount))} on ${lineLabel(row)}`
                : `amendment of +${formatCurrency(row.amount)} on ${lineLabel(row)}`;
              return (
                <li key={row.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold">
                      <Link to={`/finance/budgets/${row.budgetId}`}>{lineLabel(row)}</Link>
                    </p>
                    <span className="text-theme-text-secondary text-sm">{row.fiscalYearName}</span>
                  </div>
                  {row.isReversal ? (
                    <p className="text-theme-text-primary mt-1 text-sm font-semibold">
                      {/* U+2212, the minus sign, not a hyphen. */}
                      {'−'}
                      {formatCurrency(Math.abs(amount))}
                      <span className="text-theme-text-secondary font-normal">
                        {' · '}
                        {row.reversedAmendmentApprovedOn && row.reversedAmendmentAmount != null
                          ? `Reverses the ${formatDate(row.reversedAmendmentApprovedOn, tz)} amendment of +${formatCurrency(row.reversedAmendmentAmount)}`
                          : 'Reverses an earlier amendment'}
                      </span>
                    </p>
                  ) : (
                    <p className="text-theme-text-primary mt-1 text-sm font-semibold">+{formatCurrency(row.amount)}</p>
                  )}
                  <p className="text-theme-text-secondary mt-1 text-sm">
                    Approved {formatDate(row.approvedOn, tz)} by {row.approvedBy}
                  </p>
                  <p className="text-theme-text-primary mt-1 text-sm break-words whitespace-pre-line">{row.reason}</p>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-theme-text-secondary text-xs">
                      Entered by {row.enteredByName || 'a former member'} on {formatDateTime(row.createdAt, tz)}
                    </p>
                    {row.yearLocked ? (
                      <p className="text-theme-text-secondary text-xs">
                        {row.fiscalYearName} is locked; it cannot be confirmed or rejected until the year is unlocked.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {!own && (
                          <button
                            type="button"
                            disabled={deciding}
                            onClick={() => void confirmRow(row)}
                            className="btn-primary btn-sm"
                            aria-label={`Confirm the ${label}`}
                          >
                            Confirm
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={deciding}
                          onClick={() => setRejecting(row)}
                          className="btn-secondary btn-sm"
                          aria-label={`${own ? 'Withdraw' : 'Reject'} the ${label}`}
                        >
                          {own ? 'Withdraw' : 'Reject'}
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <PromptDialog
        isOpen={rejecting !== null}
        onClose={() => setRejecting(null)}
        onSubmit={(note) => {
          if (rejecting) void rejectRow(rejecting, note);
        }}
        title={ownRejecting ? 'Withdraw amendment' : 'Reject amendment'}
        message="The amendment stays on record, marked rejected with this reason, and the budget does not change."
        label="Reason"
        required
        multiline
        hint="Kept with the amendment and in the audit log."
        confirmLabel={ownRejecting ? 'Withdraw' : 'Reject'}
        confirmVariant="warning"
        loading={deciding}
      />
    </div>
  );
};

export default PendingAmendmentsPage;
