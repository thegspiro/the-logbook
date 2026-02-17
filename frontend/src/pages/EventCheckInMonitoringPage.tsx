import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
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

    fetchStats();

    // Auto-refresh every 10 seconds
    const interval = setInterval(() => {
      fetchStats();
    }, 10000);

    return () => clearInterval(interval);
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
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-slate-300">Loading monitoring dashboard...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-4">
          <p className="text-red-300">{error}</p>
        </div>
        <Link
          to={`/events/${eventId}`}
          className="text-blue-600 hover:text-blue-800"
        >
          ← Back to Event
        </Link>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <p className="text-slate-300">No monitoring data available</p>
        <Link
          to={`/events/${eventId}`}
          className="text-blue-600 hover:text-blue-800 mt-4 inline-block"
        >
          ← Back to Event
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <Link
          to={`/events/${eventId}`}
          className="text-blue-600 hover:text-blue-800 mb-4 inline-block"
        >
          ← Back to Event
        </Link>
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold text-white">Check-In Monitoring</h1>
            <p className="text-xl text-slate-300 mt-1">{stats.event_name}</p>
          </div>
          <div className="text-right">
            <div className="text-sm text-slate-400">
              Last updated: {formatTime(lastUpdated, tz)}
            </div>
            <div className="mt-1">
              {stats.is_check_in_active ? (
                <span className="inline-flex items-center px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
                  <span className="w-2 h-2 bg-green-600 rounded-full mr-2 animate-pulse"></span>
                  Check-In Active
                </span>
              ) : (
                <span className="inline-flex items-center px-3 py-1 bg-white/10 text-slate-300 rounded-full text-sm font-medium">
                  Check-In Inactive
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        {/* Total Checked In */}
        <div className="bg-white/10 backdrop-blur-sm rounded-lg shadow-md p-6">
          <div className="text-slate-400 text-sm font-medium mb-1">Checked In</div>
          <div className="text-3xl font-bold text-white">{stats.total_checked_in}</div>
          <div className="text-sm text-slate-300 mt-1">
            of {stats.total_eligible_members} members
          </div>
        </div>

        {/* Check-In Rate */}
        <div className="bg-white/10 backdrop-blur-sm rounded-lg shadow-md p-6">
          <div className="text-slate-400 text-sm font-medium mb-1">Check-In Rate</div>
          <div className="text-3xl font-bold text-white">{stats.check_in_rate}%</div>
          <div className="mt-2">
            <div className="w-full bg-white/10 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${Math.min(stats.check_in_rate, 100)}%` }}
              ></div>
            </div>
          </div>
        </div>

        {/* Total RSVPs */}
        <div className="bg-white/10 backdrop-blur-sm rounded-lg shadow-md p-6">
          <div className="text-slate-400 text-sm font-medium mb-1">Total RSVPs</div>
          <div className="text-3xl font-bold text-white">{stats.total_rsvps}</div>
          <div className="text-sm text-slate-300 mt-1">
            {stats.total_checked_in} checked in
          </div>
        </div>

        {/* Average Check-In Time */}
        <div className="bg-white/10 backdrop-blur-sm rounded-lg shadow-md p-6">
          <div className="text-slate-400 text-sm font-medium mb-1">Avg Check-In Time</div>
          <div className="text-3xl font-bold text-white">
            {stats.avg_check_in_time_minutes !== null
              ? `${Math.round(stats.avg_check_in_time_minutes)}m`
              : 'N/A'}
          </div>
          <div className="text-sm text-slate-300 mt-1">before event start</div>
        </div>
      </div>

      {/* Event Info */}
      <div className="bg-white/10 backdrop-blur-sm rounded-lg shadow-md p-6 mb-6">
        <h2 className="text-lg font-semibold text-white mb-4">Event Details</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <span className="text-slate-300 font-medium">Event Time:</span>
            <br />
            <span className="text-white">
              {formatShortDateTime(stats.start_datetime, tz)} - {formatShortDateTime(stats.end_datetime, tz)}
            </span>
          </div>
          <div>
            <span className="text-slate-300 font-medium">Check-In Window:</span>
            <br />
            <span className="text-white">
              {formatShortDateTime(stats.check_in_window_start, tz)} -{' '}
              {formatShortDateTime(stats.check_in_window_end, tz)}
            </span>
          </div>
        </div>
      </div>

      {/* Recent Check-Ins */}
      <div className="bg-white/10 backdrop-blur-sm rounded-lg shadow-md p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-white">Recent Check-Ins</h2>
          {stats.last_check_in_at && (
            <span className="text-sm text-slate-400">
              Last: {formatTimeAgo(stats.last_check_in_at)}
            </span>
          )}
        </div>

        {stats.recent_check_ins.length === 0 ? (
          <div className="text-center py-8 text-slate-400">
            No check-ins yet. Waiting for members to arrive...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-white/10">
              <thead>
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Member
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Guests
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Checked In
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {stats.recent_check_ins.map((activity) => (
                  <tr key={activity.user_id} className="hover:bg-white/5">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-white">
                        {activity.user_name}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-slate-300">{activity.user_email}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                        {activity.rsvp_status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-300">
                      {activity.guest_count}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-300">
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
      <div className="mt-6 text-center text-sm text-slate-400">
        Auto-refreshing every 10 seconds
      </div>
    </div>
  );
};

export default EventCheckInMonitoringPage;
