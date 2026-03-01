/**
 * formsServices — extracted from services/api.ts
 */

import axios from 'axios';
import api from './apiClient';
import type {
  FormsSummary, FormsListResponse, FormDetailDef, FormCreate, FormUpdate,
  FormFieldCreate, FormField, FormSubmission, SubmissionsListResponse,
  FormIntegrationCreate, FormIntegration, MemberLookupResponse,
  PublicFormDef, PublicFormSubmissionResponse,
} from './inventoryService';

export const formsService = {
  async getSummary(): Promise<FormsSummary> {
    const response = await api.get<FormsSummary>('/forms/summary');
    return response.data;
  },

  async getForms(params?: {
    status?: string;
    category?: string;
    search?: string;
    is_template?: boolean;
    skip?: number;
    limit?: number;
  }): Promise<FormsListResponse> {
    const response = await api.get<FormsListResponse>('/forms', { params });
    return response.data;
  },

  async getForm(formId: string): Promise<FormDetailDef> {
    const response = await api.get<FormDetailDef>(`/forms/${formId}`);
    return response.data;
  },

  async createForm(data: FormCreate): Promise<FormDetailDef> {
    const response = await api.post<FormDetailDef>('/forms', data);
    return response.data;
  },

  async updateForm(formId: string, data: FormUpdate): Promise<FormDetailDef> {
    const response = await api.patch<FormDetailDef>(`/forms/${formId}`, data);
    return response.data;
  },

  async deleteForm(formId: string): Promise<void> {
    await api.delete(`/forms/${formId}`);
  },

  async publishForm(formId: string): Promise<FormDetailDef> {
    const response = await api.post<FormDetailDef>(`/forms/${formId}/publish`);
    return response.data;
  },

  async archiveForm(formId: string): Promise<FormDetailDef> {
    const response = await api.post<FormDetailDef>(`/forms/${formId}/archive`);
    return response.data;
  },

  async addField(formId: string, data: FormFieldCreate): Promise<FormField> {
    const response = await api.post<FormField>(`/forms/${formId}/fields`, data);
    return response.data;
  },

  async updateField(formId: string, fieldId: string, data: Partial<FormFieldCreate>): Promise<FormField> {
    const response = await api.patch<FormField>(`/forms/${formId}/fields/${fieldId}`, data);
    return response.data;
  },

  async deleteField(formId: string, fieldId: string): Promise<void> {
    await api.delete(`/forms/${formId}/fields/${fieldId}`);
  },

  async submitForm(formId: string, data: Record<string, unknown>): Promise<FormSubmission> {
    const response = await api.post<FormSubmission>(`/forms/${formId}/submit`, { data });
    return response.data;
  },

  async getSubmissions(formId: string, params?: {
    skip?: number;
    limit?: number;
  }): Promise<SubmissionsListResponse> {
    const response = await api.get<SubmissionsListResponse>(`/forms/${formId}/submissions`, { params });
    return response.data;
  },

  async deleteSubmission(formId: string, submissionId: string): Promise<void> {
    await api.delete(`/forms/${formId}/submissions/${submissionId}`);
  },

  // Integration methods
  async addIntegration(formId: string, data: FormIntegrationCreate): Promise<FormIntegration> {
    const response = await api.post<FormIntegration>(`/forms/${formId}/integrations`, data);
    return response.data;
  },

  async updateIntegration(formId: string, integrationId: string, data: Partial<FormIntegrationCreate>): Promise<FormIntegration> {
    const response = await api.patch<FormIntegration>(`/forms/${formId}/integrations/${integrationId}`, data);
    return response.data;
  },

  async deleteIntegration(formId: string, integrationId: string): Promise<void> {
    await api.delete(`/forms/${formId}/integrations/${integrationId}`);
  },

  // Member lookup
  async memberLookup(query: string, limit?: number): Promise<MemberLookupResponse> {
    const response = await api.get<MemberLookupResponse>('/forms/member-lookup', {
      params: { q: query, limit: limit || 20 },
    });
    return response.data;
  },

  /**
   * Reorder form fields
   */
  async reorderFields(formId: string, fieldIds: string[]): Promise<void> {
    await api.post(`/forms/${formId}/fields/reorder`, fieldIds);
  },
};

// Public forms service (no auth required)

export const publicFormsService = {
  async getForm(slug: string): Promise<PublicFormDef> {
    const response = await axios.get<PublicFormDef>(
      `${import.meta.env.VITE_API_URL || '/api'}/public/v1/forms/${slug}`
    );
    return response.data;
  },

  async submitForm(slug: string, data: Record<string, unknown>, submitterName?: string, submitterEmail?: string, honeypot?: string): Promise<PublicFormSubmissionResponse> {
    const payload: Record<string, unknown> = { data, submitter_name: submitterName, submitter_email: submitterEmail };
    // Honeypot field - only sent if bot filled it in (real users never will)
    if (honeypot) {
      payload.website = honeypot;
    }
    const response = await axios.post<PublicFormSubmissionResponse>(
      `${import.meta.env.VITE_API_URL || '/api'}/public/v1/forms/${slug}/submit`,
      payload
    );
    return response.data;
  },
};

// ============================================
// Documents Service
// ============================================

export interface DocumentFolder {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  color: string;
  icon: string;
  parent_id?: string;
  document_count: number;
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface DocumentRecord {
  id: string;
  organization_id: string;
  folder_id?: string;
  name: string;
  description?: string;
  file_name: string;
  file_size: number;
  file_type?: string;
  status: string;
  version: number;
  tags?: string;
  created_at: string;
  updated_at: string;
  uploaded_by?: string;
  uploader_name?: string;
  folder_name?: string;
}

export interface DocumentsSummary {
  total_documents: number;
  total_folders: number;
  total_size_bytes: number;
  documents_this_month: number;
}
