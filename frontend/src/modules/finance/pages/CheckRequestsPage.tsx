/**
 * Check Requests Page
 *
 * Lists all check requests with status filter tabs and search.
 */

import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { Plus, FileCheck, AlertTriangle, Search, X } from 'lucide-react';
import { useFinanceStore } from '../store/financeStore';
import { formatCurrency } from '@/utils/currencyFormatting';
import { SkeletonPage } from '@/components/ux/Skeleton';
import { EmptyState } from '@/components/ux/EmptyState';
import { formatDate } from '@/utils/dateFormatting';
import { useTimezone } from '@/hooks/useTimezone';
import { CheckRequestStatus, CHECK_REQUEST_STATUS_COLORS } from '../types';

// =============================================================================
// Constants
// =============================================================================

const STATUS_TABS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: CheckRequestStatus.DRAFT, label: 'Draft' },
  { value: CheckRequestStatus.SUBMITTED, label: 'Submitted' },
  { value: CheckRequestStatus.PENDING_APPROVAL, label: 'Pending Approval' },
  { value: CheckRequestStatus.APPROVED, label: 'Approved' },
  { value: CheckRequestStatus.DENIED, label: 'Denied' },
  { value: CheckRequestStatus.ISSUED, label: 'Issued' },
  { value: CheckRequestStatus.VOIDED, label: 'Voided' },
  { value: CheckRequestStatus.CANCELLED, label: 'Cancelled' },
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

const CheckRequestsPage: React.FC = () => {
  const tz = useTimezone();
  const navigate = useNavigate();
  const { checkRequests, isLoading, error, fetchCheckRequests } = useFinanceStore();

  const [statusFilter, setStatusFilter] = useState('');
  const [searchText, setSearchText] = useState('');

  useEffect(() => {
    void fetchCheckRequests(statusFilter ? { status: statusFilter } : undefined);
  }, [fetchCheckRequests, statusFilter]);

  const filteredRequests = useMemo(() => {
    if (!searchText) return checkRequests;
    const lower = searchText.toLowerCase();
    return checkRequests.filter(
      (cr) =>
        cr.requestNumber.toLowerCase().includes(lower) ||
        cr.payeeName.toLowerCase().includes(lower) ||
        (cr.memo ?? '').toLowerCase().includes(lower)
    );
  }, [checkRequests, searchText]);

  if (isLoading && checkRequests.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-theme-text-primary text-2xl font-bold">Check Requests</h1>
          <p className="text-theme-text-secondary mt-1 text-sm">Request and track checks for vendors and payees</p>
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
          <h1 className="text-theme-text-primary text-2xl font-bold">Check Requests</h1>
          <p className="text-theme-text-secondary mt-1 text-sm">Request and track checks for vendors and payees</p>
        </div>
        <button
          type="button"
          onClick={() => void navigate('/finance/check-requests/new')}
          className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
        >
          <Plus className="h-4 w-4" />
          New Check Request
        </button>
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
          aria-label="Search by number, payee, or memo..."
          placeholder="Search by number, payee, or memo..."
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
      {filteredRequests.length === 0 ? (
        <EmptyState
          icon={FileCheck}
          title="No check requests found"
          description={
            searchText || statusFilter
              ? 'Try adjusting your search or filters.'
              : 'Create your first check request to get started.'
          }
          actions={
            !searchText && !statusFilter
              ? [
                  {
                    label: 'New Check Request',
                    onClick: () => void navigate('/finance/check-requests/new'),
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
                    Request #
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-secondary px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Payee
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-secondary px-4 py-3 text-right text-xs font-medium tracking-wider uppercase"
                  >
                    Amount
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-secondary px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Check #
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
                {filteredRequests.map((cr) => (
                  <tr
                    key={cr.id}
                    onClick={() => void navigate(`/finance/check-requests/${cr.id}`)}
                    className="hover:bg-theme-surface-hover cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 text-sm font-medium whitespace-nowrap text-red-600">{cr.requestNumber}</td>
                    <td className="text-theme-text-primary px-4 py-3 text-sm">{cr.payeeName}</td>
                    <td className="text-theme-text-primary px-4 py-3 text-right text-sm font-semibold whitespace-nowrap">
                      {formatCurrency(cr.amount)}
                    </td>
                    <td className="text-theme-text-secondary px-4 py-3 text-sm whitespace-nowrap">
                      {cr.checkNumber ?? '--'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${CHECK_REQUEST_STATUS_COLORS[cr.status] ?? 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-400'}`}
                      >
                        {STATUS_LABEL_MAP[cr.status] ?? cr.status}
                      </span>
                    </td>
                    <td className="text-theme-text-secondary px-4 py-3 text-sm whitespace-nowrap">
                      {formatDate(cr.createdAt, tz)}
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

export default CheckRequestsPage;
