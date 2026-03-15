/**
 * Finance Dashboard Page
 *
 * Overview dashboard showing budget health gauges, pending approvals,
 * dues collection rate, and quick links to all finance sub-pages.
 */

import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  DollarSign,
  FileText,
  Clock,
  CreditCard,
  Users,
  ChevronRight,
  AlertTriangle,
  Settings,
  Receipt,
  ClipboardList,
  PiggyBank,
  BarChart3,
  ShieldCheck,
} from 'lucide-react';
import { useFinanceStore } from '../store/financeStore';
import { formatCurrencyWhole } from '@/utils/currencyFormatting';
import { Skeleton } from '@/components/ux/Skeleton';

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
// Budget Health Gauge Component
// =============================================================================

interface BudgetGaugeProps {
  label: string;
  amount: number;
  total: number;
  colorClass: string;
}

const BudgetGauge: React.FC<BudgetGaugeProps> = ({
  label,
  amount,
  total,
  colorClass,
}) => {
  const pct = total > 0 ? Math.min((amount / total) * 100, 100) : 0;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="text-theme-text-secondary">{label}</span>
        <span className="font-medium text-theme-text-primary">
          {formatCurrencyWhole(amount)}
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
        <div
          className={`h-full rounded-full transition-all ${colorClass}`}
          style={{ width: `${String(pct)}%` }}
        />
      </div>
      <p className="mt-0.5 text-xs text-theme-text-secondary">
        {pct.toFixed(1)}% of {formatCurrencyWhole(total)}
      </p>
    </div>
  );
};

// =============================================================================
// Quick Link Card Component
// =============================================================================

interface QuickLinkProps {
  to: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}

const QuickLinkCard: React.FC<QuickLinkProps> = ({
  to,
  icon,
  title,
  description,
}) => (
  <Link
    to={to}
    className="group flex items-center gap-3 rounded-lg border border-theme-surface-border bg-theme-surface p-4 transition-all hover:shadow-md hover:border-red-200"
  >
    <div className="rounded-lg bg-red-50 dark:bg-red-500/10 p-2 text-red-600 dark:text-red-400 group-hover:bg-red-100 dark:group-hover:bg-red-500/20">
      {icon}
    </div>
    <div className="min-w-0 flex-1">
      <p className="text-sm font-medium text-theme-text-primary">{title}</p>
      <p className="truncate text-xs text-theme-text-secondary">{description}</p>
    </div>
    <ChevronRight className="h-4 w-4 shrink-0 text-theme-text-secondary group-hover:text-red-600" />
  </Link>
);

// =============================================================================
// Dashboard Loading Skeleton
// =============================================================================

const DashboardSkeleton: React.FC = () => (
  <div className="space-y-6" aria-label="Loading dashboard" role="status">
    <span className="sr-only">Loading...</span>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={`kpi-${String(i)}`}
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
    <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-6">
      <Skeleton className="mb-4 h-5 w-32" />
      <div className="space-y-4">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    </div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={`ql-${String(i)}`}
          className="rounded-lg border border-theme-surface-border bg-theme-surface p-4"
        >
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10" rounded="lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
);

// =============================================================================
// Main Dashboard Component
// =============================================================================

const FinanceDashboardPage: React.FC = () => {
  const { dashboard, isLoading, error, fetchDashboard } = useFinanceStore();

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  if (isLoading && !dashboard) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-theme-text-primary">
            Finance
          </h1>
          <p className="mt-1 text-sm text-theme-text-secondary">
            Financial management overview
          </p>
        </div>
        <DashboardSkeleton />
      </div>
    );
  }

  const budgetHealth = dashboard?.budgetHealth;
  const totalBudgeted = budgetHealth?.totalBudgeted ?? 0;
  const totalSpent = budgetHealth?.totalSpent ?? 0;
  const totalEncumbered = budgetHealth?.totalEncumbered ?? 0;
  const totalRemaining = budgetHealth?.totalRemaining ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-theme-text-primary">Finance</h1>
        <p className="mt-1 text-sm text-theme-text-secondary">
          Financial management overview
        </p>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Total Budgeted"
          value={formatCurrencyWhole(totalBudgeted)}
          icon={<DollarSign className="h-5 w-5 text-green-600" />}
          iconBgClass="bg-green-100"
          linkTo="/finance/budgets"
        />
        <KpiCard
          label="Total Spent"
          value={formatCurrencyWhole(totalSpent)}
          icon={<CreditCard className="h-5 w-5 text-blue-600" />}
          iconBgClass="bg-blue-100"
          linkTo="/finance/budgets"
        />
        <KpiCard
          label="Pending Approvals"
          value={String(dashboard?.pendingApprovalsCount ?? 0)}
          icon={<Clock className="h-5 w-5 text-yellow-600" />}
          iconBgClass="bg-yellow-100"
        />
        <KpiCard
          label="Dues Collection"
          value={`${String(Math.round(dashboard?.duesCollectionRate ?? 0))}%`}
          icon={<Users className="h-5 w-5 text-purple-600" />}
          iconBgClass="bg-purple-100"
          linkTo="/finance/dues"
        />
      </div>

      {/* Budget Health Gauges */}
      <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-6">
        <h2 className="mb-4 text-sm font-semibold text-theme-text-primary">
          Budget Health
        </h2>
        <div className="space-y-4">
          <BudgetGauge
            label="Spent"
            amount={totalSpent}
            total={totalBudgeted}
            colorClass="bg-blue-500"
          />
          <BudgetGauge
            label="Encumbered"
            amount={totalEncumbered}
            total={totalBudgeted}
            colorClass="bg-yellow-500"
          />
          <BudgetGauge
            label="Remaining"
            amount={totalRemaining}
            total={totalBudgeted}
            colorClass="bg-green-500"
          />
        </div>
      </div>

      {/* Pending Items Summary */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Link
          to="/finance/purchase-requests"
          className="flex items-center justify-between rounded-lg border border-theme-surface-border bg-theme-surface p-4 transition-shadow hover:shadow-md"
        >
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-indigo-500" />
            <span className="text-sm text-theme-text-secondary">
              Pending Purchase Requests
            </span>
          </div>
          <span className="text-lg font-bold text-theme-text-primary">
            {dashboard?.pendingPurchaseRequests ?? 0}
          </span>
        </Link>
        <Link
          to="/finance/expenses"
          className="flex items-center justify-between rounded-lg border border-theme-surface-border bg-theme-surface p-4 transition-shadow hover:shadow-md"
        >
          <div className="flex items-center gap-3">
            <Receipt className="h-5 w-5 text-orange-500" />
            <span className="text-sm text-theme-text-secondary">
              Pending Expense Reports
            </span>
          </div>
          <span className="text-lg font-bold text-theme-text-primary">
            {dashboard?.pendingExpenseReports ?? 0}
          </span>
        </Link>
        <Link
          to="/finance/check-requests"
          className="flex items-center justify-between rounded-lg border border-theme-surface-border bg-theme-surface p-4 transition-shadow hover:shadow-md"
        >
          <div className="flex items-center gap-3">
            <CreditCard className="h-5 w-5 text-teal-500" />
            <span className="text-sm text-theme-text-secondary">
              Pending Check Requests
            </span>
          </div>
          <span className="text-lg font-bold text-theme-text-primary">
            {dashboard?.pendingCheckRequests ?? 0}
          </span>
        </Link>
      </div>

      {/* Quick Links */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-theme-text-primary">
          Quick Links
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <QuickLinkCard
            to="/finance/budgets"
            icon={<BarChart3 className="h-5 w-5" />}
            title="Budgets"
            description="View and manage budget allocations"
          />
          <QuickLinkCard
            to="/finance/purchase-requests"
            icon={<ClipboardList className="h-5 w-5" />}
            title="Purchase Requests"
            description="Submit and track purchase requests"
          />
          <QuickLinkCard
            to="/finance/expenses"
            icon={<Receipt className="h-5 w-5" />}
            title="Expense Reports"
            description="Submit expense reimbursements"
          />
          <QuickLinkCard
            to="/finance/check-requests"
            icon={<CreditCard className="h-5 w-5" />}
            title="Check Requests"
            description="Request check payments"
          />
          <QuickLinkCard
            to="/finance/dues"
            icon={<PiggyBank className="h-5 w-5" />}
            title="Dues Management"
            description="Manage member dues and payments"
          />
          <QuickLinkCard
            to="/finance/settings"
            icon={<Settings className="h-5 w-5" />}
            title="Settings"
            description="Fiscal years and categories"
          />
          <QuickLinkCard
            to="/finance/settings/approval-chains"
            icon={<ShieldCheck className="h-5 w-5" />}
            title="Approval Chains"
            description="Configure approval workflows"
          />
        </div>
      </div>
    </div>
  );
};

export default FinanceDashboardPage;
