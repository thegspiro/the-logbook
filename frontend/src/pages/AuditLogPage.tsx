/**
 * Audit Log Admin Page
 *
 * Read-only view over the tamper-proof audit log for admins
 * (`audit.view`). Surfaces who changed what, when — the answer to
 * "what's the chain of custody for this record" that compliance
 * regimes ask about. Org-scoped on the backend.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ShieldCheck, Search, AlertTriangle, AlertCircle, Info, RefreshCw } from 'lucide-react';
import {
  auditLogService,
  type AuditLogEntry,
  type AuditLogFilters,
  type AuditLogStats,
  type AuditSeverity,
} from '../services/api';
import { useTimezone } from '../hooks/useTimezone';
import { formatDateTime } from '../utils/dateFormatting';
import { getErrorMessage } from '../utils/errorHandling';
import { Pagination, EmptyState } from '../components/ux';
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from '../constants/config';

const SEVERITY_BADGE: Record<AuditSeverity, string> = {
  info: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30',
  warning: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  critical: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
};

const SEVERITY_ICON: Record<AuditSeverity, React.ReactNode> = {
  info: <Info className="h-3.5 w-3.5" aria-hidden="true" />,
  warning: <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />,
  critical: <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />,
};

const inputClass =
  'w-full bg-theme-input-bg border border-theme-input-border rounded-md px-3 py-2 text-sm text-theme-text-primary focus:outline-hidden focus:ring-2 focus:ring-red-500';

const AuditLogPage: React.FC = () => {
  const tz = useTimezone();
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [stats, setStats] = useState<AuditLogStats | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [severity, setSeverity] = useState<AuditSeverity | ''>('');
  const [category, setCategory] = useState<string>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

  const filters = useMemo<AuditLogFilters>(
    () => ({
      search: search || undefined,
      severity: severity || undefined,
      event_category: category || undefined,
      skip: (page - 1) * pageSize,
      limit: pageSize,
    }),
    [search, severity, category, page, pageSize]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, statsData] = await Promise.all([auditLogService.list(filters), auditLogService.getStats()]);
      setEntries(list.logs);
      setTotal(list.total);
      setStats(statsData);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load audit log'));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  };

  const resetFilters = () => {
    setSearchInput('');
    setSearch('');
    setSeverity('');
    setCategory('');
    setPage(1);
  };

  const categories = stats ? Object.keys(stats.by_category) : [];

  return (
    <div className="mx-auto min-h-screen max-w-7xl p-4 sm:p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-theme-text-primary flex items-center gap-2 text-2xl font-bold sm:text-3xl">
            <ShieldCheck className="h-7 w-7 text-red-600 dark:text-red-400" aria-hidden="true" />
            Audit Log
          </h1>
          <p className="text-theme-text-secondary mt-1 text-sm">
            Tamper-proof record of every administrative and security event in your organization.
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm transition-colors"
          aria-label="Refresh audit log"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <div className="card p-4">
            <p className="text-theme-text-muted text-xs font-medium uppercase">Total events</p>
            <p className="text-theme-text-primary mt-1 text-2xl font-bold sm:text-3xl">{stats.total}</p>
          </div>
          <div className="card p-4">
            <p className="text-theme-text-muted text-xs font-medium uppercase">Critical</p>
            <p className="mt-1 text-2xl font-bold text-red-700 sm:text-3xl dark:text-red-400">
              {stats.by_severity.critical ?? 0}
            </p>
          </div>
          <div className="card p-4">
            <p className="text-theme-text-muted text-xs font-medium uppercase">Warnings</p>
            <p className="mt-1 text-2xl font-bold text-amber-700 sm:text-3xl dark:text-amber-400">
              {stats.by_severity.warning ?? 0}
            </p>
          </div>
          <div className="card p-4">
            <p className="text-theme-text-muted text-xs font-medium uppercase">Info</p>
            <p className="mt-1 text-2xl font-bold text-blue-700 sm:text-3xl dark:text-blue-400">
              {stats.by_severity.info ?? 0}
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <form
        onSubmit={handleSearchSubmit}
        className="card mb-4 grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-4"
      >
        <div className="relative">
          <Search
            className="text-theme-text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
            aria-hidden="true"
          />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search username or event type"
            className={`${inputClass} pl-9`}
            aria-label="Search audit log"
          />
        </div>
        <select
          value={severity}
          onChange={(e) => {
            setPage(1);
            setSeverity((e.target.value as AuditSeverity | '') || '');
          }}
          className={inputClass}
          aria-label="Filter by severity"
        >
          <option value="">All severities</option>
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="critical">Critical</option>
        </select>
        <select
          value={category}
          onChange={(e) => {
            setPage(1);
            setCategory(e.target.value);
          }}
          className={inputClass}
          aria-label="Filter by category"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <button type="submit" className="btn-primary flex-1 text-sm">
            Apply
          </button>
          <button
            type="button"
            onClick={resetFilters}
            className="text-theme-text-secondary hover:text-theme-text-primary border-theme-surface-border rounded-md border px-3 py-2 text-sm"
          >
            Reset
          </button>
        </div>
      </form>

      {/* Table */}
      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      ) : loading && entries.length === 0 ? (
        <div className="card text-theme-text-muted p-12 text-center">Loading audit log…</div>
      ) : entries.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={ShieldCheck}
            title="No audit events found"
            description={
              search || severity || category
                ? 'Try removing or relaxing a filter.'
                : 'No audit events have been recorded for your organization yet.'
            }
            actions={
              search || severity || category
                ? [{ label: 'Clear filters', onClick: resetFilters, variant: 'secondary' }]
                : undefined
            }
          />
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="bg-theme-surface-secondary text-theme-text-muted text-left text-xs font-medium uppercase">
              <tr>
                <th scope="col" className="px-4 py-3">
                  When
                </th>
                <th scope="col" className="px-4 py-3">
                  Severity
                </th>
                <th scope="col" className="px-4 py-3">
                  Event
                </th>
                <th scope="col" className="hidden px-4 py-3 md:table-cell">
                  Category
                </th>
                <th scope="col" className="px-4 py-3">
                  User
                </th>
                <th scope="col" className="hidden px-4 py-3 lg:table-cell">
                  IP
                </th>
              </tr>
            </thead>
            <tbody className="divide-theme-surface-border divide-y">
              {entries.map((entry) => {
                const sev = entry.severity;
                const expanded = expandedId === entry.id;
                return (
                  <React.Fragment key={entry.id}>
                    <tr
                      className="hover:bg-theme-surface-hover cursor-pointer"
                      onClick={() => setExpandedId(expanded ? null : entry.id)}
                      aria-expanded={expanded}
                    >
                      <td className="text-theme-text-secondary px-4 py-3 text-sm whitespace-nowrap">
                        {entry.timestamp ? formatDateTime(entry.timestamp, tz) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {sev && (
                          <span
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium uppercase ${SEVERITY_BADGE[sev]}`}
                          >
                            {SEVERITY_ICON[sev]}
                            {sev}
                          </span>
                        )}
                      </td>
                      <td className="text-theme-text-primary px-4 py-3 font-mono text-sm">{entry.event_type}</td>
                      <td className="text-theme-text-secondary hidden px-4 py-3 text-sm md:table-cell">
                        {entry.event_category}
                      </td>
                      <td className="text-theme-text-secondary px-4 py-3 text-sm">
                        {entry.username || <span className="text-theme-text-muted italic">system</span>}
                      </td>
                      <td className="text-theme-text-muted hidden px-4 py-3 font-mono text-sm lg:table-cell">
                        {entry.ip_address || '—'}
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="bg-theme-surface-secondary">
                        <td colSpan={6} className="px-4 py-3">
                          <pre className="text-theme-text-secondary font-mono text-xs whitespace-pre-wrap">
                            {JSON.stringify(entry.event_data, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {entries.length > 0 && (
        <Pagination
          currentPage={page}
          totalItems={total}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          pageSizeOptions={[...PAGE_SIZE_OPTIONS]}
          className="mt-4"
        />
      )}
    </div>
  );
};

export default AuditLogPage;
