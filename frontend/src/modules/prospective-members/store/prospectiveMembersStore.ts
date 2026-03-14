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
} from '../types';
import { pipelineService, applicantService, interviewService } from '../services/api';
import { handleStoreError } from '../../../utils/storeHelpers';
import { StageType } from '../../../constants/enums';

export type PipelineTab = 'active' | 'inactive' | 'withdrawn';

interface ProspectiveMembersState {
  // Pipeline data
  pipelines: PipelineListItem[];
  currentPipeline: Pipeline | null;
  pipelineStats: PipelineStats | null;

  // Applicant data
  applicants: ApplicantListItem[];
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
  isAdvancing: boolean;
  isRegressing: boolean;
  isRejecting: boolean;
  isHolding: boolean;
  isResuming: boolean;
  isWithdrawing: boolean;
  isReactivating: boolean;
  isPurging: boolean;
  error: string | null;

  // Pipeline actions
  fetchPipelines: () => Promise<void>;
  fetchPipeline: (id: string) => Promise<void>;
  fetchPipelineStats: (id: string) => Promise<void>;
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

  // Inactivity actions
  reactivateApplicant: (id: string, notes?: string) => Promise<void>;
  fetchInactiveApplicants: (page?: number) => Promise<void>;
  fetchWithdrawnApplicants: (page?: number) => Promise<void>;
  purgeInactiveApplicants: (applicantIds?: string[]) => Promise<void>;
  updateInactivitySettings: (config: InactivityConfig) => Promise<void>;

  // Election package actions
  fetchElectionPackage: (applicantId: string) => Promise<void>;
  updateElectionPackage: (applicantId: string, data: ElectionPackageUpdate) => Promise<void>;
  submitElectionPackage: (applicantId: string) => Promise<void>;

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

export const useProspectiveMembersStore = create<ProspectiveMembersState>(
  (set, get) => ({
    // Initial state
    pipelines: [],
    currentPipeline: null,
    pipelineStats: null,

    applicants: [],
    currentApplicant: null,

    totalApplicants: 0,
    currentPage: 1,
    pageSize: 25,
    totalPages: 0,

    filters: defaultFilters,

    viewMode: 'kanban',
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
    isAdvancing: false,
    isRegressing: false,
    isRejecting: false,
    isHolding: false,
    isResuming: false,
    isWithdrawing: false,
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
        set({ currentPipeline: pipeline, isLoadingPipeline: false });
      } catch (error) {
        set({
          error: handleStoreError(error, 'Failed to fetch pipeline'),
          isLoadingPipeline: false,
        });
      }
    },

    fetchPipelineStats: async (id: string) => {
      set({ isLoadingStats: true });
      try {
        const stats = await pipelineService.getPipelineStats(id);
        set({ pipelineStats: stats, isLoadingStats: false });
      } catch (error) {
        set({
          error: handleStoreError(error, 'Failed to fetch pipeline stats'),
          isLoadingStats: false,
        });
      }
    },

    setCurrentPipeline: (pipeline) => {
      set({ currentPipeline: pipeline });
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

      set({ isLoading: true, error: null });

      try {
        const response = await applicantService.getApplicants({
          filters: state.filters,
          page: pageToFetch,
          pageSize: state.pageSize,
        });

        set({
          applicants: response.items,
          totalApplicants: response.total,
          currentPage: response.page,
          totalPages: response.total_pages,
          isLoading: false,
        });
      } catch (error) {
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
        // Refresh applicant list
        await get().fetchApplicants();
        const currentApplicant = get().currentApplicant;
        if (currentApplicant?.id === id) {
          await get().fetchApplicant(id);
        }

        // Auto-create election package if applicant landed on an election_vote stage
        const pipeline = get().currentPipeline;
        if (pipeline && advanced) {
          const newStage = (pipeline.stages || []).find(
            (s) => s.id === advanced.current_stage_id
          );
          if (newStage?.stage_type === StageType.ELECTION_VOTE) {
            try {
              await applicantService.createElectionPackage(id, {
                applicant_id: id,
                pipeline_id: pipeline.id,
                stage_id: newStage.id,
              });
            } catch {
              // Package may already exist — not a blocking error
            }
          }
        }

        set({ isAdvancing: false });
      } catch (error) {
        set({
          error: handleStoreError(error, 'Failed to advance applicant'),
          isAdvancing: false,
        });
      }
    },

    regressApplicant: async (id: string, notes?: string) => {
      set({ isRegressing: true, error: null });
      try {
        await applicantService.regressStage(
          id,
          notes ? { notes } : undefined,
        );
        await get().fetchApplicants();
        const currentApplicant = get().currentApplicant;
        if (currentApplicant?.id === id) {
          await get().fetchApplicant(id);
        }
        set({ isRegressing: false });
      } catch (error) {
        set({
          error: handleStoreError(
            error,
            'Failed to move applicant back',
          ),
          isRegressing: false,
        });
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
      }
    },

    rejectApplicant: async (id: string, reason?: string) => {
      set({ isRejecting: true, error: null });
      try {
        await applicantService.rejectApplicant(id, reason);
        await get().fetchApplicants();
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
        await get().fetchApplicants();
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
        await get().fetchApplicants();
        await get().fetchWithdrawnApplicants();
        const state = get();
        if (state.currentPipeline) {
          await get().fetchPipelineStats(state.currentPipeline.id);
        }
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
        // Refresh both active and inactive lists
        await get().fetchApplicants();
        await get().fetchInactiveApplicants();
        const state = get();
        if (state.currentPipeline) {
          await get().fetchPipelineStats(state.currentPipeline.id);
        }
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
      }
    },

    fetchInactiveApplicants: async (page?: number) => {
      const state = get();
      const pageToFetch = page ?? state.inactiveCurrentPage;

      set({ isLoadingInactive: true, error: null });
      try {
        const response = await applicantService.getInactiveApplicants({
          pipeline_id: state.filters.pipeline_id,
          search: state.filters.search,
          page: pageToFetch,
          pageSize: state.pageSize,
        });

        set({
          inactiveApplicants: response.items,
          inactiveTotalApplicants: response.total,
          inactiveCurrentPage: response.page,
          inactiveTotalPages: response.total_pages,
          isLoadingInactive: false,
        });
      } catch (error) {
        set({
          error: handleStoreError(error, 'Failed to fetch inactive applicants'),
          isLoadingInactive: false,
        });
      }
    },

    fetchWithdrawnApplicants: async (page?: number) => {
      const state = get();
      const pageToFetch = page ?? state.withdrawnCurrentPage;

      set({ isLoadingWithdrawn: true, error: null });
      try {
        const response = await applicantService.getWithdrawnApplicants({
          pipeline_id: state.filters.pipeline_id,
          search: state.filters.search,
          page: pageToFetch,
          pageSize: state.pageSize,
        });

        set({
          withdrawnApplicants: response.items,
          withdrawnTotalApplicants: response.total,
          withdrawnCurrentPage: response.page,
          withdrawnTotalPages: response.total_pages,
          isLoadingWithdrawn: false,
        });
      } catch (error) {
        set({
          error: handleStoreError(error, 'Failed to fetch withdrawn applicants'),
          isLoadingWithdrawn: false,
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
        const updated = await pipelineService.updateInactivitySettings(
          state.currentPipeline.id,
          config
        );
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
      set({ filters: { ...get().filters, ...filters }, currentPage: 1 });
      void get().fetchApplicants(1);
    },

    clearFilters: () => {
      set({ filters: defaultFilters, currentPage: 1 });
      void get().fetchApplicants(1);
    },

    setViewMode: (mode: PipelineViewMode) => {
      set({ viewMode: mode });
    },

    setActiveTab: (tab: PipelineTab) => {
      set({ activeTab: tab });
      if (tab === 'inactive') {
        void get().fetchInactiveApplicants(1);
      } else if (tab === 'withdrawn') {
        void get().fetchWithdrawnApplicants(1);
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
  })
);

export default useProspectiveMembersStore;
