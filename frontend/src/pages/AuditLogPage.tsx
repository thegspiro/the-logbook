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
  info: <Info className="w-3.5 h-3.5" aria-hidden="true" />,
  warning: <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />,
  critical: <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />,
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
    [search, severity, category, page, pageSize],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, statsData] = await Promise.all([
        auditLogService.list(filters),
        auditLogService.getStats(),
      ]);
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
    <div className="min-h-screen max-w-7xl mx-auto p-4 sm:p-6">
      <div className="mb-6 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-theme-text-primary flex items-center gap-2">
            <ShieldCheck className="w-7 h-7 text-red-600 dark:text-red-400" aria-hidden="true" />
            Audit Log
          </h1>
          <p className="text-theme-text-secondary mt-1 text-sm">
            Tamper-proof record of every administrative and security event in your organization.
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm border border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover transition-colors"
          aria-label="Refresh audit log"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
          <div className="card p-4">
            <p className="text-xs font-medium uppercase text-theme-text-muted">Total events</p>
            <p className="text-2xl sm:text-3xl font-bold text-theme-text-primary mt-1">{stats.total}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs font-medium uppercase text-theme-text-muted">Critical</p>
            <p className="text-2xl sm:text-3xl font-bold text-red-700 dark:text-red-400 mt-1">
              {stats.by_severity.critical ?? 0}
            </p>
          </div>
          <div className="card p-4">
            <p className="text-xs font-medium uppercase text-theme-text-muted">Warnings</p>
            <p className="text-2xl sm:text-3xl font-bold text-amber-700 dark:text-amber-400 mt-1">
              {stats.by_severity.warning ?? 0}
            </p>
          </div>
          <div className="card p-4">
            <p className="text-xs font-medium uppercase text-theme-text-muted">Info</p>
            <p className="text-2xl sm:text-3xl font-bold text-blue-700 dark:text-blue-400 mt-1">
              {stats.by_severity.info ?? 0}
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <form
        onSubmit={handleSearchSubmit}
        className="card p-3 sm:p-4 mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
      >
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" aria-hidden="true" />
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
          <button type="submit" className="btn-primary text-sm flex-1">
            Apply
          </button>
          <button
            type="button"
            onClick={resetFilters}
            className="px-3 py-2 text-sm text-theme-text-secondary hover:text-theme-text-primary border border-theme-surface-border rounded-md"
          >
            Reset
          </button>
        </div>
      </form>

      {/* Table */}
      {error ? (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-700 dark:text-red-300 text-sm">{error}</div>
      ) : loading && entries.length === 0 ? (
        <div className="card p-12 text-center text-theme-text-muted">Loading audit log…</div>
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
            <thead className="bg-theme-surface-secondary text-left text-xs font-medium text-theme-text-muted uppercase">
              <tr>
                <th scope="col" className="px-4 py-3">When</th>
                <th scope="col" className="px-4 py-3">Severity</th>
                <th scope="col" className="px-4 py-3">Event</th>
                <th scope="col" className="px-4 py-3 hidden md:table-cell">Category</th>
                <th scope="col" className="px-4 py-3">User</th>
                <th scope="col" className="px-4 py-3 hidden lg:table-cell">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-theme-surface-border">
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
                      <td className="px-4 py-3 text-sm text-theme-text-secondary whitespace-nowrap">
                        {entry.timestamp ? formatDateTime(entry.timestamp, tz) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {sev && (
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium uppercase ${SEVERITY_BADGE[sev]}`}
                          >
                            {SEVERITY_ICON[sev]}
                            {sev}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-theme-text-primary font-mono">{entry.event_type}</td>
                      <td className="px-4 py-3 text-sm text-theme-text-secondary hidden md:table-cell">
                        {entry.event_category}
                      </td>
                      <td className="px-4 py-3 text-sm text-theme-text-secondary">
                        {entry.username || <span className="text-theme-text-muted italic">system</span>}
                      </td>
                      <td className="px-4 py-3 text-sm text-theme-text-muted font-mono hidden lg:table-cell">
                        {entry.ip_address || '—'}
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="bg-theme-surface-secondary">
                        <td colSpan={6} className="px-4 py-3">
                          <pre className="text-xs text-theme-text-secondary whitespace-pre-wrap font-mono">
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
