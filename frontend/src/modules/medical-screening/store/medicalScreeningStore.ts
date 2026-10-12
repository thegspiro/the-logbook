/**
 * Medical Screening Zustand Store
 */

import { create } from 'zustand';
import { medicalScreeningService } from '../services/api';
import {
  createFetchAction,
  createCreateAction,
  createUpdateAction,
  createDeleteAction,
  handleStoreError,
} from '../../../utils/storeHelpers';
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
  expiringLoading: boolean;
  complianceLoading: boolean;
  error: string | null;

  // Requirements
  fetchRequirements: (params?: { is_active?: boolean; screening_type?: string }) => Promise<void>;
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
  clearCompliance: () => void;
  fetchExpiringScreenings: (days?: number) => Promise<void>;
}

// One summary is on screen at a time. An officer who opens one subject and
// then another has two reads in flight; whichever lands last would otherwise
// win the shared `compliance` field (and clear the loading flag) even when it
// is the earlier pick, leaving the selected subject's panel blank.
let latestComplianceRequest = 0;

const fetchComplianceFor =
  (set: (partial: Partial<MedicalScreeningState>) => void, read: (id: string) => Promise<ComplianceSummary>) =>
  async (id: string): Promise<void> => {
    const request = ++latestComplianceRequest;
    set({ complianceLoading: true, error: null });
    try {
      const compliance = await read(id);
      if (request === latestComplianceRequest) set({ compliance, complianceLoading: false });
    } catch (err: unknown) {
      if (request === latestComplianceRequest) {
        set({ complianceLoading: false, error: handleStoreError(err, 'Failed to load compliance') });
      }
    }
  };

export const useMedicalScreeningStore = create<MedicalScreeningState>((set) => ({
  requirements: [],
  records: [],
  compliance: null,
  expiringScreenings: [],
  isLoading: false,
  expiringLoading: false,
  complianceLoading: false,
  error: null,

  // Requirements — fetch / CRUD
  fetchRequirements: createFetchAction(
    set,
    (params?: { is_active?: boolean; screening_type?: string }) => medicalScreeningService.listRequirements(params),
    'requirements',
    'Failed to load requirements'
  ),

  createRequirement: createCreateAction<MedicalScreeningState, ScreeningRequirementCreate, ScreeningRequirement>(
    set,
    (data) => medicalScreeningService.createRequirement(data),
    'requirements'
  ),

  updateRequirement: createUpdateAction<MedicalScreeningState, ScreeningRequirementUpdate, ScreeningRequirement>(
    set,
    (id, data) => medicalScreeningService.updateRequirement(id, data),
    'requirements'
  ),

  deleteRequirement: createDeleteAction<MedicalScreeningState, ScreeningRequirement>(
    set,
    (id) => medicalScreeningService.deleteRequirement(id),
    'requirements'
  ),

  // Records — fetch / CRUD
  fetchRecords: createFetchAction(
    set,
    (params?: { user_id?: string; prospect_id?: string; screening_type?: string; status?: string }) =>
      medicalScreeningService.listRecords(params),
    'records',
    'Failed to load records'
  ),

  createRecord: createCreateAction<MedicalScreeningState, ScreeningRecordCreate, ScreeningRecord>(
    set,
    (data) => medicalScreeningService.createRecord(data),
    'records'
  ),

  updateRecord: createUpdateAction<MedicalScreeningState, ScreeningRecordUpdate, ScreeningRecord>(
    set,
    (id, data) => medicalScreeningService.updateRecord(id, data),
    'records'
  ),

  deleteRecord: createDeleteAction<MedicalScreeningState, ScreeningRecord>(
    set,
    (id) => medicalScreeningService.deleteRecord(id),
    'records'
  ),

  // Compliance. Own loading flag for the same reason as the expiring list
  // below: the per-member panel lives inside the compliance tab, which the page
  // unmounts while the shared isLoading is raised.
  fetchUserCompliance: fetchComplianceFor(set, (userId) => medicalScreeningService.getUserCompliance(userId)),

  fetchProspectCompliance: fetchComplianceFor(set, (prospectId) =>
    medicalScreeningService.getProspectCompliance(prospectId)
  ),

  // Retires any read still in flight, so it cannot repopulate a closed panel.
  clearCompliance: () => {
    latestComplianceRequest += 1;
    set({ compliance: null, complianceLoading: false });
  },

  // Its own loading flag, not the shared isLoading. MedicalScreeningPage only
  // renders the compliance panel while isLoading is false, so a fetch that
  // raised the shared flag unmounted the very component that started it — and
  // remounting re-ran the effect, so the tab span forever and never showed its
  // content.
  fetchExpiringScreenings: createFetchAction(
    set,
    (days?: number) => medicalScreeningService.getExpiringScreenings(days),
    'expiringScreenings',
    'Failed to load expiring screenings',
    'expiringLoading'
  ),
}));
