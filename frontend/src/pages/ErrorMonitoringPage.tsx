import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router';
import { Collapsible } from '../components/ux';
import { errorLogsService, type ErrorCodeEntry } from '../services/api';
import { errorTracker, type ErrorLog } from '../services/errorTracking';
import { useAuthStore } from '../stores/authStore';
import { useTimezone } from '../hooks/useTimezone';
import { formatDateTime, formatTime, getTodayLocalDate } from '../utils/dateFormatting';
import toast from 'react-hot-toast';

import { useConfirm } from '../contexts/ConfirmContext';
/**
 * Where the error was raised. Rows written before the `source` context key
 * existed carry neither marker, so they fall back to "Client".
 */
function sourceLabel(error: ErrorLog): string {
  if (error.context.source === 'backend' || error.errorType?.startsWith('BACKEND_')) {
    return 'Server';
  }
  return 'Client';
}

/**
 * Error Monitoring Dashboard
 *
 * Displays all tracked errors with filtering, statistics, and export capabilities.
 * Useful for administrators to identify and troubleshoot issues.
 * Data is fetched from the backend API.
 */
const ErrorMonitoringPage: React.FC = () => {
  const { confirm } = useConfirm();
  const tz = useTimezone();
  const { checkPermission } = useAuthStore();
  const canClearErrors = checkPermission('audit.manage');
  const [errors, setErrors] = useState<ErrorLog[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [stats, setStats] = useState<{
    total: number;
    byType: Record<string, number>;
    recentErrors: ErrorLog[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errorCodes, setErrorCodes] = useState<ErrorCodeEntry[]>([]);
  const [codeSearch, setCodeSearch] = useState('');

  const loadErrors = useCallback(async () => {
    try {
      const [errorList, errorStats] = await Promise.all([
        errorTracker.getErrors(filter !== 'all' ? { error_type: filter } : undefined),
        errorTracker.getErrorStats(),
      ]);
      setErrors(errorList);
      setStats(errorStats);
      setLoadError(null);
    } catch {
      setLoadError('Failed to load error monitoring data');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void loadErrors();
    const interval = setInterval(() => {
      if (!document.hidden) void loadErrors();
    }, 10000);
    return () => clearInterval(interval);
  }, [loadErrors]);

  useEffect(() => {
    // Static reference data — fetched once; the section simply doesn't render
    // if it can't be loaded.
    errorLogsService.getErrorCodes().then(setErrorCodes, () => setErrorCodes([]));
  }, []);

  const exportErrors = async () => {
    try {
      const dataStr = await errorTracker.exportErrors();
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `error-log-${getTodayLocalDate(tz)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Failed to export error logs');
    }
  };

  const clearAllErrors = async () => {
    if (
      await confirm({
        title: 'Clear all errors?',
        message: 'Every recorded error is discarded, along with the history behind these statistics.',
        confirmLabel: 'Clear all',
        cancelLabel: 'Keep them',
      })
    ) {
      try {
        await errorTracker.clearErrors();
        setErrors([]);
        setStats(null);
      } catch {
        toast.error('Failed to clear error logs');
      }
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl p-6">
        <div className="text-theme-text-secondary">Loading error data...</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-7xl p-6 text-center">
        <p className="mb-4 text-red-700 dark:text-red-400">{loadError}</p>
        <button type="button" className="btn-primary" onClick={() => void loadErrors()}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-7xl p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-theme-text-primary text-3xl font-bold">Error Monitoring</h1>
        <p className="text-theme-text-secondary mt-1">Track and analyze errors across the platform</p>
      </div>

      {/* Statistics Cards */}
      {stats && (
        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="bg-theme-surface rounded-lg p-6 shadow-md backdrop-blur-xs">
            <div className="text-theme-text-muted mb-1 text-sm font-medium">Total Errors</div>
            <div className="text-theme-text-primary text-3xl font-bold">{stats.total}</div>
          </div>

          {Object.entries(stats.byType)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 3)
            .map(([type, count]) => (
              <div key={type} className="bg-theme-surface rounded-lg p-6 shadow-md backdrop-blur-xs">
                <div className="text-theme-text-muted mb-1 truncate text-sm font-medium">{type}</div>
                <div className="text-3xl font-bold text-red-600">{count}</div>
              </div>
            ))}
        </div>
      )}

      {/* Actions Bar */}
      <div className="bg-theme-surface mb-6 flex flex-wrap items-center justify-between gap-4 rounded-lg p-4 shadow-md backdrop-blur-xs">
        <div className="flex items-center gap-2">
          <label className="text-theme-text-secondary text-sm font-medium">Filter:</label>
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className="form-input">
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
            onClick={() => {
              void exportErrors();
            }}
            className="border-theme-surface-border bg-theme-surface hover:bg-theme-surface-hover rounded-md border px-4 py-2 text-sm font-medium text-blue-700 dark:text-blue-400"
          >
            Export Errors
          </button>
          {canClearErrors && (
            <button
              onClick={() => {
                void clearAllErrors();
              }}
              className="border-theme-surface-border bg-theme-surface hover:bg-theme-surface-hover rounded-md border px-4 py-2 text-sm font-medium text-red-700 dark:text-red-400"
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* Error List */}
      <div className="bg-theme-surface overflow-hidden rounded-lg shadow-md backdrop-blur-xs">
        {errors.length === 0 ? (
          <div className="text-theme-text-muted p-8 text-center">
            <svg
              className="text-theme-text-muted mx-auto mb-4 h-12 w-12"
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
            <p className="mt-1 text-sm">
              {filter === 'all' ? 'The system is running smoothly!' : `No errors of type "${filter}"`}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
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
                    Error Type
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-muted px-6 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Source
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-muted px-6 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Message
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-muted px-6 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Context
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-muted px-6 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Error ID
                  </th>
                </tr>
              </thead>
              <tbody className="divide-theme-surface-border divide-y">
                {errors.map((error) => (
                  <tr key={error.id} className="hover:bg-theme-surface-hover">
                    <td className="text-theme-text-primary px-6 py-4 text-sm whitespace-nowrap">
                      {formatDateTime(error.timestamp, tz)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs leading-5 font-semibold ${
                          error.errorType?.startsWith('BACKEND_')
                            ? 'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-400'
                            : 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400'
                        }`}
                      >
                        {error.errorType}
                      </span>
                      {/* A collapsed burst reports once with a count. Without
                          showing it, "one error" and "one error that happened
                          400 times in a minute" look identical. */}
                      {typeof error.context.occurrences === 'number' && error.context.occurrences > 1 && (
                        <span className="text-theme-text-muted ml-2 text-xs font-semibold">
                          ×{error.context.occurrences}
                        </span>
                      )}
                    </td>
                    <td className="text-theme-text-secondary px-6 py-4 text-xs whitespace-nowrap">
                      {sourceLabel(error)}
                    </td>
                    <td className="text-theme-text-secondary max-w-md px-6 py-4 text-sm">
                      <div className="truncate">{error.userMessage}</div>
                      {/* The technical message is what an administrator
                          actually needs to act on; the user message above is
                          what the member was shown. */}
                      {error.errorMessage && error.errorMessage !== error.userMessage && (
                        <div className="text-theme-text-muted mt-1 truncate font-mono text-xs">
                          {error.errorMessage}
                        </div>
                      )}
                    </td>
                    <td className="text-theme-text-secondary px-6 py-4 text-sm">
                      {error.context.path ? (
                        <span className="font-mono text-xs">
                          {(error.context.method as string | undefined) ?? ''} {error.context.path as string}
                          {error.context.status ? ` → ${error.context.status as number}` : ''}
                          {typeof error.context.error_code === 'string' ? ` [${error.context.error_code}]` : ''}
                        </span>
                      ) : (
                        <>
                          {error.context.eventId && (
                            <Link
                              to={`/events/${error.context.eventId as string}`}
                              className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                            >
                              Event
                            </Link>
                          )}
                          {error.context.userId && ` | User: ${(error.context.userId as string).substring(0, 8)}`}
                        </>
                      )}
                      {typeof error.context.page === 'string' && (
                        <div className="text-theme-text-muted mt-1 truncate text-xs">on {error.context.page}</div>
                      )}
                    </td>
                    <td className="text-theme-text-muted px-6 py-4 font-mono text-xs whitespace-nowrap">
                      {error.id?.split('-')[0]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Error Code Reference — what each LB-* support code means and how to
          resolve it, so IT can look up the code a member quotes from a toast */}
      {errorCodes.length > 0 && (
        <div className="mt-6">
          <Collapsible
            title={`Error Code Reference (${errorCodes.length} codes)`}
            className="bg-theme-surface shadow-md"
          >
            <div className="space-y-4 p-4">
              <p className="text-theme-text-secondary text-sm">
                Every error shown to a member carries a code like <span className="font-mono">LB-AUTH-002</span>. Ask
                the member for the code and look it up here. Codes in the <span className="font-mono">LB-API-*</span>{' '}
                family embed the HTTP status of a failure that has no more specific code.
              </p>
              <input
                type="search"
                value={codeSearch}
                onChange={(e) => setCodeSearch(e.target.value)}
                placeholder="Search by code or description…"
                className="form-input max-w-sm"
                aria-label="Search error codes"
              />
              <div className="overflow-x-auto">
                <table className="divide-theme-surface-border min-w-full divide-y">
                  <thead>
                    <tr>
                      <th
                        scope="col"
                        className="text-theme-text-muted px-4 py-2 text-left text-xs font-medium tracking-wider uppercase"
                      >
                        Code
                      </th>
                      <th
                        scope="col"
                        className="text-theme-text-muted px-4 py-2 text-left text-xs font-medium tracking-wider uppercase"
                      >
                        Meaning
                      </th>
                      <th
                        scope="col"
                        className="text-theme-text-muted px-4 py-2 text-left text-xs font-medium tracking-wider uppercase"
                      >
                        How to resolve
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-theme-surface-border divide-y">
                    {errorCodes
                      .filter((entry) => {
                        const query = codeSearch.trim().toLowerCase();
                        if (!query) return true;
                        return [entry.code, entry.title, entry.description].some((text) =>
                          text.toLowerCase().includes(query)
                        );
                      })
                      .map((entry) => (
                        <tr key={entry.code} className="align-top">
                          <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">{entry.code}</td>
                          <td className="max-w-md px-4 py-3 text-sm">
                            <div className="text-theme-text-primary font-medium">{entry.title}</div>
                            <div className="text-theme-text-secondary mt-1 text-xs">{entry.description}</div>
                          </td>
                          <td className="max-w-md px-4 py-3">
                            <ul className="text-theme-text-secondary list-disc space-y-1 pl-4 text-xs">
                              {entry.resolution.map((step) => (
                                <li key={step}>{step}</li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Collapsible>
        </div>
      )}

      {/* Recent Errors Preview */}
      {stats && stats.recentErrors.length > 0 && filter === 'all' && (
        <div className="bg-theme-surface mt-6 rounded-lg p-6 shadow-md backdrop-blur-xs">
          <h2 className="text-theme-text-primary mb-4 text-lg font-semibold">Recent Errors</h2>
          <div className="space-y-4">
            {stats.recentErrors.map((error: ErrorLog) => (
              <div key={error.id} className="rounded-r border-l-4 border-red-500 bg-red-500/10 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-red-700 dark:text-red-300">{error.errorType}</p>
                    <p className="mt-1 text-sm text-red-700 dark:text-red-300">{error.userMessage}</p>
                  </div>
                  <span className="text-xs text-red-600">{formatTime(error.timestamp, tz)}</span>
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
