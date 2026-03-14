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

  // Requirements — fetch / CRUD
  fetchRequirements: createFetchAction(
    set,
    (params?: { is_active?: boolean; screening_type?: string }) =>
      medicalScreeningService.listRequirements(params),
    'requirements',
    'Failed to load requirements',
  ),

  createRequirement: createCreateAction<
    MedicalScreeningState,
    ScreeningRequirementCreate,
    ScreeningRequirement
  >(set, (data) => medicalScreeningService.createRequirement(data), 'requirements'),

  updateRequirement: createUpdateAction<
    MedicalScreeningState,
    ScreeningRequirementUpdate,
    ScreeningRequirement
  >(set, (id, data) => medicalScreeningService.updateRequirement(id, data), 'requirements'),

  deleteRequirement: createDeleteAction<MedicalScreeningState, ScreeningRequirement>(
    set,
    (id) => medicalScreeningService.deleteRequirement(id),
    'requirements',
  ),

  // Records — fetch / CRUD
  fetchRecords: createFetchAction(
    set,
    (params?: {
      user_id?: string;
      prospect_id?: string;
      screening_type?: string;
      status?: string;
    }) => medicalScreeningService.listRecords(params),
    'records',
    'Failed to load records',
  ),

  createRecord: createCreateAction<
    MedicalScreeningState,
    ScreeningRecordCreate,
    ScreeningRecord
  >(set, (data) => medicalScreeningService.createRecord(data), 'records'),

  updateRecord: createUpdateAction<
    MedicalScreeningState,
    ScreeningRecordUpdate,
    ScreeningRecord
  >(set, (id, data) => medicalScreeningService.updateRecord(id, data), 'records'),

  deleteRecord: createDeleteAction<MedicalScreeningState, ScreeningRecord>(
    set,
    (id) => medicalScreeningService.deleteRecord(id),
    'records',
  ),

  // Compliance
  fetchUserCompliance: createFetchAction(
    set,
    (userId: string) => medicalScreeningService.getUserCompliance(userId),
    'compliance',
    'Failed to load compliance',
  ),

  fetchProspectCompliance: createFetchAction(
    set,
    (prospectId: string) => medicalScreeningService.getProspectCompliance(prospectId),
    'compliance',
    'Failed to load compliance',
  ),

  fetchExpiringScreenings: createFetchAction(
    set,
    (days?: number) => medicalScreeningService.getExpiringScreenings(days),
    'expiringScreenings',
    'Failed to load expiring screenings',
  ),
}));
