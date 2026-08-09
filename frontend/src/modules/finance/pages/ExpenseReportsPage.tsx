/**
 * Expense Reports Page
 *
 * Lists all expense reports with status filter tabs and search.
 */

import React, { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import { Plus, Receipt, AlertTriangle, Search, X } from 'lucide-react';
import { useFinanceStore } from '../store/financeStore';
import { formatCurrency } from '@/utils/currencyFormatting';
import { SkeletonPage } from '@/components/ux/Skeleton';
import { EmptyState } from '@/components/ux/EmptyState';
import { formatDate } from '@/utils/dateFormatting';
import { useTimezone } from '@/hooks/useTimezone';
import { ExpenseReportStatus, EXPENSE_REPORT_STATUS_COLORS } from '../types';

// =============================================================================
// Constants
// =============================================================================

const STATUS_TABS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: ExpenseReportStatus.DRAFT, label: 'Draft' },
  { value: ExpenseReportStatus.SUBMITTED, label: 'Submitted' },
  { value: ExpenseReportStatus.PENDING_APPROVAL, label: 'Pending Approval' },
  { value: ExpenseReportStatus.APPROVED, label: 'Approved' },
  { value: ExpenseReportStatus.DENIED, label: 'Denied' },
  { value: ExpenseReportStatus.PAID, label: 'Paid' },
  { value: ExpenseReportStatus.CANCELLED, label: 'Cancelled' },
];

const STATUS_LABEL_MAP: Record<string, string> = {};
for (const tab of STATUS_TABS) {
  if (tab.value) {
    STATUS_LABEL_MAP[tab.value] = tab.label;
  }
}

// =============================================================================
// Main Page Component
// =============================================================================

const ExpenseReportsPage: React.FC = () => {
  const tz = useTimezone();
  const navigate = useNavigate();
  const { expenseReports, isLoading, error, fetchExpenseReports } = useFinanceStore();

  const [statusFilter, setStatusFilter] = useState('');
  const [searchText, setSearchText] = useState('');

  useEffect(() => {
    void fetchExpenseReports(statusFilter ? { status: statusFilter } : undefined);
  }, [fetchExpenseReports, statusFilter]);

  const filteredReports = useMemo(() => {
    if (!searchText) return expenseReports;
    const lower = searchText.toLowerCase();
    return expenseReports.filter(
      (er) => er.reportNumber.toLowerCase().includes(lower) || er.title.toLowerCase().includes(lower)
    );
  }, [expenseReports, searchText]);

  if (isLoading && expenseReports.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-theme-text-primary text-2xl font-bold">Expense Reports</h1>
          <p className="text-theme-text-secondary mt-1 text-sm">Submit and track expense reimbursements</p>
        </div>
        <SkeletonPage rows={6} showStats={false} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-theme-text-primary text-2xl font-bold">Expense Reports</h1>
          <p className="text-theme-text-secondary mt-1 text-sm">Submit and track expense reimbursements</p>
        </div>
        <Link
          to="/finance/expenses/new"
          className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
        >
          <Plus className="h-4 w-4" />
          New Expense Report
        </Link>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Status Tabs */}
      <div className="border-theme-surface-border bg-theme-surface flex flex-wrap gap-1 rounded-lg border p-1">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setStatusFilter(tab.value)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              statusFilter === tab.value
                ? 'bg-red-600 text-white'
                : 'text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-surface-hover'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="text-theme-text-secondary absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
        <input
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          type="text"
          aria-label="Search by report number or title..."
          placeholder="Search by report number or title..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="border-theme-surface-border bg-theme-surface text-theme-text-primary placeholder:text-theme-text-secondary w-full rounded-lg border py-2 pr-10 pl-10 text-sm focus:border-red-500 focus:ring-1 focus:ring-red-500 focus:outline-none"
        />
        {searchText && (
          <button
            type="button"
            onClick={() => setSearchText('')}
            className="text-theme-text-secondary hover:text-theme-text-primary absolute top-1/2 right-3 -translate-y-1/2"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Table */}
      {filteredReports.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No expense reports found"
          description={
            searchText || statusFilter
              ? 'Try adjusting your search or filters.'
              : 'Create your first expense report to get started.'
          }
          actions={
            !searchText && !statusFilter
              ? [
                  {
                    label: 'New Expense Report',
                    onClick: () => void navigate('/finance/expenses/new'),
                    icon: Plus,
                  },
                ]
              : undefined
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
                    Report #
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-secondary px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Title
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-secondary px-4 py-3 text-right text-xs font-medium tracking-wider uppercase"
                  >
                    Amount
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-secondary px-4 py-3 text-center text-xs font-medium tracking-wider uppercase"
                  >
                    Items
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-secondary px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Status
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-secondary px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Date
                  </th>
                </tr>
              </thead>
              <tbody className="divide-theme-surface-border divide-y">
                {filteredReports.map((er) => (
                  <tr
                    key={er.id}
                    onClick={() => void navigate(`/finance/expenses/${er.id}`)}
                    className="hover:bg-theme-surface-hover cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 text-sm font-medium whitespace-nowrap text-red-600">{er.reportNumber}</td>
                    <td className="text-theme-text-primary px-4 py-3 text-sm">{er.title}</td>
                    <td className="text-theme-text-primary px-4 py-3 text-right text-sm font-semibold whitespace-nowrap">
                      {formatCurrency(er.totalAmount)}
                    </td>
                    <td className="text-theme-text-secondary px-4 py-3 text-center text-sm whitespace-nowrap">
                      {er.lineItems.length}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${EXPENSE_REPORT_STATUS_COLORS[er.status] ?? 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-400'}`}
                      >
                        {STATUS_LABEL_MAP[er.status] ?? er.status}
                      </span>
                    </td>
                    <td className="text-theme-text-secondary px-4 py-3 text-sm whitespace-nowrap">
                      {formatDate(er.createdAt, tz)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExpenseReportsPage;
