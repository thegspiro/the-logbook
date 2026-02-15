import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { errorTracker, type ErrorLog } from '../services/errorTracking';

/**
 * Error Monitoring Dashboard
 *
 * Displays all tracked errors with filtering, statistics, and export capabilities.
 * Useful for administrators to identify and troubleshoot issues.
 * Data is fetched from the backend API.
 */
const ErrorMonitoringPage: React.FC = () => {
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
        <div className="text-slate-300">Loading error data...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white">Error Monitoring</h1>
        <p className="text-slate-300 mt-1">Track and analyze errors across the platform</p>
      </div>

      {/* Statistics Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white/10 backdrop-blur-sm rounded-lg shadow-md p-6">
            <div className="text-slate-400 text-sm font-medium mb-1">Total Errors</div>
            <div className="text-3xl font-bold text-white">{stats.total}</div>
          </div>

          {Object.entries(stats.byType)
            .sort(([, a]: any, [, b]: any) => b - a)
            .slice(0, 3)
            .map(([type, count]: [string, any]) => (
              <div key={type} className="bg-white/10 backdrop-blur-sm rounded-lg shadow-md p-6">
                <div className="text-slate-400 text-sm font-medium mb-1 truncate">{type}</div>
                <div className="text-3xl font-bold text-red-600">{count}</div>
              </div>
            ))}
        </div>
      )}

      {/* Actions Bar */}
      <div className="bg-white/10 backdrop-blur-sm rounded-lg shadow-md p-4 mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-200">Filter:</label>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="border border-slate-600 rounded-md px-3 py-2 text-sm text-white bg-slate-900/50 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
            className="px-4 py-2 border border-white/30 rounded-md text-sm font-medium text-blue-400 bg-white/10 hover:bg-white/15"
          >
            Export Errors
          </button>
          <button
            onClick={clearAllErrors}
            className="px-4 py-2 border border-white/30 rounded-md text-sm font-medium text-red-400 bg-white/10 hover:bg-white/15"
          >
            Clear All
          </button>
        </div>
      </div>

      {/* Error List */}
      <div className="bg-white/10 backdrop-blur-sm rounded-lg shadow-md overflow-hidden">
        {errors.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            <svg
              className="mx-auto h-12 w-12 text-slate-500 mb-4"
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
            <table className="min-w-full divide-y divide-white/10">
              <thead className="bg-slate-900/50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Timestamp
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Error Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                    User Message
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Context
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Error ID
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {errors.map((error) => (
                  <tr key={error.id} className="hover:bg-white/5">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-white">
                      {new Date(error.timestamp).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">
                        {error.errorType}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-300 max-w-md truncate">
                      {error.userMessage}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-300">
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
                    <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-400 font-mono">
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
        <div className="mt-6 bg-white/10 backdrop-blur-sm rounded-lg shadow-md p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Recent Errors</h2>
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
                    {new Date(error.timestamp).toLocaleTimeString()}
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
