/**
 * Grants & Fundraising Dashboard Page
 *
 * Main dashboard for the Grants & Fundraising module showing KPI cards,
 * grant pipeline summary, upcoming deadlines, compliance tasks, and
 * recent donations.
 */

import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  DollarSign,
  FileText,
  Clock,
  TrendingUp,
  Megaphone,
  Users,
  HandCoins,
  BarChart3,
  ChevronRight,
  AlertTriangle,
  CalendarClock,
  ClipboardCheck,
} from 'lucide-react';
import { useGrantsStore } from '../store/grantsStore';
import type {
  GrantOpportunity,
  GrantComplianceTask,
  Donation,
  PipelineSummaryItem,
} from '../types';
import {
  APPLICATION_STATUS_COLORS,
  COMPLIANCE_STATUS_COLORS,
} from '../types';
import { Skeleton, SkeletonRow } from '../../../components/ux/Skeleton';
import { formatDate, daysUntil } from '../../../utils/dateFormatting';
import { useTimezone } from '../../../hooks/useTimezone';

// =============================================================================
// Currency Formatter
// =============================================================================

const formatCurrency = (amount: number): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);

// =============================================================================
// Payment Method Labels
// =============================================================================

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  check: 'Check',
  credit_card: 'Credit Card',
  bank_transfer: 'Bank Transfer',
  paypal: 'PayPal',
  venmo: 'Venmo',
  other: 'Other',
};

// =============================================================================
// Pipeline Status Labels
// =============================================================================

const PIPELINE_STATUS_LABELS: Record<string, string> = {
  researching: 'Researching',
  preparing: 'Preparing',
  submitted: 'Submitted',
  under_review: 'Under Review',
  awarded: 'Awarded',
  active: 'Active',
  reporting: 'Reporting',
  closed: 'Closed',
};

// =============================================================================
// Deadline Urgency Helpers
// =============================================================================

const getDeadlineColor = (deadlineDate: string | null): string => {
  if (!deadlineDate) return 'text-theme-text-secondary';
  const days = daysUntil(deadlineDate);
  if (isNaN(days)) return 'text-theme-text-secondary';
  if (days < 14) return 'text-red-600';
  if (days < 30) return 'text-yellow-600';
  return 'text-green-600';
};

const getDeadlineBadgeColor = (deadlineDate: string | null): string => {
  if (!deadlineDate) return 'bg-theme-surface-secondary text-theme-text-secondary';
  const days = daysUntil(deadlineDate);
  if (isNaN(days)) return 'bg-theme-surface-secondary text-theme-text-secondary';
  if (days < 14) return 'bg-red-100 text-red-700';
  if (days < 30) return 'bg-yellow-100 text-yellow-700';
  return 'bg-green-100 text-green-700';
};

// =============================================================================
// KPI Card Component
// =============================================================================

interface KpiCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  iconBgClass: string;
  linkTo?: string;
}

const KpiCard: React.FC<KpiCardProps> = ({
  label,
  value,
  icon,
  iconBgClass,
  linkTo,
}) => {
  const content = (
    <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-4 transition-shadow hover:shadow-md">
      <div className="flex items-center gap-3">
        <div className={`rounded-lg p-2 ${iconBgClass}`}>{icon}</div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-theme-text-secondary">{label}</p>
          <p className="text-xl font-bold text-theme-text-primary">{value}</p>
        </div>
        {linkTo && (
          <ChevronRight className="h-4 w-4 shrink-0 text-theme-text-secondary" />
        )}
      </div>
    </div>
  );

  if (linkTo) {
    return <Link to={linkTo}>{content}</Link>;
  }
  return content;
};

// =============================================================================
// Loading Skeleton for the Dashboard
// =============================================================================

const DashboardSkeleton: React.FC = () => (
  <div className="space-y-6" aria-label="Loading dashboard" role="status">
    <span className="sr-only">Loading...</span>

    {/* KPI Row 1 */}
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={`kpi1-${String(i)}`}
          className="rounded-lg border border-theme-surface-border bg-theme-surface p-4"
        >
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10" rounded="lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-16" />
            </div>
          </div>
        </div>
      ))}
    </div>

    {/* KPI Row 2 */}
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={`kpi2-${String(i)}`}
          className="rounded-lg border border-theme-surface-border bg-theme-surface p-4"
        >
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10" rounded="lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-16" />
            </div>
          </div>
        </div>
      ))}
    </div>

    {/* Pipeline Summary */}
    <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-4">
      <Skeleton className="mb-3 h-5 w-40" />
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton
            key={`pipe-${String(i)}`}
            className="h-7 w-24"
            rounded="full"
          />
        ))}
      </div>
    </div>

    {/* Two-column section */}
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-lg border border-theme-surface-border bg-theme-surface">
        <div className="border-b border-theme-surface-border p-4">
          <Skeleton className="h-5 w-44" />
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={`dl-${String(i)}`}
            className="border-b border-theme-surface-border last:border-b-0"
          >
            <SkeletonRow columns={3} />
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-theme-surface-border bg-theme-surface">
        <div className="border-b border-theme-surface-border p-4">
          <Skeleton className="h-5 w-44" />
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={`ct-${String(i)}`}
            className="border-b border-theme-surface-border last:border-b-0"
          >
            <SkeletonRow columns={3} />
          </div>
        ))}
      </div>
    </div>

    {/* Recent Donations Table */}
    <div className="rounded-lg border border-theme-surface-border bg-theme-surface">
      <div className="border-b border-theme-surface-border p-4">
        <Skeleton className="h-5 w-36" />
      </div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={`don-${String(i)}`}
          className="border-b border-theme-surface-border last:border-b-0"
        >
          <SkeletonRow columns={5} />
        </div>
      ))}
    </div>
  </div>
);

// =============================================================================
// Grant Pipeline Summary
// =============================================================================

interface PipelineSummaryProps {
  items: PipelineSummaryItem[];
}

const PipelineSummary: React.FC<PipelineSummaryProps> = ({ items }) => {
  const orderedStatuses = [
    'researching',
    'preparing',
    'submitted',
    'under_review',
    'awarded',
    'active',
    'reporting',
    'closed',
  ];

  const statusMap = new Map(items.map((item) => [item.status, item]));

  return (
    <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-theme-text-primary">
          Grant Pipeline
        </h2>
        <Link
          to="/grants/applications"
          className="text-xs font-medium text-red-600 hover:text-red-700"
        >
          View All
        </Link>
      </div>
      <div className="flex flex-wrap gap-2">
        {orderedStatuses.map((status) => {
          const item = statusMap.get(status);
          const count = item?.count ?? 0;
          const colorClass =
            APPLICATION_STATUS_COLORS[status] ?? 'bg-theme-surface-secondary text-theme-text-secondary';

          return (
            <Link
              key={status}
              to={`/grants/applications?status=${status}`}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-opacity hover:opacity-80 ${colorClass}`}
            >
              <span>{PIPELINE_STATUS_LABELS[status] ?? status}</span>
              <span className="font-bold">{count}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
};

// =============================================================================
// Upcoming Deadlines Section
// =============================================================================

interface UpcomingDeadlinesProps {
  deadlines: GrantOpportunity[];
  timezone: string;
}

const UpcomingDeadlines: React.FC<UpcomingDeadlinesProps> = ({
  deadlines,
  timezone,
}) => (
  <div className="rounded-lg border border-theme-surface-border bg-theme-surface">
    <div className="flex items-center justify-between border-b border-theme-surface-border p-4">
      <div className="flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-theme-text-secondary" />
        <h2 className="text-sm font-semibold text-theme-text-primary">
          Upcoming Deadlines
        </h2>
      </div>
      <Link
        to="/grants/opportunities"
        className="text-xs font-medium text-red-600 hover:text-red-700"
      >
        View All
      </Link>
    </div>
    {deadlines.length === 0 ? (
      <div className="flex flex-col items-center justify-center py-8">
        <CalendarClock className="mb-2 h-8 w-8 text-theme-text-secondary opacity-40" />
        <p className="text-sm text-theme-text-secondary">
          No upcoming deadlines
        </p>
      </div>
    ) : (
      <ul className="divide-y divide-theme-surface-border">
        {deadlines.map((opp) => {
          const days = opp.deadlineDate ? daysUntil(opp.deadlineDate) : NaN;
          const deadlineColor = getDeadlineColor(opp.deadlineDate);
          const badgeColor = getDeadlineBadgeColor(opp.deadlineDate);

          return (
            <li key={opp.id} className="p-4 transition-colors hover:bg-theme-surface-hover">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-theme-text-primary">
                    {opp.name}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-theme-text-secondary">
                    {opp.agency}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={`text-xs font-medium ${deadlineColor}`}>
                    {opp.deadlineDate
                      ? formatDate(opp.deadlineDate, timezone)
                      : 'No deadline'}
                  </p>
                  {!isNaN(days) && (
                    <span
                      className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${badgeColor}`}
                    >
                      {days < 0
                        ? 'Past due'
                        : days === 0
                          ? 'Today'
                          : `${String(days)}d left`}
                    </span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    )}
  </div>
);

// =============================================================================
// Compliance Tasks Due Section
// =============================================================================

interface ComplianceTasksProps {
  tasks: GrantComplianceTask[];
  timezone: string;
}

const ComplianceTasksDue: React.FC<ComplianceTasksProps> = ({
  tasks,
  timezone,
}) => (
  <div className="rounded-lg border border-theme-surface-border bg-theme-surface">
    <div className="flex items-center justify-between border-b border-theme-surface-border p-4">
      <div className="flex items-center gap-2">
        <ClipboardCheck className="h-4 w-4 text-theme-text-secondary" />
        <h2 className="text-sm font-semibold text-theme-text-primary">
          Compliance Tasks Due
        </h2>
      </div>
    </div>
    {tasks.length === 0 ? (
      <div className="flex flex-col items-center justify-center py-8">
        <ClipboardCheck className="mb-2 h-8 w-8 text-theme-text-secondary opacity-40" />
        <p className="text-sm text-theme-text-secondary">
          No compliance tasks due
        </p>
      </div>
    ) : (
      <ul className="divide-y divide-theme-surface-border">
        {tasks.map((task) => {
          const statusColor =
            COMPLIANCE_STATUS_COLORS[task.status] ??
            'bg-theme-surface-secondary text-theme-text-secondary';
          const days = daysUntil(task.dueDate);
          const urgentClass =
            !isNaN(days) && days < 7 ? 'text-red-600' : 'text-theme-text-secondary';

          return (
            <li key={task.id} className="p-4 transition-colors hover:bg-theme-surface-hover">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-theme-text-primary">
                    {task.title}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusColor}`}
                    >
                      {task.status.replace('_', ' ')}
                    </span>
                    <Link
                      to={`/grants/applications/${task.applicationId}`}
                      className="text-xs text-red-600 hover:text-red-700 hover:underline"
                    >
                      View Grant
                    </Link>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className={`text-xs font-medium ${urgentClass}`}>
                    {formatDate(task.dueDate, timezone)}
                  </p>
                  {!isNaN(days) && days < 7 && (
                    <span className="mt-1 inline-flex items-center gap-1 text-xs text-red-600">
                      <AlertTriangle className="h-3 w-3" />
                      {days < 0 ? 'Overdue' : days === 0 ? 'Due today' : `${String(days)}d left`}
                    </span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    )}
  </div>
);

// =============================================================================
// Recent Donations Table
// =============================================================================

interface RecentDonationsProps {
  donations: Donation[];
  timezone: string;
}

const RecentDonationsTable: React.FC<RecentDonationsProps> = ({
  donations,
  timezone,
}) => (
  <div className="rounded-lg border border-theme-surface-border bg-theme-surface">
    <div className="flex items-center justify-between border-b border-theme-surface-border p-4">
      <div className="flex items-center gap-2">
        <HandCoins className="h-4 w-4 text-theme-text-secondary" />
        <h2 className="text-sm font-semibold text-theme-text-primary">
          Recent Donations
        </h2>
      </div>
      <Link
        to="/grants/donations"
        className="text-xs font-medium text-red-600 hover:text-red-700"
      >
        View All
      </Link>
    </div>
    {donations.length === 0 ? (
      <div className="flex flex-col items-center justify-center py-8">
        <HandCoins className="mb-2 h-8 w-8 text-theme-text-secondary opacity-40" />
        <p className="text-sm text-theme-text-secondary">
          No recent donations
        </p>
      </div>
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-theme-surface-border bg-theme-surface">
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                Date
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                Donor
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                Amount
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                Campaign
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                Method
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-theme-surface-border">
            {donations.map((donation) => (
              <tr
                key={donation.id}
                className="transition-colors hover:bg-theme-surface-hover"
              >
                <td className="whitespace-nowrap px-4 py-3 text-sm text-theme-text-primary">
                  {formatDate(donation.donationDate, timezone)}
                </td>
                <td className="px-4 py-3 text-sm font-medium text-theme-text-primary">
                  {donation.isAnonymous
                    ? 'Anonymous'
                    : donation.donorName ?? 'Unknown'}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-semibold text-theme-text-primary">
                  {formatCurrency(Number(donation.amount))}
                </td>
                <td className="px-4 py-3 text-sm text-theme-text-secondary">
                  {donation.campaignId ? (
                    <Link
                      to={`/grants/campaigns/${donation.campaignId}`}
                      className="text-red-600 hover:text-red-700 hover:underline"
                    >
                      View Campaign
                    </Link>
                  ) : (
                    <span className="text-theme-text-secondary">--</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-theme-text-secondary">
                  {PAYMENT_METHOD_LABELS[donation.paymentMethod] ??
                    donation.paymentMethod}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
);

// =============================================================================
// Main Dashboard Component
// =============================================================================

const GrantsDashboardPage: React.FC = () => {
  const tz = useTimezone();
  const { dashboard, isLoading, error, fetchDashboard, clearError } =
    useGrantsStore();

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  useEffect(() => {
    if (error) {
      // Error is displayed inline; clear it after it renders
      const timer = setTimeout(() => {
        clearError();
      }, 10000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [error, clearError]);

  if (isLoading && !dashboard) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-theme-text-primary">
            Grants & Fundraising
          </h1>
          <p className="mt-1 text-sm text-theme-text-secondary">
            Overview of grants, campaigns, and fundraising activity
          </p>
        </div>
        <DashboardSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-theme-text-primary">
            Grants & Fundraising
          </h1>
          <p className="mt-1 text-sm text-theme-text-secondary">
            Overview of grants, campaigns, and fundraising activity
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/grants/applications/new"
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            <FileText className="h-4 w-4" />
            New Application
          </Link>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* KPI Row 1 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Total Grant Funding"
          value={formatCurrency(dashboard?.totalGrantFunding ?? 0)}
          icon={<DollarSign className="h-5 w-5 text-green-600" />}
          iconBgClass="bg-green-100"
          linkTo="/grants/applications"
        />
        <KpiCard
          label="Active Grants"
          value={String(dashboard?.activeGrants ?? 0)}
          icon={<FileText className="h-5 w-5 text-blue-600" />}
          iconBgClass="bg-blue-100"
          linkTo="/grants/applications?status=active"
        />
        <KpiCard
          label="Pending Applications"
          value={String(dashboard?.pendingApplications ?? 0)}
          icon={<Clock className="h-5 w-5 text-yellow-600" />}
          iconBgClass="bg-yellow-100"
          linkTo="/grants/applications?status=submitted"
        />
        <KpiCard
          label="Total Raised YTD"
          value={formatCurrency(dashboard?.totalRaisedYtd ?? 0)}
          icon={<TrendingUp className="h-5 w-5 text-emerald-600" />}
          iconBgClass="bg-emerald-100"
          linkTo="/grants/campaigns"
        />
      </div>

      {/* KPI Row 2 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Active Campaigns"
          value={String(dashboard?.activeCampaignsCount ?? 0)}
          icon={<Megaphone className="h-5 w-5 text-purple-600" />}
          iconBgClass="bg-purple-100"
          linkTo="/grants/campaigns?status=active"
        />
        <KpiCard
          label="Total Donors"
          value={String(dashboard?.totalDonors ?? 0)}
          icon={<Users className="h-5 w-5 text-indigo-600" />}
          iconBgClass="bg-indigo-100"
          linkTo="/grants/donors"
        />
        <KpiCard
          label="Outstanding Pledges"
          value={formatCurrency(dashboard?.outstandingPledges ?? 0)}
          icon={<HandCoins className="h-5 w-5 text-orange-600" />}
          iconBgClass="bg-orange-100"
          linkTo="/grants/pledges"
        />
        <KpiCard
          label="Total Raised (12mo)"
          value={formatCurrency(dashboard?.totalRaised12mo ?? 0)}
          icon={<BarChart3 className="h-5 w-5 text-teal-600" />}
          iconBgClass="bg-teal-100"
        />
      </div>

      {/* Grant Pipeline Summary */}
      <PipelineSummary items={dashboard?.pipelineSummary ?? []} />

      {/* Two-column: Upcoming Deadlines + Compliance Tasks */}
      <div className="grid gap-6 lg:grid-cols-2">
        <UpcomingDeadlines
          deadlines={dashboard?.upcomingDeadlines ?? []}
          timezone={tz}
        />
        <ComplianceTasksDue
          tasks={dashboard?.complianceTasksDue ?? []}
          timezone={tz}
        />
      </div>

      {/* Recent Donations */}
      <RecentDonationsTable
        donations={(dashboard?.recentDonations ?? []).slice(0, 10)}
        timezone={tz}
      />
    </div>
  );
};

export default GrantsDashboardPage;
