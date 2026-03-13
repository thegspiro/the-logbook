/**
 * Medical Screening Zustand Store
 */

import { create } from 'zustand';
import { medicalScreeningService } from '../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';
import type {
  ScreeningRequirement,
  ScreeningRequirementCreate,
  ScreeningRequirementUpdate,
  ScreeningRecord,
  ScreeningRecordCreate,
  ScreeningRecordUpdate,
  ComplianceSummary,
  ExpiringScreening,
} from '../types';

interface MedicalScreeningState {
  requirements: ScreeningRequirement[];
  records: ScreeningRecord[];
  compliance: ComplianceSummary | null;
  expiringScreenings: ExpiringScreening[];
  isLoading: boolean;
  error: string | null;

  // Requirements
  fetchRequirements: (params?: {
    is_active?: boolean;
    screening_type?: string;
  }) => Promise<void>;
  createRequirement: (data: ScreeningRequirementCreate) => Promise<ScreeningRequirement>;
  updateRequirement: (id: string, data: ScreeningRequirementUpdate) => Promise<ScreeningRequirement>;
  deleteRequirement: (id: string) => Promise<void>;

  // Records
  fetchRecords: (params?: {
    user_id?: string;
    prospect_id?: string;
    screening_type?: string;
    status?: string;
  }) => Promise<void>;
  createRecord: (data: ScreeningRecordCreate) => Promise<ScreeningRecord>;
  updateRecord: (id: string, data: ScreeningRecordUpdate) => Promise<ScreeningRecord>;
  deleteRecord: (id: string) => Promise<void>;

  // Compliance
  fetchUserCompliance: (userId: string) => Promise<void>;
  fetchProspectCompliance: (prospectId: string) => Promise<void>;
  fetchExpiringScreenings: (days?: number) => Promise<void>;
}

export const useMedicalScreeningStore = create<MedicalScreeningState>((set) => ({
  requirements: [],
  records: [],
  compliance: null,
  expiringScreenings: [],
  isLoading: false,
  error: null,

  fetchRequirements: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const requirements = await medicalScreeningService.listRequirements(params);
      set({ requirements, isLoading: false });
    } catch (err: unknown) {
      set({ isLoading: false, error: getErrorMessage(err, 'Failed to load requirements') });
    }
  },

  createRequirement: async (data) => {
    const requirement = await medicalScreeningService.createRequirement(data);
    set((state) => ({ requirements: [...state.requirements, requirement] }));
    return requirement;
  },

  updateRequirement: async (id, data) => {
    const requirement = await medicalScreeningService.updateRequirement(id, data);
    set((state) => ({
      requirements: state.requirements.map((r) => (r.id === id ? requirement : r)),
    }));
    return requirement;
  },

  deleteRequirement: async (id) => {
    await medicalScreeningService.deleteRequirement(id);
    set((state) => ({
      requirements: state.requirements.filter((r) => r.id !== id),
    }));
  },

  fetchRecords: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const records = await medicalScreeningService.listRecords(params);
      set({ records, isLoading: false });
    } catch (err: unknown) {
      set({ isLoading: false, error: getErrorMessage(err, 'Failed to load records') });
    }
  },

  createRecord: async (data) => {
    const record = await medicalScreeningService.createRecord(data);
    set((state) => ({ records: [...state.records, record] }));
    return record;
  },

  updateRecord: async (id, data) => {
    const record = await medicalScreeningService.updateRecord(id, data);
    set((state) => ({
      records: state.records.map((r) => (r.id === id ? record : r)),
    }));
    return record;
  },

  deleteRecord: async (id) => {
    await medicalScreeningService.deleteRecord(id);
    set((state) => ({
      records: state.records.filter((r) => r.id !== id),
    }));
  },

  fetchUserCompliance: async (userId) => {
    set({ isLoading: true, error: null });
    try {
      const compliance = await medicalScreeningService.getUserCompliance(userId);
      set({ compliance, isLoading: false });
    } catch (err: unknown) {
      set({ isLoading: false, error: getErrorMessage(err, 'Failed to load compliance') });
    }
  },

  fetchProspectCompliance: async (prospectId) => {
    set({ isLoading: true, error: null });
    try {
      const compliance = await medicalScreeningService.getProspectCompliance(prospectId);
      set({ compliance, isLoading: false });
    } catch (err: unknown) {
      set({ isLoading: false, error: getErrorMessage(err, 'Failed to load compliance') });
    }
  },

  fetchExpiringScreenings: async (days) => {
    set({ isLoading: true, error: null });
    try {
      const expiringScreenings = await medicalScreeningService.getExpiringScreenings(days);
      set({ expiringScreenings, isLoading: false });
    } catch (err: unknown) {
      set({
        isLoading: false,
        error: getErrorMessage(err, 'Failed to load expiring screenings'),
      });
    }
  },
}));
