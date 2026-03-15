/**
 * Budget Detail Page
 *
 * Displays detailed information for a single budget including
 * budget info header and transaction history placeholder.
 */

import React, { useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, AlertTriangle, DollarSign, FileText } from 'lucide-react';
import { useFinanceStore } from '../store/financeStore';
import { formatCurrencyWhole } from '@/utils/currencyFormatting';
import { Skeleton } from '@/components/ux/Skeleton';
import { EmptyState } from '@/components/ux/EmptyState';
import type { Budget } from '../types';

// =============================================================================
// Budget Info Card
// =============================================================================

interface BudgetInfoProps {
  budget: Budget;
  categoryName: string;
}

const BudgetInfoCard: React.FC<BudgetInfoProps> = ({
  budget,
  categoryName,
}) => {
  const remaining =
    budget.amountBudgeted - budget.amountSpent - budget.amountEncumbered;
  const pctUsed =
    budget.amountBudgeted > 0
      ? ((budget.amountSpent + budget.amountEncumbered) /
          budget.amountBudgeted) *
        100
      : 0;
  const spentPct =
    budget.amountBudgeted > 0
      ? Math.min((budget.amountSpent / budget.amountBudgeted) * 100, 100)
      : 0;
  const encPct =
    budget.amountBudgeted > 0
      ? Math.min(
          (budget.amountEncumbered / budget.amountBudgeted) * 100,
          100 - spentPct,
        )
      : 0;

  return (
    <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-6">
      <div className="mb-4 flex items-center gap-3">
        <div className="rounded-lg bg-green-100 p-2">
          <DollarSign className="h-5 w-5 text-green-600" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-theme-text-primary">
            {categoryName}
          </h2>
          {budget.notes && (
            <p className="text-sm text-theme-text-secondary">{budget.notes}</p>
          )}
        </div>
      </div>

      {/* Amounts grid */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <p className="text-sm text-theme-text-secondary">Budgeted</p>
          <p className="text-xl font-bold text-theme-text-primary">
            {formatCurrencyWhole(budget.amountBudgeted)}
          </p>
        </div>
        <div>
          <p className="text-sm text-theme-text-secondary">Spent</p>
          <p className="text-xl font-bold text-blue-600">
            {formatCurrencyWhole(budget.amountSpent)}
          </p>
        </div>
        <div>
          <p className="text-sm text-theme-text-secondary">Encumbered</p>
          <p className="text-xl font-bold text-yellow-600">
            {formatCurrencyWhole(budget.amountEncumbered)}
          </p>
        </div>
        <div>
          <p className="text-sm text-theme-text-secondary">Remaining</p>
          <p
            className={`text-xl font-bold ${remaining < 0 ? 'text-red-600' : 'text-green-600'}`}
          >
            {formatCurrencyWhole(remaining)}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div>
        <div className="mb-1 flex items-center justify-between text-sm">
          <span className="text-theme-text-secondary">
            {pctUsed.toFixed(1)}% utilized
          </span>
          {pctUsed > 90 && (
            <span className="font-medium text-red-600">
              {pctUsed > 100 ? 'Over budget' : 'Near limit'}
            </span>
          )}
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
          <div className="flex h-full">
            <div
              className="h-full bg-blue-500 transition-all"
              style={{ width: `${String(spentPct)}%` }}
            />
            <div
              className="h-full bg-yellow-400 transition-all"
              style={{ width: `${String(encPct)}%` }}
            />
          </div>
        </div>
        <div className="mt-2 flex items-center gap-4 text-xs text-theme-text-secondary">
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
            Available
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
  <div className="space-y-6" aria-label="Loading budget details" role="status">
    <span className="sr-only">Loading...</span>
    <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-6">
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
    <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-6">
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
    isLoading,
    error,
    fetchBudgets,
    fetchBudgetCategories,
  } = useFinanceStore();

  useEffect(() => {
    void fetchBudgets();
    void fetchBudgetCategories();
  }, [fetchBudgets, fetchBudgetCategories]);

  const budget = useMemo(
    () => budgets.find((b) => b.id === id),
    [budgets, id],
  );

  const categoryName = useMemo(() => {
    if (!budget) return 'Unknown';
    return (
      budgetCategories.find((c) => c.id === budget.categoryId)?.name ??
      'Unknown'
    );
  }, [budget, budgetCategories]);

  if (isLoading && !budget) {
    return (
      <div className="space-y-6">
        <Link
          to="/finance/budgets"
          className="inline-flex items-center gap-2 text-sm text-theme-text-secondary hover:text-theme-text-primary"
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
        <Link
          to="/finance/budgets"
          className="inline-flex items-center gap-2 text-sm text-theme-text-secondary hover:text-theme-text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Budgets
        </Link>
        <EmptyState
          icon={DollarSign}
          title="Budget not found"
          description="The budget you are looking for does not exist or has been removed."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        to="/finance/budgets"
        className="inline-flex items-center gap-2 text-sm text-theme-text-secondary hover:text-theme-text-primary"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Budgets
      </Link>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Budget Info Header */}
      <BudgetInfoCard budget={budget} categoryName={categoryName} />

      {/* Transaction History Placeholder */}
      <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-6">
        <h3 className="mb-4 text-lg font-semibold text-theme-text-primary">
          Transaction History
        </h3>
        <EmptyState
          icon={FileText}
          title="No transactions yet"
          description="Transactions linked to this budget will appear here as purchase requests and expense reports are processed."
        />
      </div>
    </div>
  );
};

export default BudgetDetailPage;
