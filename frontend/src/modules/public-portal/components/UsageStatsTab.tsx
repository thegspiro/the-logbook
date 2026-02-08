/**
 * Usage Statistics Tab
 *
 * Dashboard displaying public portal usage metrics and analytics.
 */

import React from 'react';
import { useUsageStats } from '../hooks/usePublicPortal';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  color: 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'indigo';
}

const StatCard: React.FC<StatCardProps> = ({ title, value, subtitle, icon, color }) => {
  const colorClasses = {
    blue: 'bg-blue-100 text-blue-600',
    green: 'bg-green-100 text-green-600',
    yellow: 'bg-yellow-100 text-yellow-600',
    red: 'bg-red-100 text-red-600',
    purple: 'bg-purple-100 text-purple-600',
    indigo: 'bg-indigo-100 text-indigo-600',
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-600">{title}</p>
          <p className="mt-2 text-3xl font-semibold text-gray-900">{value}</p>
          {subtitle && (
            <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
          )}
        </div>
        <div className={`p-3 rounded-lg ${colorClasses[color]}`}>
          {icon}
        </div>
      </div>
    </div>
  );
};

interface EndpointStatsProps {
  endpoint: string;
  count: number;
  percentage: number;
}

const EndpointBar: React.FC<EndpointStatsProps> = ({ endpoint, count, percentage }) => {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="font-mono text-gray-700">{endpoint}</span>
        <span className="text-gray-500">{count.toLocaleString()} ({percentage.toFixed(1)}%)</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className="bg-blue-600 h-2 rounded-full transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
};

export const UsageStatsTab: React.FC = () => {
  const { stats, loading, error, refetch } = useUsageStats();

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4">
        <p className="text-red-800">Error loading usage statistics: {error}</p>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-md p-8 text-center">
        <p className="text-gray-600">No usage statistics available</p>
      </div>
    );
  }

  // Calculate endpoint usage percentages
  const totalEndpointRequests = Object.values(stats.endpoint_usage || {}).reduce((sum, count) => sum + count, 0);
  const endpointStats = Object.entries(stats.endpoint_usage || {})
    .map(([endpoint, count]) => ({
      endpoint,
      count,
      percentage: totalEndpointRequests > 0 ? (count / totalEndpointRequests) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10); // Top 10 endpoints

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Usage Statistics</h3>
          <p className="text-sm text-gray-600 mt-1">
            Public portal usage metrics and analytics
          </p>
        </div>
        <button
          onClick={refetch}
          className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
        >
          <svg className="w-5 h-5 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Request Volume Cards */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Request Volume</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard
            title="Last 24 Hours"
            value={stats.total_requests_24h.toLocaleString()}
            subtitle={`Avg: ${Math.round(stats.total_requests_24h / 24)}/hour`}
            color="blue"
            icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            }
          />
          <StatCard
            title="Last 7 Days"
            value={stats.total_requests_7d.toLocaleString()}
            subtitle={`Avg: ${Math.round(stats.total_requests_7d / 7)}/day`}
            color="green"
            icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            }
          />
          <StatCard
            title="Last 30 Days"
            value={stats.total_requests_30d.toLocaleString()}
            subtitle={`Avg: ${Math.round(stats.total_requests_30d / 30)}/day`}
            color="purple"
            icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            }
          />
        </div>
      </div>

      {/* Key Metrics */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Key Metrics</h4>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <StatCard
            title="Active API Keys"
            value={stats.active_api_keys}
            color="indigo"
            icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
            }
          />
          <StatCard
            title="Unique IPs (24h)"
            value={stats.unique_ips_24h}
            color="blue"
            icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
              </svg>
            }
          />
          <StatCard
            title="Rate Limits Hit"
            value={stats.rate_limit_hits_24h}
            subtitle="Last 24 hours"
            color="yellow"
            icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            }
          />
          <StatCard
            title="Suspicious Activity"
            value={stats.flagged_suspicious_24h}
            subtitle="Last 24 hours"
            color="red"
            icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            }
          />
        </div>
      </div>

      {/* Response Status Distribution */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Response Status Distribution (24h)</h4>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <StatCard
            title="2xx Success"
            value={stats.status_2xx_24h}
            color="green"
            icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          />
          <StatCard
            title="4xx Client Error"
            value={stats.status_4xx_24h}
            color="yellow"
            icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          />
          <StatCard
            title="5xx Server Error"
            value={stats.status_5xx_24h}
            color="red"
            icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          />
          <StatCard
            title="Avg Response Time"
            value={`${stats.avg_response_time_ms}ms`}
            color="blue"
            icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          />
          <StatCard
            title="Error Rate"
            value={`${stats.error_rate_percentage.toFixed(2)}%`}
            subtitle="4xx + 5xx errors"
            color={stats.error_rate_percentage > 5 ? 'red' : stats.error_rate_percentage > 2 ? 'yellow' : 'green'}
            icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            }
          />
        </div>
      </div>

      {/* Endpoint Usage */}
      {endpointStats.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Top Endpoints (All Time)</h4>
          <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
            {endpointStats.map((stat) => (
              <EndpointBar
                key={stat.endpoint}
                endpoint={stat.endpoint}
                count={stat.count}
                percentage={stat.percentage}
              />
            ))}
            {Object.keys(stats.endpoint_usage || {}).length > 10 && (
              <p className="text-xs text-gray-500 text-center pt-2">
                Showing top 10 of {Object.keys(stats.endpoint_usage || {}).length} endpoints
              </p>
            )}
          </div>
        </div>
      )}

      {/* Alerts */}
      {(stats.error_rate_percentage > 5 || stats.flagged_suspicious_24h > 10 || stats.rate_limit_hits_24h > 50) && (
        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-yellow-800">Attention Required</h3>
              <div className="mt-2 text-sm text-yellow-700">
                <ul className="list-disc list-inside space-y-1">
                  {stats.error_rate_percentage > 5 && (
                    <li>High error rate detected ({stats.error_rate_percentage.toFixed(2)}%)</li>
                  )}
                  {stats.flagged_suspicious_24h > 10 && (
                    <li>Elevated suspicious activity ({stats.flagged_suspicious_24h} incidents in 24h)</li>
                  )}
                  {stats.rate_limit_hits_24h > 50 && (
                    <li>Frequent rate limiting ({stats.rate_limit_hits_24h} hits in 24h)</li>
                  )}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
