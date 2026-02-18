import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { errorTracker, type ErrorLog } from '../services/errorTracking';
import { useTimezone } from '../hooks/useTimezone';
import { formatDateTime, formatTime } from '../utils/dateFormatting';

/**
 * Error Monitoring Dashboard
 *
 * Displays all tracked errors with filtering, statistics, and export capabilities.
 * Useful for administrators to identify and troubleshoot issues.
 * Data is fetched from the backend API.
 */
const ErrorMonitoringPage: React.FC = () => {
  const tz = useTimezone();
  const [errors, setErrors] = useState<ErrorLog[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [stats, setStats] = useState<{ total: number; byType: Record<string, number>; recentErrors: ErrorLog[] } | null>(null);
  const [loading, setLoading] = useState(true);

  const loadErrors = useCallback(async () => {
    const [errorList, errorStats] = await Promise.all([
      errorTracker.getErrors(filter !== 'all' ? { error_type: filter } : undefined),
      errorTracker.getErrorStats(),
    ]);
    setErrors(errorList);
    setStats(errorStats);
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    loadErrors();
    const interval = setInterval(loadErrors, 10000);
    return () => clearInterval(interval);
  }, [loadErrors]);

  const exportErrors = async () => {
    const dataStr = await errorTracker.exportErrors();
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `error-log-${new Date().toISOString()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const clearAllErrors = async () => {
    if (window.confirm('Are you sure you want to clear all errors? This cannot be undone.')) {
      await errorTracker.clearErrors();
      setErrors([]);
      setStats(null);
    }
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <div className="text-theme-text-secondary">Loading error data...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-theme-text-primary">Error Monitoring</h1>
        <p className="text-theme-text-secondary mt-1">Track and analyze errors across the platform</p>
      </div>

      {/* Statistics Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg shadow-md p-6">
            <div className="text-theme-text-muted text-sm font-medium mb-1">Total Errors</div>
            <div className="text-3xl font-bold text-theme-text-primary">{stats.total}</div>
          </div>

          {Object.entries(stats.byType)
            .sort(([, a]: any, [, b]: any) => b - a)
            .slice(0, 3)
            .map(([type, count]: [string, any]) => (
              <div key={type} className="bg-theme-surface backdrop-blur-sm rounded-lg shadow-md p-6">
                <div className="text-theme-text-muted text-sm font-medium mb-1 truncate">{type}</div>
                <div className="text-3xl font-bold text-red-600">{count}</div>
              </div>
            ))}
        </div>
      )}

      {/* Actions Bar */}
      <div className="bg-theme-surface backdrop-blur-sm rounded-lg shadow-md p-4 mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-theme-text-secondary">Filter:</label>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="border border-theme-input-border rounded-md px-3 py-2 text-sm text-theme-text-primary bg-theme-input-bg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Errors</option>
            {stats &&
              Object.keys(stats.byType).map((type) => (
                <option key={type} value={type}>
                  {type} ({stats.byType[type]})
                </option>
              ))}
          </select>
        </div>

        <div className="flex gap-2">
          <button
            onClick={exportErrors}
            className="px-4 py-2 border border-theme-surface-border rounded-md text-sm font-medium text-blue-400 bg-theme-surface hover:bg-theme-surface-hover"
          >
            Export Errors
          </button>
          <button
            onClick={clearAllErrors}
            className="px-4 py-2 border border-theme-surface-border rounded-md text-sm font-medium text-red-400 bg-theme-surface hover:bg-theme-surface-hover"
          >
            Clear All
          </button>
        </div>
      </div>

      {/* Error List */}
      <div className="bg-theme-surface backdrop-blur-sm rounded-lg shadow-md overflow-hidden">
        {errors.length === 0 ? (
          <div className="p-8 text-center text-theme-text-muted">
            <svg
              className="mx-auto h-12 w-12 text-theme-text-muted mb-4"
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
            <p className="text-lg font-medium">No errors found</p>
            <p className="text-sm mt-1">
              {filter === 'all'
                ? 'The system is running smoothly!'
                : `No errors of type "${filter}"`}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-theme-surface-border">
              <thead className="bg-theme-surface-secondary">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                    Timestamp
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                    Error Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                    User Message
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                    Context
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                    Error ID
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-theme-surface-border">
                {errors.map((error) => (
                  <tr key={error.id} className="hover:bg-theme-surface-hover">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-theme-text-primary">
                      {formatDateTime(error.timestamp, tz)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">
                        {error.errorType}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-theme-text-secondary max-w-md truncate">
                      {error.userMessage}
                    </td>
                    <td className="px-6 py-4 text-sm text-theme-text-secondary">
                      {error.context.eventId && (
                        <Link
                          to={`/events/${error.context.eventId}`}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          Event
                        </Link>
                      )}
                      {error.context.userId && ` | User: ${error.context.userId.substring(0, 8)}`}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-xs text-theme-text-muted font-mono">
                      {error.id.split('-')[0]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent Errors Preview */}
      {stats && stats.recentErrors.length > 0 && filter === 'all' && (
        <div className="mt-6 bg-theme-surface backdrop-blur-sm rounded-lg shadow-md p-6">
          <h2 className="text-lg font-semibold text-theme-text-primary mb-4">Recent Errors</h2>
          <div className="space-y-4">
            {stats.recentErrors.map((error: ErrorLog) => (
              <div
                key={error.id}
                className="border-l-4 border-red-500 bg-red-500/10 p-4 rounded-r"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-sm font-medium text-red-300">{error.errorType}</p>
                    <p className="text-sm text-red-300 mt-1">{error.userMessage}</p>
                  </div>
                  <span className="text-xs text-red-600">
                    {formatTime(error.timestamp, tz)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ErrorMonitoringPage;
