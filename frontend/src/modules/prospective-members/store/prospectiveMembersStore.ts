/**
 * Prospective Members Store
 *
 * Zustand store for managing prospective member pipeline state.
 */

import { create } from 'zustand';
import type {
  Pipeline,
  PipelineListItem,
  PipelineStats,
  InactivityConfig,
  Applicant,
  ApplicantListItem,
  ApplicantListFilters,
  PipelineViewMode,
  ElectionPackage,
  ElectionPackageUpdate,
  Interview,
  InterviewCreate,
  InterviewUpdate,
  PaginatedApplicantList,
} from '../types';
import { pipelineService, applicantService, interviewService } from '../services/api';
import { handleStoreError } from '../../../utils/storeHelpers';
import { toAppError } from '../../../utils/errorHandling';
import { StageType } from '../../../constants/enums';
import { KANBAN_PAGE_SIZE } from '../constants';

export type PipelineTab = 'active' | 'inactive' | 'withdrawn' | 'rejected' | 'converted';

const VIEW_MODE_STORAGE_KEY = 'prospective-members:view-mode';
const PIPELINE_STORAGE_KEY = 'prospective-members:pipeline-id';

const readPreference = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writePreference = (key: string, value: string | null) => {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Storage may be unavailable in hardened/private browser contexts.
  }
};

const storedViewMode = readPreference(VIEW_MODE_STORAGE_KEY);
const initialViewMode: PipelineViewMode = storedViewMode === 'table' ? 'table' : 'kanban';

interface ProspectiveMembersState {
  // Pipeline data
  pipelines: PipelineListItem[];
  currentPipeline: Pipeline | null;
  pipelineStats: PipelineStats | null;
  preferredPipelineId: string | null;

  // Applicant data
  applicants: ApplicantListItem[];
  /**
   * Which pipeline `applicants` was loaded for, so a list belonging to a
   * pipeline nobody is looking at any more can be recognised and dropped.
   * Null whenever the list is empty or its pipeline is unknown.
   */
  applicantsPipelineId: string | null;
  currentApplicant: Applicant | null;

  // Pagination
  totalApplicants: number;
  currentPage: number;
  pageSize: number;
  totalPages: number;

  // Filters
  filters: ApplicantListFilters;

  // View state
  viewMode: PipelineViewMode;
  activeTab: PipelineTab;
  detailDrawerOpen: boolean;

  // Inactive applicant data
  inactiveApplicants: ApplicantListItem[];
  inactiveTotalApplicants: number;
  inactiveCurrentPage: number;
  inactiveTotalPages: number;

  // Withdrawn applicant data
  withdrawnApplicants: ApplicantListItem[];
  withdrawnTotalApplicants: number;
  withdrawnCurrentPage: number;
  withdrawnTotalPages: number;

  // Rejected applicant data
  rejectedApplicants: ApplicantListItem[];
  rejectedTotalApplicants: number;
  rejectedCurrentPage: number;
  rejectedTotalPages: number;

  // Converted applicant data — applications that produced a member
  convertedApplicants: ApplicantListItem[];
  convertedTotalApplicants: number;
  convertedCurrentPage: number;
  convertedTotalPages: number;

  // Election package for current applicant
  currentElectionPackage: ElectionPackage | null;
  isLoadingElectionPackage: boolean;

  // Interview data
  interviews: Interview[];
  isLoadingInterviews: boolean;

  // Loading states
  isLoading: boolean;
  isLoadingPipelines: boolean;
  isLoadingPipeline: boolean;
  isLoadingApplicant: boolean;
  isLoadingStats: boolean;
  isLoadingInactive: boolean;
  isLoadingWithdrawn: boolean;
  isLoadingRejected: boolean;
  isLoadingConverted: boolean;
  isAdvancing: boolean;
  isRegressing: boolean;
  isRejecting: boolean;
  isHolding: boolean;
  isResuming: boolean;
  isWithdrawing: boolean;
  isAssigningStage: boolean;
  isReactivating: boolean;
  isPurging: boolean;
  error: string | null;

  // Pipeline actions
  fetchPipelines: () => Promise<void>;
  fetchPipeline: (id: string) => Promise<void>;
  fetchPipelineStats: (id: string) => Promise<void>;
  refreshPipelineView: () => Promise<void>;
  setCurrentPipeline: (pipeline: Pipeline | null) => void;
  duplicatePipeline: (id: string, name: string) => Promise<Pipeline>;
  setDefaultPipeline: (id: string) => Promise<void>;
  saveAsTemplate: (id: string, name: string) => Promise<void>;
  fetchTemplates: () => Promise<PipelineListItem[]>;

  // Applicant actions
  fetchApplicants: (page?: number) => Promise<void>;
  fetchApplicant: (id: string) => Promise<void>;
  setCurrentApplicant: (applicant: Applicant | null) => void;
  advanceApplicant: (id: string, notes?: string) => Promise<void>;
  regressApplicant: (id: string, notes?: string) => Promise<void>;
  completeStep: (id: string, stepId: string, notes?: string) => Promise<void>;
  rejectApplicant: (id: string, reason?: string) => Promise<void>;
  holdApplicant: (id: string, reason?: string) => Promise<void>;
  resumeApplicant: (id: string) => Promise<void>;
  withdrawApplicant: (id: string, reason?: string) => Promise<void>;
  assignApplicantStage: (id: string, stageId: string, notes?: string) => Promise<void>;

  // Inactivity actions
  reactivateApplicant: (id: string, notes?: string) => Promise<void>;
  fetchInactiveApplicants: (page?: number) => Promise<void>;
  fetchWithdrawnApplicants: (page?: number) => Promise<void>;
  fetchRejectedApplicants: (page?: number) => Promise<void>;
  fetchConvertedApplicants: (page?: number) => Promise<void>;
  purgeInactiveApplicants: (applicantIds?: string[]) => Promise<void>;
  updateInactivitySettings: (config: InactivityConfig) => Promise<void>;

  // Election package actions
  fetchElectionPackage: (applicantId: string) => Promise<void>;
  updateElectionPackage: (applicantId: string, data: ElectionPackageUpdate) => Promise<void>;
  submitElectionPackage: (applicantId: string) => Promise<void>;
  assignPackageToElection: (applicantId: string, electionId: string) => Promise<void>;

  // Interview actions
  fetchInterviews: (applicantId: string) => Promise<void>;
  createInterview: (applicantId: string, data: InterviewCreate) => Promise<void>;
  updateInterview: (interviewId: string, data: InterviewUpdate) => Promise<void>;
  deleteInterview: (interviewId: string) => Promise<void>;

  // Filter & view actions
  setFilters: (filters: ApplicantListFilters) => void;
  clearFilters: () => void;
  setViewMode: (mode: PipelineViewMode) => void;
  setActiveTab: (tab: PipelineTab) => void;
  setDetailDrawerOpen: (open: boolean) => void;

  // Utilities
  clearError: () => void;
}

const defaultFilters: ApplicantListFilters = {};

/**
 * True when the page just fetched has fallen off the end of a shrinking list.
 *
 * Reactivating the only rejected applicant on page 2 leaves 25 records and one
 * page, but the refresh asks for page 2 again: an empty response stored as
 * "page 2 of 1", which renders the empty state with no pagination controls to
 * get back to page 1. Every list here pages the same way and had the same
 * dead end.
 */
const isPastLastPage = (requested: number, response: PaginatedApplicantList): boolean =>
  response.items.length === 0 && response.total > 0 && requested > response.total_pages;

/**
 * Sequence numbers that let a fetch tell whether it is still the current one.
 *
 * Every list here fires overlapping requests as a matter of course: on mount
 * the pipeline, the status filter and the event filter are each set by their
 * own effect, and each `setFilters` starts a fetch; selecting another pipeline
 * starts one more while the previous is still in flight. Without a token the
 * last response to *arrive* wins regardless of which request it answers, so a
 * slow reply describing the pipeline the coordinator just left could overwrite
 * — or blank — the one they are actually looking at, and the stat header would
 * then disagree with the table for as long as the page stayed open.
 *
 * A stale response is dropped whole: it does not write rows, does not clear
 * `isLoading` (the newer request in flight still owns that), and does not
 * report its error, which would otherwise surface against a list it is no
 * longer describing.
 */
type FetchKey = 'applicants' | 'inactive' | 'withdrawn' | 'rejected' | 'converted' | 'stats';
const requestTokens: Record<FetchKey, number> = {
  applicants: 0,
  inactive: 0,
  withdrawn: 0,
  rejected: 0,
  converted: 0,
  stats: 0,
};
const beginFetch = (key: FetchKey): number => {
  requestTokens[key] += 1;
  return requestTokens[key];
};
const isCurrentFetch = (key: FetchKey, token: number): boolean => requestTokens[key] === token;

/**
 * Refresh whichever archive list is on screen after a status change.
 *
 * Reactivating from the Withdrawn tab used to refresh the *inactive* list, so
 * the row the coordinator had just reactivated stayed where it was until they
 * reloaded the page.
 */
const refreshActiveArchiveList = async (get: () => ProspectiveMembersState): Promise<void> => {
  const { activeTab } = get();
  if (activeTab === 'inactive') await get().fetchInactiveApplicants();
  else if (activeTab === 'withdrawn') await get().fetchWithdrawnApplicants();
  else if (activeTab === 'rejected') await get().fetchRejectedApplicants();
  else if (activeTab === 'converted') await get().fetchConvertedApplicants();
};

export const useProspectiveMembersStore = create<ProspectiveMembersState>((set, get) => ({
  // Initial state
  pipelines: [],
  currentPipeline: null,
  pipelineStats: null,
  preferredPipelineId: readPreference(PIPELINE_STORAGE_KEY),

  applicants: [],
  applicantsPipelineId: null,
  currentApplicant: null,

  totalApplicants: 0,
  currentPage: 1,
  pageSize: 25,
  totalPages: 0,

  filters: defaultFilters,

  viewMode: initialViewMode,
  activeTab: 'active',
  detailDrawerOpen: false,

  inactiveApplicants: [],
  inactiveTotalApplicants: 0,
  inactiveCurrentPage: 1,
  inactiveTotalPages: 0,

  withdrawnApplicants: [],
  withdrawnTotalApplicants: 0,
  withdrawnCurrentPage: 1,
  withdrawnTotalPages: 0,

  rejectedApplicants: [],
  rejectedTotalApplicants: 0,
  rejectedCurrentPage: 1,
  rejectedTotalPages: 0,

  convertedApplicants: [],
  convertedTotalApplicants: 0,
  convertedCurrentPage: 1,
  convertedTotalPages: 0,

  currentElectionPackage: null,
  isLoadingElectionPackage: false,

  interviews: [],
  isLoadingInterviews: false,

  isLoading: false,
  isLoadingPipelines: false,
  isLoadingPipeline: false,
  isLoadingApplicant: false,
  isLoadingStats: false,
  isLoadingInactive: false,
  isLoadingWithdrawn: false,
  isLoadingRejected: false,
  isLoadingConverted: false,
  isAdvancing: false,
  isRegressing: false,
  isRejecting: false,
  isHolding: false,
  isResuming: false,
  isWithdrawing: false,
  isAssigningStage: false,
  isReactivating: false,
  isPurging: false,
  error: null,

  // Pipeline actions
  fetchPipelines: async () => {
    set({ isLoadingPipelines: true, error: null });
    try {
      const pipelines = await pipelineService.getPipelines();
      set({ pipelines, isLoadingPipelines: false });
    } catch (error) {
      set({
        error: handleStoreError(error, 'Failed to fetch pipelines'),
        isLoadingPipelines: false,
      });
    }
  },

  fetchPipeline: async (id: string) => {
    set({ isLoadingPipeline: true, error: null });
    try {
      const pipeline = await pipelineService.getPipeline(id);
      writePreference(PIPELINE_STORAGE_KEY, pipeline.id);
      set({ currentPipeline: pipeline, preferredPipelineId: pipeline.id, isLoadingPipeline: false });
    } catch (error) {
      set({
        error: handleStoreError(error, 'Failed to fetch pipeline'),
        isLoadingPipeline: false,
      });
    }
  },

  fetchPipelineStats: async (id: string) => {
    const { search, event_id } = get().filters;
    const token = beginFetch('stats');
    set({ isLoadingStats: true });
    try {
      const stats = await pipelineService.getPipelineStats(id, { search, event_id });
      if (!isCurrentFetch('stats', token)) return;
      set({ pipelineStats: stats, isLoadingStats: false });
    } catch (error) {
      if (!isCurrentFetch('stats', token)) return;
      set({
        error: handleStoreError(error, 'Failed to fetch pipeline stats'),
        isLoadingStats: false,
      });
    }
  },

  /**
   * Refresh both halves of the pipeline screen after a mutation.
   *
   * The stat header and the applicant list are two separate queries, so a
   * mutation that refreshes only the list leaves the header describing the
   * pipeline as it was beforehand. That is how converting the last two active
   * applicants left "Total Active: 2" standing over an empty table with
   * "Converted: 0" beside it: the list was correct and the header was a
   * snapshot of the previous minute, which reads as lost applicants rather
   * than as a stale count.
   *
   * Every mutation refreshes through this rather than calling
   * `fetchApplicants` alone, so a new one cannot reintroduce the split by
   * forgetting the second call -- which is exactly how the conversion path
   * came to be the only one missing it.
   */
  refreshPipelineView: async () => {
    const { currentPipeline, filters } = get();
    // The list's own filter first: the point of refreshing both together is
    // that they describe one population, so the counts follow whatever the
    // table is scoped to rather than whatever is selected in the header.
    const pipelineId = filters.pipeline_id ?? currentPipeline?.id;
    await Promise.all([get().fetchApplicants(), pipelineId ? get().fetchPipelineStats(pipelineId) : Promise.resolve()]);
  },

  setCurrentPipeline: (pipeline) => {
    writePreference(PIPELINE_STORAGE_KEY, pipeline?.id ?? null);
    set({ currentPipeline: pipeline, preferredPipelineId: pipeline?.id ?? null });
  },

  duplicatePipeline: async (id: string, name: string) => {
    set({ error: null });
    try {
      const duplicated = await pipelineService.duplicatePipeline(id, name);
      await get().fetchPipelines();
      return duplicated;
    } catch (error) {
      set({ error: handleStoreError(error, 'Failed to duplicate pipeline') });
      throw error;
    }
  },

  setDefaultPipeline: async (id: string) => {
    set({ error: null });
    try {
      const updated = await pipelineService.updatePipeline(id, { is_default: true });
      set({ currentPipeline: updated });
      await get().fetchPipelines();
    } catch (error) {
      set({ error: handleStoreError(error, 'Failed to set default pipeline') });
      throw error;
    }
  },

  saveAsTemplate: async (id: string, name: string) => {
    set({ error: null });
    try {
      await pipelineService.saveAsTemplate(id, name);
      await get().fetchPipelines();
    } catch (error) {
      set({ error: handleStoreError(error, 'Failed to save as template') });
      throw error;
    }
  },

  fetchTemplates: async () => {
    try {
      return await pipelineService.getTemplates();
    } catch (error) {
      set({ error: handleStoreError(error, 'Failed to fetch templates') });
      return [];
    }
  },

  // Applicant actions
  fetchApplicants: async (page?: number) => {
    const state = get();
    const pageToFetch = page ?? state.currentPage;
    // The board groups into stage columns client-side, so it needs the
    // whole set; the table pages normally.
    const pageSize = state.viewMode === 'kanban' ? KANBAN_PAGE_SIZE : state.pageSize;
    const requestedPipelineId = state.filters.pipeline_id ?? null;

    // Drop a list belonging to a different pipeline before the request, not
    // after it. Selecting another pipeline sets filters.pipeline_id and leaves
    // `applicants` alone, so the board kept drawing the previous pipeline's
    // applicants until the new fetch resolved -- and, because the catch below
    // only records the error, kept drawing them forever when it failed. The
    // board then showed one pipeline's rows under another's stage columns.
    //
    // Only on an actual pipeline change: search and status filters go through
    // setFilters too, and blanking the list on every keystroke would flash an
    // empty board over a perfectly good one.
    const isPipelineChange = requestedPipelineId !== state.applicantsPipelineId;

    const token = beginFetch('applicants');
    set({
      isLoading: true,
      error: null,
      ...(isPipelineChange ? { applicants: [], totalApplicants: 0, applicantsPipelineId: null } : {}),
    });

    try {
      const response = await applicantService.getApplicants({
        filters: state.filters,
        page: pageToFetch,
        pageSize,
        // The board and the table show applications still in the pipeline.
        // A rejected, withdrawn, inactive or converted applicant is out of it
        // and lives in its own tab, not as a card in the stage it stopped at.
        openOnly: true,
      });

      if (!isCurrentFetch('applicants', token)) return;

      if (isPastLastPage(pageToFetch, response)) {
        await get().fetchApplicants(response.total_pages);
        return;
      }

      set({
        applicants: response.items,
        applicantsPipelineId: requestedPipelineId,
        totalApplicants: response.total,
        currentPage: response.page,
        totalPages: response.total_pages,
        isLoading: false,
      });
    } catch (error) {
      if (!isCurrentFetch('applicants', token)) return;
      set({
        error: handleStoreError(error, 'Failed to fetch applicants'),
        isLoading: false,
      });
    }
  },

  fetchApplicant: async (id: string) => {
    set({ isLoadingApplicant: true, error: null });
    try {
      const applicant = await applicantService.getApplicant(id);
      set({
        currentApplicant: applicant,
        isLoadingApplicant: false,
        detailDrawerOpen: true,
      });
    } catch (error) {
      set({
        error: handleStoreError(error, 'Failed to fetch applicant'),
        isLoadingApplicant: false,
      });
    }
  },

  setCurrentApplicant: (applicant) => {
    set({ currentApplicant: applicant });
  },

  advanceApplicant: async (id: string, notes?: string) => {
    set({ isAdvancing: true, error: null });
    try {
      const advanced = await applicantService.advanceStage(id, notes ? { notes } : undefined);
      // Advancing moves a stage count, and can move a status when the new
      // stage closes the application, so the header is refreshed with the list.
      await get().refreshPipelineView();
      const currentApplicant = get().currentApplicant;
      if (currentApplicant?.id === id) {
        await get().fetchApplicant(id);
      }

      // Auto-create election package if applicant landed on an election_vote stage
      const pipeline = get().currentPipeline;
      if (pipeline && advanced) {
        const newStage = (pipeline.stages || []).find((s) => s.id === advanced.current_stage_id);
        if (newStage?.stage_type === StageType.ELECTION_VOTE) {
          try {
            await applicantService.createElectionPackage(id, {
              applicant_id: id,
              pipeline_id: pipeline.id,
              stage_id: newStage.id,
            });
          } catch (packageError: unknown) {
            // A 409 means the package is already there, which is the expected
            // outcome when a stage is re-entered. Anything else left the
            // applicant sitting on an election-vote stage with nothing to vote
            // on — the advance itself succeeded, so this is reported as a
            // warning rather than rolled back.
            if (toAppError(packageError).status !== 409) {
              set({
                error: handleStoreError(
                  packageError,
                  'Applicant advanced, but the election package could not be created'
                ),
              });
            }
          }
        }
      }

      set({ isAdvancing: false });
    } catch (error) {
      set({
        error: handleStoreError(error, 'Failed to advance applicant'),
        isAdvancing: false,
      });
      // Action components own the user-facing toast. Propagate the rejection
      // so they do not announce success after the API refused a stage gate.
      throw error;
    }
  },

  regressApplicant: async (id: string, notes?: string) => {
    set({ isRegressing: true, error: null });
    try {
      await applicantService.regressStage(id, notes ? { notes } : undefined);
      await get().refreshPipelineView();
      const currentApplicant = get().currentApplicant;
      if (currentApplicant?.id === id) {
        await get().fetchApplicant(id);
      }
      set({ isRegressing: false });
    } catch (error) {
      set({
        error: handleStoreError(error, 'Failed to move applicant back'),
        isRegressing: false,
      });
      throw error;
    }
  },

  assignApplicantStage: async (id: string, stageId: string, notes?: string) => {
    set({ isAssigningStage: true, error: null });
    try {
      await applicantService.assignStage(id, stageId, notes);
      await get().refreshPipelineView();
      const currentApplicant = get().currentApplicant;
      if (currentApplicant?.id === id) {
        await get().fetchApplicant(id);
      }
      set({ isAssigningStage: false });
    } catch (error) {
      set({
        error: handleStoreError(error, 'Failed to place applicant on a stage'),
        isAssigningStage: false,
      });
      throw error;
    }
  },

  completeStep: async (id: string, stepId: string, notes?: string) => {
    set({ isAdvancing: true, error: null });
    try {
      await applicantService.completeStep(id, stepId, notes);
      await get().fetchApplicants();
      const currentApplicant = get().currentApplicant;
      if (currentApplicant?.id === id) {
        await get().fetchApplicant(id);
      }
      set({ isAdvancing: false });
    } catch (error) {
      set({
        error: handleStoreError(error, 'Failed to complete step'),
        isAdvancing: false,
      });
      throw error;
    }
  },

  rejectApplicant: async (id: string, reason?: string) => {
    set({ isRejecting: true, error: null });
    try {
      await applicantService.rejectApplicant(id, reason);
      await get().refreshPipelineView();
      await get().fetchRejectedApplicants();
      const currentApplicant = get().currentApplicant;
      if (currentApplicant?.id === id) {
        await get().fetchApplicant(id);
      }
      set({ isRejecting: false });
    } catch (error) {
      set({
        error: handleStoreError(error, 'Failed to reject applicant'),
        isRejecting: false,
      });
      throw error;
    }
  },

  holdApplicant: async (id: string, reason?: string) => {
    set({ isHolding: true, error: null });
    try {
      await applicantService.putOnHold(id, reason);
      await get().refreshPipelineView();
      const currentApplicant = get().currentApplicant;
      if (currentApplicant?.id === id) {
        await get().fetchApplicant(id);
      }
      set({ isHolding: false });
    } catch (error) {
      set({
        error: handleStoreError(error, 'Failed to put applicant on hold'),
        isHolding: false,
      });
      throw error;
    }
  },

  resumeApplicant: async (id: string) => {
    set({ isResuming: true, error: null });
    try {
      await applicantService.resumeApplicant(id);
      await get().fetchApplicants();
      const currentApplicant = get().currentApplicant;
      if (currentApplicant?.id === id) {
        await get().fetchApplicant(id);
      }
      set({ isResuming: false });
    } catch (error) {
      set({
        error: handleStoreError(error, 'Failed to resume applicant'),
        isResuming: false,
      });
      throw error;
    }
  },

  withdrawApplicant: async (id: string, reason?: string) => {
    set({ isWithdrawing: true, error: null });
    try {
      await applicantService.withdrawApplicant(id, reason ? { reason } : undefined);
      await get().refreshPipelineView();
      await get().fetchWithdrawnApplicants();
      const currentApplicant = get().currentApplicant;
      if (currentApplicant?.id === id) {
        await get().fetchApplicant(id);
      }
      set({ isWithdrawing: false });
    } catch (error) {
      set({
        error: handleStoreError(error, 'Failed to withdraw applicant'),
        isWithdrawing: false,
      });
      throw error;
    }
  },

  // Inactivity actions
  reactivateApplicant: async (id: string, notes?: string) => {
    set({ isReactivating: true, error: null });
    try {
      await applicantService.reactivateApplicant(id, notes ? { notes } : undefined);
      await get().refreshPipelineView();
      await refreshActiveArchiveList(get);
      const currentApplicant = get().currentApplicant;
      if (currentApplicant?.id === id) {
        await get().fetchApplicant(id);
      }
      set({ isReactivating: false });
    } catch (error) {
      set({
        error: handleStoreError(error, 'Failed to reactivate applicant'),
        isReactivating: false,
      });
      throw error;
    }
  },

  fetchInactiveApplicants: async (page?: number) => {
    const state = get();
    const pageToFetch = page ?? state.inactiveCurrentPage;

    const token = beginFetch('inactive');
    set({ isLoadingInactive: true, error: null });
    try {
      const response = await applicantService.getInactiveApplicants({
        pipeline_id: state.filters.pipeline_id,
        search: state.filters.search,
        page: pageToFetch,
        pageSize: state.pageSize,
      });

      if (!isCurrentFetch('inactive', token)) return;

      if (isPastLastPage(pageToFetch, response)) {
        await get().fetchInactiveApplicants(response.total_pages);
        return;
      }

      set({
        inactiveApplicants: response.items,
        inactiveTotalApplicants: response.total,
        inactiveCurrentPage: response.page,
        inactiveTotalPages: response.total_pages,
        isLoadingInactive: false,
      });
    } catch (error) {
      if (!isCurrentFetch('inactive', token)) return;
      set({
        error: handleStoreError(error, 'Failed to fetch inactive applicants'),
        isLoadingInactive: false,
      });
    }
  },

  fetchWithdrawnApplicants: async (page?: number) => {
    const state = get();
    const pageToFetch = page ?? state.withdrawnCurrentPage;

    const token = beginFetch('withdrawn');
    set({ isLoadingWithdrawn: true, error: null });
    try {
      const response = await applicantService.getWithdrawnApplicants({
        pipeline_id: state.filters.pipeline_id,
        search: state.filters.search,
        page: pageToFetch,
        pageSize: state.pageSize,
      });

      if (!isCurrentFetch('withdrawn', token)) return;

      if (isPastLastPage(pageToFetch, response)) {
        await get().fetchWithdrawnApplicants(response.total_pages);
        return;
      }

      set({
        withdrawnApplicants: response.items,
        withdrawnTotalApplicants: response.total,
        withdrawnCurrentPage: response.page,
        withdrawnTotalPages: response.total_pages,
        isLoadingWithdrawn: false,
      });
    } catch (error) {
      if (!isCurrentFetch('withdrawn', token)) return;
      set({
        error: handleStoreError(error, 'Failed to fetch withdrawn applicants'),
        isLoadingWithdrawn: false,
      });
    }
  },

  fetchRejectedApplicants: async (page?: number) => {
    const state = get();
    const pageToFetch = page ?? state.rejectedCurrentPage;

    const token = beginFetch('rejected');
    set({ isLoadingRejected: true, error: null });
    try {
      const response = await applicantService.getRejectedApplicants({
        pipeline_id: state.filters.pipeline_id,
        search: state.filters.search,
        page: pageToFetch,
        pageSize: state.pageSize,
      });

      if (!isCurrentFetch('rejected', token)) return;

      if (isPastLastPage(pageToFetch, response)) {
        await get().fetchRejectedApplicants(response.total_pages);
        return;
      }

      set({
        rejectedApplicants: response.items,
        rejectedTotalApplicants: response.total,
        rejectedCurrentPage: response.page,
        rejectedTotalPages: response.total_pages,
        isLoadingRejected: false,
      });
    } catch (error) {
      if (!isCurrentFetch('rejected', token)) return;
      set({
        error: handleStoreError(error, 'Failed to fetch rejected applicants'),
        isLoadingRejected: false,
      });
    }
  },

  fetchConvertedApplicants: async (page?: number) => {
    const state = get();
    const pageToFetch = page ?? state.convertedCurrentPage;

    const token = beginFetch('converted');
    set({ isLoadingConverted: true, error: null });
    try {
      const response = await applicantService.getConvertedApplicants({
        pipeline_id: state.filters.pipeline_id,
        search: state.filters.search,
        page: pageToFetch,
        pageSize: state.pageSize,
      });

      if (!isCurrentFetch('converted', token)) return;

      if (isPastLastPage(pageToFetch, response)) {
        await get().fetchConvertedApplicants(response.total_pages);
        return;
      }

      set({
        convertedApplicants: response.items,
        convertedTotalApplicants: response.total,
        convertedCurrentPage: response.page,
        convertedTotalPages: response.total_pages,
        isLoadingConverted: false,
      });
    } catch (error) {
      if (!isCurrentFetch('converted', token)) return;
      set({
        error: handleStoreError(error, 'Failed to fetch converted applicants'),
        isLoadingConverted: false,
      });
    }
  },

  purgeInactiveApplicants: async (applicantIds?: string[]) => {
    const state = get();
    if (!state.currentPipeline) return;

    set({ isPurging: true, error: null });
    try {
      await applicantService.purgeInactiveApplicants(state.currentPipeline.id, {
        applicant_ids: applicantIds,
        confirm: true,
      });
      await get().fetchInactiveApplicants();
      await get().fetchPipelineStats(state.currentPipeline.id);
      set({ isPurging: false });
    } catch (error) {
      set({
        error: handleStoreError(error, 'Failed to purge inactive applicants'),
        isPurging: false,
      });
    }
  },

  updateInactivitySettings: async (config: InactivityConfig) => {
    const state = get();
    if (!state.currentPipeline) return;

    set({ error: null });
    try {
      const updated = await pipelineService.updateInactivitySettings(state.currentPipeline.id, config);
      set({ currentPipeline: updated });
    } catch (error) {
      set({
        error: handleStoreError(error, 'Failed to update inactivity settings'),
      });
      throw error;
    }
  },

  // Election package actions
  fetchElectionPackage: async (applicantId: string) => {
    set({ isLoadingElectionPackage: true });
    try {
      const pkg = await applicantService.getElectionPackage(applicantId);
      set({ currentElectionPackage: pkg, isLoadingElectionPackage: false });
    } catch (error) {
      set({
        error: handleStoreError(error, 'Failed to fetch election package'),
        isLoadingElectionPackage: false,
      });
    }
  },

  updateElectionPackage: async (applicantId: string, data: ElectionPackageUpdate) => {
    set({ error: null });
    try {
      const updated = await applicantService.updateElectionPackage(applicantId, data);
      set({ currentElectionPackage: updated });
    } catch (error) {
      set({
        error: handleStoreError(error, 'Failed to update election package'),
      });
      throw error;
    }
  },

  submitElectionPackage: async (applicantId: string) => {
    set({ error: null });
    try {
      const updated = await applicantService.updateElectionPackage(applicantId, {
        status: 'ready',
      });
      set({ currentElectionPackage: updated });
    } catch (error) {
      set({
        error: handleStoreError(error, 'Failed to submit election package'),
      });
      throw error;
    }
  },

  assignPackageToElection: async (applicantId: string, electionId: string) => {
    set({ error: null });
    try {
      const updated = await applicantService.assignToElection(applicantId, electionId);
      set({ currentElectionPackage: updated });
    } catch (error) {
      set({
        error: handleStoreError(error, 'Failed to assign package to election'),
      });
      throw error;
    }
  },

  // Interview actions
  fetchInterviews: async (applicantId: string) => {
    set({ isLoadingInterviews: true, error: null });
    try {
      const interviews = await interviewService.getInterviews(applicantId);
      set({ interviews, isLoadingInterviews: false });
    } catch (error) {
      set({
        error: handleStoreError(error, 'Failed to fetch interviews'),
        isLoadingInterviews: false,
      });
    }
  },

  createInterview: async (applicantId: string, data: InterviewCreate) => {
    set({ error: null });
    try {
      await interviewService.createInterview(applicantId, data);
      await get().fetchInterviews(applicantId);
    } catch (error) {
      set({ error: handleStoreError(error, 'Failed to create interview') });
      throw error;
    }
  },

  updateInterview: async (interviewId: string, data: InterviewUpdate) => {
    set({ error: null });
    try {
      await interviewService.updateInterview(interviewId, data);
      const currentApplicant = get().currentApplicant;
      if (currentApplicant) {
        await get().fetchInterviews(currentApplicant.id);
      }
    } catch (error) {
      set({ error: handleStoreError(error, 'Failed to update interview') });
      throw error;
    }
  },

  deleteInterview: async (interviewId: string) => {
    set({ error: null });
    try {
      await interviewService.deleteInterview(interviewId);
      const currentApplicant = get().currentApplicant;
      if (currentApplicant) {
        await get().fetchInterviews(currentApplicant.id);
      }
    } catch (error) {
      set({ error: handleStoreError(error, 'Failed to delete interview') });
      throw error;
    }
  },

  // Filter & view actions
  setFilters: (filters: ApplicantListFilters) => {
    const previous = get().filters;
    const next = { ...previous, ...filters };
    set({ filters: next, currentPage: 1 });
    void get().fetchApplicants(1);

    // The header and the tab badges count through `search` and `event_id`, so
    // either moving means the counts now describe a different population than
    // the list and have to be recounted. No other filter key enters the count
    // -- `status` narrows the open-pipeline view alone, and counting through
    // it would zero the archive badges the same response feeds -- so nothing
    // else here earns a round trip.
    const pipelineId = next.pipeline_id;
    if (pipelineId && (next.search !== previous.search || next.event_id !== previous.event_id)) {
      void get().fetchPipelineStats(pipelineId);
    }
  },

  clearFilters: () => {
    set({ filters: defaultFilters, currentPage: 1 });
    void get().fetchApplicants(1);
  },

  setViewMode: (mode: PipelineViewMode) => {
    if (get().viewMode === mode) return;
    // The two views want different page sizes, so switching has to refetch
    // — otherwise the board would render whatever page the table left
    // behind, which is the bug this pairing exists to prevent.
    set({ viewMode: mode, currentPage: 1 });
    writePreference(VIEW_MODE_STORAGE_KEY, mode);
    void get().fetchApplicants(1);
  },

  setActiveTab: (tab: PipelineTab) => {
    set({ activeTab: tab });
    if (tab === 'inactive') {
      void get().fetchInactiveApplicants(1);
    } else if (tab === 'withdrawn') {
      void get().fetchWithdrawnApplicants(1);
    } else if (tab === 'rejected') {
      void get().fetchRejectedApplicants(1);
    } else if (tab === 'converted') {
      void get().fetchConvertedApplicants(1);
    } else {
      void get().fetchApplicants(1);
    }
  },

  setDetailDrawerOpen: (open: boolean) => {
    set({ detailDrawerOpen: open });
    if (!open) {
      set({ currentApplicant: null });
    }
  },

  clearError: () => {
    set({ error: null });
  },
}));

export default useProspectiveMembersStore;
