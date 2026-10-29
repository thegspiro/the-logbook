import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router';
import { analyticsService, type QRCodeMetrics } from '../services/analytics';
import { useTimezone } from '../hooks/useTimezone';
import { Breadcrumbs, SkeletonText } from '../components/ux';
import { QrCode } from 'lucide-react';
import { EventsPageHeader } from '../components/events/EventsPageHeader';
import { formatTime } from '../utils/dateFormatting';
import { StatGrid } from '../components/ux/StatGrid';

/**
 * Analytics Dashboard
 *
 * Displays QR code check-in analytics and metrics.
 * Can show metrics for a specific event or overall platform metrics.
 * Data is fetched from the backend API.
 */
// `embedded` is the Events Administration tab, whose hub frame already supplies
// the page's side gutter; the standalone routes keep their own padding.
const AnalyticsDashboardPage: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const shellPadding = embedded ? 'py-6' : 'p-6';
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
      setError('Could not load analytics.');
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

  // Only when an event scopes this page. Without an id it renders platform-wide
  // metrics reached from elsewhere, and a trail whose every crumb is the page
  // you are already on offers nothing to follow.
  const trail = eventId
    ? [
        { label: 'Events', path: '/events' },
        { label: 'Event', path: `/events/${eventId}` },
        { label: 'QR Code Analytics' },
      ]
    : undefined;

  const scopeLine = eventId ? 'Check-in scans for this event' : 'Check-in scans across all events';
  const exportButton = (
    <button
      onClick={() => {
        void exportData();
      }}
      className="btn-secondary shrink-0 self-start text-sm font-medium text-blue-700 sm:self-auto dark:text-blue-400"
    >
      Export Data
    </button>
  );

  const header = embedded ? (
    <div className="page-header mb-6 gap-3 sm:items-start">
      <div className="page-header-title">
        {/* Embedded, the Events hub's section nav already names this page,
            so the title stays for heading navigation only and the hub
            keeps the page's one <h1>. */}
        <h2 className="sr-only">QR Code Analytics</h2>
        <p className="text-theme-text-secondary">{scopeLine}</p>
      </div>
      {exportButton}
    </div>
  ) : (
    <EventsPageHeader
      icon={QrCode}
      title="QR Code Analytics"
      subtitle={scopeLine}
      parentCrumbs={eventId ? [{ label: 'Event', path: `/events/${eventId}` }] : undefined}
      actions={exportButton}
    />
  );

  // Loading draws the page it will become — header and the four metric cards,
  // placeholders where the figures go — and only until the first figures
  // arrive. The ten-second refresh sets `loading` too, and returning a bare
  // "Loading analytics..." for it replaced the whole page every ten seconds.
  if (loading && !metrics) {
    return (
      <div className={`mx-auto min-h-screen max-w-7xl ${shellPadding}`}>
        {header}
        <StatGrid columns={4} gap={4} className="mb-6">
          <span className="sr-only">Loading analytics...</span>
          {['Total Scans', 'Successful Check-Ins', 'Success Rate', 'Avg Time to Check-In'].map((label) => (
            <div key={label} className="bg-theme-surface rounded-lg p-4 shadow-md backdrop-blur-xs sm:p-6">
              <div className="text-theme-text-muted mb-1 text-sm font-medium">{label}</div>
              <div className="text-2xl font-bold sm:text-3xl">
                <SkeletonText className="w-16" />
              </div>
            </div>
          ))}
        </StatGrid>
      </div>
    );
  }

  if (error || !metrics) {
    return (
      <div className={`mx-auto max-w-7xl ${shellPadding}`}>
        {trail && <Breadcrumbs items={trail} />}
        <div className="flex items-center justify-center py-24">
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
      </div>
    );
  }

  return (
    <div className={`mx-auto min-h-screen max-w-7xl ${shellPadding}`}>
      {header}

      {/* Key Metrics */}
      <StatGrid columns={4} gap={4} className="mb-6">
        <div className="bg-theme-surface rounded-lg p-4 shadow-md backdrop-blur-xs sm:p-6">
          <div className="text-theme-text-muted mb-1 text-sm font-medium">Total Scans</div>
          <div className="text-2xl font-bold text-blue-600 sm:text-3xl dark:text-blue-400">{metrics.totalScans}</div>
        </div>

        <div className="bg-theme-surface rounded-lg p-4 shadow-md backdrop-blur-xs sm:p-6">
          <div className="text-theme-text-muted mb-1 text-sm font-medium">Successful Check-Ins</div>
          <div className="text-2xl font-bold text-green-700 sm:text-3xl dark:text-green-600">
            {metrics.successfulCheckIns}
          </div>
        </div>

        <div className="bg-theme-surface rounded-lg p-4 shadow-md backdrop-blur-xs sm:p-6">
          <div className="text-theme-text-muted mb-1 text-sm font-medium">Success Rate</div>
          <div className="text-theme-text-primary text-2xl font-bold sm:text-3xl">{metrics.successRate}%</div>
        </div>

        <div className="bg-theme-surface rounded-lg p-4 shadow-md backdrop-blur-xs sm:p-6">
          <div className="text-theme-text-muted mb-1 text-sm font-medium">Avg Time to Check-In</div>
          <div className="text-theme-text-primary text-2xl font-bold sm:text-3xl">{metrics.avgTimeToCheckIn}s</div>
        </div>
      </StatGrid>

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
              <p>No scan errors recorded</p>
            </div>
          ) : (
            <div className="space-y-2">
              {Object.entries(metrics.errorBreakdown)
                .sort(([, a], [, b]) => b - a)
                .map(([errorType, count]) => (
                  <div key={errorType} className="flex items-center justify-between">
                    <span className="text-theme-text-secondary flex-1 truncate text-sm">{errorType}</span>
                    <span className="ml-2 rounded-sm bg-red-100 px-2 py-1 text-xs font-semibold text-red-900 dark:bg-red-500/20 dark:text-red-300">
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
        {/* Twenty-four columns cannot fit 320px, the width SC 1.4.10 names: at
            that size each bar is under 10px and its hour label spills past the
            last one, off the edge of the screen. A chart is the case the scroll
            marker exists for — the bars keep a legible minimum width and the
            strip scrolls, rather than the last hours becoming unreadable.
            `min-w-full` keeps them stretched across a desktop. It needs its own
            tabIndex: the bars are divs, so there is nothing inside a keyboard
            could otherwise reach to scroll it. */}
        <div className="hscroll" data-mobile-scroll-region aria-label="Activity by hour" tabIndex={0}>
          <div className="flex h-48 min-w-full items-end justify-between gap-1">
            {(metrics.hourlyActivity || []).map(({ hour, count }) => {
              const maxCount = Math.max(...(metrics.hourlyActivity || []).map((h) => h.count), 1);
              const heightPercent = (count / maxCount) * 100;

              return (
                <div key={hour} className="flex min-w-[18px] flex-1 flex-col items-center">
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
