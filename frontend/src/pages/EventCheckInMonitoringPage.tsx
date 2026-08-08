import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router';
import { eventService } from '../services/api';
import type { CheckInMonitoringStats } from '../types/event';
import { getErrorMessage } from '../utils/errorHandling';
import { useTimezone } from '../hooks/useTimezone';
import { formatShortDateTime, formatTime } from '../utils/dateFormatting';

/**
 * Event Check-In Monitoring Dashboard
 *
 * Provides real-time monitoring of check-in activity for event managers.
 * Auto-refreshes every 10 seconds to show live updates.
 */
const EventCheckInMonitoringPage: React.FC = () => {
  const { id: eventId } = useParams<{ id: string }>();
  const tz = useTimezone();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<CheckInMonitoringStats | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  useEffect(() => {
    if (!eventId) return;

    void fetchStats();

    // Auto-refresh every 10 seconds
    const interval = setInterval(() => {
      void fetchStats();
    }, 10000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const fetchStats = async () => {
    if (!eventId) return;

    try {
      setError(null);
      const data = await eventService.getCheckInMonitoring(eventId);
      setStats(data);
      setLastUpdated(new Date());
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load monitoring data'));
    } finally {
      setLoading(false);
    }
  };

  const formatTimeAgo = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins === 1) return '1 minute ago';
    if (diffMins < 60) return `${diffMins} minutes ago`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours === 1) return '1 hour ago';
    if (diffHours < 24) return `${diffHours} hours ago`;

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return '1 day ago';
    return `${diffDays} days ago`;
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-theme-text-secondary">Loading monitoring dashboard...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
          <p className="text-red-700 dark:text-red-300">{error}</p>
        </div>
        <Link
          to={`/events/${eventId}`}
          className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
        >
          ← Back to Event
        </Link>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <p className="text-theme-text-secondary">No monitoring data available</p>
        <Link
          to={`/events/${eventId}`}
          className="mt-4 inline-block text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
        >
          ← Back to Event
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-7xl p-6">
      {/* Header */}
      <div className="mb-6">
        <Link
          to={`/events/${eventId}`}
          className="mb-4 inline-block text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
        >
          ← Back to Event
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-theme-text-primary text-3xl font-bold">Check-In Monitoring</h1>
            <p className="text-theme-text-secondary mt-1 text-xl">{stats.event_name}</p>
          </div>
          <div className="text-right">
            <div className="text-theme-text-muted text-sm">Last updated: {formatTime(lastUpdated, tz)}</div>
            <div className="mt-1">
              {stats.is_check_in_active ? (
                <span className="inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-800 dark:bg-green-500/20 dark:text-green-400">
                  <span className="mr-2 h-2 w-2 animate-pulse rounded-full bg-green-600"></span>
                  Check-In Active
                </span>
              ) : (
                <span className="bg-theme-surface text-theme-text-secondary inline-flex items-center rounded-full px-3 py-1 text-sm font-medium">
                  Check-In Inactive
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-4">
        {/* Total Checked In */}
        <div className="bg-theme-surface rounded-lg p-6 shadow-md backdrop-blur-xs">
          <div className="text-theme-text-muted mb-1 text-sm font-medium">Checked In</div>
          <div className="text-theme-text-primary text-3xl font-bold">{stats.total_checked_in}</div>
          <div className="text-theme-text-secondary mt-1 text-sm">of {stats.total_eligible_members} members</div>
        </div>

        {/* Check-In Rate */}
        <div className="bg-theme-surface rounded-lg p-6 shadow-md backdrop-blur-xs">
          <div className="text-theme-text-muted mb-1 text-sm font-medium">Check-In Rate</div>
          <div className="text-theme-text-primary text-3xl font-bold">{stats.check_in_rate}%</div>
          <div className="mt-2">
            <div className="bg-theme-surface-secondary h-2 w-full rounded-full">
              <div
                className="h-2 rounded-full bg-blue-600 transition-all duration-300"
                style={{ width: `${Math.min(stats.check_in_rate, 100)}%` }}
              ></div>
            </div>
          </div>
        </div>

        {/* Total RSVPs */}
        <div className="bg-theme-surface rounded-lg p-6 shadow-md backdrop-blur-xs">
          <div className="text-theme-text-muted mb-1 text-sm font-medium">Total RSVPs</div>
          <div className="text-theme-text-primary text-3xl font-bold">{stats.total_rsvps}</div>
          <div className="text-theme-text-secondary mt-1 text-sm">{stats.total_checked_in} checked in</div>
        </div>

        {/* Average Check-In Time */}
        <div className="bg-theme-surface rounded-lg p-6 shadow-md backdrop-blur-xs">
          <div className="text-theme-text-muted mb-1 text-sm font-medium">Avg Check-In Time</div>
          <div className="text-theme-text-primary text-3xl font-bold">
            {stats.avg_check_in_time_minutes !== null ? `${Math.round(stats.avg_check_in_time_minutes)}m` : 'N/A'}
          </div>
          <div className="text-theme-text-secondary mt-1 text-sm">before event start</div>
        </div>
      </div>

      {/* Event Info */}
      <div className="bg-theme-surface mb-6 rounded-lg p-6 shadow-md backdrop-blur-xs">
        <h2 className="text-theme-text-primary mb-4 text-lg font-semibold">Event Details</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <span className="text-theme-text-secondary font-medium">Event Time:</span>
            <br />
            <span className="text-theme-text-primary">
              {formatShortDateTime(stats.start_datetime, tz)} - {formatShortDateTime(stats.end_datetime, tz)}
            </span>
          </div>
          <div>
            <span className="text-theme-text-secondary font-medium">Check-In Window:</span>
            <br />
            <span className="text-theme-text-primary">
              {formatShortDateTime(stats.check_in_window_start, tz)} -{' '}
              {formatShortDateTime(stats.check_in_window_end, tz)}
            </span>
          </div>
        </div>
      </div>

      {/* Recent Check-Ins */}
      <div className="bg-theme-surface rounded-lg p-6 shadow-md backdrop-blur-xs">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-theme-text-primary text-lg font-semibold">Recent Check-Ins</h2>
          {stats.last_check_in_at && (
            <span className="text-theme-text-muted text-sm">Last: {formatTimeAgo(stats.last_check_in_at)}</span>
          )}
        </div>

        {stats.recent_check_ins.length === 0 ? (
          <div className="text-theme-text-muted py-8 text-center">
            No check-ins yet. Waiting for members to arrive...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="divide-theme-surface-border min-w-full divide-y">
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="text-theme-text-muted px-6 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Member
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-muted px-6 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Email
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-muted px-6 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Status
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-muted px-6 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Guests
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-muted px-6 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Checked In
                  </th>
                </tr>
              </thead>
              <tbody className="divide-theme-surface-border divide-y">
                {stats.recent_check_ins.map((activity) => (
                  <tr key={activity.user_id} className="hover:bg-theme-surface-hover">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-theme-text-primary text-sm font-medium">{activity.user_name}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-theme-text-secondary text-sm">{activity.user_email}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="inline-flex rounded-full bg-green-100 px-2 py-1 text-xs leading-5 font-semibold text-green-800 dark:bg-green-500/20 dark:text-green-400">
                        {activity.rsvp_status}
                      </span>
                    </td>
                    <td className="text-theme-text-secondary px-6 py-4 text-sm whitespace-nowrap">
                      {activity.guest_count}
                    </td>
                    <td className="text-theme-text-secondary px-6 py-4 text-sm whitespace-nowrap">
                      {formatTimeAgo(activity.checked_in_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Auto-Refresh Indicator */}
      <div className="text-theme-text-muted mt-6 text-center text-sm">Auto-refreshing every 10 seconds</div>
    </div>
  );
};

export default EventCheckInMonitoringPage;
