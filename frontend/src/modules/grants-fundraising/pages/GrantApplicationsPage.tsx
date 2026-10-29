/**
 * Grant Applications Page
 *
 * Displays grant applications with a pipeline (kanban) view and a table view.
 * Supports search, status (or status-group) filtering, and priority filtering.
 *
 * Both views page through the server (GF-33): the table a page at a time with
 * a pager, each pipeline column a batch at a time with "Show more". Filtering,
 * search and sort happen on the server, so nothing past a single fetch is
 * silently left out.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
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
import type { GrantApplication, ApplicationStatus, ApplicationStatusGroup, GrantApplicationQuery } from '../types';
import {
  ApplicationStatus as ApplicationStatusEnum,
  ApplicationStatusGroup as ApplicationStatusGroupEnum,
  APPLICATION_STATUS_COLORS,
  APPLICATION_STATUS_GROUP_LABELS,
  PRIORITY_COLORS,
} from '../types';
import { grantsService } from '../services/api';
import { formatDate } from '../../../utils/dateFormatting';
import { formatCurrencyWhole } from '@/utils/currencyFormatting';
import { getErrorMessage } from '@/utils/errorHandling';
import { useTimezone } from '../../../hooks/useTimezone';
import { Pagination } from '@/components/ux/Pagination';
import { DEFAULT_PAGE_SIZE } from '@/constants/config';
import { useMemberNames } from '../hooks/useMemberNames';
import type { MemberNames } from '../hooks/useMemberNames';

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

const STATUS_GROUPS = Object.values(ApplicationStatusGroupEnum) as ApplicationStatusGroup[];

/** A status-filter value naming a group rather than one status. */
const GROUP_PREFIX = 'group:';

/** Cards fetched per pipeline column, and per "Show more". */
const PIPELINE_PAGE_SIZE = 25;

/** How long the search box waits for typing to stop before querying. */
const SEARCH_DEBOUNCE_MS = 300;

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

/** The filters both views share, as the server takes them. */
type ListFilters = Pick<GrantApplicationQuery, 'status' | 'statusGroup' | 'priority' | 'search'>;

function filtersFromSelection(statusFilter: string, priority: string, search: string): ListFilters {
  const isGroup = statusFilter.startsWith(GROUP_PREFIX);
  return {
    status: isGroup ? undefined : statusFilter || undefined,
    statusGroup: isGroup ? (statusFilter.slice(GROUP_PREFIX.length) as ApplicationStatusGroup) : undefined,
    priority: priority || undefined,
    search: search.trim() || undefined,
  };
}

/**
 * The initial status filter from the URL. Dashboard cards link with
 * `?group=<name>` for a figure that counts several statuses (GF-27a) and
 * `?status=<value>` for one. A stale or mistyped value falls back to
 * unfiltered rather than silently matching nothing.
 */
function initialStatusFilter(params: URLSearchParams): string {
  const group = params.get('group');
  if (group && (STATUS_GROUPS as string[]).includes(group)) return `${GROUP_PREFIX}${group}`;
  const status = params.get('status');
  return status && (PIPELINE_COLUMNS as string[]).includes(status) ? status : '';
}

// =============================================================================
// Pipeline Card Component
// =============================================================================

interface PipelineCardProps {
  application: GrantApplication;
  timezone: string;
  nameOf: MemberNames['nameOf'];
}

const PipelineCard: React.FC<PipelineCardProps> = ({ application, timezone, nameOf }) => {
  const navigate = useNavigate();

  const deadlineDate = application.applicationDeadline ? new Date(application.applicationDeadline) : null;
  const isOverdue = deadlineDate ? deadlineDate < new Date() : false;

  return (
    <button
      type="button"
      onClick={() => void navigate(`/grants/applications/${application.id}`)}
      className="card w-full p-3 text-left transition-shadow hover:shadow-md"
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
        <p className="text-theme-text-secondary mt-2 truncate text-xs">{nameOf(application.assignedTo)}</p>
      )}
    </button>
  );
};

// =============================================================================
// Pipeline Column Component
// =============================================================================

interface PipelineColumnProps {
  status: ApplicationStatus;
  filters: ListFilters;
  timezone: string;
  nameOf: MemberNames['nameOf'];
  onTotal: (status: ApplicationStatus, total: number) => void;
}

/**
 * One kanban column. It fetches its own status a batch at a time, so a busy
 * column is paged rather than cut off, and the count in its header is the
 * server's total for the column, not the number of cards loaded.
 *
 * Under a status group the column still asks for its own status *within* the
 * group; the server decides membership, so a column outside the group simply
 * comes back empty rather than this page re-deriving which statuses a group
 * holds.
 */
const PipelineColumn: React.FC<PipelineColumnProps> = ({ status, filters, timezone, nameOf, onTotal }) => {
  const colorClasses = APPLICATION_STATUS_COLORS[status] ?? 'bg-theme-surface-secondary text-theme-text-secondary';
  const [items, setItems] = useState<GrantApplication[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  // A status filter for another column means this one has nothing to show,
  // without asking the server.
  const excluded = Boolean(filters.status && filters.status !== status);

  const load = useCallback(
    async (skip: number) => {
      const id = ++requestId.current;
      setIsLoading(true);
      setError(null);
      try {
        const page = await grantsService.listApplicationsPage({
          ...filters,
          status,
          skip,
          limit: PIPELINE_PAGE_SIZE,
        });
        if (id !== requestId.current) return;
        setItems((prev) => (skip === 0 ? page.items : [...prev, ...page.items]));
        setTotal(page.total);
        onTotal(status, page.total);
      } catch (err: unknown) {
        if (id !== requestId.current) return;
        setError(getErrorMessage(err, 'Could not load this column.'));
      } finally {
        if (id === requestId.current) setIsLoading(false);
      }
    },
    [filters, status, onTotal]
  );

  useEffect(() => {
    if (excluded) {
      requestId.current += 1;
      setItems([]);
      setTotal(0);
      setIsLoading(false);
      setError(null);
      onTotal(status, 0);
      return;
    }
    void load(0);
  }, [excluded, load, onTotal, status]);

  return (
    <div className="border-theme-surface-border bg-theme-surface-secondary flex h-full w-72 flex-shrink-0 flex-col rounded-lg border">
      {/* Column header */}
      <div className="border-theme-surface-border flex items-center justify-between border-b px-3 py-2">
        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${colorClasses}`}>
          {APPLICATION_STATUS_LABELS[status] ?? status}
        </span>
        <span className="text-theme-text-secondary text-xs font-medium" data-testid={`column-total-${status}`}>
          {total}
        </span>
      </div>

      {/* Cards */}
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {error ? (
          <p className="py-4 text-center text-xs text-red-700 dark:text-red-400">{error}</p>
        ) : items.length === 0 && !isLoading ? (
          <p className="text-theme-text-secondary py-4 text-center text-xs">No applications</p>
        ) : (
          items.map((app) => <PipelineCard key={app.id} application={app} timezone={timezone} nameOf={nameOf} />)
        )}
        {isLoading && (
          <div className="flex justify-center py-2">
            <Loader2 className="h-4 w-4 animate-spin text-red-500" aria-label="Loading" />
          </div>
        )}
        {!isLoading && !error && items.length < total && (
          <button
            type="button"
            onClick={() => void load(items.length)}
            className="border-theme-surface-border text-theme-text-secondary hover:text-theme-text-primary touch:min-h-11 w-full rounded-md border px-3 py-1.5 text-xs font-medium"
          >
            Show more ({total - items.length} more)
          </button>
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
// Table View Component
// =============================================================================

interface ApplicationsTableProps {
  filters: ListFilters;
  timezone: string;
  nameOf: MemberNames['nameOf'];
  emptyState: React.ReactNode;
}

const ApplicationsTable: React.FC<ApplicationsTableProps> = ({ filters, timezone, nameOf, emptyState }) => {
  const navigate = useNavigate();
  const [sortField, setSortField] = useState<SortField>('applicationDeadline');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [items, setItems] = useState<GrantApplication[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  // A new filter or sort starts again from the first page.
  useEffect(() => {
    setPage(1);
  }, [filters, sortField, sortDir, pageSize]);

  useEffect(() => {
    const id = ++requestId.current;
    setIsLoading(true);
    setError(null);
    grantsService
      .listApplicationsPage({
        ...filters,
        sort: sortField,
        order: sortDir,
        skip: (page - 1) * pageSize,
        limit: pageSize,
      })
      .then((result) => {
        if (id !== requestId.current) return;
        setItems(result.items);
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        if (id !== requestId.current) return;
        setError(getErrorMessage(err, 'Could not load grant applications.'));
      })
      .finally(() => {
        if (id === requestId.current) setIsLoading(false);
      });
  }, [filters, sortField, sortDir, page, pageSize]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  if (error) {
    return (
      <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-400">
        {error}
      </div>
    );
  }

  if (isLoading && items.length === 0) {
    return (
      <div className="mt-16 flex flex-col items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-red-500" />
        <p className="text-theme-text-secondary mt-3 text-sm">Loading applications...</p>
      </div>
    );
  }

  if (!isLoading && total === 0) return <>{emptyState}</>;

  return (
    <div className="card mt-6 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full" aria-busy={isLoading}>
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
            {items.map((app) => (
              <tr
                key={app.id}
                onClick={() => void navigate(`/grants/applications/${app.id}`)}
                className="hover:bg-theme-surface-hover cursor-pointer transition-colors"
              >
                <td className="text-theme-text-primary px-4 py-3 text-sm font-medium">{app.grantProgramName}</td>
                <td className="text-theme-text-secondary px-4 py-3 text-sm whitespace-nowrap">{app.grantAgency}</td>
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
                  {app.applicationDeadline ? formatDate(app.applicationDeadline, timezone) : '--'}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_COLORS[app.priority] ?? 'bg-theme-surface-secondary text-theme-text-secondary'}`}
                  >
                    {PRIORITY_LABELS[app.priority] ?? app.priority}
                  </span>
                </td>
                <td className="text-theme-text-secondary px-4 py-3 text-sm whitespace-nowrap">
                  {nameOf(app.assignedTo)}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <ExternalLink className="text-theme-text-secondary h-4 w-4" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination
        currentPage={page}
        totalItems={total}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    </div>
  );
};

// =============================================================================
// Main Page Component
// =============================================================================

export const GrantApplicationsPage: React.FC = () => {
  const tz = useTimezone();
  const { nameOf } = useMemberNames();
  const [searchParams] = useSearchParams();

  const [viewMode, setViewMode] = useState<ViewMode>('pipeline');
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>(() => initialStatusFilter(searchParams));
  const [priorityFilter, setPriorityFilter] = useState<string>('');
  const [columnTotals, setColumnTotals] = useState<Partial<Record<ApplicationStatus, number>>>({});

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(searchText), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchText]);

  // Rebuilt only when a filter value changes, so the views' fetch effects run
  // once per change rather than on every render.
  const filters = useMemo(
    () => filtersFromSelection(statusFilter, priorityFilter, debouncedSearch),
    [statusFilter, priorityFilter, debouncedSearch]
  );

  const handleColumnTotal = useCallback((status: ApplicationStatus, total: number) => {
    setColumnTotals((prev) => (prev[status] === total ? prev : { ...prev, [status]: total }));
  }, []);

  const hasFilters = Boolean(searchText || statusFilter || priorityFilter);

  const clearFilters = () => {
    setSearchText('');
    setStatusFilter('');
    setPriorityFilter('');
  };

  const pipelineReported = PIPELINE_COLUMNS.every((s) => columnTotals[s] !== undefined);
  const pipelineEmpty = pipelineReported && PIPELINE_COLUMNS.every((s) => (columnTotals[s] ?? 0) === 0);

  const emptyState = (
    <div className="mt-16 flex flex-col items-center justify-center">
      <FileText className="text-theme-text-secondary h-16 w-16 opacity-40" />
      <h3 className="text-theme-text-primary mt-4 text-lg font-semibold">No grant applications found</h3>
      <p className="text-theme-text-secondary mt-1 text-sm">
        {hasFilters ? 'Try a different search or clear the filters.' : 'Add an application to start tracking a grant.'}
      </p>
      {!hasFilters && (
        <Link
          to="/grants/applications/new"
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-red-800 px-4 py-2 text-sm font-medium text-white hover:bg-red-900"
        >
          <Plus className="h-4 w-4" />
          New Application
        </Link>
      )}
    </div>
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-full px-4 py-6 sm:px-6 lg:px-8">
        {/* Page header */}
        <div className="page-header gap-4 sm:items-center">
          <div className="page-header-title">
            <h1 className="text-theme-text-primary text-2xl font-bold">Grant Applications</h1>
            <p className="text-theme-text-secondary mt-1 text-sm">Track each application from research to closeout</p>
          </div>
          <div className="page-header-actions flex flex-wrap items-center gap-3">
            {/* View toggle */}
            <div className="card flex p-0.5">
              <button
                type="button"
                onClick={() => setViewMode('pipeline')}
                className={`touch:min-h-11 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  viewMode === 'pipeline'
                    ? 'bg-red-800 text-white'
                    : 'text-theme-text-secondary hover:text-theme-text-primary'
                }`}
              >
                <LayoutGrid className="h-4 w-4" />
                Pipeline
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`touch:min-h-11 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  viewMode === 'table'
                    ? 'bg-red-800 text-white'
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
              className="touch:min-h-11 inline-flex items-center gap-2 rounded-lg bg-red-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-900"
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
              aria-label="Search by program or agency"
              placeholder="Search by program or agency..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="form-input pr-4 pl-10"
            />
          </div>

          <select
            aria-label="Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="form-input"
          >
            <option value="">All Statuses</option>
            <optgroup label="Groups">
              {STATUS_GROUPS.map((g) => (
                <option key={g} value={`${GROUP_PREFIX}${g}`}>
                  {APPLICATION_STATUS_GROUP_LABELS[g]}
                </option>
              ))}
            </optgroup>
            <optgroup label="Statuses">
              {PIPELINE_COLUMNS.map((s) => (
                <option key={s} value={s}>
                  {APPLICATION_STATUS_LABELS[s] ?? s}
                </option>
              ))}
            </optgroup>
          </select>

          <select
            aria-label="Priority"
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="form-input"
          >
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
              Clear filters
            </button>
          )}
        </div>

        {viewMode === 'pipeline' ? (
          /* ================================================================ */
          /* Pipeline (Kanban) View                                           */
          /* ================================================================ */
          <>
            {pipelineEmpty && emptyState}
            <div className="-mx-4 mt-6 overflow-x-auto px-4 pb-4">
              <div className="inline-flex gap-3" style={{ minHeight: '60vh' }}>
                {PIPELINE_COLUMNS.map((status) => (
                  <PipelineColumn
                    key={status}
                    status={status}
                    filters={filters}
                    timezone={tz}
                    nameOf={nameOf}
                    onTotal={handleColumnTotal}
                  />
                ))}
              </div>
            </div>
          </>
        ) : (
          /* ================================================================ */
          /* Table View                                                       */
          /* ================================================================ */
          <ApplicationsTable filters={filters} timezone={tz} nameOf={nameOf} emptyState={emptyState} />
        )}
      </div>
    </div>
  );
};

export default GrantApplicationsPage;
