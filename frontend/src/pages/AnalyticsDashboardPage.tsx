import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { analyticsService, type QRCodeMetrics } from '../services/analytics';

/**
 * Analytics Dashboard
 *
 * Displays QR code check-in analytics and metrics.
 * Can show metrics for a specific event or overall platform metrics.
 * Data is fetched from the backend API.
 */
const AnalyticsDashboardPage: React.FC = () => {
  const { id: eventId } = useParams<{ id?: string }>();
  const [metrics, setMetrics] = useState<QRCodeMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadMetrics = async () => {
      try {
        const data = eventId
          ? await analyticsService.getEventMetrics(eventId)
          : await analyticsService.getOverallMetrics();
        setMetrics(data);
        setError(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load analytics';
        setError(message);
      }
    };

    loadMetrics();
    const interval = setInterval(loadMetrics, 10000); // Refresh every 10 seconds

    return () => clearInterval(interval);
  }, [eventId]);

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

  if (error && !metrics) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-red-700 dark:text-red-400 mb-2">Unable to load analytics</p>
          <p className="text-theme-text-muted text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-theme-text-secondary">Loading analytics...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6 flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-theme-text-primary">QR Code Analytics</h1>
          <p className="text-theme-text-secondary mt-1">
            {eventId ? 'Event-specific metrics' : 'Platform-wide metrics'}
          </p>
        </div>
        <button
          onClick={exportData}
          className="px-4 py-2 border border-white/30 rounded-md text-sm font-medium text-blue-700 dark:text-blue-400 bg-theme-surface hover:bg-theme-surface-hover"
        >
          Export Data
        </button>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-theme-surface backdrop-blur-sm rounded-lg shadow-md p-6">
          <div className="text-theme-text-muted text-sm font-medium mb-1">Total Scans</div>
          <div className="text-3xl font-bold text-blue-600">{metrics.totalScans}</div>
        </div>

        <div className="bg-theme-surface backdrop-blur-sm rounded-lg shadow-md p-6">
          <div className="text-theme-text-muted text-sm font-medium mb-1">Successful Check-Ins</div>
          <div className="text-3xl font-bold text-green-600">{metrics.successfulCheckIns}</div>
        </div>

        <div className="bg-theme-surface backdrop-blur-sm rounded-lg shadow-md p-6">
          <div className="text-theme-text-muted text-sm font-medium mb-1">Success Rate</div>
          <div className="text-3xl font-bold text-theme-text-primary">{metrics.successRate}%</div>
        </div>

        <div className="bg-theme-surface backdrop-blur-sm rounded-lg shadow-md p-6">
          <div className="text-theme-text-muted text-sm font-medium mb-1">Avg Time to Check-In</div>
          <div className="text-3xl font-bold text-theme-text-primary">{metrics.avgTimeToCheckIn}s</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Device Breakdown */}
        <div className="bg-theme-surface backdrop-blur-sm rounded-lg shadow-md p-6">
          <h2 className="text-lg font-semibold text-theme-text-primary mb-4">Device Breakdown</h2>
          <div className="space-y-3">
            {Object.entries(metrics.deviceBreakdown).map(([device, count]) => {
              const total = Object.values(metrics.deviceBreakdown).reduce((a, b) => a + b, 0);
              const percentage = total > 0 ? (count / total) * 100 : 0;

              return (
                <div key={device} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="capitalize">{device}</span>
                    <span className="font-medium">
                      {count} ({Math.round(percentage)}%)
                    </span>
                  </div>
                  <div className="w-full bg-theme-surface rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${percentage}%` }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Error Breakdown */}
        <div className="bg-theme-surface backdrop-blur-sm rounded-lg shadow-md p-6">
          <h2 className="text-lg font-semibold text-theme-text-primary mb-4">Error Breakdown</h2>
          {Object.keys(metrics.errorBreakdown).length === 0 ? (
            <div className="text-center py-8 text-theme-text-muted">
              <svg
                className="mx-auto h-12 w-12 text-green-700 dark:text-green-400 mb-2"
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
                  <div key={errorType} className="flex justify-between items-center">
                    <span className="text-sm text-theme-text-primary truncate flex-1">{errorType}</span>
                    <span className="px-2 py-1 bg-red-100 text-red-800 rounded text-xs font-semibold ml-2">
                      {count}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* Hourly Activity */}
      <div className="bg-theme-surface backdrop-blur-sm rounded-lg shadow-md p-6 mb-6">
        <h2 className="text-lg font-semibold text-theme-text-primary mb-4">Activity by Hour</h2>
        <div className="flex items-end justify-between gap-1 h-48">
          {metrics.hourlyActivity.map(({ hour, count }) => {
            const maxCount = Math.max(...metrics.hourlyActivity.map(h => h.count), 1);
            const heightPercent = (count / maxCount) * 100;

            return (
              <div key={hour} className="flex-1 flex flex-col items-center">
                <div
                  className="w-full bg-blue-600 hover:bg-blue-700 rounded-t cursor-pointer transition-all"
                  style={{ height: `${heightPercent}%` }}
                  title={`${hour}:00 - ${count} events`}
                ></div>
                <div className="text-xs text-theme-text-muted mt-1">{hour}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Check-In Trends */}
      {metrics.checkInTrends.length > 0 && (
        <div className="bg-theme-surface backdrop-blur-sm rounded-lg shadow-md p-6">
          <h2 className="text-lg font-semibold text-theme-text-primary mb-4">
            Check-In Trends (Last 24 Hours)
          </h2>
          <div className="overflow-x-auto">
            <div className="flex items-end gap-2 min-w-max h-32">
              {metrics.checkInTrends.map(({ time, count }, index) => {
                const maxCount = Math.max(...metrics.checkInTrends.map(t => t.count), 1);
                const heightPercent = (count / maxCount) * 100;

                return (
                  <div key={index} className="flex flex-col items-center">
                    <div
                      className="w-8 bg-green-600 hover:bg-green-700 rounded-t cursor-pointer transition-all"
                      style={{ height: `${heightPercent}px` }}
                      title={`${time.toLocaleTimeString()} - ${count} check-ins`}
                    ></div>
                    <div className="text-xs text-theme-text-muted mt-1 whitespace-nowrap">
                      {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
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
