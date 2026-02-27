/**
 * Apparatus Store
 *
 * Zustand store for managing apparatus state.
 */

import { create } from 'zustand';
import type {
  Apparatus,
  ApparatusListItem,
  ApparatusType,
  ApparatusStatus,
  ApparatusFleetSummary,
  ApparatusListFilters,
  ApparatusMaintenanceDue,
} from '../types';
import {
  apparatusService,
  apparatusTypeService,
  apparatusStatusService,
  apparatusMaintenanceService,
} from '../services/api';

interface ApparatusState {
  // Data
  apparatusList: ApparatusListItem[];
  currentApparatus: Apparatus | null;
  types: ApparatusType[];
  statuses: ApparatusStatus[];
  fleetSummary: ApparatusFleetSummary | null;
  maintenanceDue: ApparatusMaintenanceDue[];

  // Pagination
  totalApparatus: number;
  currentPage: number;
  pageSize: number;
  totalPages: number;

  // Filters
  filters: ApparatusListFilters;

  // Loading states
  isLoading: boolean;
  isLoadingTypes: boolean;
  isLoadingStatuses: boolean;
  isLoadingSummary: boolean;
  error: string | null;

  // Actions
  fetchApparatusList: (page?: number) => Promise<void>;
  fetchApparatus: (id: string) => Promise<void>;
  fetchTypes: () => Promise<void>;
  fetchStatuses: () => Promise<void>;
  fetchFleetSummary: () => Promise<void>;
  fetchMaintenanceDue: (daysAhead?: number) => Promise<void>;
  setFilters: (filters: ApparatusListFilters) => void;
  clearFilters: () => void;
  setCurrentApparatus: (apparatus: Apparatus | null) => void;
  clearError: () => void;
}

const defaultFilters: ApparatusListFilters = {
  isArchived: false,
};

export const useApparatusStore = create<ApparatusState>((set, get) => ({
  // Initial state
  apparatusList: [],
  currentApparatus: null,
  types: [],
  statuses: [],
  fleetSummary: null,
  maintenanceDue: [],

  totalApparatus: 0,
  currentPage: 1,
  pageSize: 25,
  totalPages: 0,

  filters: defaultFilters,

  isLoading: false,
  isLoadingTypes: false,
  isLoadingStatuses: false,
  isLoadingSummary: false,
  error: null,

  // Actions
  fetchApparatusList: async (page?: number) => {
    const state = get();
    const pageToFetch = page ?? state.currentPage;

    set({ isLoading: true, error: null });

    try {
      const response = await apparatusService.getApparatusList({
        filters: state.filters,
        page: pageToFetch,
        pageSize: state.pageSize,
      });

      set({
        apparatusList: response.items,
        totalApparatus: response.total,
        currentPage: response.page,
        totalPages: response.totalPages,
        isLoading: false,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch apparatus list',
        isLoading: false,
      });
    }
  },

  fetchApparatus: async (id: string) => {
    set({ isLoading: true, error: null });

    try {
      const apparatus = await apparatusService.getApparatus(id);
      set({ currentApparatus: apparatus, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch apparatus',
        isLoading: false,
      });
    }
  },

  fetchTypes: async () => {
    set({ isLoadingTypes: true });

    try {
      const types = await apparatusTypeService.getTypes({ isActive: true });
      set({ types, isLoadingTypes: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch apparatus types',
        isLoadingTypes: false,
      });
    }
  },

  fetchStatuses: async () => {
    set({ isLoadingStatuses: true });

    try {
      const statuses = await apparatusStatusService.getStatuses({ isActive: true });
      set({ statuses, isLoadingStatuses: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch apparatus statuses',
        isLoadingStatuses: false,
      });
    }
  },

  fetchFleetSummary: async () => {
    set({ isLoadingSummary: true });

    try {
      const summary = await apparatusService.getFleetSummary();
      set({ fleetSummary: summary, isLoadingSummary: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch fleet summary',
        isLoadingSummary: false,
      });
    }
  },

  fetchMaintenanceDue: async (daysAhead = 30) => {
    try {
      const maintenanceDue = await apparatusMaintenanceService.getMaintenanceDue({ daysAhead });
      set({ maintenanceDue });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch maintenance due',
      });
    }
  },

  setFilters: (filters: ApparatusListFilters) => {
    set({ filters: { ...get().filters, ...filters }, currentPage: 1 });
    void get().fetchApparatusList(1);
  },

  clearFilters: () => {
    set({ filters: defaultFilters, currentPage: 1 });
    void get().fetchApparatusList(1);
  },

  setCurrentApparatus: (apparatus: Apparatus | null) => {
    set({ currentApparatus: apparatus });
  },

  clearError: () => {
    set({ error: null });
  },
}));

export default useApparatusStore;
