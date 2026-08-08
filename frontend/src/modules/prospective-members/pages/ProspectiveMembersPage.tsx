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
  Printer,
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
import { useNavigate } from 'react-router';
import toast from 'react-hot-toast';
import { useProspectiveMembersStore } from '../store/prospectiveMembersStore';
import { PipelineKanban } from '../components/PipelineKanban';
import { PipelineTable } from '../components/PipelineTable';
import { ApplicantDetailDrawer } from '../components/ApplicantDetailDrawer';
import { ConversionModal } from '../components/ConversionModal';
import { applicantService } from '../services/api';
import type { ApplicantListItem, Applicant, ApplicantStatus, BulkActionResult } from '../types';
import { isValidEmail, getInitials } from '../utils';
import { getErrorMessage } from '../../../utils/errorHandling';
import { formatDate } from '../../../utils/dateFormatting';
import { useTimezone } from '../../../hooks/useTimezone';

export const ProspectiveMembersPage: React.FC = () => {
  const navigate = useNavigate();
  const tz = useTimezone();
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
  const [selectedApplicants, setSelectedApplicants] = useState<Set<string>>(new Set());
  const [isBulkAdvancing, setIsBulkAdvancing] = useState(false);
  const [isBulkRejecting, setIsBulkRejecting] = useState(false);
  const [showBulkRejectConfirm, setShowBulkRejectConfirm] = useState(false);
  // A rejection reason belongs to the applicants it is written about. The old
  // path hardcoded the literal string "Bulk rejection" into every record.
  const [bulkRejectReason, setBulkRejectReason] = useState('');
  const [isBulkReactivating, setIsBulkReactivating] = useState(false);

  // New applicant form state
  const [newApplicant, setNewApplicant] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    target_membership_type: 'regular' as 'regular' | 'administrative',
  });
  const [isCreating, setIsCreating] = useState(false);

  // Load pipelines on mount
  useEffect(() => {
    void fetchPipelines();
  }, [fetchPipelines]);

  // Select first active pipeline by default
  useEffect(() => {
    if (pipelines.length > 0 && !currentPipeline) {
      const activePipeline = pipelines.find((p) => p.is_active) ?? pipelines[0];
      if (activePipeline) {
        void fetchPipeline(activePipeline.id);
      }
    }
  }, [pipelines, currentPipeline, fetchPipeline]);

  // Load applicants when pipeline is selected
  useEffect(() => {
    if (currentPipeline) {
      setFilters({ pipeline_id: currentPipeline.id });
      void fetchPipelineStats(currentPipeline.id);
    }
  }, [currentPipeline, fetchPipelineStats, setFilters]);

  // Handle search debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery !== (filters.search ?? '')) {
        setFilters({ search: searchQuery || undefined });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, filters.search, setFilters]);

  // Handle status filter
  useEffect(() => {
    setFilters(statusFilter ? { status: statusFilter } : { status: undefined });
  }, [statusFilter, setFilters]);

  const handleApplicantClick = (applicantItem: ApplicantListItem) => {
    void fetchApplicant(applicantItem.id);
  };

  const handleConvert = (applicant: Applicant) => {
    setConversionApplicant(applicant);
    setDetailDrawerOpen(false);
  };

  const toggleApplicantSelection = (id: string) => {
    setSelectedApplicants((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAllApplicants = () => {
    if (selectedApplicants.size === applicants.length) {
      setSelectedApplicants(new Set());
    } else {
      setSelectedApplicants(new Set(applicants.map((a) => a.id)));
    }
  };

  /**
   * Report a bulk outcome truthfully.
   *
   * The previous handlers counted only successes and announced failures as a
   * bare number ("Failed to advance 4 applicant(s)"), which gave the
   * coordinator no way to tell who was skipped or retry deliberately. The
   * backend itemizes, so name the first few and say why.
   */
  const reportBulkResult = (result: BulkActionResult, verb: string) => {
    const { succeeded_count: ok, failed_count: failed, results } = result;
    if (ok > 0) {
      toast.success(`${verb} ${ok} applicant${ok === 1 ? '' : 's'}`);
    }
    if (failed > 0) {
      const skipped = results.filter((r) => !r.succeeded);
      const named = skipped
        .slice(0, 3)
        .map((r) => `${r.name ?? 'Unknown'} (${r.error ?? 'failed'})`)
        .join('; ');
      const more = skipped.length > 3 ? ` and ${skipped.length - 3} more` : '';
      toast.error(`Skipped ${failed}: ${named}${more}`, { duration: 8000 });
    }
  };

  const handleBulkAdvance = async () => {
    if (!currentPipeline) return;
    const ids = Array.from(selectedApplicants);
    setIsBulkAdvancing(true);
    try {
      const result = await applicantService.bulkAdvance(ids);
      reportBulkResult(result, 'Advanced');
      if (result.succeeded_count > 0) {
        void fetchApplicants();
        if (currentPipeline) void fetchPipelineStats(currentPipeline.id);
      }
      setSelectedApplicants(new Set());
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to advance applicants'));
    } finally {
      setIsBulkAdvancing(false);
    }
  };

  const handleBulkReactivate = async () => {
    const ids = Array.from(selectedInactive);
    setIsBulkReactivating(true);
    try {
      const result = await applicantService.bulkSetStatus(ids, 'active');
      // Previously a partial failure was announced through toast.success, so
      // "Reactivated 3 of 10" arrived in green.
      reportBulkResult(result, 'Reactivated');
      if (result.succeeded_count > 0) {
        void fetchInactiveApplicants();
        void fetchApplicants();
      }
      setSelectedInactive(new Set());
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to reactivate applications'));
    } finally {
      setIsBulkReactivating(false);
    }
  };

  const handleBulkReject = async () => {
    const ids = Array.from(selectedApplicants);
    setIsBulkRejecting(true);
    try {
      const result = await applicantService.bulkSetStatus(ids, 'rejected', bulkRejectReason.trim() || undefined);
      reportBulkResult(result, 'Rejected');
      if (result.succeeded_count > 0) {
        void fetchApplicants();
        if (currentPipeline) void fetchPipelineStats(currentPipeline.id);
      }
      setSelectedApplicants(new Set());
      setShowBulkRejectConfirm(false);
      setBulkRejectReason('');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to reject applicants'));
    } finally {
      setIsBulkRejecting(false);
    }
  };

  const isLastStage = useMemo(() => {
    if (!currentPipeline || !currentApplicant) return false;
    const sortedStages = [...currentPipeline.stages].sort((a, b) => a.sort_order - b.sort_order);
    const lastStage = sortedStages[sortedStages.length - 1];
    return lastStage?.id === currentApplicant.current_stage_id;
  }, [currentPipeline, currentApplicant]);

  const isFirstStage = useMemo(() => {
    if (!currentPipeline || !currentApplicant) return true;
    const sortedStages = [...currentPipeline.stages].sort((a, b) => a.sort_order - b.sort_order);
    const firstStage = sortedStages[0];
    return firstStage?.id === currentApplicant.current_stage_id;
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
      // Check for duplicate/existing members before creating
      try {
        const check = await applicantService.checkExisting(
          newApplicant.email.trim(),
          newApplicant.first_name.trim(),
          newApplicant.last_name.trim()
        );
        if (check.has_matches) {
          const proceed = window.confirm(
            `This email or name matches ${check.match_count} existing member(s). Do you want to continue creating this applicant?`
          );
          if (!proceed) {
            setIsCreating(false);
            return;
          }
        }
      } catch {
        // If the check fails, continue with creation anyway
      }

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
        target_membership_type: 'regular',
      });
      void fetchApplicants();
      void fetchPipelineStats(currentPipeline.id);
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Failed to create applicant');
      toast.error(msg);
    } finally {
      setIsCreating(false);
    }
  };

  const sortedStages = useMemo(
    () => (currentPipeline ? [...currentPipeline.stages].sort((a, b) => a.sort_order - b.sort_order) : []),
    [currentPipeline]
  );

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-theme-text-primary flex items-center gap-3 text-xl font-bold sm:text-2xl">
            <Users className="h-6 w-6 text-red-700 sm:h-7 sm:w-7 dark:text-red-500" />
            Prospective Members
          </h1>
          <p className="text-theme-text-muted mt-1 text-sm">Manage your organization's applicant pipeline</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void navigate('/prospective-members/settings')}
            className="text-theme-text-secondary border-theme-surface-border hover:bg-theme-surface-secondary flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors sm:px-4"
          >
            <Settings className="h-4 w-4" />
            <span className="hidden sm:inline">Pipeline Settings</span>
            <span className="sm:hidden">Settings</span>
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="btn-primary flex items-center gap-2 px-3 text-sm sm:px-4"
          >
            <UserPlus className="h-4 w-4" />
            <span className="hidden sm:inline">Add Applicant</span>
            <span className="sm:hidden">Add</span>
          </button>
        </div>
      </div>

      {/* Stats Bar */}
      {pipelineStats && !isLoadingStats && (
        <>
          <div className="mb-2 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6">
            <div className="bg-theme-input-bg border-theme-surface-border rounded-lg border p-4">
              <div className="text-theme-text-muted mb-1 flex items-center gap-2 text-xs">
                <Users className="h-3.5 w-3.5" />
                Total Active
              </div>
              <p className="text-theme-text-primary text-2xl font-bold">{pipelineStats.active_applicants}</p>
            </div>
            <div className="bg-theme-input-bg border-theme-surface-border rounded-lg border p-4">
              <div className="mb-1 flex items-center gap-2 text-xs text-blue-700 dark:text-blue-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Converted
              </div>
              <p className="text-theme-text-primary text-2xl font-bold">{pipelineStats.converted_count}</p>
            </div>
            <div className="bg-theme-input-bg border-theme-surface-border rounded-lg border p-4">
              <div className="text-theme-text-muted mb-1 flex items-center gap-2 text-xs">
                <Clock className="h-3.5 w-3.5" />
                Avg. Days to Convert
              </div>
              <p className="text-theme-text-primary text-2xl font-bold">
                {pipelineStats.avg_days_to_convert > 0 ? pipelineStats.avg_days_to_convert : '—'}
              </p>
            </div>
            <div className="bg-theme-input-bg border-theme-surface-border rounded-lg border p-4">
              <div className="mb-1 flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
                <TrendingUp className="h-3.5 w-3.5" />
                Conversion Rate
              </div>
              <p className="text-theme-text-primary text-2xl font-bold">
                {pipelineStats.conversion_rate > 0 ? `${pipelineStats.conversion_rate.toFixed(1)}%` : '—'}
              </p>
            </div>
            {pipelineStats.warning_count > 0 && (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
                <div className="mb-1 flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Approaching Timeout
                </div>
                <p className="text-2xl font-bold text-amber-700 dark:text-amber-300">{pipelineStats.warning_count}</p>
              </div>
            )}
            {pipelineStats.inactive_count > 0 && (
              <div className="bg-theme-input-bg border-theme-surface-border rounded-lg border p-4">
                <div className="text-theme-text-muted mb-1 flex items-center gap-2 text-xs">
                  <XCircle className="h-3.5 w-3.5" />
                  Inactive
                </div>
                <p className="text-theme-text-muted text-2xl font-bold">{pipelineStats.inactive_count}</p>
              </div>
            )}
            {pipelineStats.withdrawn_count > 0 && (
              <div className="bg-theme-input-bg border-theme-surface-border rounded-lg border p-4">
                <div className="text-theme-text-muted mb-1 flex items-center gap-2 text-xs">
                  <Archive className="h-3.5 w-3.5" />
                  Withdrawn
                </div>
                <p className="text-theme-text-muted text-2xl font-bold">{pipelineStats.withdrawn_count}</p>
              </div>
            )}
          </div>
          <div className="mb-6 flex items-center gap-1.5 px-1">
            <Info className="text-theme-text-muted h-3 w-3 shrink-0" />
            <p className="text-theme-text-muted text-xs">
              Statistics include active applicants only. Inactive, rejected, and withdrawn (archived) applicants are
              excluded from conversion rate and averages.
            </p>
          </div>
        </>
      )}

      {/* Active / Inactive Tabs */}
      <div className="tab-scroll mb-4">
        <button
          onClick={() => setActiveTab('active')}
          className={`border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === 'active'
              ? 'text-theme-text-primary border-red-500'
              : 'text-theme-text-muted hover:text-theme-text-secondary border-transparent'
          }`}
        >
          Active Pipeline
        </button>
        <button
          onClick={() => setActiveTab('inactive')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === 'inactive'
              ? 'text-theme-text-primary border-red-500'
              : 'text-theme-text-muted hover:text-theme-text-secondary border-transparent'
          }`}
        >
          Inactive Applications
          {pipelineStats && pipelineStats.inactive_count > 0 && (
            <span className="bg-theme-surface-hover text-theme-text-secondary rounded-full px-1.5 py-0.5 text-xs">
              {pipelineStats.inactive_count}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('withdrawn')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === 'withdrawn'
              ? 'text-theme-text-primary border-red-500'
              : 'text-theme-text-muted hover:text-theme-text-secondary border-transparent'
          }`}
        >
          Withdrawn
          {pipelineStats && pipelineStats.withdrawn_count > 0 && (
            <span className="bg-theme-surface-hover text-theme-text-secondary rounded-full px-1.5 py-0.5 text-xs">
              {pipelineStats.withdrawn_count}
            </span>
          )}
        </button>
      </div>

      {/* Controls Bar (Active tab) */}
      {activeTab === 'active' && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          {/* Pipeline Selector */}
          {pipelines.length > 1 && (
            <select
              value={currentPipeline?.id ?? ''}
              onChange={(e) => {
                const pipeline = pipelines.find((p) => p.id === e.target.value);
                if (pipeline) void fetchPipeline(pipeline.id);
              }}
              className="bg-theme-surface border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
            >
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}

          {/* Search */}
          <div className="relative max-w-md flex-1">
            <Search className="text-theme-text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search applicants..."
              placeholder="Search applicants..."
              className="bg-theme-surface border-theme-surface-border text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring w-full rounded-lg border py-2 pr-4 pl-10 text-sm focus:ring-2 focus:outline-hidden"
            />
          </div>

          {/* Status Filter */}
          <div className="relative">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                statusFilter
                  ? 'border-red-500 bg-red-500/10 text-red-700 dark:text-red-400'
                  : 'border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-secondary'
              }`}
            >
              <Filter className="h-4 w-4" />
              Filter
              {statusFilter && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setStatusFilter('');
                  }}
                  className="ml-1"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </button>
            {showFilters && (
              <div className="bg-theme-surface-modal border-theme-surface-border absolute top-full left-0 z-10 mt-2 w-48 rounded-lg border py-1 shadow-xl">
                {(['active', 'on_hold', 'withdrawn', 'converted', 'rejected'] as ApplicantStatus[]).map((status) => (
                  <button
                    key={status}
                    onClick={() => {
                      setStatusFilter(status);
                      setShowFilters(false);
                    }}
                    className={`hover:bg-theme-surface-secondary w-full px-4 py-2 text-left text-sm capitalize ${
                      statusFilter === status ? 'text-red-700 dark:text-red-400' : 'text-theme-text-secondary'
                    }`}
                  >
                    {status.replace('_', ' ')}
                  </button>
                ))}
                {statusFilter && (
                  <button
                    onClick={() => {
                      setStatusFilter('');
                      setShowFilters(false);
                    }}
                    className="text-theme-text-muted hover:bg-theme-surface-secondary border-theme-surface-border w-full border-t px-4 py-2 text-left text-sm"
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
            onClick={() => {
              void fetchApplicants();
            }}
            disabled={isLoading}
            className="text-theme-text-muted hover:text-theme-text-primary p-2 transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>

          {/* View Toggle */}
          <div className="bg-theme-surface border-theme-surface-border flex items-center rounded-lg border">
            <button
              onClick={() => setViewMode('kanban')}
              className={`flex items-center gap-1.5 rounded-l-lg px-3 py-2 text-sm transition-colors ${
                viewMode === 'kanban' ? 'bg-red-600 text-white' : 'text-theme-text-muted hover:text-theme-text-primary'
              }`}
            >
              <LayoutGrid className="h-4 w-4" />
              Kanban
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`flex items-center gap-1.5 rounded-r-lg px-3 py-2 text-sm transition-colors ${
                viewMode === 'table' ? 'bg-red-600 text-white' : 'text-theme-text-muted hover:text-theme-text-primary'
              }`}
            >
              <List className="h-4 w-4" />
              Table
            </button>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-4">
          <XCircle className="h-5 w-5 shrink-0 text-red-700 dark:text-red-400" />
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Active Tab Content */}
      {activeTab === 'active' && (
        <>
          {(isLoading || isLoadingPipeline || isLoadingPipelines) && !applicants.length ? (
            <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
              <Loader2 className="h-8 w-8 animate-spin text-red-700 dark:text-red-500" />
            </div>
          ) : !currentPipeline ? (
            <div className="py-20 text-center">
              <Users className="text-theme-text-muted mx-auto mb-4 h-12 w-12" />
              <h3 className="text-theme-text-primary mb-2 text-lg font-medium">No pipeline configured</h3>
              <p className="text-theme-text-muted mb-4">Create a pipeline to start managing prospective members.</p>
              <button onClick={() => void navigate('/prospective-members/settings')} className="btn-primary px-6">
                Configure Pipeline
              </button>
            </div>
          ) : (
            <>
              {/* Bulk Actions Bar */}
              {selectedApplicants.size > 0 && (
                <div className="bg-theme-surface border-theme-surface-border mb-3 flex items-center gap-3 rounded-lg border p-3">
                  <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedApplicants.size === applicants.length}
                      onChange={toggleAllApplicants}
                      className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
                    />
                    {selectedApplicants.size} selected
                  </label>
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      onClick={() =>
                        void navigate(`/prospective-members/print-labels?ids=${[...selectedApplicants].join(',')}`)
                      }
                      className="border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-secondary flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors"
                    >
                      <Printer className="h-3.5 w-3.5" />
                      Print Badges
                    </button>
                    <button
                      onClick={() => {
                        void handleBulkAdvance();
                      }}
                      disabled={isBulkAdvancing}
                      className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {isBulkAdvancing ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      )}
                      Advance All
                    </button>
                    {showBulkRejectConfirm ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={bulkRejectReason}
                          onChange={(e) => setBulkRejectReason(e.target.value)}
                          placeholder="Reason (optional)"
                          aria-label="Reason for rejecting the selected applicants"
                          maxLength={1000}
                          className="form-input w-56 py-1.5 text-sm"
                        />
                        <button
                          onClick={() => {
                            setShowBulkRejectConfirm(false);
                            setBulkRejectReason('');
                          }}
                          className="text-theme-text-secondary hover:text-theme-text-primary px-3 py-1.5 text-xs transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => {
                            void handleBulkReject();
                          }}
                          disabled={isBulkRejecting}
                          className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                        >
                          {isBulkRejecting ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <XCircle className="h-3.5 w-3.5" />
                          )}
                          Confirm Reject
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowBulkRejectConfirm(true)}
                        className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-sm text-red-700 transition-colors hover:bg-red-500/10 dark:text-red-400"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        Reject All
                      </button>
                    )}
                    <button
                      onClick={() => setSelectedApplicants(new Set())}
                      className="text-theme-text-muted hover:text-theme-text-primary p-1.5 transition-colors"
                      title="Clear selection"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
              {viewMode === 'kanban' && (
                <PipelineKanban
                  stages={sortedStages}
                  applicants={applicants}
                  totalApplicants={totalApplicants}
                  onApplicantClick={handleApplicantClick}
                  selectedApplicants={selectedApplicants}
                  onToggleSelect={toggleApplicantSelection}
                />
              )}
              {viewMode === 'table' && (
                <PipelineTable
                  applicants={applicants}
                  totalApplicants={totalApplicants}
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={(page) => {
                    void fetchApplicants(page);
                  }}
                  onApplicantClick={handleApplicantClick}
                  selectedApplicants={selectedApplicants}
                  onToggleSelect={toggleApplicantSelection}
                  onToggleAll={toggleAllApplicants}
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
            <div className="bg-theme-surface border-theme-surface-border mb-3 flex items-center gap-3 rounded-lg border p-3">
              <span className="text-theme-text-secondary text-sm">{selectedInactive.size} selected</span>
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={() => {
                    void handleBulkReactivate();
                  }}
                  disabled={isBulkReactivating}
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                >
                  {isBulkReactivating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3.5 w-3.5" />
                  )}
                  Reactivate
                </button>
                <button
                  onClick={() => setShowPurgeConfirm(true)}
                  disabled={isPurging}
                  className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-sm"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Purge Selected
                </button>
              </div>
            </div>
          )}

          {isLoadingInactive ? (
            <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
              <Loader2 className="h-8 w-8 animate-spin text-red-700 dark:text-red-500" />
            </div>
          ) : inactiveApplicants.length === 0 ? (
            <div className="bg-theme-input-bg border-theme-surface-border rounded-lg border border-dashed py-20 text-center">
              <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-emerald-600" />
              <h3 className="text-theme-text-primary mb-2 text-lg font-medium">No inactive applications</h3>
              <p className="text-theme-text-muted text-sm">
                All applications are currently active or have been resolved.
              </p>
            </div>
          ) : (
            <div className="bg-theme-input-bg border-theme-surface-border overflow-hidden overflow-x-auto rounded-lg border">
              <table className="w-full">
                <thead>
                  <tr className="border-theme-surface-border border-b">
                    <th scope="col" className="w-10 p-3">
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
                        className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
                      />
                    </th>
                    <th
                      scope="col"
                      className="text-theme-text-muted p-3 text-left text-xs font-medium tracking-wider uppercase"
                    >
                      Name
                    </th>
                    <th
                      scope="col"
                      className="text-theme-text-muted table-col-secondary p-3 text-left text-xs font-medium tracking-wider uppercase"
                    >
                      Email
                    </th>
                    <th
                      scope="col"
                      className="text-theme-text-muted table-col-secondary p-3 text-left text-xs font-medium tracking-wider uppercase"
                    >
                      Last Stage
                    </th>
                    <th
                      scope="col"
                      className="text-theme-text-muted table-col-tertiary p-3 text-left text-xs font-medium tracking-wider uppercase"
                    >
                      Inactive Since
                    </th>
                    <th
                      scope="col"
                      className="text-theme-text-muted p-3 text-left text-xs font-medium tracking-wider uppercase"
                    >
                      Days Idle
                    </th>
                    <th scope="col" className="w-28 p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {inactiveApplicants.map((applicant) => (
                    <tr
                      key={applicant.id}
                      className="border-theme-surface-border hover:bg-theme-surface-secondary border-b transition-colors"
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
                          className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
                        />
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2.5">
                          <div className="bg-theme-surface-hover text-theme-text-secondary flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold">
                            {getInitials(applicant.first_name, applicant.last_name)}
                          </div>
                          <span className="text-theme-text-secondary text-sm font-medium">
                            {applicant.first_name} {applicant.last_name}
                          </span>
                        </div>
                      </td>
                      <td className="text-theme-text-muted table-col-secondary p-3 text-sm">{applicant.email}</td>
                      <td className="text-theme-text-muted table-col-secondary p-3 text-sm">
                        {applicant.current_stage_name ?? '—'}
                      </td>
                      <td className="text-theme-text-muted table-col-tertiary p-3 text-sm">
                        {applicant.deactivated_at ? formatDate(applicant.deactivated_at, tz) : '—'}
                      </td>
                      <td className="text-theme-text-muted p-3 text-sm">{applicant.days_since_activity}d</td>
                      <td className="p-3">
                        <button
                          onClick={() => {
                            void (async () => {
                              try {
                                await reactivateApplicant(applicant.id);
                                toast.success(`${applicant.first_name} reactivated`);
                              } catch {
                                toast.error('Failed to reactivate');
                              }
                            })();
                          }}
                          disabled={isReactivating}
                          className="flex items-center gap-1 rounded-lg border border-emerald-500/30 px-2.5 py-1.5 text-xs text-emerald-700 transition-colors hover:bg-emerald-500/10 disabled:opacity-50 dark:text-emerald-400"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Reactivate
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {inactiveTotalPages > 1 && (
                <div className="border-theme-surface-border flex items-center justify-between border-t p-3">
                  <p className="text-theme-text-muted text-sm">
                    Page {inactiveCurrentPage} of {inactiveTotalPages} ({inactiveTotalApplicants} total)
                  </p>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        void fetchInactiveApplicants(inactiveCurrentPage - 1);
                      }}
                      disabled={inactiveCurrentPage <= 1}
                      className="text-theme-text-muted hover:text-theme-text-primary px-3 py-1 text-sm transition-colors disabled:opacity-30"
                    >
                      Previous
                    </button>
                    <button
                      onClick={() => {
                        void fetchInactiveApplicants(inactiveCurrentPage + 1);
                      }}
                      disabled={inactiveCurrentPage >= inactiveTotalPages}
                      className="text-theme-text-muted hover:text-theme-text-primary px-3 py-1 text-sm transition-colors disabled:opacity-30"
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
            <div className="bg-theme-input-bg border-theme-surface-border mt-4 flex items-start gap-2 rounded-lg border p-3">
              <Info className="text-theme-text-muted mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p className="text-theme-text-muted text-xs">
                Inactive applications are excluded from pipeline statistics. Purging permanently deletes applicant data
                and cannot be undone. Consider reactivating applications before purging if you are unsure.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Withdrawn Tab Content */}
      {activeTab === 'withdrawn' && (
        <div>
          {isLoadingWithdrawn ? (
            <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
              <Loader2 className="h-8 w-8 animate-spin text-red-700 dark:text-red-500" />
            </div>
          ) : withdrawnApplicants.length === 0 ? (
            <div className="bg-theme-input-bg border-theme-surface-border rounded-lg border border-dashed py-20 text-center">
              <Archive className="text-theme-text-muted mx-auto mb-4 h-12 w-12" />
              <h3 className="text-theme-text-primary mb-2 text-lg font-medium">No withdrawn applications</h3>
              <p className="text-theme-text-muted text-sm">
                Applicants who voluntarily withdraw from the pipeline will appear here.
              </p>
            </div>
          ) : (
            <div className="bg-theme-input-bg border-theme-surface-border overflow-hidden overflow-x-auto rounded-lg border">
              <table className="w-full">
                <thead>
                  <tr className="border-theme-surface-border border-b">
                    <th
                      scope="col"
                      className="text-theme-text-muted p-3 text-left text-xs font-medium tracking-wider uppercase"
                    >
                      Name
                    </th>
                    <th
                      scope="col"
                      className="text-theme-text-muted table-col-secondary p-3 text-left text-xs font-medium tracking-wider uppercase"
                    >
                      Email
                    </th>
                    <th
                      scope="col"
                      className="text-theme-text-muted table-col-secondary p-3 text-left text-xs font-medium tracking-wider uppercase"
                    >
                      Last Stage
                    </th>
                    <th
                      scope="col"
                      className="text-theme-text-muted table-col-tertiary p-3 text-left text-xs font-medium tracking-wider uppercase"
                    >
                      Withdrawn Date
                    </th>
                    <th
                      scope="col"
                      className="text-theme-text-muted table-col-tertiary p-3 text-left text-xs font-medium tracking-wider uppercase"
                    >
                      Reason
                    </th>
                    <th scope="col" className="w-32 p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {withdrawnApplicants.map((applicant) => (
                    <tr
                      key={applicant.id}
                      className="border-theme-surface-border hover:bg-theme-surface-secondary border-b transition-colors"
                    >
                      <td className="p-3">
                        <div
                          className="flex cursor-pointer items-center gap-2.5"
                          onClick={() => {
                            void fetchApplicant(applicant.id);
                          }}
                        >
                          <div className="bg-theme-surface-hover text-theme-text-secondary flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold">
                            {getInitials(applicant.first_name, applicant.last_name)}
                          </div>
                          <span className="text-theme-text-secondary text-sm font-medium">
                            {applicant.first_name} {applicant.last_name}
                          </span>
                        </div>
                      </td>
                      <td className="text-theme-text-muted table-col-secondary p-3 text-sm">{applicant.email}</td>
                      <td className="text-theme-text-muted table-col-secondary p-3 text-sm">
                        {applicant.current_stage_name ?? '—'}
                      </td>
                      <td className="text-theme-text-muted table-col-tertiary p-3 text-sm">
                        {applicant.withdrawn_at ? formatDate(applicant.withdrawn_at, tz) : '—'}
                      </td>
                      <td className="text-theme-text-muted table-col-tertiary max-w-[200px] truncate p-3 text-sm">
                        {applicant.withdrawal_reason ?? '—'}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              void fetchApplicant(applicant.id);
                            }}
                            className="text-theme-text-muted hover:text-theme-text-primary text-xs transition-colors"
                          >
                            View
                          </button>
                          <button
                            onClick={() => {
                              void (async () => {
                                try {
                                  await reactivateApplicant(applicant.id);
                                  toast.success(`${applicant.first_name} reactivated`);
                                } catch {
                                  toast.error('Failed to reactivate');
                                }
                              })();
                            }}
                            disabled={isReactivating}
                            className="flex items-center gap-1 rounded-lg border border-emerald-500/30 px-2.5 py-1.5 text-xs text-emerald-700 transition-colors hover:bg-emerald-500/10 disabled:opacity-50 dark:text-emerald-400"
                          >
                            <RotateCcw className="h-3 w-3" />
                            Reactivate
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {withdrawnTotalPages > 1 && (
                <div className="border-theme-surface-border flex items-center justify-between border-t p-3">
                  <p className="text-theme-text-muted text-sm">
                    Page {withdrawnCurrentPage} of {withdrawnTotalPages} ({withdrawnTotalApplicants} total)
                  </p>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        void fetchWithdrawnApplicants(withdrawnCurrentPage - 1);
                      }}
                      disabled={withdrawnCurrentPage <= 1}
                      className="text-theme-text-muted hover:text-theme-text-primary px-3 py-1 text-sm transition-colors disabled:opacity-30"
                    >
                      Previous
                    </button>
                    <button
                      onClick={() => {
                        void fetchWithdrawnApplicants(withdrawnCurrentPage + 1);
                      }}
                      disabled={withdrawnCurrentPage >= withdrawnTotalPages}
                      className="text-theme-text-muted hover:text-theme-text-primary px-3 py-1 text-sm transition-colors disabled:opacity-30"
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
            <div className="bg-theme-input-bg border-theme-surface-border mt-4 flex items-start gap-2 rounded-lg border p-3">
              <Info className="text-theme-text-muted mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p className="text-theme-text-muted text-xs">
                Withdrawn applications are from prospective members who voluntarily left the pipeline process. You can
                reactivate them to place them back into the active pipeline at their previous stage.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Purge Confirmation Modal */}
      {showPurgeConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-theme-surface-modal border-theme-surface-border w-full max-w-md rounded-xl border">
            <div className="p-6">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10">
                  <AlertTriangle className="h-5 w-5 text-red-700 dark:text-red-400" />
                </div>
                <div>
                  <h2 className="text-theme-text-primary text-lg font-bold">Confirm Purge</h2>
                  <p className="text-theme-text-muted text-sm">This action cannot be undone</p>
                </div>
              </div>
              <p className="text-theme-text-secondary mb-4 text-sm">
                You are about to permanently delete{' '}
                <strong className="text-theme-text-primary">{selectedInactive.size}</strong> inactive application(s) and
                all associated personal data. This protects your organization from holding unnecessary private
                information.
              </p>
            </div>
            <div className="border-theme-surface-border flex items-center justify-end gap-3 border-t p-6">
              <button
                onClick={() => setShowPurgeConfirm(false)}
                className="text-theme-text-secondary hover:text-theme-text-primary px-4 py-2 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void (async () => {
                    try {
                      await purgeInactiveApplicants(Array.from(selectedInactive));
                      toast.success(`Purged ${selectedInactive.size} application(s)`);
                      setSelectedInactive(new Set());
                    } catch {
                      toast.error('Failed to purge applications');
                    }
                    setShowPurgeConfirm(false);
                  })();
                }}
                disabled={isPurging}
                className="btn-primary flex items-center gap-2 px-6"
              >
                {isPurging && <Loader2 className="h-4 w-4 animate-spin" />}
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
        isFirstStage={isFirstStage}
      />

      {/* Conversion Modal */}
      <ConversionModal
        isOpen={!!conversionApplicant}
        onClose={() => setConversionApplicant(null)}
        applicant={conversionApplicant}
      />

      {/* Add Applicant Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-theme-surface-modal border-theme-surface-border w-full max-w-md rounded-xl border">
            <div className="border-theme-surface-border flex items-center justify-between border-b p-6">
              <h2 className="text-theme-text-primary text-lg font-bold">Add Applicant</h2>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-theme-text-muted hover:text-theme-text-primary transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-theme-text-muted mb-1 block text-sm">First Name *</label>
                  <input
                    type="text"
                    value={newApplicant.first_name}
                    onChange={(e) => setNewApplicant({ ...newApplicant, first_name: e.target.value })}
                    className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                  />
                </div>
                <div>
                  <label className="text-theme-text-muted mb-1 block text-sm">Last Name *</label>
                  <input
                    type="text"
                    value={newApplicant.last_name}
                    onChange={(e) => setNewApplicant({ ...newApplicant, last_name: e.target.value })}
                    className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                  />
                </div>
              </div>
              <div>
                <label className="text-theme-text-muted mb-1 block text-sm">Email *</label>
                <input
                  type="email"
                  value={newApplicant.email}
                  onChange={(e) => setNewApplicant({ ...newApplicant, email: e.target.value })}
                  className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                />
              </div>
              <div>
                <label className="text-theme-text-muted mb-1 block text-sm">Phone</label>
                <input
                  type="tel"
                  value={newApplicant.phone}
                  onChange={(e) => setNewApplicant({ ...newApplicant, phone: e.target.value })}
                  className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                />
              </div>
              <div>
                <label className="text-theme-text-muted mb-1 block text-sm">Membership Type</label>
                <select
                  value={newApplicant.target_membership_type}
                  onChange={(e) =>
                    setNewApplicant({
                      ...newApplicant,
                      target_membership_type: e.target.value as 'regular' | 'administrative',
                    })
                  }
                  className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                >
                  <option value="regular">Regular Member</option>
                  <option value="administrative">Administrative</option>
                </select>
              </div>
            </div>
            <div className="border-theme-surface-border flex items-center justify-end gap-3 border-t p-6">
              <button
                onClick={() => setShowAddModal(false)}
                className="text-theme-text-secondary hover:text-theme-text-primary px-4 py-2 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void handleCreateApplicant();
                }}
                disabled={isCreating}
                className="btn-primary flex items-center gap-2 px-6"
              >
                {isCreating && <Loader2 className="h-4 w-4 animate-spin" />}
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
