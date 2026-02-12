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
  Applicant,
  ApplicantListItem,
  ApplicantListFilters,
  PipelineViewMode,
} from '../types';
import { pipelineService, applicantService } from '../services/api';

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
  detailDrawerOpen: boolean;

  // Loading states
  isLoading: boolean;
  isLoadingPipelines: boolean;
  isLoadingPipeline: boolean;
  isLoadingApplicant: boolean;
  isLoadingStats: boolean;
  isAdvancing: boolean;
  error: string | null;

  // Pipeline actions
  fetchPipelines: () => Promise<void>;
  fetchPipeline: (id: string) => Promise<void>;
  fetchPipelineStats: (id: string) => Promise<void>;
  setCurrentPipeline: (pipeline: Pipeline | null) => void;

  // Applicant actions
  fetchApplicants: (page?: number) => Promise<void>;
  fetchApplicant: (id: string) => Promise<void>;
  setCurrentApplicant: (applicant: Applicant | null) => void;
  advanceApplicant: (id: string, notes?: string) => Promise<void>;
  rejectApplicant: (id: string, reason?: string) => Promise<void>;
  holdApplicant: (id: string, reason?: string) => Promise<void>;
  resumeApplicant: (id: string) => Promise<void>;

  // Filter & view actions
  setFilters: (filters: ApplicantListFilters) => void;
  clearFilters: () => void;
  setViewMode: (mode: PipelineViewMode) => void;
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
    detailDrawerOpen: false,

    isLoading: false,
    isLoadingPipelines: false,
    isLoadingPipeline: false,
    isLoadingApplicant: false,
    isLoadingStats: false,
    isAdvancing: false,
    error: null,

    // Pipeline actions
    fetchPipelines: async () => {
      set({ isLoadingPipelines: true, error: null });
      try {
        const pipelines = await pipelineService.getPipelines();
        set({ pipelines, isLoadingPipelines: false });
      } catch (error) {
        set({
          error:
            error instanceof Error
              ? error.message
              : 'Failed to fetch pipelines',
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
          error:
            error instanceof Error
              ? error.message
              : 'Failed to fetch pipeline',
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
          error:
            error instanceof Error
              ? error.message
              : 'Failed to fetch pipeline stats',
          isLoadingStats: false,
        });
      }
    },

    setCurrentPipeline: (pipeline) => {
      set({ currentPipeline: pipeline });
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
          error:
            error instanceof Error
              ? error.message
              : 'Failed to fetch applicants',
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
          error:
            error instanceof Error
              ? error.message
              : 'Failed to fetch applicant',
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
        await applicantService.advanceStage(id, notes ? { notes } : undefined);
        // Refresh both the applicant and the list
        await get().fetchApplicants();
        const currentApplicant = get().currentApplicant;
        if (currentApplicant?.id === id) {
          await get().fetchApplicant(id);
        }
        set({ isAdvancing: false });
      } catch (error) {
        set({
          error:
            error instanceof Error
              ? error.message
              : 'Failed to advance applicant',
          isAdvancing: false,
        });
      }
    },

    rejectApplicant: async (id: string, reason?: string) => {
      set({ isAdvancing: true, error: null });
      try {
        await applicantService.rejectApplicant(id, reason);
        await get().fetchApplicants();
        const currentApplicant = get().currentApplicant;
        if (currentApplicant?.id === id) {
          await get().fetchApplicant(id);
        }
        set({ isAdvancing: false });
      } catch (error) {
        set({
          error:
            error instanceof Error
              ? error.message
              : 'Failed to reject applicant',
          isAdvancing: false,
        });
      }
    },

    holdApplicant: async (id: string, reason?: string) => {
      set({ isAdvancing: true, error: null });
      try {
        await applicantService.putOnHold(id, reason);
        await get().fetchApplicants();
        const currentApplicant = get().currentApplicant;
        if (currentApplicant?.id === id) {
          await get().fetchApplicant(id);
        }
        set({ isAdvancing: false });
      } catch (error) {
        set({
          error:
            error instanceof Error
              ? error.message
              : 'Failed to put applicant on hold',
          isAdvancing: false,
        });
      }
    },

    resumeApplicant: async (id: string) => {
      set({ isAdvancing: true, error: null });
      try {
        await applicantService.resumeApplicant(id);
        await get().fetchApplicants();
        const currentApplicant = get().currentApplicant;
        if (currentApplicant?.id === id) {
          await get().fetchApplicant(id);
        }
        set({ isAdvancing: false });
      } catch (error) {
        set({
          error:
            error instanceof Error
              ? error.message
              : 'Failed to resume applicant',
          isAdvancing: false,
        });
      }
    },

    // Filter & view actions
    setFilters: (filters: ApplicantListFilters) => {
      set({ filters: { ...get().filters, ...filters }, currentPage: 1 });
      get().fetchApplicants(1);
    },

    clearFilters: () => {
      set({ filters: defaultFilters, currentPage: 1 });
      get().fetchApplicants(1);
    },

    setViewMode: (mode: PipelineViewMode) => {
      set({ viewMode: mode });
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
