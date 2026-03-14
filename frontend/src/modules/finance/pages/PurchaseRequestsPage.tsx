/**
 * Purchase Requests Page
 *
 * Lists all purchase requests with status filter tabs, search,
 * and a table view. Includes a button to create new requests.
 */

import React, { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Plus,
  ClipboardList,
  AlertTriangle,
  Search,
  X,
} from 'lucide-react';
import { useFinanceStore } from '../store/financeStore';
import { SkeletonPage } from '@/components/ux/Skeleton';
import { EmptyState } from '@/components/ux/EmptyState';
import { formatDate } from '@/utils/dateFormatting';
import { formatCurrencyWhole } from '@/utils/currencyFormatting';
import {
  PurchaseRequestStatus,
  PURCHASE_REQUEST_STATUS_COLORS,
} from '../types';

// =============================================================================
// Constants
// =============================================================================

const STATUS_TABS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: PurchaseRequestStatus.DRAFT, label: 'Draft' },
  { value: PurchaseRequestStatus.SUBMITTED, label: 'Submitted' },
  { value: PurchaseRequestStatus.PENDING_APPROVAL, label: 'Pending Approval' },
  { value: PurchaseRequestStatus.APPROVED, label: 'Approved' },
  { value: PurchaseRequestStatus.DENIED, label: 'Denied' },
  { value: PurchaseRequestStatus.ORDERED, label: 'Ordered' },
  { value: PurchaseRequestStatus.RECEIVED, label: 'Received' },
  { value: PurchaseRequestStatus.PAID, label: 'Paid' },
  { value: PurchaseRequestStatus.CANCELLED, label: 'Cancelled' },
];

const STATUS_LABEL_MAP: Record<string, string> = {};
for (const tab of STATUS_TABS) {
  if (tab.value) {
    STATUS_LABEL_MAP[tab.value] = tab.label;
  }
}

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-gray-100 text-gray-700',
  medium: 'bg-blue-100 text-blue-700',
  high: 'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-700',
};

// =============================================================================
// Main Page Component
// =============================================================================

const PurchaseRequestsPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    purchaseRequests,
    isLoading,
    error,
    fetchPurchaseRequests,
  } = useFinanceStore();

  const [statusFilter, setStatusFilter] = useState('');
  const [searchText, setSearchText] = useState('');

  useEffect(() => {
    void fetchPurchaseRequests(
      statusFilter ? { status: statusFilter } : undefined,
    );
  }, [fetchPurchaseRequests, statusFilter]);

  const filteredRequests = useMemo(() => {
    if (!searchText) return purchaseRequests;
    const lower = searchText.toLowerCase();
    return purchaseRequests.filter(
      (pr) =>
        pr.requestNumber.toLowerCase().includes(lower) ||
        pr.title.toLowerCase().includes(lower) ||
        (pr.vendor ?? '').toLowerCase().includes(lower),
    );
  }, [purchaseRequests, searchText]);

  if (isLoading && purchaseRequests.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-theme-text-primary">
            Purchase Requests
          </h1>
          <p className="mt-1 text-sm text-theme-text-secondary">
            Submit and track purchase requests
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
            Purchase Requests
          </h1>
          <p className="mt-1 text-sm text-theme-text-secondary">
            Submit and track purchase requests
          </p>
        </div>
        <Link
          to="/finance/purchase-requests/new"
          className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Request
        </Link>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
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
          placeholder="Search by number, title, or vendor..."
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
      {filteredRequests.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No purchase requests found"
          description={
            searchText || statusFilter
              ? 'Try adjusting your search or filters.'
              : 'Create your first purchase request to get started.'
          }
          actions={
            !searchText && !statusFilter
              ? [
                  {
                    label: 'New Request',
                    onClick: () => navigate('/finance/purchase-requests/new'),
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
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                    Request #
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                    Title
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                    Vendor
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                    Amount
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                    Priority
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-theme-surface-border">
                {filteredRequests.map((pr) => (
                  <tr
                    key={pr.id}
                    onClick={() =>
                      navigate(`/finance/purchase-requests/${pr.id}`)
                    }
                    className="cursor-pointer transition-colors hover:bg-theme-surface-hover"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-red-600">
                      {pr.requestNumber}
                    </td>
                    <td className="px-4 py-3 text-sm text-theme-text-primary">
                      {pr.title}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-theme-text-secondary">
                      {pr.vendor ?? '--'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-semibold text-theme-text-primary">
                      {formatCurrencyWhole(pr.estimatedAmount)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_COLORS[pr.priority] ?? 'bg-gray-100 text-gray-700'}`}
                      >
                        {pr.priority}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${PURCHASE_REQUEST_STATUS_COLORS[pr.status] ?? 'bg-gray-100 text-gray-800'}`}
                      >
                        {STATUS_LABEL_MAP[pr.status] ?? pr.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-theme-text-secondary">
                      {formatDate(pr.createdAt)}
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

export default PurchaseRequestsPage;
