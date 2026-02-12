/**
 * Prospective Members Page
 *
 * Main dashboard for managing the prospective member pipeline.
 * Supports kanban and table views with stats, search, and filtering.
 */

import React, { useEffect, useState, useMemo } from 'react';
import {
  Users,
  UserPlus,
  Search,
  LayoutGrid,
  List,
  Filter,
  X,
  TrendingUp,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Settings,
  RefreshCw,
  AlertTriangle,
  Trash2,
  RotateCcw,
  Info,
  Archive,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useProspectiveMembersStore } from '../store/prospectiveMembersStore';
import type { PipelineTab } from '../store/prospectiveMembersStore';
import { PipelineKanban } from '../components/PipelineKanban';
import { PipelineTable } from '../components/PipelineTable';
import { ApplicantDetailDrawer } from '../components/ApplicantDetailDrawer';
import { ConversionModal } from '../components/ConversionModal';
import { applicantService } from '../services/api';
import type { ApplicantListItem, Applicant, ApplicantStatus } from '../types';
import { isValidEmail, getInitials } from '../types';

export const ProspectiveMembersPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    pipelines,
    currentPipeline,
    pipelineStats,
    applicants,
    currentApplicant,
    totalApplicants,
    currentPage,
    totalPages,
    filters,
    viewMode,
    activeTab,
    detailDrawerOpen,
    inactiveApplicants,
    inactiveTotalApplicants,
    inactiveCurrentPage,
    inactiveTotalPages,
    withdrawnApplicants,
    withdrawnTotalApplicants,
    withdrawnCurrentPage,
    withdrawnTotalPages,
    isLoading,
    isLoadingPipelines,
    isLoadingPipeline,
    isLoadingStats,
    isLoadingInactive,
    isLoadingWithdrawn,
    isReactivating,
    isPurging,
    error,
    fetchPipelines,
    fetchPipeline,
    fetchPipelineStats,
    fetchApplicants,
    fetchApplicant,
    fetchInactiveApplicants,
    fetchWithdrawnApplicants,
    reactivateApplicant,
    purgeInactiveApplicants,
    setFilters,
    clearFilters,
    setViewMode,
    setActiveTab,
    setDetailDrawerOpen,
  } = useProspectiveMembersStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState<ApplicantStatus | ''>('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [conversionApplicant, setConversionApplicant] = useState<Applicant | null>(null);
  const [selectedInactive, setSelectedInactive] = useState<Set<string>>(new Set());
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false);

  // New applicant form state
  const [newApplicant, setNewApplicant] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    target_membership_type: 'probationary' as const,
  });
  const [isCreating, setIsCreating] = useState(false);

  // Load pipelines on mount
  useEffect(() => {
    fetchPipelines();
  }, [fetchPipelines]);

  // Select first active pipeline by default
  useEffect(() => {
    if (pipelines.length > 0 && !currentPipeline) {
      const activePipeline = pipelines.find((p) => p.is_active) ?? pipelines[0];
      fetchPipeline(activePipeline.id);
    }
  }, [pipelines, currentPipeline, fetchPipeline]);

  // Load applicants when pipeline is selected
  useEffect(() => {
    if (currentPipeline) {
      setFilters({ pipeline_id: currentPipeline.id });
      fetchPipelineStats(currentPipeline.id);
    }
  }, [currentPipeline?.id]);

  // Handle search debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery !== (filters.search ?? '')) {
        setFilters({ search: searchQuery || undefined });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Handle status filter
  useEffect(() => {
    setFilters({ status: statusFilter || undefined });
  }, [statusFilter]);

  const handleApplicantClick = (applicantItem: ApplicantListItem) => {
    fetchApplicant(applicantItem.id);
  };

  const handleConvert = (applicant: Applicant) => {
    setConversionApplicant(applicant);
    setDetailDrawerOpen(false);
  };

  const isLastStage = useMemo(() => {
    if (!currentPipeline || !currentApplicant) return false;
    const sortedStages = [...currentPipeline.stages].sort(
      (a, b) => a.sort_order - b.sort_order
    );
    const lastStage = sortedStages[sortedStages.length - 1];
    return lastStage?.id === currentApplicant.current_stage_id;
  }, [currentPipeline, currentApplicant]);

  const handleCreateApplicant = async () => {
    if (!currentPipeline) return;
    if (!newApplicant.first_name.trim() || !newApplicant.last_name.trim() || !newApplicant.email.trim()) {
      toast.error('First name, last name, and email are required');
      return;
    }
    if (!isValidEmail(newApplicant.email.trim())) {
      toast.error('Please enter a valid email address');
      return;
    }
    setIsCreating(true);
    try {
      await applicantService.createApplicant({
        pipeline_id: currentPipeline.id,
        ...newApplicant,
      });
      toast.success('Applicant added to pipeline');
      setShowAddModal(false);
      setNewApplicant({
        first_name: '',
        last_name: '',
        email: '',
        phone: '',
        target_membership_type: 'probationary',
      });
      fetchApplicants();
      fetchPipelineStats(currentPipeline.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create applicant';
      toast.error(msg);
    } finally {
      setIsCreating(false);
    }
  };

  const sortedStages = useMemo(
    () =>
      currentPipeline
        ? [...currentPipeline.stages].sort((a, b) => a.sort_order - b.sort_order)
        : [],
    [currentPipeline]
  );

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Users className="w-7 h-7 text-red-500" />
            Prospective Members
          </h1>
          <p className="text-slate-400 mt-1">
            Manage your organization's applicant pipeline
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/prospective-members/settings')}
            className="flex items-center gap-2 px-4 py-2 text-sm text-slate-300 border border-white/10 rounded-lg hover:bg-white/5 transition-colors"
          >
            <Settings className="w-4 h-4" />
            Pipeline Settings
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            Add Applicant
          </button>
        </div>
      </div>

      {/* Stats Bar */}
      {pipelineStats && !isLoadingStats && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-2">
            <div className="bg-slate-800/50 border border-white/10 rounded-lg p-4">
              <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                <Users className="w-3.5 h-3.5" />
                Total Active
              </div>
              <p className="text-2xl font-bold text-white">
                {pipelineStats.active_applicants}
              </p>
            </div>
            <div className="bg-slate-800/50 border border-white/10 rounded-lg p-4">
              <div className="flex items-center gap-2 text-blue-400 text-xs mb-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Converted
              </div>
              <p className="text-2xl font-bold text-white">
                {pipelineStats.converted_count}
              </p>
            </div>
            <div className="bg-slate-800/50 border border-white/10 rounded-lg p-4">
              <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                <Clock className="w-3.5 h-3.5" />
                Avg. Days to Convert
              </div>
              <p className="text-2xl font-bold text-white">
                {pipelineStats.avg_days_to_convert > 0
                  ? pipelineStats.avg_days_to_convert
                  : '—'}
              </p>
            </div>
            <div className="bg-slate-800/50 border border-white/10 rounded-lg p-4">
              <div className="flex items-center gap-2 text-amber-400 text-xs mb-1">
                <TrendingUp className="w-3.5 h-3.5" />
                Conversion Rate
              </div>
              <p className="text-2xl font-bold text-white">
                {pipelineStats.conversion_rate > 0
                  ? `${pipelineStats.conversion_rate.toFixed(1)}%`
                  : '—'}
              </p>
            </div>
            {(pipelineStats.warning_count > 0) && (
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-4">
                <div className="flex items-center gap-2 text-amber-400 text-xs mb-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Approaching Timeout
                </div>
                <p className="text-2xl font-bold text-amber-300">
                  {pipelineStats.warning_count}
                </p>
              </div>
            )}
            {(pipelineStats.inactive_count > 0) && (
              <div className="bg-slate-800/50 border border-white/10 rounded-lg p-4">
                <div className="flex items-center gap-2 text-slate-500 text-xs mb-1">
                  <XCircle className="w-3.5 h-3.5" />
                  Inactive
                </div>
                <p className="text-2xl font-bold text-slate-400">
                  {pipelineStats.inactive_count}
                </p>
              </div>
            )}
            {(pipelineStats.withdrawn_count > 0) && (
              <div className="bg-slate-800/50 border border-white/10 rounded-lg p-4">
                <div className="flex items-center gap-2 text-slate-500 text-xs mb-1">
                  <Archive className="w-3.5 h-3.5" />
                  Withdrawn
                </div>
                <p className="text-2xl font-bold text-slate-400">
                  {pipelineStats.withdrawn_count}
                </p>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 mb-6 px-1">
            <Info className="w-3 h-3 text-slate-600 flex-shrink-0" />
            <p className="text-xs text-slate-600">
              Statistics include active applicants only. Inactive, rejected, and withdrawn (archived) applicants are excluded from conversion rate and averages.
            </p>
          </div>
        </>
      )}

      {/* Active / Inactive Tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-white/10">
        <button
          onClick={() => setActiveTab('active')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'active'
              ? 'border-red-500 text-white'
              : 'border-transparent text-slate-400 hover:text-slate-300'
          }`}
        >
          Active Pipeline
        </button>
        <button
          onClick={() => setActiveTab('inactive')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'inactive'
              ? 'border-red-500 text-white'
              : 'border-transparent text-slate-400 hover:text-slate-300'
          }`}
        >
          Inactive Applications
          {pipelineStats && pipelineStats.inactive_count > 0 && (
            <span className="px-1.5 py-0.5 text-xs rounded-full bg-slate-700 text-slate-300">
              {pipelineStats.inactive_count}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('withdrawn')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'withdrawn'
              ? 'border-red-500 text-white'
              : 'border-transparent text-slate-400 hover:text-slate-300'
          }`}
        >
          Withdrawn
          {pipelineStats && pipelineStats.withdrawn_count > 0 && (
            <span className="px-1.5 py-0.5 text-xs rounded-full bg-slate-700 text-slate-300">
              {pipelineStats.withdrawn_count}
            </span>
          )}
        </button>
      </div>

      {/* Controls Bar (Active tab) */}
      {activeTab === 'active' && (
      <div className="flex items-center gap-3 mb-4">
        {/* Pipeline Selector */}
        {pipelines.length > 1 && (
          <select
            value={currentPipeline?.id ?? ''}
            onChange={(e) => {
              const pipeline = pipelines.find((p) => p.id === e.target.value);
              if (pipeline) fetchPipeline(pipeline.id);
            }}
            className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            {pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}

        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search applicants..."
            className="w-full bg-slate-800 border border-white/10 rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500"
          />
        </div>

        {/* Status Filter */}
        <div className="relative">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-3 py-2 text-sm border rounded-lg transition-colors ${
              statusFilter
                ? 'border-red-500 text-red-400 bg-red-500/10'
                : 'border-white/10 text-slate-300 hover:bg-white/5'
            }`}
          >
            <Filter className="w-4 h-4" />
            Filter
            {statusFilter && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setStatusFilter('');
                }}
                className="ml-1"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </button>
          {showFilters && (
            <div className="absolute top-full mt-2 left-0 w-48 bg-slate-700 border border-white/10 rounded-lg shadow-xl z-10 py-1">
              {(['active', 'on_hold', 'withdrawn', 'converted', 'rejected'] as ApplicantStatus[]).map(
                (status) => (
                  <button
                    key={status}
                    onClick={() => {
                      setStatusFilter(status);
                      setShowFilters(false);
                    }}
                    className={`w-full text-left px-4 py-2 text-sm capitalize hover:bg-white/5 ${
                      statusFilter === status
                        ? 'text-red-400'
                        : 'text-slate-300'
                    }`}
                  >
                    {status.replace('_', ' ')}
                  </button>
                )
              )}
              {statusFilter && (
                <button
                  onClick={() => {
                    setStatusFilter('');
                    setShowFilters(false);
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-slate-400 hover:bg-white/5 border-t border-white/10"
                >
                  Clear filter
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex-1" />

        {/* Refresh */}
        <button
          onClick={() => fetchApplicants()}
          disabled={isLoading}
          className="p-2 text-slate-400 hover:text-white transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>

        {/* View Toggle */}
        <div className="flex items-center bg-slate-800 border border-white/10 rounded-lg">
          <button
            onClick={() => setViewMode('kanban')}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-l-lg transition-colors ${
              viewMode === 'kanban'
                ? 'bg-red-600 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <LayoutGrid className="w-4 h-4" />
            Kanban
          </button>
          <button
            onClick={() => setViewMode('table')}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-r-lg transition-colors ${
              viewMode === 'table'
                ? 'bg-red-600 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <List className="w-4 h-4" />
            Table
          </button>
        </div>
      </div>

      {/* Close active tab controls wrapper */}
      )}

      {/* Error State */}
      {error && (
        <div className="mb-4 bg-red-500/10 border border-red-500/20 rounded-lg p-4 flex items-center gap-2">
          <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Active Tab Content */}
      {activeTab === 'active' && (
        <>
          {(isLoading || isLoadingPipeline || isLoadingPipelines) && !applicants.length ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-red-500" />
            </div>
          ) : !currentPipeline ? (
            <div className="text-center py-20">
              <Users className="w-12 h-12 text-slate-600 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-white mb-2">
                No pipeline configured
              </h3>
              <p className="text-slate-400 mb-4">
                Create a pipeline to start managing prospective members.
              </p>
              <button
                onClick={() => navigate('/prospective-members/settings')}
                className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
              >
                Configure Pipeline
              </button>
            </div>
          ) : (
            <>
              {viewMode === 'kanban' && (
                <PipelineKanban
                  stages={sortedStages}
                  applicants={applicants}
                  onApplicantClick={handleApplicantClick}
                />
              )}
              {viewMode === 'table' && (
                <PipelineTable
                  applicants={applicants}
                  totalApplicants={totalApplicants}
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={(page) => fetchApplicants(page)}
                  onApplicantClick={handleApplicantClick}
                />
              )}
            </>
          )}
        </>
      )}

      {/* Inactive Tab Content */}
      {activeTab === 'inactive' && (
        <div>
          {/* Inactive Bulk Actions */}
          {selectedInactive.size > 0 && (
            <div className="mb-3 flex items-center gap-3 p-3 bg-slate-800 border border-white/10 rounded-lg">
              <span className="text-sm text-slate-300">
                {selectedInactive.size} selected
              </span>
              <div className="flex items-center gap-2 ml-auto">
                <button
                  onClick={async () => {
                    const ids = Array.from(selectedInactive);
                    let successCount = 0;
                    for (const id of ids) {
                      try {
                        await reactivateApplicant(id);
                        successCount++;
                      } catch {
                        // continue
                      }
                    }
                    if (successCount === ids.length) {
                      toast.success(`Reactivated ${successCount} application(s)`);
                    } else {
                      toast.success(`Reactivated ${successCount} of ${ids.length} application(s)`);
                    }
                    setSelectedInactive(new Set());
                  }}
                  disabled={isReactivating}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reactivate
                </button>
                <button
                  onClick={() => setShowPurgeConfirm(true)}
                  disabled={isPurging}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Purge Selected
                </button>
              </div>
            </div>
          )}

          {isLoadingInactive ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-red-500" />
            </div>
          ) : inactiveApplicants.length === 0 ? (
            <div className="text-center py-20 bg-slate-800/30 rounded-lg border border-dashed border-white/10">
              <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-white mb-2">
                No inactive applications
              </h3>
              <p className="text-sm text-slate-400">
                All applications are currently active or have been resolved.
              </p>
            </div>
          ) : (
            <div className="bg-slate-800/50 border border-white/10 rounded-lg overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="w-10 p-3">
                      <input
                        type="checkbox"
                        checked={selectedInactive.size === inactiveApplicants.length && inactiveApplicants.length > 0}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedInactive(new Set(inactiveApplicants.map((a) => a.id)));
                          } else {
                            setSelectedInactive(new Set());
                          }
                        }}
                        className="rounded border-white/20 bg-slate-700 text-red-500 focus:ring-red-500"
                      />
                    </th>
                    <th className="text-left p-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Name</th>
                    <th className="text-left p-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Email</th>
                    <th className="text-left p-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Last Stage</th>
                    <th className="text-left p-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Inactive Since</th>
                    <th className="text-left p-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Days Idle</th>
                    <th className="w-28 p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {inactiveApplicants.map((applicant) => (
                    <tr
                      key={applicant.id}
                      className="border-b border-white/5 hover:bg-white/5 transition-colors"
                    >
                      <td className="p-3">
                        <input
                          type="checkbox"
                          checked={selectedInactive.has(applicant.id)}
                          onChange={(e) => {
                            const next = new Set(selectedInactive);
                            if (e.target.checked) {
                              next.add(applicant.id);
                            } else {
                              next.delete(applicant.id);
                            }
                            setSelectedInactive(next);
                          }}
                          className="rounded border-white/20 bg-slate-700 text-red-500 focus:ring-red-500"
                        />
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-slate-600 flex items-center justify-center text-xs font-bold text-slate-300 flex-shrink-0">
                            {getInitials(applicant.first_name, applicant.last_name)}
                          </div>
                          <span className="text-sm font-medium text-slate-300">
                            {applicant.first_name} {applicant.last_name}
                          </span>
                        </div>
                      </td>
                      <td className="p-3 text-sm text-slate-400">{applicant.email}</td>
                      <td className="p-3 text-sm text-slate-400">{applicant.current_stage_name ?? '—'}</td>
                      <td className="p-3 text-sm text-slate-400">
                        {applicant.deactivated_at
                          ? new Date(applicant.deactivated_at).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })
                          : '—'}
                      </td>
                      <td className="p-3 text-sm text-slate-500">
                        {applicant.days_since_activity}d
                      </td>
                      <td className="p-3">
                        <button
                          onClick={async () => {
                            try {
                              await reactivateApplicant(applicant.id);
                              toast.success(`${applicant.first_name} reactivated`);
                            } catch {
                              toast.error('Failed to reactivate');
                            }
                          }}
                          disabled={isReactivating}
                          className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-emerald-400 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/10 transition-colors disabled:opacity-50"
                        >
                          <RotateCcw className="w-3 h-3" />
                          Reactivate
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {inactiveTotalPages > 1 && (
                <div className="flex items-center justify-between p-3 border-t border-white/10">
                  <p className="text-sm text-slate-400">
                    Page {inactiveCurrentPage} of {inactiveTotalPages} ({inactiveTotalApplicants} total)
                  </p>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => fetchInactiveApplicants(inactiveCurrentPage - 1)}
                      disabled={inactiveCurrentPage <= 1}
                      className="px-3 py-1 text-sm text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
                    >
                      Previous
                    </button>
                    <button
                      onClick={() => fetchInactiveApplicants(inactiveCurrentPage + 1)}
                      disabled={inactiveCurrentPage >= inactiveTotalPages}
                      className="px-3 py-1 text-sm text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Purge Note */}
          {inactiveApplicants.length > 0 && (
            <div className="flex items-start gap-2 mt-4 p-3 bg-slate-800/30 border border-white/5 rounded-lg">
              <Info className="w-3.5 h-3.5 text-slate-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-slate-500">
                Inactive applications are excluded from pipeline statistics.
                Purging permanently deletes applicant data and cannot be undone.
                Consider reactivating applications before purging if you are unsure.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Withdrawn Tab Content */}
      {activeTab === 'withdrawn' && (
        <div>
          {isLoadingWithdrawn ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-red-500" />
            </div>
          ) : withdrawnApplicants.length === 0 ? (
            <div className="text-center py-20 bg-slate-800/30 rounded-lg border border-dashed border-white/10">
              <Archive className="w-12 h-12 text-slate-600 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-white mb-2">
                No withdrawn applications
              </h3>
              <p className="text-sm text-slate-400">
                Applicants who voluntarily withdraw from the pipeline will appear here.
              </p>
            </div>
          ) : (
            <div className="bg-slate-800/50 border border-white/10 rounded-lg overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left p-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Name</th>
                    <th className="text-left p-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Email</th>
                    <th className="text-left p-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Last Stage</th>
                    <th className="text-left p-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Withdrawn Date</th>
                    <th className="text-left p-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Reason</th>
                    <th className="w-32 p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {withdrawnApplicants.map((applicant) => (
                    <tr
                      key={applicant.id}
                      className="border-b border-white/5 hover:bg-white/5 transition-colors"
                    >
                      <td className="p-3">
                        <div
                          className="flex items-center gap-2.5 cursor-pointer"
                          onClick={() => fetchApplicant(applicant.id)}
                        >
                          <div className="w-8 h-8 rounded-full bg-slate-600 flex items-center justify-center text-xs font-bold text-slate-300 flex-shrink-0">
                            {getInitials(applicant.first_name, applicant.last_name)}
                          </div>
                          <span className="text-sm font-medium text-slate-300">
                            {applicant.first_name} {applicant.last_name}
                          </span>
                        </div>
                      </td>
                      <td className="p-3 text-sm text-slate-400">{applicant.email}</td>
                      <td className="p-3 text-sm text-slate-400">{applicant.current_stage_name ?? '—'}</td>
                      <td className="p-3 text-sm text-slate-400">
                        {applicant.withdrawn_at
                          ? new Date(applicant.withdrawn_at).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })
                          : '—'}
                      </td>
                      <td className="p-3 text-sm text-slate-500 max-w-[200px] truncate">
                        {applicant.withdrawal_reason ?? '—'}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => fetchApplicant(applicant.id)}
                            className="text-xs text-slate-400 hover:text-white transition-colors"
                          >
                            View
                          </button>
                          <button
                            onClick={async () => {
                              try {
                                await reactivateApplicant(applicant.id);
                                toast.success(`${applicant.first_name} reactivated`);
                              } catch {
                                toast.error('Failed to reactivate');
                              }
                            }}
                            disabled={isReactivating}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-emerald-400 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/10 transition-colors disabled:opacity-50"
                          >
                            <RotateCcw className="w-3 h-3" />
                            Reactivate
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {withdrawnTotalPages > 1 && (
                <div className="flex items-center justify-between p-3 border-t border-white/10">
                  <p className="text-sm text-slate-400">
                    Page {withdrawnCurrentPage} of {withdrawnTotalPages} ({withdrawnTotalApplicants} total)
                  </p>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => fetchWithdrawnApplicants(withdrawnCurrentPage - 1)}
                      disabled={withdrawnCurrentPage <= 1}
                      className="px-3 py-1 text-sm text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
                    >
                      Previous
                    </button>
                    <button
                      onClick={() => fetchWithdrawnApplicants(withdrawnCurrentPage + 1)}
                      disabled={withdrawnCurrentPage >= withdrawnTotalPages}
                      className="px-3 py-1 text-sm text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Info Note */}
          {withdrawnApplicants.length > 0 && (
            <div className="flex items-start gap-2 mt-4 p-3 bg-slate-800/30 border border-white/5 rounded-lg">
              <Info className="w-3.5 h-3.5 text-slate-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-slate-500">
                Withdrawn applications are from prospective members who voluntarily left the pipeline process.
                You can reactivate them to place them back into the active pipeline at their previous stage.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Purge Confirmation Modal */}
      {showPurgeConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-white/10 rounded-xl max-w-md w-full">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-red-400" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">Confirm Purge</h2>
                  <p className="text-sm text-slate-400">This action cannot be undone</p>
                </div>
              </div>
              <p className="text-sm text-slate-300 mb-4">
                You are about to permanently delete <strong className="text-white">{selectedInactive.size}</strong> inactive
                application(s) and all associated personal data. This protects your organization from holding
                unnecessary private information.
              </p>
            </div>
            <div className="flex items-center justify-end gap-3 p-6 border-t border-white/10">
              <button
                onClick={() => setShowPurgeConfirm(false)}
                className="px-4 py-2 text-slate-300 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  try {
                    await purgeInactiveApplicants(Array.from(selectedInactive));
                    toast.success(`Purged ${selectedInactive.size} application(s)`);
                    setSelectedInactive(new Set());
                  } catch {
                    toast.error('Failed to purge applications');
                  }
                  setShowPurgeConfirm(false);
                }}
                disabled={isPurging}
                className="flex items-center gap-2 px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {isPurging && <Loader2 className="w-4 h-4 animate-spin" />}
                Permanently Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Drawer */}
      <ApplicantDetailDrawer
        applicant={currentApplicant}
        isOpen={detailDrawerOpen}
        onClose={() => setDetailDrawerOpen(false)}
        onConvert={handleConvert}
        isLastStage={isLastStage}
      />

      {/* Conversion Modal */}
      <ConversionModal
        isOpen={!!conversionApplicant}
        onClose={() => setConversionApplicant(null)}
        applicant={conversionApplicant}
      />

      {/* Add Applicant Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-white/10 rounded-xl max-w-md w-full">
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <h2 className="text-lg font-bold text-white">Add Applicant</h2>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">First Name *</label>
                  <input
                    type="text"
                    value={newApplicant.first_name}
                    onChange={(e) =>
                      setNewApplicant({ ...newApplicant, first_name: e.target.value })
                    }
                    className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Last Name *</label>
                  <input
                    type="text"
                    value={newApplicant.last_name}
                    onChange={(e) =>
                      setNewApplicant({ ...newApplicant, last_name: e.target.value })
                    }
                    className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Email *</label>
                <input
                  type="email"
                  value={newApplicant.email}
                  onChange={(e) =>
                    setNewApplicant({ ...newApplicant, email: e.target.value })
                  }
                  className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Phone</label>
                <input
                  type="tel"
                  value={newApplicant.phone}
                  onChange={(e) =>
                    setNewApplicant({ ...newApplicant, phone: e.target.value })
                  }
                  className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Membership Type</label>
                <select
                  value={newApplicant.target_membership_type}
                  onChange={(e) =>
                    setNewApplicant({
                      ...newApplicant,
                      target_membership_type: e.target.value as 'probationary' | 'administrative',
                    })
                  }
                  className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  <option value="probationary">Probationary</option>
                  <option value="administrative">Administrative</option>
                </select>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 p-6 border-t border-white/10">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-slate-300 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateApplicant}
                disabled={isCreating}
                className="flex items-center gap-2 px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {isCreating && <Loader2 className="w-4 h-4 animate-spin" />}
                Add to Pipeline
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProspectiveMembersPage;
