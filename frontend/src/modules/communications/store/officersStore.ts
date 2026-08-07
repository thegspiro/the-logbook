/**
 * Officers Store
 *
 * Zustand store for the department office directory that supplies email
 * templates with their signature variables ({{president_name}}, ...).
 */

import { create } from 'zustand';
import { officersService } from '../../../services/api';
import { handleStoreError } from '../../../utils/storeHelpers';
import type { DepartmentOfficer, OfficerUpdate, OfficerVariable } from '../types';

interface OfficersState {
  offices: DepartmentOfficer[];
  variables: OfficerVariable[];

  isLoading: boolean;
  /** Office key currently being written, so only that row shows a spinner. */
  savingOfficeKey: string | null;
  error: string | null;
  hasLoaded: boolean;

  fetchOfficers: () => Promise<void>;
  setOfficer: (officeKey: string, data: OfficerUpdate) => Promise<void>;
  clearOfficer: (officeKey: string) => Promise<void>;
  clearError: () => void;
}

export const useOfficersStore = create<OfficersState>((set) => ({
  offices: [],
  variables: [],
  isLoading: false,
  savingOfficeKey: null,
  error: null,
  hasLoaded: false,

  fetchOfficers: async () => {
    set({ isLoading: true, error: null });
    try {
      const directory = await officersService.getOfficers();
      set({
        offices: directory.offices,
        variables: directory.variables,
        isLoading: false,
        hasLoaded: true,
      });
    } catch (err: unknown) {
      set({
        error: handleStoreError(err, 'Failed to load department officers'),
        isLoading: false,
      });
    }
  },

  setOfficer: async (officeKey, data) => {
    set({ savingOfficeKey: officeKey, error: null });
    try {
      const directory = await officersService.setOfficer(officeKey, data);
      set({
        offices: directory.offices,
        variables: directory.variables,
        savingOfficeKey: null,
      });
    } catch (err: unknown) {
      set({
        error: handleStoreError(err, 'Failed to save officer'),
        savingOfficeKey: null,
      });
      throw err;
    }
  },

  clearOfficer: async (officeKey) => {
    set({ savingOfficeKey: officeKey, error: null });
    try {
      const directory = await officersService.clearOfficer(officeKey);
      set({
        offices: directory.offices,
        variables: directory.variables,
        savingOfficeKey: null,
      });
    } catch (err: unknown) {
      set({
        error: handleStoreError(err, 'Failed to clear officer'),
        savingOfficeKey: null,
      });
      throw err;
    }
  },

  clearError: () => set({ error: null }),
}));
