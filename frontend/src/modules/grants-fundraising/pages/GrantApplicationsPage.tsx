/**
 * Grant Applications Page
 *
 * Displays all grant applications with a pipeline (kanban) view and a table view.
 * Supports search, status filtering, and priority filtering.
 */

import React, { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  Plus,
  Search,
  LayoutGrid,
  Table2,
  ExternalLink,
  Loader2,
  FileText,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  X,
} from 'lucide-react';
import type { GrantApplication, ApplicationStatus } from '../types';
import { ApplicationStatus as ApplicationStatusEnum, APPLICATION_STATUS_COLORS, PRIORITY_COLORS } from '../types';
import { useGrantsStore } from '../store/grantsStore';
import { formatDate } from '../../../utils/dateFormatting';
import { formatCurrencyWhole } from '@/utils/currencyFormatting';
import { useTimezone } from '../../../hooks/useTimezone';

// =============================================================================
// Constants
// =============================================================================

type ViewMode = 'pipeline' | 'table';

const APPLICATION_STATUS_LABELS: Record<string, string> = {
  researching: 'Researching',
  preparing: 'Preparing',
  internal_review: 'Internal Review',
  submitted: 'Submitted',
  under_review: 'Under Review',
  awarded: 'Awarded',
  denied: 'Denied',
  active: 'Active',
  reporting: 'Reporting',
  closed: 'Closed',
};

const PIPELINE_COLUMNS: ApplicationStatus[] = [
  ApplicationStatusEnum.RESEARCHING,
  ApplicationStatusEnum.PREPARING,
  ApplicationStatusEnum.INTERNAL_REVIEW,
  ApplicationStatusEnum.SUBMITTED,
  ApplicationStatusEnum.UNDER_REVIEW,
  ApplicationStatusEnum.AWARDED,
  ApplicationStatusEnum.DENIED,
  ApplicationStatusEnum.ACTIVE,
  ApplicationStatusEnum.REPORTING,
  ApplicationStatusEnum.CLOSED,
];

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

type SortField =
  | 'grantProgramName'
  | 'grantAgency'
  | 'applicationStatus'
  | 'amountRequested'
  | 'amountAwarded'
  | 'applicationDeadline'
  | 'priority'
  | 'assignedTo';
type SortDir = 'asc' | 'desc';

const PRIORITY_SORT_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// =============================================================================
// Pipeline Card Component
// =============================================================================

interface PipelineCardProps {
  application: GrantApplication;
  timezone: string;
}

const PipelineCard: React.FC<PipelineCardProps> = ({ application, timezone }) => {
  const navigate = useNavigate();

  const deadlineDate = application.applicationDeadline ? new Date(application.applicationDeadline) : null;
  const isOverdue = deadlineDate ? deadlineDate < new Date() : false;

  return (
    <button
      type="button"
      onClick={() => void navigate(`/grants/applications/${application.id}`)}
      className="border-theme-surface-border bg-theme-surface w-full rounded-lg border p-3 text-left shadow-sm transition-shadow hover:shadow-md"
    >
      <p className="text-theme-text-primary line-clamp-2 text-sm font-medium">{application.grantProgramName}</p>

      {application.amountRequested != null && (
        <p className="text-theme-text-primary mt-1 text-lg font-bold">
          {formatCurrencyWhole(application.amountRequested)}
        </p>
      )}

      {application.applicationDeadline && (
        <p className={`mt-1 text-xs ${isOverdue ? 'font-semibold text-red-600' : 'text-theme-text-secondary'}`}>
          Deadline: {formatDate(application.applicationDeadline, timezone)}
        </p>
      )}

      <div className="mt-2 flex items-center gap-2">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_COLORS[application.priority] ?? 'bg-theme-surface-secondary text-theme-text-secondary'}`}
        >
          {PRIORITY_LABELS[application.priority] ?? application.priority}
        </span>
      </div>

      {application.assignedTo && (
        <p className="text-theme-text-secondary mt-2 truncate text-xs">{application.assignedTo}</p>
      )}
    </button>
  );
};

// =============================================================================
// Pipeline Column Component
// =============================================================================

interface PipelineColumnProps {
  status: ApplicationStatus;
  applications: GrantApplication[];
  timezone: string;
}

const PipelineColumn: React.FC<PipelineColumnProps> = ({ status, applications, timezone }) => {
  const colorClasses = APPLICATION_STATUS_COLORS[status] ?? 'bg-theme-surface-secondary text-theme-text-secondary';

  return (
    <div className="border-theme-surface-border bg-theme-bg flex h-full w-72 flex-shrink-0 flex-col rounded-lg border">
      {/* Column header */}
      <div className="border-theme-surface-border flex items-center justify-between border-b px-3 py-2">
        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${colorClasses}`}>
          {APPLICATION_STATUS_LABELS[status] ?? status}
        </span>
        <span className="text-theme-text-secondary text-xs font-medium">{applications.length}</span>
      </div>

      {/* Cards */}
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {applications.length === 0 ? (
          <p className="text-theme-text-secondary py-4 text-center text-xs">No applications</p>
        ) : (
          applications.map((app) => <PipelineCard key={app.id} application={app} timezone={timezone} />)
        )}
      </div>
    </div>
  );
};

// =============================================================================
// Sortable Header Component
// =============================================================================

interface SortableHeaderProps {
  label: string;
  field: SortField;
  currentSort: SortField;
  currentDir: SortDir;
  onSort: (field: SortField) => void;
}

const SortableHeader: React.FC<SortableHeaderProps> = ({ label, field, currentSort, currentDir, onSort }) => {
  const isActive = currentSort === field;
  return (
    <th
      scope="col"
      className="text-theme-text-secondary px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className="hover:text-theme-text-primary inline-flex items-center gap-1"
      >
        {label}
        {isActive ? (
          currentDir === 'asc' ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </th>
  );
};

// =============================================================================
// Main Page Component
// =============================================================================

export const GrantApplicationsPage: React.FC = () => {
  const navigate = useNavigate();
  const tz = useTimezone();

  const { applications, isLoading, error, fetchApplications } = useGrantsStore();

  const [viewMode, setViewMode] = useState<ViewMode>('pipeline');
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [priorityFilter, setPriorityFilter] = useState<string>('');
  const [sortField, setSortField] = useState<SortField>('applicationDeadline');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  useEffect(() => {
    void fetchApplications();
  }, [fetchApplications]);

  // ---------------------------------------------------------------------------
  // Filtering
  // ---------------------------------------------------------------------------

  const filteredApplications = useMemo(() => {
    return applications.filter((app) => {
      const matchesSearch =
        !searchText ||
        app.grantProgramName.toLowerCase().includes(searchText.toLowerCase()) ||
        app.grantAgency.toLowerCase().includes(searchText.toLowerCase()) ||
        (app.assignedTo ?? '').toLowerCase().includes(searchText.toLowerCase());
      const matchesStatus = !statusFilter || app.applicationStatus === statusFilter;
      const matchesPriority = !priorityFilter || app.priority === priorityFilter;
      return matchesSearch && matchesStatus && matchesPriority;
    });
  }, [applications, searchText, statusFilter, priorityFilter]);

  // ---------------------------------------------------------------------------
  // Sorting (table view)
  // ---------------------------------------------------------------------------

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sortedApplications = useMemo(() => {
    const copy = [...filteredApplications];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'grantProgramName':
          cmp = a.grantProgramName.localeCompare(b.grantProgramName);
          break;
        case 'grantAgency':
          cmp = a.grantAgency.localeCompare(b.grantAgency);
          break;
        case 'applicationStatus':
          cmp = a.applicationStatus.localeCompare(b.applicationStatus);
          break;
        case 'amountRequested':
          cmp = (a.amountRequested ?? 0) - (b.amountRequested ?? 0);
          break;
        case 'amountAwarded':
          cmp = (a.amountAwarded ?? 0) - (b.amountAwarded ?? 0);
          break;
        case 'applicationDeadline': {
          const da = a.applicationDeadline ? new Date(a.applicationDeadline).getTime() : Infinity;
          const db = b.applicationDeadline ? new Date(b.applicationDeadline).getTime() : Infinity;
          cmp = da - db;
          break;
        }
        case 'priority':
          cmp = (PRIORITY_SORT_ORDER[a.priority] ?? 99) - (PRIORITY_SORT_ORDER[b.priority] ?? 99);
          break;
        case 'assignedTo':
          cmp = (a.assignedTo ?? '').localeCompare(b.assignedTo ?? '');
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [filteredApplications, sortField, sortDir]);

  // ---------------------------------------------------------------------------
  // Pipeline grouping
  // ---------------------------------------------------------------------------

  const applicationsByStatus = useMemo(() => {
    const grouped: Record<string, GrantApplication[]> = {};
    for (const status of PIPELINE_COLUMNS) {
      grouped[status] = [];
    }
    for (const app of filteredApplications) {
      const bucket = grouped[app.applicationStatus];
      if (bucket) {
        bucket.push(app);
      }
    }
    return grouped;
  }, [filteredApplications]);

  // ---------------------------------------------------------------------------
  // Filters active indicator
  // ---------------------------------------------------------------------------

  const hasFilters = searchText || statusFilter || priorityFilter;

  const clearFilters = () => {
    setSearchText('');
    setStatusFilter('');
    setPriorityFilter('');
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="bg-theme-bg min-h-screen">
      <div className="mx-auto max-w-full px-4 py-6 sm:px-6 lg:px-8">
        {/* Page header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-theme-text-primary text-2xl font-bold">Grant Applications</h1>
            <p className="text-theme-text-secondary mt-1 text-sm">
              Track and manage grant applications through the pipeline
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* View toggle */}
            <div className="border-theme-surface-border bg-theme-surface flex rounded-lg border p-0.5">
              <button
                type="button"
                onClick={() => setViewMode('pipeline')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  viewMode === 'pipeline'
                    ? 'bg-red-600 text-white'
                    : 'text-theme-text-secondary hover:text-theme-text-primary'
                }`}
              >
                <LayoutGrid className="h-4 w-4" />
                Pipeline
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  viewMode === 'table'
                    ? 'bg-red-600 text-white'
                    : 'text-theme-text-secondary hover:text-theme-text-primary'
                }`}
              >
                <Table2 className="h-4 w-4" />
                Table
              </button>
            </div>

            {/* New Application */}
            <Link
              to="/grants/applications/new"
              className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
            >
              <Plus className="h-4 w-4" />
              New Application
            </Link>
          </div>
        </div>

        {/* Search & filters */}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="text-theme-text-secondary absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <input
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              type="text"
              aria-label="Search programs, agencies, assignees..."
              placeholder="Search programs, agencies, assignees..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="form-input pr-4 pl-10"
            />
          </div>

          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="form-input">
            <option value="">All Statuses</option>
            {PIPELINE_COLUMNS.map((s) => (
              <option key={s} value={s}>
                {APPLICATION_STATUS_LABELS[s] ?? s}
              </option>
            ))}
          </select>

          <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className="form-input">
            <option value="">All Priorities</option>
            {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="border-theme-surface-border text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm transition-colors"
            >
              <X className="h-3.5 w-3.5" />
              Clear
            </button>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Loading */}
        {isLoading ? (
          <div className="mt-16 flex flex-col items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-red-500" />
            <p className="text-theme-text-secondary mt-3 text-sm">Loading applications...</p>
          </div>
        ) : filteredApplications.length === 0 ? (
          /* Empty state */
          <div className="mt-16 flex flex-col items-center justify-center">
            <FileText className="text-theme-text-secondary h-16 w-16 opacity-40" />
            <h3 className="text-theme-text-primary mt-4 text-lg font-semibold">No grant applications found</h3>
            <p className="text-theme-text-secondary mt-1 text-sm">
              {hasFilters
                ? 'Try adjusting your search or filters.'
                : 'Get started by creating your first grant application.'}
            </p>
            {!hasFilters && (
              <Link
                to="/grants/applications/new"
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                <Plus className="h-4 w-4" />
                New Application
              </Link>
            )}
          </div>
        ) : viewMode === 'pipeline' ? (
          /* ================================================================ */
          /* Pipeline (Kanban) View                                           */
          /* ================================================================ */
          <div className="-mx-4 mt-6 overflow-x-auto px-4 pb-4">
            <div className="inline-flex gap-3" style={{ minHeight: '60vh' }}>
              {PIPELINE_COLUMNS.map((status) => (
                <PipelineColumn
                  key={status}
                  status={status}
                  applications={applicationsByStatus[status] ?? []}
                  timezone={tz}
                />
              ))}
            </div>
          </div>
        ) : (
          /* ================================================================ */
          /* Table View                                                       */
          /* ================================================================ */
          <div className="border-theme-surface-border bg-theme-surface mt-6 overflow-hidden rounded-lg border">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-theme-surface-border bg-theme-surface border-b">
                    <SortableHeader
                      label="Program Name"
                      field="grantProgramName"
                      currentSort={sortField}
                      currentDir={sortDir}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      label="Agency"
                      field="grantAgency"
                      currentSort={sortField}
                      currentDir={sortDir}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      label="Status"
                      field="applicationStatus"
                      currentSort={sortField}
                      currentDir={sortDir}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      label="Amount Requested"
                      field="amountRequested"
                      currentSort={sortField}
                      currentDir={sortDir}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      label="Amount Awarded"
                      field="amountAwarded"
                      currentSort={sortField}
                      currentDir={sortDir}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      label="Deadline"
                      field="applicationDeadline"
                      currentSort={sortField}
                      currentDir={sortDir}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      label="Priority"
                      field="priority"
                      currentSort={sortField}
                      currentDir={sortDir}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      label="Assigned To"
                      field="assignedTo"
                      currentSort={sortField}
                      currentDir={sortDir}
                      onSort={handleSort}
                    />
                    <th
                      scope="col"
                      className="text-theme-text-secondary px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                    >
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-theme-surface-border divide-y">
                  {sortedApplications.map((app) => (
                    <tr
                      key={app.id}
                      onClick={() => void navigate(`/grants/applications/${app.id}`)}
                      className="hover:bg-theme-surface-hover cursor-pointer transition-colors"
                    >
                      <td className="text-theme-text-primary px-4 py-3 text-sm font-medium">{app.grantProgramName}</td>
                      <td className="text-theme-text-secondary px-4 py-3 text-sm whitespace-nowrap">
                        {app.grantAgency}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${APPLICATION_STATUS_COLORS[app.applicationStatus] ?? 'bg-theme-surface-secondary text-theme-text-secondary'}`}
                        >
                          {APPLICATION_STATUS_LABELS[app.applicationStatus] ?? app.applicationStatus}
                        </span>
                      </td>
                      <td className="text-theme-text-primary px-4 py-3 text-sm font-semibold whitespace-nowrap">
                        {formatCurrencyWhole(app.amountRequested)}
                      </td>
                      <td className="text-theme-text-primary px-4 py-3 text-sm whitespace-nowrap">
                        {formatCurrencyWhole(app.amountAwarded)}
                      </td>
                      <td className="text-theme-text-secondary px-4 py-3 text-sm whitespace-nowrap">
                        {app.applicationDeadline ? formatDate(app.applicationDeadline, tz) : '--'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_COLORS[app.priority] ?? 'bg-theme-surface-secondary text-theme-text-secondary'}`}
                        >
                          {PRIORITY_LABELS[app.priority] ?? app.priority}
                        </span>
                      </td>
                      <td className="text-theme-text-secondary px-4 py-3 text-sm whitespace-nowrap">
                        {app.assignedTo ?? '--'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <ExternalLink className="text-theme-text-secondary h-4 w-4" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default GrantApplicationsPage;
