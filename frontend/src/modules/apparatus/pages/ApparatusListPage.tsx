/**
 * Apparatus List Page
 *
 * Main page for viewing all apparatus in the fleet.
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Truck,
  Plus,
  Search,
  Filter,
  Eye,
  Printer,
  Edit,
  Archive,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Wrench,
  Gauge,
  Clock,
  Users,
} from 'lucide-react';
import { useApparatusStore } from '../store/apparatusStore';
import { StatusBadge } from '../components/StatusBadge';
import { ApparatusTypeBadge } from '../components/ApparatusTypeBadge';
import { formatNumber } from '../../../utils/dateFormatting';

export const ApparatusListPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filterType, setFilterType] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [showArchived, setShowArchived] = useState(false);

  const {
    apparatusList,
    types,
    statuses,
    fleetSummary,
    totalApparatus,
    currentPage,
    totalPages,
    isLoading,
    isLoadingTypes,
    isLoadingStatuses,
    isLoadingSummary,
    error,
    fetchApparatusList,
    fetchTypes,
    fetchStatuses,
    fetchFleetSummary,
    setFilters,
    clearError,
  } = useApparatusStore();

  useEffect(() => {
    // Check authentication via session flag (tokens are in httpOnly cookies)
    if (!localStorage.getItem('has_session')) {
      void navigate('/login');
      return;
    }

    // Load initial data
    void fetchTypes();
    void fetchStatuses();
    void fetchFleetSummary();
    void fetchApparatusList(1);
  }, [navigate, fetchTypes, fetchStatuses, fetchFleetSummary, fetchApparatusList]);

  // Apply filters when they change
  useEffect(() => {
    const filters: Record<string, unknown> = {
      isArchived: showArchived,
    };

    if (filterType) {
      filters.apparatusTypeId = filterType;
    }
    if (filterStatus) {
      filters.statusId = filterStatus;
    }
    if (searchQuery) {
      filters.search = searchQuery;
    }

    setFilters(filters);
  }, [filterType, filterStatus, showArchived, searchQuery, setFilters]);

  const handlePageChange = (page: number) => {
    void fetchApparatusList(page);
  };

  const getTypeById = (typeId: string) => {
    return types.find((t) => t.id === typeId);
  };

  const getStatusById = (statusId: string) => {
    return statuses.find((s) => s.id === statusId);
  };

  return (
    <div className="from-theme-bg-from via-theme-bg-via to-theme-bg-to min-h-screen bg-linear-to-br">
      {/* Header */}
      <header className="bg-theme-input-bg border-theme-surface-border border-b px-4 py-4 backdrop-blur-xs sm:px-6">
        <div className="mx-auto max-w-7xl">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center space-x-3">
              <div className="shrink-0 rounded-lg bg-red-600 p-2">
                <Truck className="h-6 w-6 text-white" />
              </div>
              <div className="min-w-0">
                <h1 className="text-theme-text-primary truncate text-lg font-bold sm:text-xl">Apparatus Management</h1>
                <p className="text-theme-text-muted hidden text-sm sm:block">
                  Manage your fleet vehicles and equipment
                </p>
              </div>
            </div>
            <button
              onClick={() => void navigate('/dashboard')}
              className="text-theme-text-secondary hover:text-theme-text-primary shrink-0 text-sm transition-colors max-md:inline-flex max-md:min-h-[44px] max-md:items-center"
            >
              <span className="hidden sm:inline">← Back to Dashboard</span>
              <span className="sm:hidden">← Back</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        {/* Error Display */}
        {error && (
          <div className="mb-6 flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/10 p-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-red-700 dark:text-red-400" />
              <span className="text-red-700 dark:text-red-300">{error}</span>
            </div>
            <button
              onClick={clearError}
              className="text-red-700 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Fleet Summary Cards */}
        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6">
          <div className="card p-4">
            <p className="text-theme-text-muted text-xs font-medium uppercase">Total Fleet</p>
            <p className="text-theme-text-primary mt-1 text-2xl font-bold">
              {isLoadingSummary ? '...' : (fleetSummary?.totalApparatus ?? 0)}
            </p>
          </div>
          <div className="card p-4">
            <p className="text-theme-text-muted text-xs font-medium uppercase">In Service</p>
            <p className="mt-1 text-2xl font-bold text-green-700 dark:text-green-400">
              {isLoadingSummary ? '...' : (fleetSummary?.inServiceCount ?? 0)}
            </p>
          </div>
          <div className="card p-4">
            <p className="text-theme-text-muted text-xs font-medium uppercase">Out of Service</p>
            <p className="mt-1 text-2xl font-bold text-red-700 dark:text-red-400">
              {isLoadingSummary ? '...' : (fleetSummary?.outOfServiceCount ?? 0)}
            </p>
          </div>
          <div className="card p-4">
            <p className="text-theme-text-muted text-xs font-medium uppercase">In Maintenance</p>
            <p className="mt-1 text-2xl font-bold text-yellow-700 dark:text-yellow-400">
              {isLoadingSummary ? '...' : (fleetSummary?.inMaintenanceCount ?? 0)}
            </p>
          </div>
          <div className="card p-4">
            <p className="text-theme-text-muted text-xs font-medium uppercase">Reserve</p>
            <p className="mt-1 text-2xl font-bold text-blue-700 dark:text-blue-400">
              {isLoadingSummary ? '...' : (fleetSummary?.reserveCount ?? 0)}
            </p>
          </div>
          <div className="card p-4">
            <p className="text-theme-text-muted text-xs font-medium uppercase">Maint. Due</p>
            <p className="mt-1 text-2xl font-bold text-orange-700 dark:text-orange-400">
              {isLoadingSummary
                ? '...'
                : (fleetSummary?.maintenanceDueSoon ?? 0) + (fleetSummary?.maintenanceOverdue ?? 0)}
            </p>
          </div>
        </div>

        {/* Actions Bar */}
        <div className="card mb-6 p-4">
          <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
            {/* Search */}
            <div className="relative w-full flex-1 md:max-w-md">
              <Search className="text-theme-text-muted absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 transform" />
              <input
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                type="text"
                aria-label="Search by unit number, name, or VIN..."
                placeholder="Search by unit number, name, or VIN..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="form-input placeholder-theme-text-muted pr-4 pl-10"
              />
            </div>

            {/* Filter Toggle */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center space-x-2 rounded-lg px-4 py-2 transition-colors max-md:min-h-[44px] ${
                showFilters
                  ? 'bg-red-600 text-white'
                  : 'bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover'
              }`}
            >
              <Filter className="h-4 w-4" />
              <span>Filters</span>
            </button>

            {/* Add Button */}
            <button onClick={() => void navigate('/apparatus/new')} className="btn-primary flex items-center space-x-2">
              <Plus className="h-4 w-4" />
              <span>Add Apparatus</span>
            </button>
          </div>

          {/* Expanded Filters */}
          {showFilters && (
            <div className="border-theme-surface-border mt-4 grid grid-cols-1 gap-4 border-t pt-4 sm:grid-cols-2 md:grid-cols-4">
              {/* Type Filter */}
              <div>
                <label className="text-theme-text-muted mb-1 block text-sm">Type</label>
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  disabled={isLoadingTypes}
                  className="form-input"
                >
                  <option value="">All Types</option>
                  {types.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Status Filter */}
              <div>
                <label className="text-theme-text-muted mb-1 block text-sm">Status</label>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  disabled={isLoadingStatuses}
                  className="form-input"
                >
                  <option value="">All Statuses</option>
                  {statuses.map((status) => (
                    <option key={status.id} value={status.id}>
                      {status.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Show Archived */}
              <div className="flex items-end">
                <label className="flex cursor-pointer items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={showArchived}
                    onChange={(e) => setShowArchived(e.target.checked)}
                    className="form-checkbox"
                  />
                  <span className="text-theme-text-secondary">Show Archived</span>
                </label>
              </div>

              {/* Clear Filters */}
              <div className="flex items-end">
                <button
                  onClick={() => {
                    setFilterType('');
                    setFilterStatus('');
                    setShowArchived(false);
                    setSearchQuery('');
                  }}
                  className="text-theme-text-muted hover:text-theme-text-primary px-4 py-2 transition-colors"
                >
                  Clear Filters
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Apparatus Table */}
        {isLoading ? (
          <div className="card p-12 text-center" role="status" aria-live="polite">
            <div className="border-theme-text-primary mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2"></div>
            <p className="text-theme-text-secondary">Loading apparatus...</p>
          </div>
        ) : apparatusList.length === 0 ? (
          <div className="card p-12 text-center">
            <Truck className="text-theme-text-muted mx-auto mb-4 h-16 w-16" />
            <h3 className="text-theme-text-primary mb-2 text-xl font-bold">No Apparatus Found</h3>
            <p className="text-theme-text-secondary mb-6">
              {searchQuery || filterType || filterStatus
                ? 'Try adjusting your search or filters'
                : 'Get started by adding your first piece of apparatus'}
            </p>
            {!searchQuery && !filterType && !filterStatus && (
              <button
                onClick={() => void navigate('/apparatus/new')}
                className="btn-primary mx-auto flex items-center space-x-2 px-6 py-3"
              >
                <Plus className="h-5 w-5" />
                <span>Add Apparatus</span>
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-theme-input-bg border-theme-surface-border border-b">
                    <tr>
                      <th
                        scope="col"
                        className="text-theme-text-secondary px-3 py-3 text-left text-xs font-medium tracking-wider uppercase sm:px-6"
                      >
                        Unit
                      </th>
                      <th
                        scope="col"
                        className="text-theme-text-secondary table-col-secondary px-3 py-3 text-left text-xs font-medium tracking-wider uppercase sm:px-6"
                      >
                        Type
                      </th>
                      <th
                        scope="col"
                        className="text-theme-text-secondary table-col-secondary px-3 py-3 text-left text-xs font-medium tracking-wider uppercase sm:px-6"
                      >
                        Vehicle
                      </th>
                      <th
                        scope="col"
                        className="text-theme-text-secondary px-3 py-3 text-left text-xs font-medium tracking-wider uppercase sm:px-6"
                      >
                        Status
                      </th>
                      <th
                        scope="col"
                        className="text-theme-text-secondary table-col-secondary px-3 py-3 text-left text-xs font-medium tracking-wider uppercase sm:px-6"
                      >
                        <Users className="mr-1 inline h-4 w-4" />
                        Min Crew
                      </th>
                      <th
                        scope="col"
                        className="text-theme-text-secondary table-col-tertiary px-3 py-3 text-left text-xs font-medium tracking-wider uppercase sm:px-6"
                      >
                        <Gauge className="mr-1 inline h-4 w-4" />
                        Mileage
                      </th>
                      <th
                        scope="col"
                        className="text-theme-text-secondary table-col-tertiary px-3 py-3 text-left text-xs font-medium tracking-wider uppercase sm:px-6"
                      >
                        <Clock className="mr-1 inline h-4 w-4" />
                        Hours
                      </th>
                      <th
                        scope="col"
                        className="text-theme-text-secondary px-3 py-3 text-right text-xs font-medium tracking-wider uppercase sm:px-6"
                      >
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-theme-surface-border divide-y">
                    {apparatusList.map((apparatus) => {
                      const apparatusType = apparatus.apparatusType || getTypeById(apparatus.apparatusTypeId);
                      const status = apparatus.statusRecord || getStatusById(apparatus.statusId);

                      return (
                        <tr
                          key={apparatus.id}
                          className={`hover:bg-theme-surface-secondary transition-colors ${
                            apparatus.isArchived ? 'opacity-60' : ''
                          }`}
                        >
                          <td className="px-3 py-4 whitespace-nowrap sm:px-6">
                            <div className="flex items-center">
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-600 font-bold text-white">
                                {/* Unit numbers are hyphenated ("E-1", "B-5"), so a
                                    blind two-character prefix renders "E-", "B-" —
                                    the separator, not the number. Drop the
                                    punctuation first. */}
                                {apparatus.unitNumber.replace(/[^A-Za-z0-9]/g, '').substring(0, 2)}
                              </div>
                              <div className="ml-3 min-w-0">
                                <div className="text-theme-text-primary truncate font-medium">
                                  {apparatus.unitNumber}
                                </div>
                                {apparatus.name && (
                                  <div className="text-theme-text-muted truncate text-sm">{apparatus.name}</div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="table-col-secondary px-3 py-4 whitespace-nowrap sm:px-6">
                            {apparatusType && <ApparatusTypeBadge type={apparatusType} />}
                          </td>
                          <td className="table-col-secondary px-3 py-4 sm:px-6">
                            <div className="text-theme-text-primary text-sm">
                              {apparatus.year && apparatus.make && apparatus.model
                                ? `${apparatus.year} ${apparatus.make} ${apparatus.model}`
                                : apparatus.make && apparatus.model
                                  ? `${apparatus.make} ${apparatus.model}`
                                  : '-'}
                            </div>
                          </td>
                          <td className="px-3 py-4 whitespace-nowrap sm:px-6">
                            <div className="flex items-center gap-2">
                              {status && <StatusBadge status={status} />}
                              {apparatus.hasDeficiency && (
                                <span
                                  className="inline-flex items-center gap-1 rounded border border-red-500/20 bg-red-500/10 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:text-red-400"
                                  title="Equipment deficiency reported"
                                >
                                  <AlertTriangle className="h-3 w-3" />
                                  Deficiency
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="table-col-secondary px-3 py-4 whitespace-nowrap sm:px-6">
                            <div className="text-theme-text-secondary text-sm">{apparatus.minStaffing}</div>
                          </td>
                          <td className="table-col-tertiary px-3 py-4 whitespace-nowrap sm:px-6">
                            <div className="text-theme-text-secondary text-sm">
                              {apparatus.currentMileage ? formatNumber(apparatus.currentMileage) : '-'}
                            </div>
                          </td>
                          <td className="table-col-tertiary px-3 py-4 whitespace-nowrap sm:px-6">
                            <div className="text-theme-text-secondary text-sm">
                              {apparatus.currentHours ? formatNumber(apparatus.currentHours) : '-'}
                            </div>
                          </td>
                          <td className="px-3 py-4 text-right whitespace-nowrap sm:px-6">
                            <div className="flex items-center justify-end space-x-1 sm:space-x-2">
                              <button
                                onClick={() => void navigate(`/apparatus/print-labels?ids=${apparatus.id}`)}
                                className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-secondary hidden min-h-[44px] min-w-[44px] items-center justify-center rounded-sm p-2 transition-colors sm:inline-flex"
                                title="Print label"
                              >
                                <Printer className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => void navigate(`/apparatus/${apparatus.id}`)}
                                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-sm p-2 text-blue-700 transition-colors hover:bg-blue-500/10 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                                title="View Details"
                              >
                                <Eye className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => void navigate(`/apparatus/${apparatus.id}/edit`)}
                                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-sm p-2 text-green-700 transition-colors hover:bg-green-500/10 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
                                title="Edit"
                              >
                                <Edit className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => void navigate(`/apparatus/${apparatus.id}`)}
                                className="hidden min-h-[44px] min-w-[44px] items-center justify-center rounded-sm p-2 text-yellow-700 transition-colors hover:bg-yellow-500/10 hover:text-yellow-700 sm:inline-flex dark:text-yellow-400 dark:hover:text-yellow-300"
                                title="View Details"
                              >
                                <Wrench className="h-4 w-4" />
                              </button>
                              {!apparatus.isArchived && (
                                <button
                                  onClick={() => void navigate(`/apparatus/${apparatus.id}`)}
                                  className="text-theme-text-muted hover:text-theme-text-secondary hover:bg-theme-surface-secondary hidden min-h-[44px] min-w-[44px] items-center justify-center rounded-sm p-2 transition-colors sm:inline-flex"
                                  title="Archive"
                                >
                                  <Archive className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-6 flex flex-col items-center justify-between gap-3 sm:flex-row">
                <p className="text-theme-text-muted text-sm">
                  Showing page {currentPage} of {totalPages} ({totalApparatus} total)
                </p>
                <div className="flex items-center space-x-1 sm:space-x-2">
                  <button
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }
                    return (
                      <button
                        key={pageNum}
                        onClick={() => handlePageChange(pageNum)}
                        className={`h-10 min-w-[40px] rounded-lg text-sm font-medium transition-colors ${
                          currentPage === pageNum
                            ? 'bg-red-600 text-white'
                            : 'bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover'
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className="bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
};

export default ApparatusListPage;
