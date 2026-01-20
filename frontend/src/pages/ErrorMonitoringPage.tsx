import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { errorTracker, type ErrorLog } from '../services/errorTracking';

/**
 * Error Monitoring Dashboard
 *
 * Displays all tracked errors with filtering, statistics, and export capabilities.
 * Useful for administrators to identify and troubleshoot issues.
 */
const ErrorMonitoringPage: React.FC = () => {
  const [errors, setErrors] = useState<ErrorLog[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    // Refresh errors every 5 seconds
    const loadErrors = () => {
      setErrors(errorTracker.getErrors());
      setStats(errorTracker.getErrorStats());
    };

    loadErrors();
    const interval = setInterval(loadErrors, 5000);

    return () => clearInterval(interval);
  }, []);

  const filteredErrors = filter === 'all'
    ? errors
    : errors.filter(e => e.errorType === filter);

  const exportErrors = () => {
    const dataStr = errorTracker.exportErrors();
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `error-log-${new Date().toISOString()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const clearAllErrors = () => {
    if (window.confirm('Are you sure you want to clear all errors? This cannot be undone.')) {
      errorTracker.clearErrors();
      setErrors([]);
      setStats(null);
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Error Monitoring</h1>
        <p className="text-gray-600 mt-1">Track and analyze errors across the platform</p>
      </div>

      {/* Statistics Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="text-gray-500 text-sm font-medium mb-1">Total Errors</div>
            <div className="text-3xl font-bold text-gray-900">{stats.total}</div>
          </div>

          {Object.entries(stats.byType)
            .sort(([, a]: any, [, b]: any) => b - a)
            .slice(0, 3)
            .map(([type, count]: [string, any]) => (
              <div key={type} className="bg-white rounded-lg shadow-md p-6">
                <div className="text-gray-500 text-sm font-medium mb-1 truncate">{type}</div>
                <div className="text-3xl font-bold text-red-600">{count}</div>
              </div>
            ))}
        </div>
      )}

      {/* Actions Bar */}
      <div className="bg-white rounded-lg shadow-md p-4 mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">Filter:</label>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
            className="px-4 py-2 border border-blue-300 rounded-md text-sm font-medium text-blue-700 bg-white hover:bg-blue-50"
          >
            Export Errors
          </button>
          <button
            onClick={clearAllErrors}
            className="px-4 py-2 border border-red-300 rounded-md text-sm font-medium text-red-700 bg-white hover:bg-red-50"
          >
            Clear All
          </button>
        </div>
      </div>

      {/* Error List */}
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        {filteredErrors.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <svg
              className="mx-auto h-12 w-12 text-gray-400 mb-4"
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
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Timestamp
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Error Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    User Message
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Context
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Error ID
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredErrors.map((error) => (
                  <tr key={error.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {new Date(error.timestamp).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">
                        {error.errorType}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 max-w-md truncate">
                      {error.userMessage}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
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
                    <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500 font-mono">
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
        <div className="mt-6 bg-white rounded-lg shadow-md p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Errors</h2>
          <div className="space-y-4">
            {stats.recentErrors.map((error: ErrorLog) => (
              <div
                key={error.id}
                className="border-l-4 border-red-500 bg-red-50 p-4 rounded-r"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-sm font-medium text-red-900">{error.errorType}</p>
                    <p className="text-sm text-red-700 mt-1">{error.userMessage}</p>
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
