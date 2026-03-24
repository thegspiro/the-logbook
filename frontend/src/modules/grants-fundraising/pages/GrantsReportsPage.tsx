/**
 * Grants Reports Page
 *
 * Two-tab reports dashboard with date range filtering.
 * - "Grant Reports" tab: KPI cards, compliance summary, spending by category
 * - "Fundraising Reports" tab: KPI cards, donations by payment method, monthly totals
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  BarChart3,
  TrendingUp,
  DollarSign,
  FileText,
  Users,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { grantsService } from '../services/api';
import type { GrantReport, FundraisingReport } from '../types';
import { COMPLIANCE_STATUS_COLORS } from '../types';

import { formatCurrencyWhole } from '@/utils/currencyFormatting';
import { getTodayLocalDate, toLocalDateString } from '@/utils/dateFormatting';
import { useTimezone } from '@/hooks/useTimezone';

const formatPercent = (value: number): string =>
  new Intl.NumberFormat('en-US', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value / 100);

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  check: 'Check',
  credit_card: 'Credit Card',
  bank_transfer: 'Bank Transfer',
  paypal: 'PayPal',
  venmo: 'Venmo',
  other: 'Other',
};

const BAR_COLORS = [
  'bg-red-500',
  'bg-blue-500',
  'bg-green-500',
  'bg-yellow-500',
  'bg-purple-500',
  'bg-indigo-500',
  'bg-teal-500',
  'bg-orange-500',
  'bg-pink-500',
];

type TabId = 'grants' | 'fundraising';

// =============================================================================
// Subcomponents
// =============================================================================

/** KPI card with icon, label, and formatted value. */
const KpiCard: React.FC<{
  label: string;
  value: string;
  icon: React.ReactNode;
  color?: string;
}> = ({ label, value, icon, color }) => (
  <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-4">
    <div className="flex items-center gap-3">
      <div
        className={`rounded-lg p-2 ${color ?? 'bg-theme-surface-secondary'}`}
      >
        {icon}
      </div>
      <div>
        <p className="text-xs uppercase text-theme-text-secondary">{label}</p>
        <p className="text-xl font-bold text-theme-text-primary">{value}</p>
      </div>
    </div>
  </div>
);

/** Simple horizontal bar chart using Tailwind CSS divs. */
const HorizontalBarChart: React.FC<{
  items: { label: string; value: number }[];
  formatValue?: (v: number) => string;
}> = ({ items, formatValue }) => {
  const maxValue = Math.max(...items.map((i) => i.value), 1);
  const fmt = formatValue ?? ((v: number) => String(v));

  return (
    <div className="space-y-2">
      {items.map((item, idx) => {
        const pct = Math.round((item.value / maxValue) * 100);
        const color = BAR_COLORS[idx % BAR_COLORS.length] ?? 'bg-theme-text-muted';

        return (
          <div key={item.label}>
            <div className="mb-0.5 flex items-center justify-between text-sm">
              <span className="mr-2 truncate text-theme-text-secondary">
                {item.label}
              </span>
              <span className="shrink-0 font-medium text-theme-text-primary">
                {fmt(item.value)}
              </span>
            </div>
            <div className="h-4 w-full overflow-hidden rounded bg-theme-surface-hover">
              <div
                className={`h-full rounded transition-all ${color}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

// =============================================================================
// Default date range
// =============================================================================

function getDefaultDateRange(tz: string): { start: string; end: string } {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  return {
    start: toLocalDateString(startOfYear, tz),
    end: getTodayLocalDate(tz),
  };
}

// =============================================================================
// Main Component
// =============================================================================

const GrantsReportsPage: React.FC = () => {
  const tz = useTimezone();
  const defaults = getDefaultDateRange(tz);

  const [activeTab, setActiveTab] = useState<TabId>('grants');
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);
  const [grantReport, setGrantReport] = useState<GrantReport | null>(null);
  const [fundraisingReport, setFundraisingReport] =
    useState<FundraisingReport | null>(null);
  const [isLoadingGrants, setIsLoadingGrants] = useState(false);
  const [isLoadingFundraising, setIsLoadingFundraising] = useState(false);

  const loadReports = useCallback(async () => {
    setIsLoadingGrants(true);
    setIsLoadingFundraising(true);

    try {
      const dateParams: { startDate?: string; endDate?: string } = {};
      if (startDate) dateParams.startDate = startDate;
      if (endDate) dateParams.endDate = endDate;
      const gr = await grantsService.getGrantReport(dateParams);
      setGrantReport(gr);
    } catch {
      toast.error('Failed to load grant report data.');
    } finally {
      setIsLoadingGrants(false);
    }

    try {
      const frParams: { startDate?: string; endDate?: string } = {};
      if (startDate) frParams.startDate = startDate;
      if (endDate) frParams.endDate = endDate;
      const fr = await grantsService.getFundraisingReport(frParams);
      setFundraisingReport(fr);
    } catch {
      toast.error('Failed to load fundraising report data.');
    } finally {
      setIsLoadingFundraising(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  // Derived data for grant reports
  const spendingByCategory =
    grantReport?.spendingByCategory
      ? Object.entries(grantReport.spendingByCategory).map(
          ([label, value]) => ({
            label: label.charAt(0).toUpperCase() + label.slice(1),
            value,
          }),
        )
      : [];

  // Derived data for fundraising reports
  const donationsByMethod =
    fundraisingReport?.donationsByMethod
      ? Object.entries(fundraisingReport.donationsByMethod)
      : [];

  const donationsByMethodTotal = donationsByMethod.reduce(
    (sum, [, v]) => sum + v,
    0,
  );

  const monthlyTotals = fundraisingReport?.monthlyTotals ?? [];

  // Tab definitions
  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    {
      id: 'grants',
      label: 'Grant Reports',
      icon: <FileText className="h-4 w-4" />,
    },
    {
      id: 'fundraising',
      label: 'Fundraising Reports',
      icon: <DollarSign className="h-4 w-4" />,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-theme-text-primary">
          Grants &amp; Fundraising Reports
        </h1>
        <p className="mt-1 text-sm text-theme-text-secondary">
          Grant performance metrics and fundraising analytics
        </p>
      </div>

      {/* Date Range Filter */}
      <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-theme-text-secondary">
            Date Range
          </span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="rounded-lg border border-theme-input-border bg-theme-input-bg px-3 py-1.5 text-sm text-theme-text-primary focus:border-red-500 focus:outline-none"
          />
          <span className="text-sm text-theme-text-secondary">to</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="rounded-lg border border-theme-input-border bg-theme-input-bg px-3 py-1.5 text-sm text-theme-text-primary focus:border-red-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 overflow-x-auto rounded-lg border border-theme-surface-border bg-theme-surface p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-red-600 text-white'
                : 'text-theme-text-secondary hover:bg-theme-surface-hover hover:text-theme-text-primary'
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* ================================================================== */}
      {/* Grant Reports Tab                                                  */}
      {/* ================================================================== */}
      {activeTab === 'grants' && (
        <section>
          {isLoadingGrants ? (
            <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
              <Loader2 className="h-6 w-6 animate-spin text-red-500" />
            </div>
          ) : grantReport ? (
            <div className="space-y-6">
              {/* KPI Cards */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <KpiCard
                  label="Total Applications"
                  value={String(grantReport.totalApplications)}
                  icon={
                    <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  }
                  color="bg-blue-100 dark:bg-blue-900/30"
                />
                <KpiCard
                  label="Total Requested"
                  value={formatCurrencyWhole(grantReport.totalRequested)}
                  icon={
                    <DollarSign className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                  }
                  color="bg-indigo-100 dark:bg-indigo-900/30"
                />
                <KpiCard
                  label="Total Awarded"
                  value={formatCurrencyWhole(grantReport.totalAwarded)}
                  icon={
                    <DollarSign className="h-5 w-5 text-green-600 dark:text-green-400" />
                  }
                  color="bg-green-100 dark:bg-green-900/30"
                />
                <KpiCard
                  label="Total Spent"
                  value={formatCurrencyWhole(grantReport.totalSpent)}
                  icon={
                    <BarChart3 className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                  }
                  color="bg-orange-100 dark:bg-orange-900/30"
                />
                <KpiCard
                  label="Success Rate"
                  value={`${grantReport.successRate}%`}
                  icon={
                    <TrendingUp className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  }
                  color="bg-emerald-100 dark:bg-emerald-900/30"
                />
                <KpiCard
                  label="Awarded / Denied"
                  value={`${grantReport.awardedCount} / ${grantReport.deniedCount}`}
                  icon={
                    <FileText className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                  }
                  color="bg-purple-100 dark:bg-purple-900/30"
                />
              </div>

              {/* Compliance Summary */}
              <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-5">
                <h3 className="mb-3 font-semibold text-theme-text-primary">
                  Compliance Summary
                </h3>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex rounded-full bg-theme-surface-secondary px-2 py-0.5 text-xs font-medium text-theme-text-secondary">
                      Total
                    </span>
                    <span className="font-bold text-theme-text-primary">
                      {grantReport.complianceSummary.totalTasks}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${COMPLIANCE_STATUS_COLORS['completed'] ?? ''}`}
                    >
                      <CheckCircle2 className="mr-1 h-3 w-3" />
                      Completed
                    </span>
                    <span className="font-bold text-theme-text-primary">
                      {grantReport.complianceSummary.completed}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${COMPLIANCE_STATUS_COLORS['overdue'] ?? ''}`}
                    >
                      <AlertTriangle className="mr-1 h-3 w-3" />
                      Overdue
                    </span>
                    <span className="font-bold text-theme-text-primary">
                      {grantReport.complianceSummary.overdue}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${COMPLIANCE_STATUS_COLORS['pending'] ?? ''}`}
                    >
                      <Clock className="mr-1 h-3 w-3" />
                      Pending
                    </span>
                    <span className="font-bold text-theme-text-primary">
                      {grantReport.complianceSummary.pending}
                    </span>
                  </div>
                </div>
              </div>

              {/* Spending by Category */}
              {spendingByCategory.length > 0 && (
                <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-5">
                  <h3 className="mb-4 font-semibold text-theme-text-primary">
                    Spending by Category
                  </h3>
                  <HorizontalBarChart
                    items={spendingByCategory}
                    formatValue={formatCurrencyWhole}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-8 text-center">
              <FileText className="mx-auto mb-2 h-8 w-8 text-theme-text-secondary opacity-40" />
              <p className="text-sm text-theme-text-secondary">
                No grant report data available for the selected period.
              </p>
            </div>
          )}
        </section>
      )}

      {/* ================================================================== */}
      {/* Fundraising Reports Tab                                            */}
      {/* ================================================================== */}
      {activeTab === 'fundraising' && (
        <section>
          {isLoadingFundraising ? (
            <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
              <Loader2 className="h-6 w-6 animate-spin text-red-500" />
            </div>
          ) : fundraisingReport ? (
            <div className="space-y-6">
              {/* KPI Cards */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <KpiCard
                  label="Total Donations"
                  value={formatCurrencyWhole(fundraisingReport.totalDonations)}
                  icon={
                    <DollarSign className="h-5 w-5 text-green-600 dark:text-green-400" />
                  }
                  color="bg-green-100 dark:bg-green-900/30"
                />
                <KpiCard
                  label="Donation Count"
                  value={String(fundraisingReport.donationCount)}
                  icon={
                    <BarChart3 className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  }
                  color="bg-blue-100 dark:bg-blue-900/30"
                />
                <KpiCard
                  label="Unique Donors"
                  value={String(fundraisingReport.uniqueDonors)}
                  icon={
                    <Users className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                  }
                  color="bg-indigo-100 dark:bg-indigo-900/30"
                />
                <KpiCard
                  label="Average Gift"
                  value={formatCurrencyWhole(fundraisingReport.averageGift)}
                  icon={
                    <TrendingUp className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                  }
                  color="bg-purple-100 dark:bg-purple-900/30"
                />
              </div>

              {/* Donations by Payment Method */}
              {donationsByMethod.length > 0 && (
                <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-5">
                  <h3 className="mb-4 font-semibold text-theme-text-primary">
                    Donations by Payment Method
                  </h3>
                  <ul className="divide-y divide-theme-surface-border">
                    {donationsByMethod.map(([method, amount]) => {
                      const pct =
                        donationsByMethodTotal > 0
                          ? (amount / donationsByMethodTotal) * 100
                          : 0;

                      return (
                        <li
                          key={method}
                          className="flex items-center justify-between py-2.5"
                        >
                          <span className="text-sm text-theme-text-primary">
                            {PAYMENT_METHOD_LABELS[method] ?? method}
                          </span>
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-medium text-theme-text-primary">
                              {formatCurrencyWhole(amount)}
                            </span>
                            <span className="w-14 text-right text-xs text-theme-text-secondary">
                              {formatPercent(pct)}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {/* Monthly Totals */}
              {monthlyTotals.length > 0 && (
                <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-5">
                  <h3 className="mb-4 font-semibold text-theme-text-primary">
                    Monthly Totals
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-theme-surface-border text-left">
                          <th scope="col" className="pb-2 font-medium text-theme-text-secondary">
                            Month
                          </th>
                          <th scope="col" className="pb-2 text-right font-medium text-theme-text-secondary">
                            Total
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {monthlyTotals.map((row) => (
                          <tr
                            key={row.month}
                            className="border-b border-theme-surface-border last:border-0"
                          >
                            <td className="py-2 text-theme-text-primary">
                              {row.month}
                            </td>
                            <td className="py-2 text-right font-medium text-theme-text-primary">
                              {formatCurrencyWhole(row.total)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-8 text-center">
              <DollarSign className="mx-auto mb-2 h-8 w-8 text-theme-text-secondary opacity-40" />
              <p className="text-sm text-theme-text-secondary">
                No fundraising report data available for the selected period.
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  );
};

export default GrantsReportsPage;
