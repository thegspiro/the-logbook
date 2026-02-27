import React, { useState, useEffect, useCallback } from 'react';
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
import type { PlatformAnalytics, DailyCount, ModuleUsage } from '../types/platformAnalytics';

/**
 * Platform Analytics Dashboard
 *
 * Provides IT admins with a bird's-eye view of platform adoption,
 * module usage, operational activity, system health, and content metrics.
 */
const PlatformAnalyticsPage: React.FC = () => {
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
    const interval = setInterval(() => { void load(); }, 60000);

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
    link.download = `platform-analytics-${new Date().toISOString()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <div className="text-theme-text-secondary">Loading platform analytics...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <div className="text-center py-12">
          <p className="text-red-400 mb-4">{error ?? 'No analytics data available'}</p>
          <button
            onClick={() => { setLoading(true); void loadData(); }}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row justify-between items-start gap-4">
        <div>
          <h1 className="text-3xl font-bold text-theme-text-primary">Platform Analytics</h1>
          <p className="text-theme-text-secondary mt-1">
            Platform-wide usage and health metrics for IT administrators
          </p>
          {lastRefreshed && (
            <p className="text-xs text-theme-text-muted mt-1">
              Last refreshed: {lastRefreshed.toLocaleTimeString()}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { void loadData(); }}
            className="px-4 py-2 border border-theme-surface-border rounded-md text-sm font-medium text-theme-text-secondary bg-theme-surface hover:bg-theme-surface-hover flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          <button
            onClick={() => { void exportData(); }}
            className="px-4 py-2 border border-theme-surface-border rounded-md text-sm font-medium text-blue-400 bg-theme-surface hover:bg-theme-surface-hover flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>
      </div>

      {/* ── Section 1: User Adoption ── */}
      <SectionTitle>User Adoption</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon={Users} label="Total Users" value={data.totalUsers} />
        <StatCard icon={UserCheck} label="Active Users" sublabel="Last 30 days" value={data.activeUsers} color="green" />
        <StatCard icon={TrendingUp} label="Adoption Rate" value={`${data.adoptionRate}%`} color={data.adoptionRate >= 75 ? 'green' : data.adoptionRate >= 50 ? 'yellow' : 'red'} />
        <StatCard icon={UserPlus} label="New Users" sublabel="Last 30 days" value={data.newUsersLast30Days} color="blue" />
      </div>

      {/* Login Trend Chart */}
      {data.loginTrend.length > 0 && (
        <div className="bg-theme-surface backdrop-blur-sm rounded-lg shadow-md p-6 mb-6">
          <h3 className="text-lg font-semibold text-theme-text-primary mb-4">Daily Login Activity (30 Days)</h3>
          <BarChart data={data.loginTrend} color="blue" />
        </div>
      )}

      {/* ── Section 2: Module Usage ── */}
      <SectionTitle>Module Usage</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {data.modules.map((mod) => (
          <ModuleCard key={mod.name} module={mod} />
        ))}
      </div>

      {/* ── Section 3: Operational Activity ── */}
      <SectionTitle>Operational Activity</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <StatCard icon={Calendar} label="Total Events" value={data.totalEvents} />
        <StatCard icon={Calendar} label="Events" sublabel="Last 30 days" value={data.eventsLast30Days} color="blue" />
        <StatCard icon={CheckSquare} label="Total Check-Ins" value={data.totalCheckIns} color="green" />
        <StatCard icon={Clock} label="Training Hours" sublabel="Last 30 days" value={data.trainingHoursLast30Days} color="purple" />
        <StatCard icon={FileText} label="Forms Submitted" sublabel="Last 30 days" value={data.formsSubmittedLast30Days} />
      </div>

      {/* ── Section 4: System Health ── */}
      <SectionTitle>System Health</SectionTitle>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <StatCard
          icon={AlertTriangle}
          label="Errors"
          sublabel="Last 7 days"
          value={data.errorsLast7Days}
          color={data.errorsLast7Days === 0 ? 'green' : data.errorsLast7Days < 10 ? 'yellow' : 'red'}
        />

        {/* Error Trend */}
        <div className="bg-theme-surface backdrop-blur-sm rounded-lg shadow-md p-6 lg:col-span-2">
          <h3 className="text-sm font-medium text-theme-text-muted mb-3">Error Trend (7 Days)</h3>
          {data.errorTrend.length > 0 ? (
            <BarChart data={data.errorTrend} color="red" />
          ) : (
            <p className="text-theme-text-muted text-sm">No error data</p>
          )}
        </div>
      </div>

      {/* Top Error Types */}
      {Object.keys(data.topErrorTypes).length > 0 && (
        <div className="bg-theme-surface backdrop-blur-sm rounded-lg shadow-md p-6 mb-6">
          <h3 className="text-lg font-semibold text-theme-text-primary mb-4">Top Error Types</h3>
          <div className="space-y-2">
            {Object.entries(data.topErrorTypes)
              .sort(([, a], [, b]) => b - a)
              .map(([errorType, count]) => (
                <div key={errorType} className="flex justify-between items-center">
                  <span className="text-sm text-theme-text-secondary truncate flex-1">{errorType}</span>
                  <span className="px-2 py-1 bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400 rounded text-xs font-semibold ml-2">
                    {count}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* ── Section 5: Content ── */}
      <SectionTitle>Content & Documents</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <StatCard icon={FileText} label="Total Documents" value={data.totalDocuments} />
        <StatCard icon={FileText} label="Documents Uploaded" sublabel="Last 30 days" value={data.documentsLast30Days} color="blue" />
      </div>
    </div>
  );
};

// ── Helper Components ──

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h2 className="text-xl font-semibold text-theme-text-primary mb-4 mt-2">{children}</h2>
);

interface StatCardProps {
  icon: React.FC<{ className?: string }>;
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

const StatCard: React.FC<StatCardProps> = ({ icon: Icon, label, sublabel, value, color }) => (
  <div className="bg-theme-surface backdrop-blur-sm rounded-lg shadow-md p-6">
    <div className="flex items-center gap-2 mb-1">
      <Icon className="w-4 h-4 text-theme-text-muted" />
      <span className="text-theme-text-muted text-sm font-medium">{label}</span>
    </div>
    {sublabel && <p className="text-xs text-theme-text-muted mb-1">{sublabel}</p>}
    <div className={`text-3xl font-bold ${color ? colorMap[color] ?? 'text-theme-text-primary' : 'text-theme-text-primary'}`}>
      {value}
    </div>
  </div>
);

interface ModuleCardProps {
  module: ModuleUsage;
}

const ModuleCard: React.FC<ModuleCardProps> = ({ module }) => {
  const formatDate = (iso: string | null) => {
    if (!iso) return 'Never';
    const d = new Date(iso);
    return d.toLocaleDateString();
  };

  return (
    <div className="bg-theme-surface backdrop-blur-sm rounded-lg shadow-md p-5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-theme-text-muted" />
          <span className="text-sm font-semibold text-theme-text-primary">{module.name}</span>
        </div>
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
          module.enabled
            ? 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400'
            : 'bg-gray-100 text-gray-600 dark:bg-gray-500/20 dark:text-gray-400'
        }`}>
          {module.enabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>
      <div className="text-2xl font-bold text-theme-text-primary mb-1">
        {module.recordCount.toLocaleString()}
      </div>
      <p className="text-xs text-theme-text-muted">records</p>
      <div className="flex items-center gap-1 mt-2 text-xs text-theme-text-muted">
        <Activity className="w-3 h-3" />
        <span>Last activity: {formatDate(module.lastActivity)}</span>
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
  const maxCount = Math.max(...data.map(d => d.count), 1);
  const colors = barColors[color];

  return (
    <div className="flex items-end justify-between gap-1 h-32">
      {data.map(({ date, count }) => {
        const heightPercent = (count / maxCount) * 100;
        // Show only day portion of date (DD)
        const dayLabel = date.split('-')[2] ?? date;

        return (
          <div key={date} className="flex-1 flex flex-col items-center min-w-0">
            <div
              className={`w-full ${colors.bar} ${colors.hover} rounded-t cursor-pointer transition-all`}
              style={{ height: `${Math.max(heightPercent, count > 0 ? 2 : 0)}%` }}
              title={`${date}: ${count}`}
            />
            <div className="text-[10px] text-theme-text-muted mt-1 truncate w-full text-center">{dayLabel}</div>
          </div>
        );
      })}
    </div>
  );
};

export default PlatformAnalyticsPage;
