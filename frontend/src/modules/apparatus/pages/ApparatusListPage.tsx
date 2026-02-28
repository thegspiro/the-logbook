/**
 * Apparatus List Page
 *
 * Main page for viewing all apparatus in the fleet.
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Truck,
  Plus,
  Search,
  Filter,
  Eye,
  Edit,
  Archive,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Wrench,
  Gauge,
  Clock,
} from 'lucide-react';
import { useApparatusStore } from '../store/apparatusStore';
import { StatusBadge } from '../components/StatusBadge';
import { ApparatusTypeBadge } from '../components/ApparatusTypeBadge';

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
      navigate('/login');
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
    <div className="min-h-screen bg-gradient-to-br from-theme-bg via-red-900 to-theme-bg">
      {/* Header */}
      <header className="bg-theme-input-bg backdrop-blur-sm border-b border-theme-surface-border px-6 py-4">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="bg-red-600 rounded-lg p-2">
                <Truck className="w-6 h-6 text-theme-text-primary" />
              </div>
              <div>
                <h1 className="text-theme-text-primary text-xl font-bold">Apparatus Management</h1>
                <p className="text-theme-text-muted text-sm">Manage your fleet vehicles and equipment</p>
              </div>
            </div>
            <button
              onClick={() => navigate('/dashboard')}
              className="text-theme-text-secondary hover:text-theme-text-primary transition-colors text-sm"
            >
              ← Back to Dashboard
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Error Display */}
        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-red-700 dark:text-red-400" />
              <span className="text-red-700 dark:text-red-300">{error}</span>
            </div>
            <button onClick={clearError} className="text-red-700 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300">
              Dismiss
            </button>
          </div>
        )}

        {/* Fleet Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 mb-8">
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border">
            <p className="text-theme-text-muted text-xs font-medium uppercase">Total Fleet</p>
            <p className="text-theme-text-primary text-2xl font-bold mt-1">
              {isLoadingSummary ? '...' : fleetSummary?.totalApparatus ?? 0}
            </p>
          </div>
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border">
            <p className="text-theme-text-muted text-xs font-medium uppercase">In Service</p>
            <p className="text-green-700 dark:text-green-400 text-2xl font-bold mt-1">
              {isLoadingSummary ? '...' : fleetSummary?.inServiceCount ?? 0}
            </p>
          </div>
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border">
            <p className="text-theme-text-muted text-xs font-medium uppercase">Out of Service</p>
            <p className="text-red-700 dark:text-red-400 text-2xl font-bold mt-1">
              {isLoadingSummary ? '...' : fleetSummary?.outOfServiceCount ?? 0}
            </p>
          </div>
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border">
            <p className="text-theme-text-muted text-xs font-medium uppercase">In Maintenance</p>
            <p className="text-yellow-700 dark:text-yellow-400 text-2xl font-bold mt-1">
              {isLoadingSummary ? '...' : fleetSummary?.inMaintenanceCount ?? 0}
            </p>
          </div>
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border">
            <p className="text-theme-text-muted text-xs font-medium uppercase">Reserve</p>
            <p className="text-blue-700 dark:text-blue-400 text-2xl font-bold mt-1">
              {isLoadingSummary ? '...' : fleetSummary?.reserveCount ?? 0}
            </p>
          </div>
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border">
            <p className="text-theme-text-muted text-xs font-medium uppercase">Maint. Due</p>
            <p className="text-orange-700 dark:text-orange-400 text-2xl font-bold mt-1">
              {isLoadingSummary ? '...' : (fleetSummary?.maintenanceDueSoon ?? 0) + (fleetSummary?.maintenanceOverdue ?? 0)}
            </p>
          </div>
        </div>

        {/* Actions Bar */}
        <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border mb-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            {/* Search */}
            <div className="relative flex-1 w-full md:max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-theme-text-muted" />
              <input
                type="text"
                placeholder="Search by unit number, name, or VIN..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>

            {/* Filter Toggle */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors ${
                showFilters
                  ? 'bg-red-600 text-white'
                  : 'bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover'
              }`}
            >
              <Filter className="w-4 h-4" />
              <span>Filters</span>
            </button>

            {/* Add Button */}
            <button
              onClick={() => navigate('/apparatus/new')}
              className="flex items-center space-x-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Add Apparatus</span>
            </button>
          </div>

          {/* Expanded Filters */}
          {showFilters && (
            <div className="mt-4 pt-4 border-t border-theme-surface-border grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              {/* Type Filter */}
              <div>
                <label className="block text-sm text-theme-text-muted mb-1">Type</label>
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  disabled={isLoadingTypes}
                  className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
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
                <label className="block text-sm text-theme-text-muted mb-1">Status</label>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  disabled={isLoadingStatuses}
                  className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
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
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showArchived}
                    onChange={(e) => setShowArchived(e.target.checked)}
                    className="w-4 h-4 rounded border-theme-input-border bg-theme-input-bg text-red-600 focus:ring-red-500"
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
                  className="px-4 py-2 text-theme-text-muted hover:text-theme-text-primary transition-colors"
                >
                  Clear Filters
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Apparatus Table */}
        {isLoading ? (
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-12 border border-theme-surface-border text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
            <p className="text-theme-text-secondary">Loading apparatus...</p>
          </div>
        ) : apparatusList.length === 0 ? (
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-12 border border-theme-surface-border text-center">
            <Truck className="w-16 h-16 text-theme-text-muted mx-auto mb-4" />
            <h3 className="text-theme-text-primary text-xl font-bold mb-2">No Apparatus Found</h3>
            <p className="text-theme-text-secondary mb-6">
              {searchQuery || filterType || filterStatus
                ? 'Try adjusting your search or filters'
                : 'Get started by adding your first piece of apparatus'}
            </p>
            {!searchQuery && !filterType && !filterStatus && (
              <button
                onClick={() => navigate('/apparatus/new')}
                className="flex items-center space-x-2 px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors mx-auto"
              >
                <Plus className="w-5 h-5" />
                <span>Add Apparatus</span>
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="bg-theme-surface backdrop-blur-sm rounded-lg border border-theme-surface-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-theme-input-bg border-b border-theme-surface-border">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-theme-text-secondary uppercase tracking-wider">
                        Unit
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-theme-text-secondary uppercase tracking-wider">
                        Type
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-theme-text-secondary uppercase tracking-wider">
                        Vehicle
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-theme-text-secondary uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-theme-text-secondary uppercase tracking-wider">
                        <Gauge className="w-4 h-4 inline mr-1" />
                        Mileage
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-theme-text-secondary uppercase tracking-wider">
                        <Clock className="w-4 h-4 inline mr-1" />
                        Hours
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-theme-text-secondary uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
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
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <div className="w-10 h-10 bg-red-600 rounded-lg flex items-center justify-center text-white font-bold">
                                {apparatus.unitNumber.substring(0, 2)}
                              </div>
                              <div className="ml-3">
                                <div className="text-theme-text-primary font-medium">
                                  {apparatus.unitNumber}
                                </div>
                                {apparatus.name && (
                                  <div className="text-theme-text-muted text-sm">{apparatus.name}</div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {apparatusType && <ApparatusTypeBadge type={apparatusType} />}
                          </td>
                          <td className="px-6 py-4">
                            <div className="text-theme-text-primary text-sm">
                              {apparatus.year && apparatus.make && apparatus.model
                                ? `${apparatus.year} ${apparatus.make} ${apparatus.model}`
                                : apparatus.make && apparatus.model
                                ? `${apparatus.make} ${apparatus.model}`
                                : '-'}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {status && <StatusBadge status={status} />}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-theme-text-secondary text-sm">
                              {apparatus.currentMileage
                                ? apparatus.currentMileage.toLocaleString()
                                : '-'}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-theme-text-secondary text-sm">
                              {apparatus.currentHours
                                ? apparatus.currentHours.toLocaleString()
                                : '-'}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right">
                            <div className="flex items-center justify-end space-x-2">
                              <button
                                onClick={() => navigate(`/apparatus/${apparatus.id}`)}
                                className="p-2 text-blue-700 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-500/10 rounded transition-colors"
                                title="View Details"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => navigate(`/apparatus/${apparatus.id}/edit`)}
                                className="p-2 text-green-700 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:bg-green-500/10 rounded transition-colors"
                                title="Edit"
                              >
                                <Edit className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => navigate(`/apparatus/${apparatus.id}`)}
                                className="p-2 text-yellow-700 dark:text-yellow-400 hover:text-yellow-700 dark:hover:text-yellow-300 hover:bg-yellow-500/10 rounded transition-colors"
                                title="View Details"
                              >
                                <Wrench className="w-4 h-4" />
                              </button>
                              {!apparatus.isArchived && (
                                <button
                                  onClick={() => navigate(`/apparatus/${apparatus.id}`)}
                                  className="p-2 text-theme-text-muted hover:text-theme-text-secondary hover:bg-theme-surface-secondary rounded transition-colors"
                                  title="Archive"
                                >
                                  <Archive className="w-4 h-4" />
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
              <div className="mt-6 flex items-center justify-between">
                <p className="text-theme-text-muted text-sm">
                  Showing page {currentPage} of {totalPages} ({totalApparatus} total)
                </p>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="p-2 rounded-lg bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="w-5 h-5" />
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
                        className={`w-10 h-10 rounded-lg transition-colors ${
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
                    className="p-2 rounded-lg bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronRight className="w-5 h-5" />
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
