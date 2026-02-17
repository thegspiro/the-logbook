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
    refetch();
  }, [filters, refetch]);

  const getStatusColor = (statusCode: number) => {
    if (statusCode >= 200 && statusCode < 300) return 'text-green-600';
    if (statusCode >= 400 && statusCode < 500) return 'text-yellow-600';
    if (statusCode >= 500) return 'text-red-600';
    return 'text-gray-600';
  };

  const getMethodColor = (method: string) => {
    switch (method) {
      case 'GET': return 'bg-blue-100 text-blue-800';
      case 'POST': return 'bg-green-100 text-green-800';
      case 'PUT': return 'bg-yellow-100 text-yellow-800';
      case 'PATCH': return 'bg-orange-100 text-orange-800';
      case 'DELETE': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const handleFilterChange = (key: keyof AccessLogFilters, value: string | number | boolean | undefined) => {
    setFilters(prev => ({
      ...prev,
      [key]: value || undefined,
      offset: 0, // Reset to first page when filters change
    }));
  };

  const handleNextPage = () => {
    setFilters(prev => ({
      ...prev,
      offset: (prev.offset || 0) + (prev.limit || 50),
    }));
  };

  const handlePrevPage = () => {
    setFilters(prev => ({
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

  const hasActiveFilters = filters.api_key_id || filters.ip_address ||
    filters.endpoint || filters.status_code || filters.flagged_suspicious !== undefined;

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4">
        <p className="text-red-800">Error loading access logs: {error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Access Logs</h3>
        <p className="text-sm text-gray-600 mt-1">
          View all public portal access attempts with detailed request information
        </p>
      </div>

      {/* Filters */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* IP Address Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              IP Address
            </label>
            <input
              type="text"
              value={filters.ip_address || ''}
              onChange={(e) => handleFilterChange('ip_address', e.target.value)}
              placeholder="e.g., 192.168.1.1"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Endpoint Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Endpoint
            </label>
            <input
              type="text"
              value={filters.endpoint || ''}
              onChange={(e) => handleFilterChange('endpoint', e.target.value)}
              placeholder="e.g., /api/public/v1/organization/info"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Status Code Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Status Code
            </label>
            <select
              value={filters.status_code || ''}
              onChange={(e) => handleFilterChange('status_code', e.target.value ? parseInt(e.target.value) : undefined)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Suspicious Activity
            </label>
            <select
              value={filters.flagged_suspicious === undefined ? '' : filters.flagged_suspicious.toString()}
              onChange={(e) => handleFilterChange('flagged_suspicious', e.target.value === '' ? undefined : e.target.value === 'true')}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All</option>
              <option value="true">Flagged Only</option>
              <option value="false">Not Flagged</option>
            </select>
          </div>

          {/* Results Per Page */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Results Per Page
            </label>
            <select
              value={filters.limit || 50}
              onChange={(e) => handleFilterChange('limit', parseInt(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                className="w-full px-3 py-2 text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Clear Filters
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Logs Table */}
      {logs.length === 0 ? (
        <div className="bg-gray-50 border border-gray-200 rounded-md p-8 text-center">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-gray-900">No access logs found</h3>
          <p className="mt-1 text-sm text-gray-500">
            {hasActiveFilters ? 'Try adjusting your filters' : 'Access logs will appear here once requests are made'}
          </p>
        </div>
      ) : (
        <>
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Timestamp
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Method
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Endpoint
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    IP Address
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Time
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Flag
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {logs.map((log) => (
                  <React.Fragment key={log.id}>
                    <tr
                      className={`hover:bg-gray-50 ${log.flagged_suspicious ? 'bg-red-50' : ''}`}
                    >
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {formatDateTime(log.timestamp, tz)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-semibold rounded ${getMethodColor(log.method)}`}>
                          {log.method}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900 font-mono">
                        {log.endpoint}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`text-sm font-semibold ${getStatusColor(log.status_code)}`}>
                          {log.status_code}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-mono">
                        {log.ip_address}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {log.response_time_ms ? `${log.response_time_ms}ms` : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {log.flagged_suspicious && (
                          <span className="px-2 py-1 text-xs font-semibold rounded bg-red-100 text-red-800">
                            Suspicious
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button
                          onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                          className="text-blue-600 hover:text-blue-900"
                        >
                          {expandedLog === log.id ? 'Hide' : 'Details'}
                        </button>
                      </td>
                    </tr>
                    {expandedLog === log.id && (
                      <tr className="bg-gray-50">
                        <td colSpan={8} className="px-6 py-4">
                          <div className="space-y-2 text-sm">
                            {log.user_agent && (
                              <div>
                                <span className="font-semibold text-gray-700">User Agent:</span>
                                <span className="ml-2 text-gray-600">{log.user_agent}</span>
                              </div>
                            )}
                            {log.referer && (
                              <div>
                                <span className="font-semibold text-gray-700">Referer:</span>
                                <span className="ml-2 text-gray-600">{log.referer}</span>
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
                                <span className="font-semibold text-gray-700">API Key ID:</span>
                                <span className="ml-2 text-gray-600 font-mono">{log.api_key_id}</span>
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
          <div className="flex items-center justify-between bg-white px-4 py-3 border border-gray-200 rounded-lg">
            <div className="text-sm text-gray-700">
              Showing <span className="font-medium">{(filters.offset || 0) + 1}</span> to{' '}
              <span className="font-medium">{(filters.offset || 0) + logs.length}</span>
            </div>
            <div className="flex space-x-2">
              <button
                onClick={handlePrevPage}
                disabled={!filters.offset || filters.offset === 0}
                className="px-3 py-1 text-sm bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <button
                onClick={handleNextPage}
                disabled={logs.length < (filters.limit || 50)}
                className="px-3 py-1 text-sm bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
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
