import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router';
import { analyticsService, type QRCodeMetrics } from '../services/analytics';
import { useTimezone } from '../hooks/useTimezone';
import { formatTime } from '../utils/dateFormatting';

/**
 * Analytics Dashboard
 *
 * Displays QR code check-in analytics and metrics.
 * Can show metrics for a specific event or overall platform metrics.
 * Data is fetched from the backend API.
 */
const AnalyticsDashboardPage: React.FC = () => {
  const { id: eventId } = useParams<{ id?: string }>();
  const tz = useTimezone();
  const [metrics, setMetrics] = useState<QRCodeMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMetrics = useCallback(async () => {
    setLoading(true);
    try {
      const data = eventId
        ? await analyticsService.getEventMetrics(eventId)
        : await analyticsService.getOverallMetrics();
      setMetrics(data);
      setError(null);
    } catch {
      setError('Failed to load analytics data');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void loadMetrics();
    const interval = setInterval(() => {
      if (!document.hidden) void loadMetrics();
    }, 10000); // Refresh every 10 seconds

    return () => clearInterval(interval);
  }, [loadMetrics]);

  const exportData = async () => {
    const dataStr = await analyticsService.exportAnalytics(eventId);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `analytics-${eventId || 'overall'}-${new Date().toISOString()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-theme-text-secondary">Loading analytics...</div>
      </div>
    );
  }

  if (error || !metrics) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="mb-4 text-red-700 dark:text-red-400">{error || 'No analytics data available'}</p>
          <button
            onClick={() => {
              void loadMetrics();
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
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-theme-text-primary text-3xl font-bold">QR Code Analytics</h1>
          <p className="text-theme-text-secondary mt-1">
            {eventId ? 'Event-specific metrics' : 'Platform-wide metrics'}
          </p>
        </div>
        <button
          onClick={() => {
            void exportData();
          }}
          className="border-theme-surface-border bg-theme-surface hover:bg-theme-surface-hover rounded-md border px-4 py-2 text-sm font-medium text-blue-700 dark:text-blue-400"
        >
          Export Data
        </button>
      </div>

      {/* Key Metrics */}
      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="bg-theme-surface rounded-lg p-6 shadow-md backdrop-blur-xs">
          <div className="text-theme-text-muted mb-1 text-sm font-medium">Total Scans</div>
          <div className="text-3xl font-bold text-blue-600">{metrics.totalScans}</div>
        </div>

        <div className="bg-theme-surface rounded-lg p-6 shadow-md backdrop-blur-xs">
          <div className="text-theme-text-muted mb-1 text-sm font-medium">Successful Check-Ins</div>
          <div className="text-3xl font-bold text-green-600">{metrics.successfulCheckIns}</div>
        </div>

        <div className="bg-theme-surface rounded-lg p-6 shadow-md backdrop-blur-xs">
          <div className="text-theme-text-muted mb-1 text-sm font-medium">Success Rate</div>
          <div className="text-theme-text-primary text-3xl font-bold">{metrics.successRate}%</div>
        </div>

        <div className="bg-theme-surface rounded-lg p-6 shadow-md backdrop-blur-xs">
          <div className="text-theme-text-muted mb-1 text-sm font-medium">Avg Time to Check-In</div>
          <div className="text-theme-text-primary text-3xl font-bold">{metrics.avgTimeToCheckIn}s</div>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Device Breakdown */}
        <div className="bg-theme-surface rounded-lg p-6 shadow-md backdrop-blur-xs">
          <h2 className="text-theme-text-primary mb-4 text-lg font-semibold">Device Breakdown</h2>
          <div className="space-y-3">
            {Object.entries(metrics.deviceBreakdown || {}).map(([device, count]) => {
              const total = Object.values(metrics.deviceBreakdown || {}).reduce((a, b) => a + b, 0);
              const percentage = total > 0 ? (count / total) * 100 : 0;

              return (
                <div key={device} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="capitalize">{device}</span>
                    <span className="font-medium">
                      {count} ({Math.round(percentage)}%)
                    </span>
                  </div>
                  <div className="bg-theme-surface-secondary h-2 w-full rounded-full">
                    <div
                      className="h-2 rounded-full bg-blue-600 transition-all duration-300"
                      style={{ width: `${percentage}%` }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Error Breakdown */}
        <div className="bg-theme-surface rounded-lg p-6 shadow-md backdrop-blur-xs">
          <h2 className="text-theme-text-primary mb-4 text-lg font-semibold">Error Breakdown</h2>
          {Object.keys(metrics.errorBreakdown).length === 0 ? (
            <div className="text-theme-text-muted py-8 text-center">
              <svg
                className="mx-auto mb-2 h-12 w-12 text-green-700 dark:text-green-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <p>No errors reported!</p>
            </div>
          ) : (
            <div className="space-y-2">
              {Object.entries(metrics.errorBreakdown)
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
          )}
        </div>
      </div>

      {/* Hourly Activity */}
      <div className="bg-theme-surface mb-6 rounded-lg p-6 shadow-md backdrop-blur-xs">
        <h2 className="text-theme-text-primary mb-4 text-lg font-semibold">Activity by Hour</h2>
        <div className="flex h-48 items-end justify-between gap-1">
          {(metrics.hourlyActivity || []).map(({ hour, count }) => {
            const maxCount = Math.max(...(metrics.hourlyActivity || []).map((h) => h.count), 1);
            const heightPercent = (count / maxCount) * 100;

            return (
              <div key={hour} className="flex flex-1 flex-col items-center">
                <div
                  className="w-full cursor-pointer rounded-t bg-blue-600 transition-all hover:bg-blue-700"
                  style={{ height: `${heightPercent}%` }}
                  title={`${hour}:00 - ${count} events`}
                ></div>
                <div className="text-theme-text-muted mt-1 text-xs">{hour}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Check-In Trends */}
      {(metrics.checkInTrends || []).length > 0 && (
        <div className="bg-theme-surface rounded-lg p-6 shadow-md backdrop-blur-xs">
          <h2 className="text-theme-text-primary mb-4 text-lg font-semibold">Check-In Trends (Last 24 Hours)</h2>
          <div className="overflow-x-auto">
            <div className="flex h-32 min-w-max items-end gap-2">
              {(metrics.checkInTrends || []).map(({ time, count }, index) => {
                const maxCount = Math.max(...(metrics.checkInTrends || []).map((t) => t.count), 1);
                const heightPercent = (count / maxCount) * 100;

                return (
                  <div key={index} className="flex flex-col items-center">
                    <div
                      className="w-8 cursor-pointer rounded-t bg-green-600 transition-all hover:bg-green-700"
                      style={{ height: `${heightPercent}px` }}
                      title={`${formatTime(time, tz)} - ${count} check-ins`}
                    ></div>
                    <div className="text-theme-text-muted mt-1 text-xs whitespace-nowrap">{formatTime(time, tz)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AnalyticsDashboardPage;
