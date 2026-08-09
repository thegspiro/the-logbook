import React, { useState, useEffect, useCallback } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Users,
  UserCheck,
  UserPlus,
  TrendingUp,
  Calendar,
  CheckSquare,
  Clock,
  FileText,
  AlertTriangle,
  Package,
  Activity,
  Download,
  RefreshCw,
} from 'lucide-react';
import { platformAnalyticsService } from '../services/api';
import { formatTime, formatDate, formatNumber, getTodayLocalDate } from '../utils/dateFormatting';
import { useTimezone } from '../hooks/useTimezone';
import type { PlatformAnalytics, DailyCount, ModuleUsage } from '../types/platformAnalytics';

/**
 * Platform Analytics Dashboard
 *
 * Provides IT admins with a bird's-eye view of platform adoption,
 * module usage, operational activity, system health, and content metrics.
 */
const PlatformAnalyticsPage: React.FC = () => {
  const tz = useTimezone();
  const [data, setData] = useState<PlatformAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const loadData = useCallback(async () => {
    try {
      const analytics = await platformAnalyticsService.getAnalytics();
      setData(analytics);
      setError(null);
      setLastRefreshed(new Date());
    } catch {
      setError('Failed to load platform analytics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const analytics = await platformAnalyticsService.getAnalytics().catch(() => null);
      if (!cancelled && analytics) {
        setData(analytics);
        setLastRefreshed(new Date());
      }
      if (!cancelled) setLoading(false);
    };

    void load();
    const interval = setInterval(() => {
      void load();
    }, 60000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const exportData = useCallback(async () => {
    const analytics = await platformAnalyticsService.exportAnalytics();
    const dataBlob = new Blob([JSON.stringify(analytics, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `platform-analytics-${getTodayLocalDate(tz)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, [tz]);

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl p-6">
        <div className="text-theme-text-secondary">Loading platform analytics...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-7xl p-6">
        <div className="py-12 text-center">
          <p className="mb-4 text-red-700 dark:text-red-400">{error ?? 'No analytics data available'}</p>
          <button
            onClick={() => {
              setLoading(true);
              void loadData();
            }}
            className="btn-primary rounded-md text-sm font-medium"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-7xl p-6">
      {/* Header */}
      <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row">
        <div>
          <h1 className="text-theme-text-primary text-3xl font-bold">Platform Analytics</h1>
          <p className="text-theme-text-secondary mt-1">Platform-wide usage and health metrics for IT administrators</p>
          {lastRefreshed && (
            <p className="text-theme-text-muted mt-1 text-xs">Last refreshed: {formatTime(lastRefreshed, tz)}</p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              void loadData();
            }}
            className="border-theme-surface-border text-theme-text-secondary bg-theme-surface hover:bg-theme-surface-hover flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
          <button
            onClick={() => {
              void exportData();
            }}
            className="border-theme-surface-border bg-theme-surface hover:bg-theme-surface-hover flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium text-blue-700 dark:text-blue-400"
          >
            <Download className="h-4 w-4" />
            Export
          </button>
        </div>
      </div>

      {/* ── Section 1: User Adoption ── */}
      <SectionTitle>User Adoption</SectionTitle>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Users} label="Total Users" value={data.totalUsers} />
        <StatCard
          icon={UserCheck}
          label="Active Users"
          sublabel="Last 30 days"
          value={data.activeUsers}
          color="green"
        />
        <StatCard
          icon={TrendingUp}
          label="Adoption Rate"
          value={`${data.adoptionRate}%`}
          color={data.adoptionRate >= 75 ? 'green' : data.adoptionRate >= 50 ? 'yellow' : 'red'}
        />
        <StatCard
          icon={UserPlus}
          label="New Users"
          sublabel="Last 30 days"
          value={data.newUsersLast30Days}
          color="blue"
        />
      </div>

      {/* Login Trend Chart */}
      {(data.loginTrend?.length ?? 0) > 0 && (
        <div className="bg-theme-surface mb-6 rounded-lg p-6 shadow-md backdrop-blur-xs">
          <h3 className="text-theme-text-primary mb-4 text-lg font-semibold">Daily Login Activity (30 Days)</h3>
          <BarChart data={data.loginTrend} color="blue" />
        </div>
      )}

      {/* ── Section 2: Module Usage ── */}
      <SectionTitle>Module Usage</SectionTitle>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {data.modules.map((mod) => (
          <ModuleCard key={mod.name} module={mod} />
        ))}
      </div>

      {/* ── Section 3: Operational Activity ── */}
      <SectionTitle>Operational Activity</SectionTitle>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard icon={Calendar} label="Total Events" value={data.totalEvents} />
        <StatCard icon={Calendar} label="Events" sublabel="Last 30 days" value={data.eventsLast30Days} color="blue" />
        <StatCard icon={CheckSquare} label="Total Check-Ins" value={data.totalCheckIns} color="green" />
        <StatCard
          icon={Clock}
          label="Training Hours"
          sublabel="Last 30 days"
          value={data.trainingHoursLast30Days}
          color="purple"
        />
        <StatCard
          icon={FileText}
          label="Forms Submitted"
          sublabel="Last 30 days"
          value={data.formsSubmittedLast30Days}
        />
      </div>

      {/* ── Section 4: System Health ── */}
      <SectionTitle>System Health</SectionTitle>
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <StatCard
          icon={AlertTriangle}
          label="Errors"
          sublabel="Last 7 days"
          value={data.errorsLast7Days}
          color={data.errorsLast7Days === 0 ? 'green' : data.errorsLast7Days < 10 ? 'yellow' : 'red'}
        />

        {/* Error Trend */}
        <div className="bg-theme-surface rounded-lg p-6 shadow-md backdrop-blur-xs lg:col-span-2">
          <h3 className="text-theme-text-muted mb-3 text-sm font-medium">Error Trend (7 Days)</h3>
          {(data.errorTrend?.length ?? 0) > 0 ? (
            <BarChart data={data.errorTrend} color="red" />
          ) : (
            <p className="text-theme-text-muted text-sm">No error data</p>
          )}
        </div>
      </div>

      {/* Top Error Types */}
      {Object.keys(data.topErrorTypes ?? {}).length > 0 && (
        <div className="bg-theme-surface mb-6 rounded-lg p-6 shadow-md backdrop-blur-xs">
          <h3 className="text-theme-text-primary mb-4 text-lg font-semibold">Top Error Types</h3>
          <div className="space-y-2">
            {Object.entries(data.topErrorTypes ?? {})
              .sort(([, a], [, b]) => b - a)
              .map(([errorType, count]) => (
                <div key={errorType} className="flex items-center justify-between">
                  <span className="text-theme-text-secondary flex-1 truncate text-sm">{errorType}</span>
                  <span className="ml-2 rounded-sm bg-red-100 px-2 py-1 text-xs font-semibold text-red-800 dark:bg-red-500/20 dark:text-red-400">
                    {count}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* ── Section 5: Content ── */}
      <SectionTitle>Content & Documents</SectionTitle>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard icon={FileText} label="Total Documents" value={data.totalDocuments} />
        <StatCard
          icon={FileText}
          label="Documents Uploaded"
          sublabel="Last 30 days"
          value={data.documentsLast30Days}
          color="blue"
        />
      </div>
    </div>
  );
};

// ── Helper Components ──

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h2 className="text-theme-text-primary mt-2 mb-4 text-xl font-semibold">{children}</h2>
);

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  sublabel?: string;
  value: string | number;
  color?: 'blue' | 'green' | 'red' | 'yellow' | 'purple';
}

const colorMap: Record<string, string> = {
  blue: 'text-blue-600',
  green: 'text-green-600',
  red: 'text-red-600',
  yellow: 'text-yellow-600',
  purple: 'text-purple-600',
};

const StatCard: React.FC<StatCardProps> = ({ icon: Icon, label, sublabel, value, color }) => {
  const displayValue = typeof value === 'number' ? formatNumber(value ?? 0) : (value ?? '—');

  return (
    <div className="bg-theme-surface rounded-lg p-6 shadow-md backdrop-blur-xs">
      <div className="mb-1 flex items-center gap-2">
        <Icon className="text-theme-text-muted h-4 w-4" />
        <span className="text-theme-text-muted text-sm font-medium">{label}</span>
      </div>
      {sublabel && <p className="text-theme-text-muted mb-1 text-xs">{sublabel}</p>}
      <div
        className={`text-3xl font-bold ${color ? (colorMap[color] ?? 'text-theme-text-primary') : 'text-theme-text-primary'}`}
      >
        {displayValue}
      </div>
    </div>
  );
};

interface ModuleCardProps {
  module: ModuleUsage;
}

const ModuleCard: React.FC<ModuleCardProps> = ({ module }) => {
  const tz = useTimezone();

  return (
    <div className="bg-theme-surface rounded-lg p-5 shadow-md backdrop-blur-xs">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="text-theme-text-muted h-4 w-4" />
          <span className="text-theme-text-primary text-sm font-semibold">{module.name}</span>
        </div>
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${
            module.enabled
              ? 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400'
              : 'bg-theme-surface-secondary text-theme-text-muted'
          }`}
        >
          {module.enabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>
      <div className="text-theme-text-primary mb-1 text-2xl font-bold">{formatNumber(module.recordCount ?? 0)}</div>
      <p className="text-theme-text-muted text-xs">records</p>
      <div className="text-theme-text-muted mt-2 flex items-center gap-1 text-xs">
        <Activity className="h-3 w-3" />
        <span>Last activity: {module.lastActivity ? formatDate(module.lastActivity, tz) : 'Never'}</span>
      </div>
    </div>
  );
};

interface BarChartProps {
  data: DailyCount[];
  color: 'blue' | 'red' | 'green';
}

const barColors = {
  blue: { bar: 'bg-blue-600', hover: 'hover:bg-blue-700' },
  red: { bar: 'bg-red-600', hover: 'hover:bg-red-700' },
  green: { bar: 'bg-green-600', hover: 'hover:bg-green-700' },
} as const;

const BarChart: React.FC<BarChartProps> = ({ data, color }) => {
  const maxCount = Math.max(...data.map((d) => d.count), 1);
  const colors = barColors[color];

  return (
    <div className="overflow-x-auto">
      <div className="flex h-32 min-w-full items-end justify-between gap-1">
        {data.map(({ date, count }) => {
          const heightPercent = (count / maxCount) * 100;
          // Show only day portion of date (DD)
          const dayLabel = date.split('-')[2] ?? date;

          return (
            // Keep bars at a legible minimum width on phones (the row scrolls
            // horizontally) while still growing to fill wide screens.
            <div key={date} className="flex min-w-[20px] flex-1 flex-col items-center">
              <div
                className={`w-full ${colors.bar} ${colors.hover} cursor-pointer rounded-t transition-all`}
                style={{ height: `${Math.max(heightPercent, count > 0 ? 2 : 0)}%` }}
                title={`${date}: ${count}`}
              />
              <div className="text-theme-text-muted mt-1 w-full truncate text-center text-[10px]">{dayLabel}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PlatformAnalyticsPage;
