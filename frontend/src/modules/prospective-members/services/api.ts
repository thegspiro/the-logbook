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
  InactivityConfig,
  Applicant,
  ApplicantCreate,
  ApplicantUpdate,
  ApplicantListFilters,
  PaginatedApplicantList,
  AdvanceStageRequest,
  ConvertApplicantRequest,
  ConvertApplicantResponse,
  ApplicantDocument,
  WithdrawApplicantRequest,
  ReactivateApplicantRequest,
  PurgeInactiveRequest,
  PurgeInactiveResponse,
  ElectionPackage,
  ElectionPackageCreate,
  ElectionPackageUpdate,
} from '../types';
import { FILE_UPLOAD_LIMITS } from '../types';

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

// Shared refresh promise to prevent concurrent refresh attempts (matches shared API client pattern)
let refreshPromise: Promise<string> | null = null;

// Handle 401 responses with race-safe token refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      const refreshToken = localStorage.getItem('refresh_token');
      if (!refreshToken) return Promise.reject(error);

      try {
        if (!refreshPromise) {
          refreshPromise = axios
            .post('/api/v1/auth/refresh', { refresh_token: refreshToken })
            .then((response) => {
              const { access_token, refresh_token: new_refresh_token } = response.data;
              localStorage.setItem('access_token', access_token);
              if (new_refresh_token) {
                localStorage.setItem('refresh_token', new_refresh_token);
              }
              return access_token;
            })
            .finally(() => { refreshPromise = null; });
        }
        const newAccessToken = await refreshPromise;
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return api(originalRequest);
      } catch {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        window.location.href = '/login';
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

  // Inactivity configuration
  async updateInactivitySettings(
    pipelineId: string,
    config: InactivityConfig
  ): Promise<Pipeline> {
    const response = await api.patch<Pipeline>(
      `/prospective-members/pipelines/${pipelineId}`,
      { inactivity_config: config }
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
          include_inactive: params?.filters?.include_inactive,
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

  async withdrawApplicant(
    applicantId: string,
    data?: WithdrawApplicantRequest
  ): Promise<Applicant> {
    const response = await api.post<Applicant>(
      `/prospective-members/applicants/${applicantId}/withdraw`,
      data ?? {}
    );
    return response.data;
  },

  async resumeApplicant(applicantId: string): Promise<Applicant> {
    const response = await api.post<Applicant>(
      `/prospective-members/applicants/${applicantId}/resume`
    );
    return response.data;
  },

  async reactivateApplicant(
    applicantId: string,
    data?: ReactivateApplicantRequest
  ): Promise<Applicant> {
    const response = await api.post<Applicant>(
      `/prospective-members/applicants/${applicantId}/reactivate`,
      data ?? {}
    );
    return response.data;
  },

  async getInactiveApplicants(params?: {
    pipeline_id?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<PaginatedApplicantList> {
    const response = await api.get<PaginatedApplicantList>(
      '/prospective-members/applicants',
      {
        params: {
          pipeline_id: params?.pipeline_id,
          status: 'inactive',
          search: params?.search,
          page: params?.page ?? 1,
          page_size: params?.pageSize ?? 25,
        },
      }
    );
    return response.data;
  },

  async getWithdrawnApplicants(params?: {
    pipeline_id?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<PaginatedApplicantList> {
    const response = await api.get<PaginatedApplicantList>(
      '/prospective-members/applicants',
      {
        params: {
          pipeline_id: params?.pipeline_id,
          status: 'withdrawn',
          search: params?.search,
          page: params?.page ?? 1,
          page_size: params?.pageSize ?? 25,
        },
      }
    );
    return response.data;
  },

  async purgeInactiveApplicants(
    pipelineId: string,
    data: PurgeInactiveRequest
  ): Promise<PurgeInactiveResponse> {
    const response = await api.post<PurgeInactiveResponse>(
      `/prospective-members/pipelines/${pipelineId}/purge-inactive`,
      data
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
    // Client-side file validation
    if (file.size > FILE_UPLOAD_LIMITS.maxSizeBytes) {
      throw new Error(`File exceeds maximum size of ${FILE_UPLOAD_LIMITS.maxSizeLabel}`);
    }
    if (file.type && !(FILE_UPLOAD_LIMITS.allowedMimeTypes as readonly string[]).includes(file.type)) {
      throw new Error(
        `File type "${file.type}" is not allowed. Accepted: ${FILE_UPLOAD_LIMITS.allowedExtensions.join(', ')}`
      );
    }
    const ext = file.name.toLowerCase().match(/\.[^.]+$/)?.[0];
    if (ext && !(FILE_UPLOAD_LIMITS.allowedExtensions as readonly string[]).includes(ext)) {
      throw new Error(
        `File extension "${ext}" is not allowed. Accepted: ${FILE_UPLOAD_LIMITS.allowedExtensions.join(', ')}`
      );
    }

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

  // Election package management
  async getElectionPackage(applicantId: string): Promise<ElectionPackage | null> {
    try {
      const response = await api.get<ElectionPackage>(
        `/prospective-members/applicants/${applicantId}/election-package`
      );
      return response.data;
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        return null;
      }
      throw err;
    }
  },

  async createElectionPackage(
    applicantId: string,
    data: ElectionPackageCreate
  ): Promise<ElectionPackage> {
    const response = await api.post<ElectionPackage>(
      `/prospective-members/applicants/${applicantId}/election-package`,
      data
    );
    return response.data;
  },

  async updateElectionPackage(
    applicantId: string,
    data: ElectionPackageUpdate
  ): Promise<ElectionPackage> {
    const response = await api.patch<ElectionPackage>(
      `/prospective-members/applicants/${applicantId}/election-package`,
      data
    );
    return response.data;
  },
};

// =============================================================================
// Election Package Service (cross-module query for Elections module)
// =============================================================================

export const electionPackageService = {
  async getPendingPackages(pipelineId?: string): Promise<ElectionPackage[]> {
    const response = await api.get<ElectionPackage[]>(
      '/prospective-members/election-packages',
      { params: { pipeline_id: pipelineId, status: 'ready' } }
    );
    return response.data;
  },

  async getAllPackages(params?: {
    pipeline_id?: string;
    status?: string;
  }): Promise<ElectionPackage[]> {
    const response = await api.get<ElectionPackage[]>(
      '/prospective-members/election-packages',
      { params }
    );
    return response.data;
  },
};
