/**
 * Budgets Page
 *
 * Displays budget allocations by fiscal year with utilization progress bars.
 * Supports fiscal year selection and category filtering.
 */

import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router';
import { BarChart3, AlertTriangle, ChevronRight } from 'lucide-react';
import { useFinanceStore } from '../store/financeStore';
import { formatCurrencyWhole } from '@/utils/currencyFormatting';
import { SkeletonPage } from '@/components/ux/Skeleton';
import { EmptyState } from '@/components/ux/EmptyState';
import type { Budget } from '../types';

// =============================================================================
// Budget Progress Bar
// =============================================================================

interface BudgetProgressProps {
  spent: number;
  encumbered: number;
  budgeted: number;
}

const BudgetProgress: React.FC<BudgetProgressProps> = ({ spent, encumbered, budgeted }) => {
  const spentPct = budgeted > 0 ? Math.min((spent / budgeted) * 100, 100) : 0;
  const encPct = budgeted > 0 ? Math.min((encumbered / budgeted) * 100, 100 - spentPct) : 0;
  const totalPct = spentPct + encPct;
  const overBudget = totalPct > 90;

  return (
    <div className="w-full">
      <div className="text-theme-text-secondary mb-1 flex items-center justify-between text-xs">
        <span>{totalPct.toFixed(0)}% used</span>
        {overBudget && (
          <span className="font-medium text-red-600">{totalPct > 100 ? 'Over budget' : 'Near limit'}</span>
        )}
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
        <div className="flex h-full">
          <div className="h-full bg-blue-500 transition-all" style={{ width: `${String(spentPct)}%` }} />
          <div className="h-full bg-yellow-400 transition-all" style={{ width: `${String(encPct)}%` }} />
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// Summary Cards
// =============================================================================

interface SummaryCardsProps {
  budgets: Budget[];
}

const SummaryCards: React.FC<SummaryCardsProps> = ({ budgets }) => {
  const totalBudgeted = budgets.reduce((s, b) => s + b.amountBudgeted, 0);
  const totalSpent = budgets.reduce((s, b) => s + b.amountSpent, 0);
  const totalEncumbered = budgets.reduce((s, b) => s + b.amountEncumbered, 0);
  const totalRemaining = totalBudgeted - totalSpent - totalEncumbered;

  const cards = [
    {
      label: 'Total Budgeted',
      value: formatCurrencyWhole(totalBudgeted),
      color: 'text-green-600',
    },
    {
      label: 'Total Spent',
      value: formatCurrencyWhole(totalSpent),
      color: 'text-blue-600',
    },
    {
      label: 'Encumbered',
      value: formatCurrencyWhole(totalEncumbered),
      color: 'text-yellow-600',
    },
    {
      label: 'Remaining',
      value: formatCurrencyWhole(totalRemaining),
      color: totalRemaining < 0 ? 'text-red-600' : 'text-green-600',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((c) => (
        <div key={c.label} className="border-theme-surface-border bg-theme-surface rounded-lg border p-4">
          <p className="text-theme-text-secondary text-sm">{c.label}</p>
          <p className={`text-xl font-bold ${c.color}`}>{c.value}</p>
        </div>
      ))}
    </div>
  );
};

// =============================================================================
// Main Page Component
// =============================================================================

const BudgetsPage: React.FC = () => {
  const {
    fiscalYears,
    budgets,
    budgetCategories,
    isLoading,
    error,
    fetchFiscalYears,
    fetchBudgets,
    fetchBudgetCategories,
  } = useFinanceStore();

  const [selectedFiscalYear, setSelectedFiscalYear] = useState('');

  useEffect(() => {
    void fetchFiscalYears();
    void fetchBudgetCategories();
  }, [fetchFiscalYears, fetchBudgetCategories]);

  // Auto-select active fiscal year
  useEffect(() => {
    if (!selectedFiscalYear && fiscalYears.length > 0) {
      const active = fiscalYears.find((fy) => fy.status === 'active');
      setSelectedFiscalYear(active?.id ?? fiscalYears[0]?.id ?? '');
    }
  }, [fiscalYears, selectedFiscalYear]);

  // Fetch budgets when fiscal year changes
  useEffect(() => {
    if (selectedFiscalYear) {
      void fetchBudgets({ fiscalYearId: selectedFiscalYear });
    }
  }, [selectedFiscalYear, fetchBudgets]);

  // Build category lookup
  const categoryMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const cat of budgetCategories) {
      map.set(cat.id, cat.name);
    }
    return map;
  }, [budgetCategories]);

  const getRemaining = (b: Budget): number => b.amountBudgeted - b.amountSpent - b.amountEncumbered;

  if (isLoading && budgets.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-theme-text-primary text-2xl font-bold">Budgets</h1>
          <p className="text-theme-text-secondary mt-1 text-sm">Budget allocations and utilization by fiscal year</p>
        </div>
        <SkeletonPage rows={6} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-theme-text-primary text-2xl font-bold">Budgets</h1>
          <p className="text-theme-text-secondary mt-1 text-sm">Budget allocations and utilization by fiscal year</p>
        </div>
        <select
          value={selectedFiscalYear}
          onChange={(e) => setSelectedFiscalYear(e.target.value)}
          className="border-theme-surface-border bg-theme-surface text-theme-text-primary focus:ring-theme-focus-ring rounded-lg border px-3 py-2 text-sm focus:border-red-500 focus:ring-2 focus:outline-none"
        >
          <option value="">Select Fiscal Year</option>
          {fiscalYears.map((fy) => (
            <option key={fy.id} value={fy.id}>
              {fy.name} {fy.status === 'active' ? '(Active)' : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Summary Cards */}
      {budgets.length > 0 && <SummaryCards budgets={budgets} />}

      {/* Budget legend */}
      {budgets.length > 0 && (
        <div className="text-theme-text-secondary flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-500" />
            Spent
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-yellow-400" />
            Encumbered
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-gray-200 dark:bg-gray-600" />
            Available
          </span>
        </div>
      )}

      {/* Budget Table */}
      {budgets.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="No budgets found"
          description={
            selectedFiscalYear
              ? 'No budgets have been created for the selected fiscal year.'
              : 'Select a fiscal year to view budgets.'
          }
        />
      ) : (
        <div className="border-theme-surface-border bg-theme-surface overflow-hidden rounded-lg border">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-theme-surface-border border-b">
                  <th
                    scope="col"
                    className="text-theme-text-secondary px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Category
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-secondary px-4 py-3 text-right text-xs font-medium tracking-wider uppercase"
                  >
                    Budgeted
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-secondary px-4 py-3 text-right text-xs font-medium tracking-wider uppercase"
                  >
                    Spent
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-secondary px-4 py-3 text-right text-xs font-medium tracking-wider uppercase"
                  >
                    Encumbered
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-secondary px-4 py-3 text-right text-xs font-medium tracking-wider uppercase"
                  >
                    Remaining
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-secondary px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    % Used
                  </th>
                  <th scope="col" className="px-4 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-theme-surface-border divide-y">
                {budgets.map((budget) => {
                  const remaining = getRemaining(budget);

                  return (
                    <tr key={budget.id} className="hover:bg-theme-surface-hover transition-colors">
                      <td className="px-4 py-3">
                        <Link
                          to={`/finance/budgets/${budget.id}`}
                          className="text-theme-text-primary text-sm font-medium hover:text-red-600"
                        >
                          {categoryMap.get(budget.categoryId) ?? 'Unknown'}
                        </Link>
                      </td>
                      <td className="text-theme-text-primary px-4 py-3 text-right text-sm font-semibold whitespace-nowrap">
                        {formatCurrencyWhole(budget.amountBudgeted)}
                      </td>
                      <td className="text-theme-text-primary px-4 py-3 text-right text-sm whitespace-nowrap">
                        {formatCurrencyWhole(budget.amountSpent)}
                      </td>
                      <td className="text-theme-text-secondary px-4 py-3 text-right text-sm whitespace-nowrap">
                        {formatCurrencyWhole(budget.amountEncumbered)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right text-sm font-medium whitespace-nowrap ${remaining < 0 ? 'text-red-600' : 'text-green-600'}`}
                      >
                        {formatCurrencyWhole(remaining)}
                      </td>
                      <td className="px-4 py-3" style={{ minWidth: 160 }}>
                        <BudgetProgress
                          spent={budget.amountSpent}
                          encumbered={budget.amountEncumbered}
                          budgeted={budget.amountBudgeted}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          to={`/finance/budgets/${budget.id}`}
                          className="text-theme-text-secondary hover:text-red-600"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {/* Totals row */}
              <tfoot>
                <tr className="border-theme-surface-border bg-theme-surface border-t-2">
                  <td className="text-theme-text-primary px-4 py-3 text-sm font-bold">Total</td>
                  <td className="text-theme-text-primary px-4 py-3 text-right text-sm font-bold whitespace-nowrap">
                    {formatCurrencyWhole(budgets.reduce((s, b) => s + b.amountBudgeted, 0))}
                  </td>
                  <td className="text-theme-text-primary px-4 py-3 text-right text-sm font-bold whitespace-nowrap">
                    {formatCurrencyWhole(budgets.reduce((s, b) => s + b.amountSpent, 0))}
                  </td>
                  <td className="text-theme-text-secondary px-4 py-3 text-right text-sm font-bold whitespace-nowrap">
                    {formatCurrencyWhole(budgets.reduce((s, b) => s + b.amountEncumbered, 0))}
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-bold whitespace-nowrap text-green-600">
                    {formatCurrencyWhole(budgets.reduce((s, b) => s + getRemaining(b), 0))}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default BudgetsPage;
