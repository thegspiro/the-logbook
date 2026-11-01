/**
 * Apparatus List Page
 *
 * Main page for viewing all apparatus in the fleet.
 */

import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  Truck,
  Plus,
  Search,
  Filter,
  Eye,
  Printer,
  Edit,
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
import { useAuthStore } from '../../../stores/authStore';
import { NfpaDepartmentSwitch } from '../components/NfpaDepartmentSwitch';
import { useApparatusNfpaSettings } from '../hooks/useApparatusNfpaSettings';
import { OperationsPageHeader } from '../../../components/operations/OperationsPageHeader';

// The dashboard's fleet-readiness tiles link here with one of these in the
// query string. Only the exact value a tile sends turns its filter on; anything
// else is unrecognized and degrades to the full list rather than an error.
const DASHBOARD_FILTERS = [
  {
    param: 'serviceStatus',
    value: 'unavailable',
    name: 'Out of service or in maintenance',
    label: 'Showing only apparatus that are out of service or in maintenance.',
  },
  {
    param: 'hasDeficiency',
    value: 'true',
    name: 'Unresolved deficiency',
    label: 'Showing only apparatus with an unresolved equipment deficiency.',
  },
  {
    param: 'inspection',
    value: 'overdue',
    name: 'Inspection overdue',
    label: 'Showing only apparatus whose inspection has expired.',
  },
] as const;

export const ApparatusListPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeDashboardFilters = DASHBOARD_FILTERS.filter((f) => searchParams.get(f.param) === f.value);
  const unavailableOnly = searchParams.get('serviceStatus') === 'unavailable';
  const deficiencyOnly = searchParams.get('hasDeficiency') === 'true';
  const inspectionOverdueOnly = searchParams.get('inspection') === 'overdue';
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filterType, setFilterType] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [showArchived, setShowArchived] = useState(false);
  // An empty list under a search or filter says nothing about whether the
  // department has any apparatus, so it must not read as a first-run screen.
  const isNarrowed = Boolean(
    searchQuery || filterType || filterStatus || showArchived || activeDashboardFilters.length > 0
  );
  const checkPermission = useAuthStore((state) => state.checkPermission);
  const canManage = checkPermission('apparatus.manage');
  const canCreate = canManage || checkPermission('apparatus.create');
  const canEdit = canManage || checkPermission('apparatus.edit');
  // The switch writes organization settings, so it is offered only to those
  // the settings endpoint will accept it from.
  const canManageSettings = checkPermission('settings.manage');
  const { settings: nfpaSettings, refresh: refreshNfpaSettings } = useApparatusNfpaSettings();

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

    // Load initial data. The list itself is fetched by the filter effect
    // below, which also runs on mount: a second fetch here would race it with
    // whatever filters the store kept from the last visit.
    void fetchTypes();
    void fetchStatuses();
    if (canManage) void fetchFleetSummary();
  }, [navigate, canManage, fetchTypes, fetchStatuses, fetchFleetSummary]);

  // Apply filters when they change. Every key is sent, cleared ones as
  // undefined, because the store merges into the filters it already holds and
  // an omitted key would keep the previous value.
  useEffect(() => {
    setFilters({
      isArchived: showArchived,
      apparatusTypeId: filterType || undefined,
      statusId: filterStatus || undefined,
      search: searchQuery || undefined,
      serviceStatus: unavailableOnly ? 'unavailable' : undefined,
      hasDeficiency: deficiencyOnly || undefined,
      inspection: inspectionOverdueOnly ? 'overdue' : undefined,
    });
  }, [
    filterType,
    filterStatus,
    showArchived,
    searchQuery,
    unavailableOnly,
    deficiencyOnly,
    inspectionOverdueOnly,
    setFilters,
  ]);

  const clearDashboardFilters = (params: readonly string[]) => {
    const next = new URLSearchParams(searchParams);
    params.forEach((param) => next.delete(param));
    setSearchParams(next, { replace: true });
  };

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
    <div>
      <div data-page-main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <OperationsPageHeader icon={Truck} title="Apparatus" subtitle="Manage your fleet vehicles and equipment" />

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
        {canManage && (
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
              <p className="text-theme-text-muted text-xs font-medium uppercase">Maintenance Due</p>
              <p className="mt-1 text-2xl font-bold text-orange-700 dark:text-orange-400">
                {isLoadingSummary
                  ? '...'
                  : (fleetSummary?.maintenanceDueSoon ?? 0) + (fleetSummary?.maintenanceOverdue ?? 0)}
              </p>
            </div>
          </div>
        )}

        {canManageSettings && nfpaSettings && (
          <NfpaDepartmentSwitch settings={nfpaSettings} onChanged={refreshNfpaSettings} />
        )}

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
                aria-label="Search by unit number, name, or VIN"
                placeholder="Search by unit number, name, or VIN..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="form-input placeholder-theme-text-muted pr-4 pl-10"
              />
            </div>

            {/* Filter Toggle */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`touch:min-h-[44px] flex items-center space-x-2 rounded-lg px-4 py-2 transition-colors ${
                showFilters
                  ? 'bg-red-800 text-white'
                  : 'bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover'
              }`}
            >
              <Filter className="h-4 w-4" />
              <span>Filters</span>
            </button>

            {/* Add Button */}
            {canCreate && (
              <button
                onClick={() => void navigate('/apparatus/new')}
                className="btn-primary flex items-center space-x-2"
              >
                <Plus className="h-4 w-4" />
                <span>Add Apparatus</span>
              </button>
            )}
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
              {canManage && (
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
              )}

              {/* Clear Filters */}
              <div className="flex items-end">
                <button
                  onClick={() => {
                    setFilterType('');
                    setFilterStatus('');
                    setShowArchived(false);
                    setSearchQuery('');
                    clearDashboardFilters(DASHBOARD_FILTERS.map((f) => f.param));
                  }}
                  className="text-theme-text-muted hover:text-theme-text-primary px-4 py-2 transition-colors"
                >
                  Clear Filters
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Readiness filters, arrived at from the dashboard tiles */}
        {activeDashboardFilters.map((filter) => (
          <div
            key={filter.param}
            className="alert-warning mb-4 flex flex-wrap items-center justify-between gap-2 text-sm"
            role="status"
          >
            <span>{filter.label}</span>
            <button
              type="button"
              onClick={() => clearDashboardFilters([filter.param])}
              aria-label={`Clear filter: ${filter.name}`}
              className="touch-target-phone font-medium underline"
            >
              Clear filter
            </button>
          </div>
        ))}

        {/* Apparatus Table */}
        {isLoading ? (
          <div className="card p-12 text-center" role="status" aria-live="polite">
            <div className="border-theme-text-primary mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2"></div>
            <p className="text-theme-text-secondary">Loading apparatus...</p>
          </div>
        ) : apparatusList.length === 0 ? (
          <div className="card p-12 text-center">
            <Truck className="text-theme-text-muted mx-auto mb-4 h-16 w-16" />
            <h3 className="text-theme-text-primary mb-2 text-xl font-bold">
              {isNarrowed ? 'No Apparatus Found' : 'No apparatus yet'}
            </h3>
            <p className="text-theme-text-secondary mb-6">
              {isNarrowed
                ? 'No apparatus match your search or filters. Change or clear them to see more.'
                : canCreate
                  ? 'Add each vehicle your department runs, such as an engine, ladder or ambulance. Its record keeps its status, maintenance, fuel, drivers and expiration dates in one place, and its crew seats fill in on new shifts.'
                  : 'No apparatus have been added yet.'}
            </p>
            {canCreate && !isNarrowed && (
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
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-800 font-bold text-white">
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
                                  className="inline-flex items-center gap-1 rounded border border-red-500/20 bg-red-500/10 px-1.5 py-0.5 text-xs font-medium text-red-900 dark:text-red-300"
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
                                aria-label={`Print label for ${apparatus.unitNumber}`}
                              >
                                <Printer className="h-4 w-4" aria-hidden="true" />
                              </button>
                              <button
                                onClick={() => void navigate(`/apparatus/${apparatus.id}`)}
                                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-sm p-2 text-blue-700 transition-colors hover:bg-blue-500/10 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                                title="View Details"
                                aria-label={`View ${apparatus.unitNumber}`}
                              >
                                <Eye className="h-4 w-4" aria-hidden="true" />
                              </button>
                              {canEdit && (
                                <button
                                  onClick={() => void navigate(`/apparatus/${apparatus.id}/edit`)}
                                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-sm p-2 text-green-700 transition-colors hover:bg-green-500/10 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
                                  title="Edit"
                                  aria-label={`Edit ${apparatus.unitNumber}`}
                                >
                                  <Edit className="h-4 w-4" aria-hidden="true" />
                                </button>
                              )}
                              {/* Archiving asks for a disposal method, so it lives in
                                  the form on the apparatus page, not on this row. */}
                              {canManage && (
                                <button
                                  onClick={() => void navigate(`/apparatus/${apparatus.id}?tab=maintenance`)}
                                  className="hidden min-h-[44px] min-w-[44px] items-center justify-center rounded-sm p-2 text-yellow-700 transition-colors hover:bg-yellow-500/10 hover:text-yellow-700 sm:inline-flex dark:text-yellow-400 dark:hover:text-yellow-300"
                                  title="Maintenance"
                                  aria-label={`Maintenance for ${apparatus.unitNumber}`}
                                >
                                  <Wrench className="h-4 w-4" aria-hidden="true" />
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
                  Page {currentPage} of {totalPages} · {totalApparatus} apparatus
                </p>
                <div className="flex items-center space-x-1 sm:space-x-2">
                  <button
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                    aria-label="Previous page"
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
                            ? 'bg-red-800 text-white'
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
                    aria-label="Next page"
                    className="bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ApparatusListPage;
