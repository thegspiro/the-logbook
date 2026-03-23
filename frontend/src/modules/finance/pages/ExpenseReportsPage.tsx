/**
 * Expense Reports Page
 *
 * Lists all expense reports with status filter tabs and search.
 */

import React, { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Receipt, AlertTriangle, Search, X } from 'lucide-react';
import { useFinanceStore } from '../store/financeStore';
import { formatCurrency } from '@/utils/currencyFormatting';
import { SkeletonPage } from '@/components/ux/Skeleton';
import { EmptyState } from '@/components/ux/EmptyState';
import { formatDate } from '@/utils/dateFormatting';
import { useTimezone } from '@/hooks/useTimezone';
import {
  ExpenseReportStatus,
  EXPENSE_REPORT_STATUS_COLORS,
} from '../types';

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
  const {
    expenseReports,
    isLoading,
    error,
    fetchExpenseReports,
  } = useFinanceStore();

  const [statusFilter, setStatusFilter] = useState('');
  const [searchText, setSearchText] = useState('');

  useEffect(() => {
    void fetchExpenseReports(
      statusFilter ? { status: statusFilter } : undefined,
    );
  }, [fetchExpenseReports, statusFilter]);

  const filteredReports = useMemo(() => {
    if (!searchText) return expenseReports;
    const lower = searchText.toLowerCase();
    return expenseReports.filter(
      (er) =>
        er.reportNumber.toLowerCase().includes(lower) ||
        er.title.toLowerCase().includes(lower),
    );
  }, [expenseReports, searchText]);

  if (isLoading && expenseReports.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-theme-text-primary">
            Expense Reports
          </h1>
          <p className="mt-1 text-sm text-theme-text-secondary">
            Submit and track expense reimbursements
          </p>
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
          <h1 className="text-2xl font-bold text-theme-text-primary">
            Expense Reports
          </h1>
          <p className="mt-1 text-sm text-theme-text-secondary">
            Submit and track expense reimbursements
          </p>
        </div>
        <Link
          to="/finance/expenses/new"
          className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Expense Report
        </Link>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Status Tabs */}
      <div className="flex flex-wrap gap-1 rounded-lg border border-theme-surface-border bg-theme-surface p-1">
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
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-theme-text-secondary" />
        <input
          type="text"
          aria-label="Search by report number or title..." placeholder="Search by report number or title..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="w-full rounded-lg border border-theme-surface-border bg-theme-surface py-2 pl-10 pr-10 text-sm text-theme-text-primary placeholder:text-theme-text-secondary focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
        />
        {searchText && (
          <button
            type="button"
            onClick={() => setSearchText('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-theme-text-secondary hover:text-theme-text-primary"
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
                    onClick: () => navigate('/finance/expenses/new'),
                    icon: Plus,
                  },
                ]
              : undefined
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-theme-surface-border bg-theme-surface">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-theme-surface-border">
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                    Report #
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                    Title
                  </th>
                  <th scope="col" className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                    Amount
                  </th>
                  <th scope="col" className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                    Items
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-theme-surface-border">
                {filteredReports.map((er) => (
                  <tr
                    key={er.id}
                    onClick={() => navigate(`/finance/expenses/${er.id}`)}
                    className="cursor-pointer transition-colors hover:bg-theme-surface-hover"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-red-600">
                      {er.reportNumber}
                    </td>
                    <td className="px-4 py-3 text-sm text-theme-text-primary">
                      {er.title}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-semibold text-theme-text-primary">
                      {formatCurrency(er.totalAmount)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-center text-sm text-theme-text-secondary">
                      {er.lineItems.length}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${EXPENSE_REPORT_STATUS_COLORS[er.status] ?? 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-400'}`}
                      >
                        {STATUS_LABEL_MAP[er.status] ?? er.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-theme-text-secondary">
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
