import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { eventService } from '../services/api';
import type { CheckInMonitoringStats } from '../types/event';

/**
 * Event Check-In Monitoring Dashboard
 *
 * Provides real-time monitoring of check-in activity for event managers.
 * Auto-refreshes every 10 seconds to show live updates.
 */
const EventCheckInMonitoringPage: React.FC = () => {
  const { id: eventId } = useParams<{ id: string }>();

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
    } catch (err: any) {
      console.error('Error fetching monitoring stats:', err);
      setError(err.response?.data?.detail || 'Failed to load monitoring data');
    } finally {
      setLoading(false);
    }
  };

  const formatDateTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
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
        <div className="text-gray-600">Loading monitoring dashboard...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
          <p className="text-red-800">{error}</p>
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
        <p className="text-gray-600">No monitoring data available</p>
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
    <div className="max-w-7xl mx-auto p-6">
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
            <h1 className="text-3xl font-bold text-gray-900">Check-In Monitoring</h1>
            <p className="text-xl text-gray-600 mt-1">{stats.event_name}</p>
          </div>
          <div className="text-right">
            <div className="text-sm text-gray-500">
              Last updated: {lastUpdated.toLocaleTimeString()}
            </div>
            <div className="mt-1">
              {stats.is_check_in_active ? (
                <span className="inline-flex items-center px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
                  <span className="w-2 h-2 bg-green-600 rounded-full mr-2 animate-pulse"></span>
                  Check-In Active
                </span>
              ) : (
                <span className="inline-flex items-center px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-sm font-medium">
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
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="text-gray-500 text-sm font-medium mb-1">Checked In</div>
          <div className="text-3xl font-bold text-gray-900">{stats.total_checked_in}</div>
          <div className="text-sm text-gray-600 mt-1">
            of {stats.total_eligible_members} members
          </div>
        </div>

        {/* Check-In Rate */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="text-gray-500 text-sm font-medium mb-1">Check-In Rate</div>
          <div className="text-3xl font-bold text-gray-900">{stats.check_in_rate}%</div>
          <div className="mt-2">
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${Math.min(stats.check_in_rate, 100)}%` }}
              ></div>
            </div>
          </div>
        </div>

        {/* Total RSVPs */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="text-gray-500 text-sm font-medium mb-1">Total RSVPs</div>
          <div className="text-3xl font-bold text-gray-900">{stats.total_rsvps}</div>
          <div className="text-sm text-gray-600 mt-1">
            {stats.total_checked_in} checked in
          </div>
        </div>

        {/* Average Check-In Time */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="text-gray-500 text-sm font-medium mb-1">Avg Check-In Time</div>
          <div className="text-3xl font-bold text-gray-900">
            {stats.avg_check_in_time_minutes !== null
              ? `${Math.round(stats.avg_check_in_time_minutes)}m`
              : 'N/A'}
          </div>
          <div className="text-sm text-gray-600 mt-1">before event start</div>
        </div>
      </div>

      {/* Event Info */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Event Details</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <span className="text-gray-600 font-medium">Event Time:</span>
            <br />
            <span className="text-gray-900">
              {formatDateTime(stats.start_datetime)} - {formatDateTime(stats.end_datetime)}
            </span>
          </div>
          <div>
            <span className="text-gray-600 font-medium">Check-In Window:</span>
            <br />
            <span className="text-gray-900">
              {formatDateTime(stats.check_in_window_start)} -{' '}
              {formatDateTime(stats.check_in_window_end)}
            </span>
          </div>
        </div>
      </div>

      {/* Recent Check-Ins */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Recent Check-Ins</h2>
          {stats.last_check_in_at && (
            <span className="text-sm text-gray-500">
              Last: {formatTimeAgo(stats.last_check_in_at)}
            </span>
          )}
        </div>

        {stats.recent_check_ins.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No check-ins yet. Waiting for members to arrive...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead>
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Member
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Guests
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Checked In
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {stats.recent_check_ins.map((activity) => (
                  <tr key={activity.user_id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {activity.user_name}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-600">{activity.user_email}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                        {activity.rsvp_status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {activity.guest_count}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
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
      <div className="mt-6 text-center text-sm text-gray-500">
        Auto-refreshing every 10 seconds
      </div>
    </div>
  );
};

export default EventCheckInMonitoringPage;
