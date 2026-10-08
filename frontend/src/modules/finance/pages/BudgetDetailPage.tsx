/**
 * Budget Detail Page
 *
 * Displays detailed information for a single budget including
 * budget info header and transaction history placeholder. A `finance.manage`
 * holder edits the line from here.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router';
import { ArrowLeft, AlertTriangle, DollarSign, FileText, Pencil } from 'lucide-react';
import { useFinanceStore } from '../store/financeStore';
import { useFinanceRequestAccess } from '../hooks/useFinanceRequestAccess';
import { BudgetFormDialog } from '../components/BudgetFormDialog';
import { budgetOwnerLabel } from '../utils/budgetOwnership';
import { formatCurrencyWhole } from '@/utils/currencyFormatting';
import { Skeleton } from '@/components/ux/Skeleton';
import { EmptyState } from '@/components/ux/EmptyState';
import { Breadcrumbs } from '@/components/ux/Breadcrumbs';
import type { Budget } from '../types';

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

      {/* Amounts grid */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <p className="text-theme-text-secondary text-sm">Budgeted</p>
          <p className="text-theme-text-primary text-xl font-bold">
            {formatCurrencyWhole(Number(budget.amountBudgeted))}
          </p>
        </div>
        <div>
          <p className="text-theme-text-secondary text-sm">Spent</p>
          <p className="text-xl font-bold text-blue-600">{formatCurrencyWhole(Number(budget.amountSpent))}</p>
        </div>
        <div>
          <p className="text-theme-text-secondary text-sm">Encumbered</p>
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
            Encumbered
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
  const {
    budgets,
    budgetCategories,
    fiscalYears,
    isLoading,
    error,
    fetchBudgets,
    fetchBudgetCategories,
    fetchFiscalYears,
  } = useFinanceStore();
  const { canManage } = useFinanceRequestAccess();
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    void fetchBudgets();
    void fetchBudgetCategories();
  }, [fetchBudgets, fetchBudgetCategories]);

  useEffect(() => {
    // The edit dialog names the line's fiscal year.
    if (canManage) void fetchFiscalYears();
  }, [canManage, fetchFiscalYears]);

  const budget = useMemo(() => budgets.find((b) => b.id === id), [budgets, id]);

  const categoryName = useMemo(() => {
    if (!budget) return 'Unknown';
    return budgetCategories.find((c) => c.id === budget.categoryId)?.name ?? 'Unknown';
  }, [budget, budgetCategories]);

  if (isLoading && !budget) {
    return (
      <div className="space-y-6">
        <Breadcrumbs />
        <Link
          to="/finance/budgets"
          className="text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-2 text-sm"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Budgets
        </Link>
        <DetailSkeleton />
      </div>
    );
  }

  if (!budget) {
    return (
      <div className="space-y-6">
        <Breadcrumbs />
        <Link
          to="/finance/budgets"
          className="text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-2 text-sm"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Budgets
        </Link>
        <EmptyState
          headingLevel={1}
          icon={DollarSign}
          title="Budget not found"
          description="The budget you are looking for does not exist or has been removed."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Rendered by the loading and not-found branches above too — without it
          here the trail showed while the budget was fetching and disappeared
          when it loaded. */}
      <Breadcrumbs />
      {/* Back link */}
      <Link
        to="/finance/budgets"
        className="text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-2 text-sm"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Budgets
      </Link>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Budget Info Header */}
      <BudgetInfoCard
        budget={budget}
        categoryName={categoryName}
        actions={
          canManage ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="btn-secondary inline-flex shrink-0 items-center gap-2"
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
              Edit
            </button>
          ) : undefined
        }
      />

      {editing && (
        <BudgetFormDialog
          budget={budget}
          fiscalYears={fiscalYears}
          categories={budgetCategories}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            // Re-fetch rather than splice the response in (CLAUDE.md pitfall #11).
            void fetchBudgets();
          }}
        />
      )}

      {/* Transaction History Placeholder */}
      <div className="card p-6">
        <h3 className="text-theme-text-primary mb-4 text-lg font-semibold">Transaction History</h3>
        <EmptyState
          headingLevel={4}
          icon={FileText}
          title="Not available yet"
          description="Individual transactions for this budget aren't listed here yet."
        />
      </div>
    </div>
  );
};

export default BudgetDetailPage;
