/**
 * Dues Management Page
 *
 * Manages dues schedules and member payment tracking.
 */

import React, { useEffect, useState, useMemo } from 'react';
import { AlertTriangle, DollarSign, Users, Calendar } from 'lucide-react';
import { useFinanceStore } from '../store/financeStore';
import { formatCurrency } from '@/utils/currencyFormatting';
import { SkeletonPage } from '@/components/ux/Skeleton';
import { EmptyState } from '@/components/ux/EmptyState';
import { formatDate } from '@/utils/dateFormatting';
import { useTimezone } from '@/hooks/useTimezone';
import {
  DuesStatus,
  DUES_STATUS_COLORS,
  DuesFrequency,
} from '../types';
import type { DuesSummary } from '../types';

// =============================================================================
// Constants
// =============================================================================

const STATUS_TABS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: DuesStatus.PENDING, label: 'Pending' },
  { value: DuesStatus.PAID, label: 'Paid' },
  { value: DuesStatus.PARTIAL, label: 'Partial' },
  { value: DuesStatus.OVERDUE, label: 'Overdue' },
  { value: DuesStatus.WAIVED, label: 'Waived' },
  { value: DuesStatus.EXEMPT, label: 'Exempt' },
];

const FREQUENCY_LABELS: Record<string, string> = {
  [DuesFrequency.ANNUAL]: 'Annual',
  [DuesFrequency.SEMI_ANNUAL]: 'Semi-Annual',
  [DuesFrequency.QUARTERLY]: 'Quarterly',
  [DuesFrequency.MONTHLY]: 'Monthly',
};

const STATUS_LABEL_MAP: Record<string, string> = {};
for (const tab of STATUS_TABS) {
  if (tab.value) {
    STATUS_LABEL_MAP[tab.value] = tab.label;
  }
}

// =============================================================================
// Summary Cards Component
// =============================================================================

const SummaryCards: React.FC<{ summary: DuesSummary }> = ({ summary }) => (
  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
    <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-4">
      <div className="flex items-center gap-2 text-sm text-theme-text-secondary">
        <DollarSign className="h-4 w-4" />
        Expected
      </div>
      <p className="mt-1 text-xl font-bold text-theme-text-primary">
        {formatCurrency(summary.totalExpected)}
      </p>
    </div>
    <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-4">
      <div className="flex items-center gap-2 text-sm text-theme-text-secondary">
        <DollarSign className="h-4 w-4 text-green-600" />
        Collected
      </div>
      <p className="mt-1 text-xl font-bold text-green-600">
        {formatCurrency(summary.totalCollected)}
      </p>
    </div>
    <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-4">
      <div className="flex items-center gap-2 text-sm text-theme-text-secondary">
        <DollarSign className="h-4 w-4 text-red-600" />
        Outstanding
      </div>
      <p className="mt-1 text-xl font-bold text-red-600">
        {formatCurrency(summary.totalOutstanding)}
      </p>
    </div>
    <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-4">
      <div className="flex items-center gap-2 text-sm text-theme-text-secondary">
        <Users className="h-4 w-4" />
        Collection Rate
      </div>
      <p className="mt-1 text-xl font-bold text-theme-text-primary">
        {summary.collectionRate.toFixed(1)}%
      </p>
    </div>
  </div>
);

// =============================================================================
// Main Page Component
// =============================================================================

const DuesManagementPage: React.FC = () => {
  const tz = useTimezone();
  const {
    duesSchedules,
    memberDues,
    duesSummary,
    isLoading,
    error,
    fetchDuesSchedules,
    fetchMemberDues,
    fetchDuesSummary,
  } = useFinanceStore();

  const [selectedScheduleId, setSelectedScheduleId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Load schedules and summary on mount
  useEffect(() => {
    void fetchDuesSchedules();
    void fetchDuesSummary();
  }, [fetchDuesSchedules, fetchDuesSummary]);

  // Load member dues when schedule or status filter changes
  useEffect(() => {
    const params: { scheduleId?: string; status?: string } = {};
    if (selectedScheduleId) params.scheduleId = selectedScheduleId;
    if (statusFilter) params.status = statusFilter;
    void fetchMemberDues(Object.keys(params).length > 0 ? params : undefined);
  }, [fetchMemberDues, selectedScheduleId, statusFilter]);

  // Refresh summary when schedule changes
  useEffect(() => {
    void fetchDuesSummary(selectedScheduleId || undefined);
  }, [fetchDuesSummary, selectedScheduleId]);

  const activeSchedules = useMemo(
    () => duesSchedules.filter((s) => s.isActive),
    [duesSchedules],
  );

  if (isLoading && duesSchedules.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-theme-text-primary">
            Dues Management
          </h1>
          <p className="mt-1 text-sm text-theme-text-secondary">
            Manage member dues schedules and payments
          </p>
        </div>
        <SkeletonPage rows={6} showStats />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-theme-text-primary">
          Dues Management
        </h1>
        <p className="mt-1 text-sm text-theme-text-secondary">
          Manage member dues schedules and payments
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Summary Cards */}
      {duesSummary && <SummaryCards summary={duesSummary} />}

      {/* Schedule Selector */}
      {activeSchedules.length > 0 && (
        <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-4">
          <h2 className="mb-3 text-sm font-medium text-theme-text-secondary">
            Dues Schedule
          </h2>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelectedScheduleId('')}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                !selectedScheduleId
                  ? 'bg-red-600 text-white'
                  : 'border border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover'
              }`}
            >
              All Schedules
            </button>
            {activeSchedules.map((schedule) => (
              <button
                key={schedule.id}
                type="button"
                onClick={() => setSelectedScheduleId(schedule.id)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  selectedScheduleId === schedule.id
                    ? 'bg-red-600 text-white'
                    : 'border border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover'
                }`}
              >
                <span>{schedule.name}</span>
                <span className="ml-1 text-xs opacity-75">
                  ({FREQUENCY_LABELS[schedule.frequency] ?? schedule.frequency})
                </span>
              </button>
            ))}
          </div>
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

      {/* Member Dues Table */}
      {memberDues.length === 0 ? (
        <EmptyState
          icon={Calendar}
          title="No dues records found"
          description={
            statusFilter || selectedScheduleId
              ? 'Try adjusting your filters.'
              : 'No dues have been generated yet. Create a schedule and generate dues to get started.'
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-theme-surface-border bg-theme-surface">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-theme-surface-border">
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                    Member
                  </th>
                  <th scope="col" className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                    Amount Due
                  </th>
                  <th scope="col" className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                    Amount Paid
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                    Due Date
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                    Paid Date
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-theme-surface-border">
                {memberDues.map((md) => (
                  <tr
                    key={md.id}
                    className="transition-colors hover:bg-theme-surface-hover"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-theme-text-primary">
                      {md.userId}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-theme-text-primary">
                      {formatCurrency(md.amountDue)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-semibold text-theme-text-primary">
                      {formatCurrency(md.amountPaid)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-theme-text-secondary">
                      {formatDate(md.dueDate, tz)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${DUES_STATUS_COLORS[md.status] ?? 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-400'}`}
                      >
                        {STATUS_LABEL_MAP[md.status] ?? md.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-theme-text-secondary">
                      {md.paidDate ? formatDate(md.paidDate, tz) : '--'}
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

export default DuesManagementPage;
