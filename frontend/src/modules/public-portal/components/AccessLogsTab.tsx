/**
 * Access Logs Tab
 *
 * Displays a filterable table of all public portal access attempts
 * with suspicious activity flagging and detailed request information.
 */

import React, { useState, useEffect } from 'react';
import { useAccessLogs } from '../hooks/usePublicPortal';
import type { AccessLogFilters } from '../types';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDateTime } from '../../../utils/dateFormatting';

export const AccessLogsTab: React.FC = () => {
  const tz = useTimezone();
  const [filters, setFilters] = useState<AccessLogFilters>({
    limit: 50,
    offset: 0,
  });

  const { logs, loading, error, refetch } = useAccessLogs(filters);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);

  // Refetch when filters change
  useEffect(() => {
    void refetch();
  }, [filters, refetch]);

  const getStatusColor = (statusCode: number) => {
    if (statusCode >= 200 && statusCode < 300) return 'text-green-600';
    if (statusCode >= 400 && statusCode < 500) return 'text-yellow-600';
    if (statusCode >= 500) return 'text-red-600';
    return 'text-theme-text-muted';
  };

  const getMethodColor = (method: string) => {
    switch (method) {
      case 'GET':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400';
      case 'POST':
        return 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400';
      case 'PUT':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400';
      case 'PATCH':
        return 'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-400';
      case 'DELETE':
        return 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400';
      default:
        return 'bg-theme-surface-secondary text-theme-text-muted';
    }
  };

  const handleFilterChange = (key: keyof AccessLogFilters, value: string | number | boolean | undefined) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value || undefined,
      offset: 0, // Reset to first page when filters change
    }));
  };

  const handleNextPage = () => {
    setFilters((prev) => ({
      ...prev,
      offset: (prev.offset || 0) + (prev.limit || 50),
    }));
  };

  const handlePrevPage = () => {
    setFilters((prev) => ({
      ...prev,
      offset: Math.max(0, (prev.offset || 0) - (prev.limit || 50)),
    }));
  };

  const clearFilters = () => {
    setFilters({
      limit: 50,
      offset: 0,
    });
  };

  const hasActiveFilters =
    filters.api_key_id ||
    filters.ip_address ||
    filters.endpoint ||
    filters.status_code ||
    filters.flagged_suspicious !== undefined;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 dark:border-red-500/30 dark:bg-red-500/10">
        <p className="text-red-800 dark:text-red-400">Error loading access logs: {error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-theme-text-primary text-lg font-semibold">Access Logs</h3>
        <p className="text-theme-text-muted mt-1 text-sm">
          View all public portal access attempts with detailed request information
        </p>
      </div>

      {/* Filters */}
      <div className="card-secondary p-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* IP Address Filter */}
          <div>
            <label className="text-theme-text-secondary mb-1 block text-sm font-medium">IP Address</label>
            <input
              type="text"
              value={filters.ip_address || ''}
              onChange={(e) => handleFilterChange('ip_address', e.target.value)}
              placeholder="e.g., 192.168.1.1"
              className="form-input"
            />
          </div>

          {/* Endpoint Filter */}
          <div>
            <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Endpoint</label>
            <input
              type="text"
              value={filters.endpoint || ''}
              onChange={(e) => handleFilterChange('endpoint', e.target.value)}
              placeholder="e.g., /api/public/v1/organization/info"
              className="form-input"
            />
          </div>

          {/* Status Code Filter */}
          <div>
            <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Status Code</label>
            <select
              value={filters.status_code || ''}
              onChange={(e) => handleFilterChange('status_code', e.target.value ? parseInt(e.target.value) : undefined)}
              className="form-input"
            >
              <option value="">All</option>
              <option value="200">200 - OK</option>
              <option value="401">401 - Unauthorized</option>
              <option value="403">403 - Forbidden</option>
              <option value="429">429 - Too Many Requests</option>
              <option value="500">500 - Internal Server Error</option>
              <option value="503">503 - Service Unavailable</option>
            </select>
          </div>

          {/* Flagged Only Filter */}
          <div>
            <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Suspicious Activity</label>
            <select
              value={filters.flagged_suspicious === undefined ? '' : filters.flagged_suspicious.toString()}
              onChange={(e) =>
                handleFilterChange('flagged_suspicious', e.target.value === '' ? undefined : e.target.value === 'true')
              }
              className="form-input"
            >
              <option value="">All</option>
              <option value="true">Flagged Only</option>
              <option value="false">Not Flagged</option>
            </select>
          </div>

          {/* Results Per Page */}
          <div>
            <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Results Per Page</label>
            <select
              value={filters.limit || 50}
              onChange={(e) => handleFilterChange('limit', parseInt(e.target.value))}
              className="form-input"
            >
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="200">200</option>
            </select>
          </div>

          {/* Clear Filters Button */}
          <div className="flex items-end">
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="text-theme-text-secondary bg-theme-surface border-theme-surface-border hover:bg-theme-surface-hover w-full rounded-md border px-3 py-2"
              >
                Clear Filters
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Logs Table */}
      {logs.length === 0 ? (
        <div className="bg-theme-surface-secondary border-theme-surface-border rounded-md border p-8 text-center">
          <svg
            className="text-theme-text-muted mx-auto h-12 w-12"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <h3 className="text-theme-text-primary mt-2 text-sm font-medium">No access logs found</h3>
          <p className="text-theme-text-muted mt-1 text-sm">
            {hasActiveFilters ? 'Try adjusting your filters' : 'Access logs will appear here once requests are made'}
          </p>
        </div>
      ) : (
        <>
          <div className="bg-theme-surface border-theme-surface-border overflow-x-auto rounded-lg border">
            <table className="divide-theme-surface-border min-w-full divide-y">
              <thead className="bg-theme-surface-secondary">
                <tr>
                  <th
                    scope="col"
                    className="text-theme-text-muted px-6 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Timestamp
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-muted px-6 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Method
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-muted px-6 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Endpoint
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
                    IP Address
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-muted px-6 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Time
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-muted px-6 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Flag
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-muted px-6 py-3 text-right text-xs font-medium tracking-wider uppercase"
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-theme-surface divide-theme-surface-border divide-y">
                {logs.map((log) => (
                  <React.Fragment key={log.id}>
                    <tr className={`hover:bg-theme-surface-hover ${log.flagged_suspicious ? 'bg-red-500/10' : ''}`}>
                      <td className="text-theme-text-muted px-6 py-4 text-sm whitespace-nowrap">
                        {formatDateTime(log.timestamp, tz)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`rounded-sm px-2 py-1 text-xs font-semibold ${getMethodColor(log.method)}`}>
                          {log.method}
                        </span>
                      </td>
                      <td className="text-theme-text-primary px-6 py-4 font-mono text-sm">{log.endpoint}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`text-sm font-semibold ${getStatusColor(log.status_code)}`}>
                          {log.status_code}
                        </span>
                      </td>
                      <td className="text-theme-text-muted px-6 py-4 font-mono text-sm whitespace-nowrap">
                        {log.ip_address}
                      </td>
                      <td className="text-theme-text-muted px-6 py-4 text-sm whitespace-nowrap">
                        {log.response_time_ms ? `${log.response_time_ms}ms` : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {log.flagged_suspicious && (
                          <span className="rounded-sm bg-red-100 px-2 py-1 text-xs font-semibold text-red-800 dark:bg-red-500/20 dark:text-red-400">
                            Suspicious
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right text-sm font-medium whitespace-nowrap">
                        <button
                          onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                          className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
                        >
                          {expandedLog === log.id ? 'Hide' : 'Details'}
                        </button>
                      </td>
                    </tr>
                    {expandedLog === log.id && (
                      <tr className="bg-theme-surface-secondary">
                        <td colSpan={8} className="px-6 py-4">
                          <div className="space-y-2 text-sm">
                            {log.user_agent && (
                              <div>
                                <span className="text-theme-text-secondary font-semibold">User Agent:</span>
                                <span className="text-theme-text-muted ml-2">{log.user_agent}</span>
                              </div>
                            )}
                            {log.referer && (
                              <div>
                                <span className="text-theme-text-secondary font-semibold">Referer:</span>
                                <span className="text-theme-text-muted ml-2">{log.referer}</span>
                              </div>
                            )}
                            {log.flagged_suspicious && log.flag_reason && (
                              <div>
                                <span className="font-semibold text-red-700">Flag Reason:</span>
                                <span className="ml-2 text-red-600">{log.flag_reason}</span>
                              </div>
                            )}
                            {log.api_key_id && (
                              <div>
                                <span className="text-theme-text-secondary font-semibold">API Key ID:</span>
                                <span className="text-theme-text-muted ml-2 font-mono">{log.api_key_id}</span>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="bg-theme-surface border-theme-surface-border flex items-center justify-between rounded-lg border px-4 py-3">
            <div className="text-theme-text-secondary text-sm">
              Showing <span className="font-medium">{(filters.offset || 0) + 1}</span> to{' '}
              <span className="font-medium">{(filters.offset || 0) + logs.length}</span>
            </div>
            <div className="flex space-x-2">
              <button
                onClick={handlePrevPage}
                disabled={!filters.offset || filters.offset === 0}
                className="bg-theme-surface border-theme-surface-border hover:bg-theme-surface-hover rounded-md border px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <button
                onClick={handleNextPage}
                disabled={logs.length < (filters.limit || 50)}
                className="bg-theme-surface border-theme-surface-border hover:bg-theme-surface-hover rounded-md border px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
