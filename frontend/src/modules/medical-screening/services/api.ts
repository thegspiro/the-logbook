/**
 * Medical Screening API Service
 *
 * API client for the medical screening module.
 */

import { createApiClient } from '../../../utils/createApiClient';
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

const api = createApiClient();
const BASE = '/medical-screening';

export const medicalScreeningService = {
  // --- Requirements ---

  async listRequirements(params?: {
    is_active?: boolean;
    screening_type?: string;
  }): Promise<ScreeningRequirement[]> {
    const { data } = await api.get<ScreeningRequirement[]>(
      `${BASE}/requirements`,
      { params }
    );
    return data;
  },

  async getRequirement(id: string): Promise<ScreeningRequirement> {
    const { data } = await api.get<ScreeningRequirement>(
      `${BASE}/requirements/${id}`
    );
    return data;
  },

  async createRequirement(
    payload: ScreeningRequirementCreate
  ): Promise<ScreeningRequirement> {
    const { data } = await api.post<ScreeningRequirement>(
      `${BASE}/requirements`,
      payload
    );
    return data;
  },

  async updateRequirement(
    id: string,
    payload: ScreeningRequirementUpdate
  ): Promise<ScreeningRequirement> {
    const { data } = await api.put<ScreeningRequirement>(
      `${BASE}/requirements/${id}`,
      payload
    );
    return data;
  },

  async deleteRequirement(id: string): Promise<void> {
    await api.delete(`${BASE}/requirements/${id}`);
  },

  // --- Records ---

  async listRecords(params?: {
    user_id?: string;
    prospect_id?: string;
    screening_type?: string;
    status?: string;
  }): Promise<ScreeningRecord[]> {
    const { data } = await api.get<ScreeningRecord[]>(`${BASE}/records`, {
      params,
    });
    return data;
  },

  async getRecord(id: string): Promise<ScreeningRecord> {
    const { data } = await api.get<ScreeningRecord>(`${BASE}/records/${id}`);
    return data;
  },

  async createRecord(payload: ScreeningRecordCreate): Promise<ScreeningRecord> {
    const { data } = await api.post<ScreeningRecord>(
      `${BASE}/records`,
      payload
    );
    return data;
  },

  async updateRecord(
    id: string,
    payload: ScreeningRecordUpdate
  ): Promise<ScreeningRecord> {
    const { data } = await api.put<ScreeningRecord>(
      `${BASE}/records/${id}`,
      payload
    );
    return data;
  },

  async deleteRecord(id: string): Promise<void> {
    await api.delete(`${BASE}/records/${id}`);
  },

  // --- Compliance ---

  async getUserCompliance(userId: string): Promise<ComplianceSummary> {
    const { data } = await api.get<ComplianceSummary>(
      `${BASE}/compliance/${userId}`
    );
    return data;
  },

  async getProspectCompliance(
    prospectId: string
  ): Promise<ComplianceSummary> {
    const { data } = await api.get<ComplianceSummary>(
      `${BASE}/compliance/prospect/${prospectId}`
    );
    return data;
  },

  async getExpiringScreenings(
    days?: number
  ): Promise<ExpiringScreening[]> {
    const { data } = await api.get<ExpiringScreening[]>(
      `${BASE}/expiring`,
      { params: days ? { days } : undefined }
    );
    return data;
  },
};
