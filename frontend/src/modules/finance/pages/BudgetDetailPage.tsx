/**
 * Budget Detail Page
 *
 * Displays detailed information for a single budget line: the info header,
 * its amendments and the transactions that moved its totals. A
 * `finance.manage` holder edits the line and records amendments from here.
 *
 * Opens to `finance.view` and to the line's owner (the member holding its
 * owner position, or its category's), read-only for the owner. The line is
 * loaded by id — `GET /finance/budgets/{id}`, which applies that rule and is a
 * 404 to anyone else — rather than found in the budget list, which an owner
 * without `finance.view` cannot fetch.
 *
 * An amendment is extra money leadership approved for the line. It is entered
 * pending and moves nothing until a second officer confirms it here: a
 * `finance.budget_review` or `finance.manage` holder other than whoever
 * entered it (the backend enforces both; this page only hides the button it
 * would refuse). Once confirmed, the backend raises `amountBudgeted` by it and
 * reports the original (`originalAmount`); this page shows both rather than
 * working either out (CLAUDE.md pitfall #29).
 * A mistaken amendment is corrected by a reversing entry, never edited: the
 * backend reports which rows are reversals and which are reversed, and this
 * page only renders that.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router';
import { ArrowLeft, AlertTriangle, DollarSign, Pencil, Plus } from 'lucide-react';
import { useFinanceStore } from '../store/financeStore';
import { useFinanceRequestAccess } from '../hooks/useFinanceRequestAccess';
import { useAuthStore } from '@/stores/authStore';
import { BudgetFormDialog } from '../components/BudgetFormDialog';
import { AmendmentDialog } from '../components/AmendmentDialog';
import { ReverseAmendmentDialog } from '../components/ReverseAmendmentDialog';
import { BudgetTransactionList } from '../components/BudgetTransactionList';
import { budgetService } from '../services/api';
import { budgetOwnerLabel } from '../utils/budgetOwnership';
import { formatCurrency, formatCurrencyWhole } from '@/utils/currencyFormatting';
import { formatDate, formatDateTime } from '@/utils/dateFormatting';
import { getErrorMessage, toAppError } from '@/utils/errorHandling';
import { useConfirm } from '@/contexts/ConfirmContext';
import { PromptDialog } from '@/components/ux/PromptDialog';
import toast from 'react-hot-toast';
import { useTimezone } from '@/hooks/useTimezone';
import { Skeleton } from '@/components/ux/Skeleton';
import { EmptyState } from '@/components/ux/EmptyState';
import { Breadcrumbs } from '@/components/ux/Breadcrumbs';
import { BudgetAmendmentStatus } from '../types';
import type { Budget, BudgetAmendment } from '../types';

// =============================================================================
// Budget Info Card
// =============================================================================

interface BudgetInfoProps {
  budget: Budget;
  categoryName: string;
  /** Rendered beside the title — the Edit button, for a finance manager. */
  actions?: React.ReactNode;
}

const BudgetInfoCard: React.FC<BudgetInfoProps> = ({ budget, categoryName, actions }) => {
  const amendmentCount = budget.amendmentCount ?? 0;
  const pendingCount = budget.pendingAmendmentCount ?? 0;
  const amended = amendmentCount > 0;
  const remaining = Number(budget.amountBudgeted) - Number(budget.amountSpent) - Number(budget.amountEncumbered);
  const pctUsed =
    Number(budget.amountBudgeted) > 0
      ? ((Number(budget.amountSpent) + Number(budget.amountEncumbered)) / Number(budget.amountBudgeted)) * 100
      : 0;
  const spentPct =
    Number(budget.amountBudgeted) > 0
      ? Math.min((Number(budget.amountSpent) / Number(budget.amountBudgeted)) * 100, 100)
      : 0;
  const encPct =
    Number(budget.amountBudgeted) > 0
      ? Math.min((Number(budget.amountEncumbered) / Number(budget.amountBudgeted)) * 100, 100 - spentPct)
      : 0;

  return (
    <div className="card p-6">
      <div className="mb-4 flex items-start gap-3">
        <div className="rounded-lg bg-green-100 p-2 dark:bg-green-500/20">
          <DollarSign className="h-5 w-5 text-green-600" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-theme-text-primary text-lg font-semibold">{categoryName}</h2>
          {budget.notes && <p className="text-theme-text-secondary text-sm">{budget.notes}</p>}
        </div>
        {actions}
      </div>

      <dl className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-theme-text-secondary text-sm">Station</dt>
          <dd className="text-theme-text-primary text-sm font-medium">
            {budget.stationId ? budget.stationName || 'Unknown station' : 'Department-wide'}
          </dd>
        </div>
        <div>
          <dt className="text-theme-text-secondary text-sm">Owner</dt>
          <dd className="text-theme-text-primary text-sm font-medium">{budgetOwnerLabel(budget)}</dd>
        </div>
      </dl>

      {amended && (
        <dl className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-theme-text-secondary text-sm">Original budget</dt>
            <dd className="text-theme-text-primary text-sm font-medium">{formatCurrency(budget.originalAmount)}</dd>
          </div>
          <div>
            <dt className="text-theme-text-secondary text-sm">Current budget</dt>
            <dd className="text-theme-text-primary text-sm font-medium">{formatCurrency(budget.amountBudgeted)}</dd>
          </div>
          <div>
            <dt className="text-theme-text-secondary text-sm">Amendments</dt>
            <dd className="text-theme-text-primary text-sm font-medium">
              +{formatCurrency(budget.amendmentsTotal)} ({String(amendmentCount)})
            </dd>
          </div>
        </dl>
      )}

      {pendingCount > 0 && (
        <p className="alert-warning mb-6 text-sm" role="status">
          {pendingCount === 1
            ? '1 amendment is awaiting confirmation by a second officer and is not yet in these figures.'
            : `${String(pendingCount)} amendments are awaiting confirmation by a second officer and are not yet in these figures.`}
        </p>
      )}

      {/* Amounts grid */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <p className="text-theme-text-secondary text-sm">{amended ? 'Current budget' : 'Budgeted'}</p>
          <p className="text-theme-text-primary text-xl font-bold">
            {formatCurrencyWhole(Number(budget.amountBudgeted))}
          </p>
        </div>
        <div>
          <p className="text-theme-text-secondary text-sm">Spent</p>
          <p className="text-xl font-bold text-blue-600">{formatCurrencyWhole(Number(budget.amountSpent))}</p>
        </div>
        <div>
          <p className="text-theme-text-secondary text-sm">Committed</p>
          <p className="text-xl font-bold text-yellow-600">{formatCurrencyWhole(Number(budget.amountEncumbered))}</p>
        </div>
        <div>
          <p className="text-theme-text-secondary text-sm">Remaining</p>
          <p className={`text-xl font-bold ${remaining < 0 ? 'text-red-600' : 'text-green-600'}`}>
            {formatCurrencyWhole(remaining)}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div>
        <div className="mb-1 flex items-center justify-between text-sm">
          <span className="text-theme-text-secondary">{pctUsed.toFixed(1)}% used</span>
          {pctUsed > 90 && (
            <span className="font-medium text-red-600">{pctUsed > 100 ? 'Over budget' : 'Near limit'}</span>
          )}
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
          <div className="flex h-full">
            <div className="h-full bg-blue-500 transition-all" style={{ width: `${String(spentPct)}%` }} />
            <div className="h-full bg-yellow-400 transition-all" style={{ width: `${String(encPct)}%` }} />
          </div>
        </div>
        <div className="text-theme-text-secondary mt-2 flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
            Spent
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-yellow-400" />
            Committed
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-gray-200 dark:bg-gray-600" />
            Remaining
          </span>
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// Amendments
// =============================================================================

interface AmendmentListProps {
  amendments: BudgetAmendment[];
  loading: boolean;
  error: string | null;
  /** Offered only to a finance manager, and only while the year is unlocked. */
  onReverse?: ((amendment: BudgetAmendment) => void) | undefined;
  /**
   * Offered to a budget reviewer or finance manager while the year is
   * unlocked. Confirm is hidden on the viewer's own entries; reject is not,
   * since withdrawing one's own mistaken entry is how it is taken back.
   */
  onConfirm?: ((amendment: BudgetAmendment) => void) | undefined;
  onReject?: ((amendment: BudgetAmendment) => void) | undefined;
  currentUserId?: string | undefined;
}

const statusOf = (a: BudgetAmendment): BudgetAmendmentStatus => a.status ?? BudgetAmendmentStatus.CONFIRMED;

const AmendmentList: React.FC<AmendmentListProps> = ({
  amendments,
  loading,
  error,
  onReverse,
  onConfirm,
  onReject,
  currentUserId,
}) => {
  const tz = useTimezone();
  const byId = new Map(amendments.map((a) => [a.id, a]));
  let body: React.ReactNode;
  if (error) {
    body = <p className="text-sm text-red-700 dark:text-red-400">{error}</p>;
  } else if (loading && amendments.length === 0) {
    body = <Skeleton className="h-10 w-full" />;
  } else if (amendments.length === 0) {
    body = <p className="text-theme-text-secondary text-sm">No amendments have been recorded for this line.</p>;
  } else {
    body = (
      <ul className="divide-theme-surface-border divide-y" aria-label="Amendments">
        {amendments.map((a) => {
          const status = statusOf(a);
          const pending = status === BudgetAmendmentStatus.PENDING;
          const rejected = status === BudgetAmendmentStatus.REJECTED;
          const reversalPending = a.reversalStatus === BudgetAmendmentStatus.PENDING;
          // Struck through only once the reversal is confirmed and has moved the budget.
          const reversed = Boolean(a.reversedByAmendmentId) && !reversalPending;
          const original = a.reversesAmendmentId ? byId.get(a.reversesAmendmentId) : undefined;
          const ownEntry = Boolean(currentUserId) && a.createdBy === currentUserId;
          const label = a.isReversal
            ? `reversal of ${formatCurrency(Math.abs(Number(a.amount)))}`
            : `${formatDate(a.approvedOn, tz)} amendment of +${formatCurrency(a.amount)}`;
          return (
            <li key={a.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                {a.isReversal ? (
                  <p className="text-theme-text-primary text-sm font-semibold">
                    {/* U+2212, the minus sign, not a hyphen. */}
                    {'\u2212'}
                    {formatCurrency(Math.abs(Number(a.amount)))}
                    <span className="text-theme-text-secondary font-normal">
                      {' · '}
                      {original
                        ? `Reverses the ${formatDate(original.approvedOn, tz)} amendment of +${formatCurrency(original.amount)}`
                        : 'Reverses an earlier amendment'}
                    </span>
                  </p>
                ) : (
                  <p
                    className={`text-sm font-semibold ${
                      reversed || rejected ? 'text-theme-text-secondary line-through' : 'text-theme-text-primary'
                    }`}
                  >
                    +{formatCurrency(a.amount)}
                  </p>
                )}
                {pending && (
                  <span className="badge bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-white">
                    Pending confirmation
                  </span>
                )}
                {rejected && <span className="badge bg-theme-surface-secondary text-theme-text-primary">Rejected</span>}
                <p className="text-theme-text-secondary text-sm">
                  Approved {formatDate(a.approvedOn, tz)} by {a.approvedBy}
                </p>
              </div>
              {reversed && (
                <p className="text-theme-text-secondary mt-1 text-sm font-medium">
                  Reversed {formatDate(a.reversedAt, tz)} by {a.reversedByName || 'a former member'}
                </p>
              )}
              {reversalPending && (
                <p className="text-theme-text-secondary mt-1 text-sm font-medium">
                  Reversal entered {formatDate(a.reversedAt, tz)} by {a.reversedByName || 'a former member'}, awaiting
                  confirmation
                </p>
              )}
              {status === BudgetAmendmentStatus.CONFIRMED && a.decidedAt && (
                <p className="text-theme-text-secondary mt-1 text-sm">
                  Confirmed {formatDate(a.decidedAt, tz)} by {a.decidedByName || 'a former member'}
                </p>
              )}
              {rejected && (
                <p className="text-theme-text-secondary mt-1 text-sm break-words whitespace-pre-line">
                  Rejected {formatDate(a.decidedAt, tz)} by {a.decidedByName || 'a former member'}
                  {a.decisionNote ? `: ${a.decisionNote}` : ''}
                </p>
              )}
              <p className="text-theme-text-primary mt-1 text-sm break-words whitespace-pre-line">{a.reason}</p>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                <p className="text-theme-text-secondary text-xs">
                  Entered by {a.enteredByName || 'a former member'} on {formatDateTime(a.createdAt, tz)}
                </p>
                {pending && (onConfirm || onReject) && (
                  <div className="flex flex-wrap gap-2">
                    {onConfirm && !ownEntry && (
                      <button
                        type="button"
                        onClick={() => onConfirm(a)}
                        className="btn-primary btn-sm"
                        aria-label={`Confirm the ${label}`}
                      >
                        Confirm
                      </button>
                    )}
                    {onReject && (
                      <button
                        type="button"
                        onClick={() => onReject(a)}
                        className="btn-secondary btn-sm"
                        aria-label={`${ownEntry ? 'Withdraw' : 'Reject'} the ${label}`}
                      >
                        {ownEntry ? 'Withdraw' : 'Reject'}
                      </button>
                    )}
                  </div>
                )}
                {onReverse &&
                  status === BudgetAmendmentStatus.CONFIRMED &&
                  !a.isReversal &&
                  !a.reversedByAmendmentId && (
                    <button
                      type="button"
                      onClick={() => onReverse(a)}
                      className="btn-secondary btn-sm"
                      // Every row has one; the name says which amendment it reverses.
                      aria-label={`Reverse the ${formatDate(a.approvedOn, tz)} amendment of +${formatCurrency(a.amount)}`}
                    >
                      Reverse
                    </button>
                  )}
              </div>
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <div className="card p-6">
      <h3 className="text-theme-text-primary mb-4 text-lg font-semibold">Amendments</h3>
      {body}
    </div>
  );
};

// =============================================================================
// Loading Skeleton
// =============================================================================

const DetailSkeleton: React.FC = () => (
  <div className="space-y-6" aria-label="Loading budget details" role="status" aria-live="polite">
    <span className="sr-only">Loading...</span>
    <div className="card p-6">
      <div className="mb-4 flex items-center gap-3">
        <Skeleton className="h-10 w-10" rounded="lg" />
        <div className="space-y-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-3 w-32" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={`amt-${String(i)}`} className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-24" />
          </div>
        ))}
      </div>
      <Skeleton className="mt-6 h-3 w-full" />
    </div>
    <div className="card p-6">
      <Skeleton className="mb-4 h-5 w-40" />
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={`row-${String(i)}`} className="mb-3 h-10 w-full" />
      ))}
    </div>
  </div>
);

// =============================================================================
// Main Page Component
// =============================================================================

const BudgetDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { budgetCategories, fiscalYears, fetchBudgetCategories, fetchFiscalYears } = useFinanceStore();
  const { canManage, seesAllRequests, seesAllExpenseReports } = useFinanceRequestAccess();
  // finance.view lists every line; without it the member reached this line as
  // its owner, so the way back is their own list.
  const seesAllBudgets = useAuthStore((s) => s.checkPermission('finance.view'));
  // The second officer: whoever may confirm or reject a pending amendment.
  const canDecide = useAuthStore(
    (s) => s.checkPermission('finance.budget_review') || s.checkPermission('finance.manage')
  );
  const currentUserId = useAuthStore((s) => s.user?.id);
  const { confirm } = useConfirm();
  const [rejecting, setRejecting] = useState<BudgetAmendment | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [amending, setAmending] = useState(false);
  const [reversing, setReversing] = useState<BudgetAmendment | null>(null);
  const [amendments, setAmendments] = useState<BudgetAmendment[]>([]);
  const [amendmentsLoading, setAmendmentsLoading] = useState(false);
  const [amendmentsError, setAmendmentsError] = useState<string | null>(null);
  // Bumped after an edit or amendment so the transaction list re-reads too.
  const [revision, setRevision] = useState(0);

  const loadBudget = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      setBudget(await budgetService.get(id));
      setLoadError(null);
    } catch (err: unknown) {
      setBudget(null);
      // A 404 is the API's answer for a line that is not there or not the
      // caller's to read; anything else is a failure worth naming.
      setLoadError(toAppError(err).status === 404 ? null : getErrorMessage(err, 'Could not load the budget line'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadAmendments = useCallback(async () => {
    if (!id) return;
    setAmendmentsLoading(true);
    try {
      setAmendments(await budgetService.listAmendments(id));
      setAmendmentsError(null);
    } catch (err: unknown) {
      setAmendmentsError(getErrorMessage(err, 'Could not load the amendments'));
    } finally {
      setAmendmentsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadBudget();
  }, [loadBudget]);

  useEffect(() => {
    void loadAmendments();
  }, [loadAmendments]);

  useEffect(() => {
    // The edit dialog names the line's fiscal year and category; only a
    // finance manager opens it, and only they can list either.
    if (!canManage) return;
    void fetchFiscalYears();
    void fetchBudgetCategories();
  }, [canManage, fetchFiscalYears, fetchBudgetCategories]);

  const reload = () => {
    // Re-fetch rather than splice the response in (CLAUDE.md pitfall #11).
    void loadBudget();
    void loadAmendments();
    setRevision((r) => r + 1);
  };

  const confirmAmendment = async (amendment: BudgetAmendment) => {
    if (!id) return;
    const ok = await confirm({
      title: 'Confirm amendment',
      message: amendment.isReversal
        ? `This lowers the line's budget by ${formatCurrency(Math.abs(Number(amendment.amount)))}. Confirm only if the reversal matches what was approved.`
        : `This raises the line's budget by ${formatCurrency(amendment.amount)}. Confirm only if it matches what ${amendment.approvedBy} approved.`,
      confirmLabel: 'Confirm amendment',
      cancelLabel: 'Not yet',
      variant: 'warning',
    });
    if (!ok) return;
    setDeciding(true);
    try {
      await budgetService.confirmAmendment(id, amendment.id);
      toast.success('Amendment confirmed');
      reload();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not confirm the amendment'));
    } finally {
      setDeciding(false);
    }
  };

  const rejectAmendment = async (amendment: BudgetAmendment, note: string) => {
    if (!id) return;
    setDeciding(true);
    try {
      await budgetService.rejectAmendment(id, amendment.id, { note: note.trim() });
      toast.success('Amendment rejected');
      setRejecting(null);
      reload();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not reject the amendment'));
    } finally {
      setDeciding(false);
    }
  };

  const backLink = seesAllBudgets ? (
    <Link
      to="/finance/budgets"
      className="text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-2 text-sm"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to Budgets
    </Link>
  ) : (
    <Link
      to="/finance/my-budgets"
      className="text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-2 text-sm"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to My Budgets
    </Link>
  );

  if (loading && !budget) {
    return (
      <div className="space-y-6">
        <Breadcrumbs />
        {backLink}
        <DetailSkeleton />
      </div>
    );
  }

  if (!budget) {
    return (
      <div className="space-y-6">
        <Breadcrumbs />
        {backLink}
        {loadError ? (
          <div
            role="alert"
            className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <p>{loadError}</p>
          </div>
        ) : (
          <EmptyState
            headingLevel={1}
            icon={DollarSign}
            title="Budget not found"
            description="The budget you are looking for does not exist, has been removed, or is not one of yours."
          />
        )}
      </div>
    );
  }

  const categoryName = budget.categoryName || 'Unknown category';
  // A locked year takes no amendments or reversals; the backend refuses
  // either regardless.
  const yearLocked = fiscalYears.some((fy) => fy.id === budget.fiscalYearId && fy.isLocked);

  return (
    <div className="space-y-6">
      {/* Rendered by the loading and not-found branches above too — without it
          here the trail showed while the budget was fetching and disappeared
          when it loaded. */}
      <Breadcrumbs />
      {backLink}

      {/* Budget Info Header */}
      <BudgetInfoCard
        budget={budget}
        categoryName={categoryName}
        actions={
          canManage ? (
            <div className="flex shrink-0 flex-wrap justify-end gap-2">
              {!yearLocked && (
                <button
                  type="button"
                  onClick={() => setAmending(true)}
                  className="btn-secondary inline-flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add amendment
                </button>
              )}
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="btn-secondary inline-flex items-center gap-2"
              >
                <Pencil className="h-4 w-4" aria-hidden="true" />
                Edit
              </button>
            </div>
          ) : undefined
        }
      />

      {amending && (
        <AmendmentDialog
          budgetId={budget.id}
          lineName={categoryName}
          onClose={() => setAmending(false)}
          onSaved={() => {
            setAmending(false);
            reload();
          }}
        />
      )}

      {reversing && (
        <ReverseAmendmentDialog
          budgetId={budget.id}
          amendment={reversing}
          onClose={() => setReversing(null)}
          onSaved={() => {
            setReversing(null);
            reload();
          }}
        />
      )}

      {editing && (
        <BudgetFormDialog
          budget={budget}
          fiscalYears={fiscalYears}
          categories={budgetCategories}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
        />
      )}

      <AmendmentList
        amendments={amendments}
        loading={amendmentsLoading}
        error={amendmentsError}
        // Owners read the list too (#3010) but never reverse; a locked year
        // takes no reversal, and the backend refuses one regardless.
        onReverse={canManage && !yearLocked ? setReversing : undefined}
        onConfirm={canDecide && !yearLocked && !deciding ? (a) => void confirmAmendment(a) : undefined}
        onReject={canDecide && !yearLocked && !deciding ? setRejecting : undefined}
        currentUserId={currentUserId}
      />

      <PromptDialog
        isOpen={rejecting !== null}
        onClose={() => setRejecting(null)}
        onSubmit={(note) => {
          if (rejecting) void rejectAmendment(rejecting, note);
        }}
        title={rejecting && rejecting.createdBy === currentUserId ? 'Withdraw amendment' : 'Reject amendment'}
        message="The amendment stays on record, marked rejected with this reason, and the budget does not change."
        label="Reason"
        required
        multiline
        hint="Kept with the amendment and in the audit log."
        confirmLabel={rejecting && rejecting.createdBy === currentUserId ? 'Withdraw' : 'Reject'}
        confirmVariant="warning"
        loading={deciding}
      />

      <BudgetTransactionList
        budgetId={budget.id}
        revision={revision}
        linkRequests={seesAllRequests}
        linkExpenseReports={seesAllExpenseReports}
      />
    </div>
  );
};

export default BudgetDetailPage;
