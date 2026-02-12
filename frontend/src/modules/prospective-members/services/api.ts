/**
 * Prospective Members API Service
 *
 * API client for the prospective member pipeline module.
 */

import axios from 'axios';
import type {
  Pipeline,
  PipelineCreate,
  PipelineUpdate,
  PipelineListItem,
  PipelineStage,
  PipelineStageCreate,
  PipelineStageUpdate,
  PipelineStats,
  Applicant,
  ApplicantCreate,
  ApplicantUpdate,
  ApplicantListFilters,
  PaginatedApplicantList,
  AdvanceStageRequest,
  ConvertApplicantRequest,
  ConvertApplicantResponse,
  ApplicantDocument,
} from '../types';

const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
});

// Attach auth token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 responses
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      const refreshToken = localStorage.getItem('refresh_token');
      if (refreshToken && !error.config._retry) {
        error.config._retry = true;
        try {
          const res = await axios.post('/api/v1/auth/refresh', {
            refresh_token: refreshToken,
          });
          const { access_token } = res.data;
          localStorage.setItem('access_token', access_token);
          error.config.headers.Authorization = `Bearer ${access_token}`;
          return api(error.config);
        } catch {
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
          window.location.href = '/login';
        }
      }
    }
    return Promise.reject(error);
  }
);

// =============================================================================
// Pipeline Service
// =============================================================================

export const pipelineService = {
  async getPipelines(): Promise<PipelineListItem[]> {
    const response = await api.get<PipelineListItem[]>('/prospective-members/pipelines');
    return response.data;
  },

  async getPipeline(pipelineId: string): Promise<Pipeline> {
    const response = await api.get<Pipeline>(`/prospective-members/pipelines/${pipelineId}`);
    return response.data;
  },

  async createPipeline(data: PipelineCreate): Promise<Pipeline> {
    const response = await api.post<Pipeline>('/prospective-members/pipelines', data);
    return response.data;
  },

  async updatePipeline(pipelineId: string, data: PipelineUpdate): Promise<Pipeline> {
    const response = await api.patch<Pipeline>(
      `/prospective-members/pipelines/${pipelineId}`,
      data
    );
    return response.data;
  },

  async deletePipeline(pipelineId: string): Promise<void> {
    await api.delete(`/prospective-members/pipelines/${pipelineId}`);
  },

  async getPipelineStats(pipelineId: string): Promise<PipelineStats> {
    const response = await api.get<PipelineStats>(
      `/prospective-members/pipelines/${pipelineId}/stats`
    );
    return response.data;
  },

  // Stage management
  async addStage(pipelineId: string, data: PipelineStageCreate): Promise<PipelineStage> {
    const response = await api.post<PipelineStage>(
      `/prospective-members/pipelines/${pipelineId}/stages`,
      data
    );
    return response.data;
  },

  async updateStage(
    pipelineId: string,
    stageId: string,
    data: PipelineStageUpdate
  ): Promise<PipelineStage> {
    const response = await api.patch<PipelineStage>(
      `/prospective-members/pipelines/${pipelineId}/stages/${stageId}`,
      data
    );
    return response.data;
  },

  async deleteStage(pipelineId: string, stageId: string): Promise<void> {
    await api.delete(`/prospective-members/pipelines/${pipelineId}/stages/${stageId}`);
  },

  async reorderStages(
    pipelineId: string,
    stageIds: string[]
  ): Promise<PipelineStage[]> {
    const response = await api.post<PipelineStage[]>(
      `/prospective-members/pipelines/${pipelineId}/stages/reorder`,
      { stage_ids: stageIds }
    );
    return response.data;
  },
};

// =============================================================================
// Applicant Service
// =============================================================================

export const applicantService = {
  async getApplicants(params?: {
    filters?: ApplicantListFilters;
    page?: number;
    pageSize?: number;
  }): Promise<PaginatedApplicantList> {
    const response = await api.get<PaginatedApplicantList>(
      '/prospective-members/applicants',
      {
        params: {
          pipeline_id: params?.filters?.pipeline_id,
          stage_id: params?.filters?.stage_id,
          status: params?.filters?.status,
          target_membership_type: params?.filters?.target_membership_type,
          search: params?.filters?.search,
          page: params?.page ?? 1,
          page_size: params?.pageSize ?? 25,
        },
      }
    );
    return response.data;
  },

  async getApplicant(applicantId: string): Promise<Applicant> {
    const response = await api.get<Applicant>(
      `/prospective-members/applicants/${applicantId}`
    );
    return response.data;
  },

  async createApplicant(data: ApplicantCreate): Promise<Applicant> {
    const response = await api.post<Applicant>(
      '/prospective-members/applicants',
      data
    );
    return response.data;
  },

  async updateApplicant(
    applicantId: string,
    data: ApplicantUpdate
  ): Promise<Applicant> {
    const response = await api.patch<Applicant>(
      `/prospective-members/applicants/${applicantId}`,
      data
    );
    return response.data;
  },

  async deleteApplicant(applicantId: string): Promise<void> {
    await api.delete(`/prospective-members/applicants/${applicantId}`);
  },

  async advanceStage(
    applicantId: string,
    data?: AdvanceStageRequest
  ): Promise<Applicant> {
    const response = await api.post<Applicant>(
      `/prospective-members/applicants/${applicantId}/advance`,
      data ?? {}
    );
    return response.data;
  },

  async rejectApplicant(
    applicantId: string,
    reason?: string
  ): Promise<Applicant> {
    const response = await api.post<Applicant>(
      `/prospective-members/applicants/${applicantId}/reject`,
      { reason }
    );
    return response.data;
  },

  async putOnHold(
    applicantId: string,
    reason?: string
  ): Promise<Applicant> {
    const response = await api.post<Applicant>(
      `/prospective-members/applicants/${applicantId}/hold`,
      { reason }
    );
    return response.data;
  },

  async resumeApplicant(applicantId: string): Promise<Applicant> {
    const response = await api.post<Applicant>(
      `/prospective-members/applicants/${applicantId}/resume`
    );
    return response.data;
  },

  async convertToMember(
    applicantId: string,
    data: ConvertApplicantRequest
  ): Promise<ConvertApplicantResponse> {
    const response = await api.post<ConvertApplicantResponse>(
      `/prospective-members/applicants/${applicantId}/convert`,
      data
    );
    return response.data;
  },

  // Document management
  async getDocuments(applicantId: string): Promise<ApplicantDocument[]> {
    const response = await api.get<ApplicantDocument[]>(
      `/prospective-members/applicants/${applicantId}/documents`
    );
    return response.data;
  },

  async uploadDocument(
    applicantId: string,
    stageId: string,
    documentType: string,
    file: File
  ): Promise<ApplicantDocument> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('stage_id', stageId);
    formData.append('document_type', documentType);

    const response = await api.post<ApplicantDocument>(
      `/prospective-members/applicants/${applicantId}/documents`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );
    return response.data;
  },

  async deleteDocument(
    applicantId: string,
    documentId: string
  ): Promise<void> {
    await api.delete(
      `/prospective-members/applicants/${applicantId}/documents/${documentId}`
    );
  },
};
