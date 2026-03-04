/**
 * Grants & Fundraising Store
 *
 * Zustand store for managing grants and fundraising state.
 */

import { create } from 'zustand';
import { grantsService, fundraisingService } from '../services/api';
import type {
  GrantOpportunity,
  GrantApplication,
  GrantBudgetItem,
  GrantExpenditure,
  GrantComplianceTask,
  GrantNote,
  FundraisingCampaign,
  Donor,
  Donation,
  Pledge,
  GrantsDashboard,
} from '../types';
import { handleStoreError } from '../../../utils/storeHelpers';

interface GrantsState {
  // Data
  opportunities: GrantOpportunity[];
  applications: GrantApplication[];
  selectedApplication: GrantApplication | null;
  /** Alias for selectedApplication used by detail pages */
  currentApplication: GrantApplication | null;
  campaigns: FundraisingCampaign[];
  donors: Donor[];
  donations: Donation[];
  pledges: Pledge[];
  dashboard: GrantsDashboard | null;

  // Loading states
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchOpportunities: (params?: {
    category?: string;
    isActive?: boolean;
    search?: string;
  }) => Promise<void>;
  fetchApplications: (params?: {
    status?: string;
    priority?: string;
    assignedTo?: string;
    search?: string;
  }) => Promise<void>;
  fetchApplication: (id: string) => Promise<void>;
  fetchCampaigns: (params?: {
    status?: string;
    campaignType?: string;
    search?: string;
  }) => Promise<void>;
  fetchDonors: (params?: {
    donorType?: string;
    active?: boolean;
    search?: string;
  }) => Promise<void>;
  fetchDonations: (params?: {
    campaignId?: string;
    donorId?: string;
    startDate?: string;
    endDate?: string;
  }) => Promise<void>;
  fetchPledges: (params?: {
    campaignId?: string;
    donorId?: string;
    status?: string;
  }) => Promise<void>;
  fetchDashboard: () => Promise<void>;
  createApplication: (
    data: Partial<GrantApplication>,
  ) => Promise<GrantApplication>;
  updateApplication: (
    id: string,
    data: Partial<GrantApplication>,
  ) => Promise<GrantApplication>;
  createDonation: (data: Partial<Donation>) => Promise<Donation>;
  addBudgetItem: (
    applicationId: string,
    data: Partial<GrantBudgetItem>,
  ) => Promise<GrantBudgetItem>;
  addExpenditure: (
    applicationId: string,
    data: Partial<GrantExpenditure>,
  ) => Promise<GrantExpenditure>;
  addComplianceTask: (
    applicationId: string,
    data: Partial<GrantComplianceTask>,
  ) => Promise<GrantComplianceTask>;
  updateComplianceTask: (
    applicationId: string,
    taskId: string,
    data: Partial<GrantComplianceTask>,
  ) => Promise<GrantComplianceTask>;
  addGrantNote: (
    applicationId: string,
    data: Partial<GrantNote>,
  ) => Promise<GrantNote>;
  clearError: () => void;
}

export const useGrantsStore = create<GrantsState>((set) => ({
  // Initial state
  opportunities: [],
  applications: [],
  selectedApplication: null,
  currentApplication: null,
  campaigns: [],
  donors: [],
  donations: [],
  pledges: [],
  dashboard: null,

  isLoading: false,
  error: null,

  // Actions
  fetchOpportunities: async (params) => {
    set({ isLoading: true, error: null });

    try {
      const opportunities = await grantsService.listOpportunities(params);
      set({ opportunities, isLoading: false });
    } catch (error) {
      set({
        error: handleStoreError(error, 'Failed to fetch grant opportunities'),
        isLoading: false,
      });
    }
  },

  fetchApplications: async (params) => {
    set({ isLoading: true, error: null });

    try {
      const applications = await grantsService.listApplications(params);
      set({ applications, isLoading: false });
    } catch (error) {
      set({
        error: handleStoreError(error, 'Failed to fetch grant applications'),
        isLoading: false,
      });
    }
  },

  fetchApplication: async (id: string) => {
    set({ isLoading: true, error: null });

    try {
      const application = await grantsService.getApplication(id);
      set({
        selectedApplication: application,
        currentApplication: application,
        isLoading: false,
      });
    } catch (error) {
      set({
        error: handleStoreError(error, 'Failed to fetch grant application'),
        isLoading: false,
      });
    }
  },

  fetchCampaigns: async (params) => {
    set({ isLoading: true, error: null });

    try {
      const campaigns = await fundraisingService.listCampaigns(params);
      set({ campaigns, isLoading: false });
    } catch (error) {
      set({
        error: handleStoreError(
          error,
          'Failed to fetch fundraising campaigns',
        ),
        isLoading: false,
      });
    }
  },

  fetchDonors: async (params) => {
    set({ isLoading: true, error: null });

    try {
      const donors = await fundraisingService.listDonors(params);
      set({ donors, isLoading: false });
    } catch (error) {
      set({
        error: handleStoreError(error, 'Failed to fetch donors'),
        isLoading: false,
      });
    }
  },

  fetchDonations: async (params) => {
    set({ isLoading: true, error: null });

    try {
      const donations = await fundraisingService.listDonations(params);
      set({ donations, isLoading: false });
    } catch (error) {
      set({
        error: handleStoreError(error, 'Failed to fetch donations'),
        isLoading: false,
      });
    }
  },

  fetchPledges: async (params) => {
    set({ isLoading: true, error: null });

    try {
      const pledges = await fundraisingService.listPledges(params);
      set({ pledges, isLoading: false });
    } catch (error) {
      set({
        error: handleStoreError(error, 'Failed to fetch pledges'),
        isLoading: false,
      });
    }
  },

  fetchDashboard: async () => {
    set({ isLoading: true, error: null });

    try {
      const dashboard = await grantsService.getDashboard();
      set({ dashboard, isLoading: false });
    } catch (error) {
      set({
        error: handleStoreError(error, 'Failed to fetch grants dashboard'),
        isLoading: false,
      });
    }
  },

  createApplication: async (data) => {
    set({ isLoading: true, error: null });

    try {
      const application = await grantsService.createApplication(data);
      set((state) => ({
        applications: [...state.applications, application],
        isLoading: false,
      }));
      return application;
    } catch (error) {
      set({
        error: handleStoreError(error, 'Failed to create grant application'),
        isLoading: false,
      });
      throw error;
    }
  },

  updateApplication: async (id, data) => {
    set({ isLoading: true, error: null });

    try {
      const updated = await grantsService.updateApplication(id, data);
      set((state) => ({
        applications: state.applications.map((app) =>
          app.id === id ? updated : app,
        ),
        selectedApplication:
          state.selectedApplication?.id === id
            ? updated
            : state.selectedApplication,
        currentApplication:
          state.currentApplication?.id === id
            ? updated
            : state.currentApplication,
        isLoading: false,
      }));
      return updated;
    } catch (error) {
      set({
        error: handleStoreError(error, 'Failed to update grant application'),
        isLoading: false,
      });
      throw error;
    }
  },

  createDonation: async (data) => {
    set({ isLoading: true, error: null });

    try {
      const donation = await fundraisingService.createDonation(data);
      set((state) => ({
        donations: [...state.donations, donation],
        isLoading: false,
      }));
      return donation;
    } catch (error) {
      set({
        error: handleStoreError(error, 'Failed to record donation'),
        isLoading: false,
      });
      throw error;
    }
  },

  addBudgetItem: async (applicationId, data) => {
    try {
      const item = await grantsService.createBudgetItem(applicationId, data);
      // Re-fetch application to get updated budget items
      const application = await grantsService.getApplication(applicationId);
      set({ selectedApplication: application, currentApplication: application });
      return item;
    } catch (error) {
      set({
        error: handleStoreError(error, 'Failed to add budget item'),
      });
      throw error;
    }
  },

  addExpenditure: async (applicationId, data) => {
    try {
      const expenditure = await grantsService.createExpenditure(
        applicationId,
        data,
      );
      const application = await grantsService.getApplication(applicationId);
      set({ selectedApplication: application, currentApplication: application });
      return expenditure;
    } catch (error) {
      set({
        error: handleStoreError(error, 'Failed to record expenditure'),
      });
      throw error;
    }
  },

  addComplianceTask: async (applicationId, data) => {
    try {
      const task = await grantsService.createComplianceTask(
        applicationId,
        data,
      );
      const application = await grantsService.getApplication(applicationId);
      set({ selectedApplication: application, currentApplication: application });
      return task;
    } catch (error) {
      set({
        error: handleStoreError(error, 'Failed to add compliance task'),
      });
      throw error;
    }
  },

  updateComplianceTask: async (applicationId, taskId, data) => {
    try {
      const task = await grantsService.updateComplianceTask(
        applicationId,
        taskId,
        data,
      );
      const application = await grantsService.getApplication(applicationId);
      set({ selectedApplication: application, currentApplication: application });
      return task;
    } catch (error) {
      set({
        error: handleStoreError(error, 'Failed to update compliance task'),
      });
      throw error;
    }
  },

  addGrantNote: async (applicationId, data) => {
    try {
      const note = await grantsService.createNote(applicationId, data);
      const application = await grantsService.getApplication(applicationId);
      set({ selectedApplication: application, currentApplication: application });
      return note;
    } catch (error) {
      set({
        error: handleStoreError(error, 'Failed to add note'),
      });
      throw error;
    }
  },

  clearError: () => {
    set({ error: null });
  },
}));

export default useGrantsStore;
