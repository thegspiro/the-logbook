/**
 * Prospective Members API Service
 *
 * API client for the prospective member pipeline module.
 *
 * MAPPING LAYER: The frontend uses "stages/applicants" terminology while the
 * backend uses "steps/prospects". This service translates between the two so
 * frontend components don't need to know about backend field names.
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
  StageType,
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
import { DEFAULT_INACTIVITY_CONFIG, FILE_UPLOAD_LIMITS } from '../types';

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
// Backend ↔ Frontend Mapping Helpers
// =============================================================================

/** Map frontend stage_type to backend step_type + action_type */
function mapStageTypeToBackend(stageType: StageType): { step_type: string; action_type?: string } {
  switch (stageType) {
    case 'form_submission':
      return { step_type: 'action', action_type: 'custom' };
    case 'document_upload':
      return { step_type: 'action', action_type: 'collect_document' };
    case 'election_vote':
      return { step_type: 'action', action_type: 'custom' };
    case 'manual_approval':
    default:
      return { step_type: 'checkbox' };
  }
}

/** Map backend step_type + action_type to frontend stage_type */
function mapStepTypeToFrontend(stepType: string, actionType?: string | null): StageType {
  if (stepType === 'action') {
    if (actionType === 'collect_document') return 'document_upload';
    return 'form_submission';
  }
  // checkbox and note both map to manual_approval
  return 'manual_approval';
}

/** Provide a valid default StageConfig for a given stage type */
function getDefaultStageConfig(stageType: StageType): PipelineStage['config'] {
  switch (stageType) {
    case 'form_submission':
      return { form_id: '', form_name: '' };
    case 'document_upload':
      return { required_document_types: [], allow_multiple: true };
    case 'election_vote':
      return {
        voting_method: 'simple_majority',
        victory_condition: 'majority',
        eligible_voter_roles: [],
        anonymous_voting: true,
      };
    case 'manual_approval':
    default:
      return { approver_roles: [], require_notes: false };
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Map a backend pipeline step response to a frontend PipelineStage */
function mapStepToStage(step: any): PipelineStage {
  const stageType = mapStepTypeToFrontend(step.step_type, step.action_type);
  return {
    id: step.id,
    pipeline_id: step.pipeline_id,
    name: step.name,
    description: step.description ?? undefined,
    stage_type: stageType,
    config: getDefaultStageConfig(stageType),
    sort_order: step.sort_order ?? 0,
    is_required: step.required ?? true,
    created_at: step.created_at,
    updated_at: step.updated_at,
  };
}

/** Map a backend pipeline response to a frontend Pipeline */
function mapPipelineResponse(data: any): Pipeline {
  return {
    id: data.id,
    organization_id: data.organization_id,
    name: data.name,
    description: data.description ?? undefined,
    is_active: data.is_active ?? !data.is_template,
    inactivity_config: data.inactivity_config && Object.keys(data.inactivity_config).length > 0
      ? data.inactivity_config
      : DEFAULT_INACTIVITY_CONFIG,
    stages: (data.steps || []).map(mapStepToStage),
    applicant_count: data.prospect_count ?? 0,
    created_at: data.created_at,
    updated_at: data.updated_at,
  };
}

/** Map a backend pipeline list response to a frontend PipelineListItem */
function mapPipelineListItem(data: any): PipelineListItem {
  return {
    id: data.id,
    name: data.name,
    description: data.description ?? undefined,
    is_active: data.is_active ?? !data.is_template,
    stage_count: data.step_count ?? 0,
    applicant_count: data.prospect_count ?? 0,
    created_at: data.created_at,
  };
}

/** Map a frontend PipelineStageCreate to a backend step create payload */
function mapStageCreateToBackend(stage: PipelineStageCreate): any {
  const { step_type, action_type } = mapStageTypeToBackend(stage.stage_type);
  return {
    name: stage.name,
    description: stage.description,
    step_type,
    action_type,
    sort_order: stage.sort_order,
    required: stage.is_required ?? true,
  };
}

/** Map a frontend PipelineStageUpdate to a backend step update payload */
function mapStageUpdateToBackend(stage: PipelineStageUpdate): any {
  const payload: any = {};
  if (stage.name !== undefined) payload.name = stage.name;
  if (stage.description !== undefined) payload.description = stage.description;
  if (stage.stage_type !== undefined) {
    const { step_type, action_type } = mapStageTypeToBackend(stage.stage_type);
    payload.step_type = step_type;
    payload.action_type = action_type;
  }
  if (stage.sort_order !== undefined) payload.sort_order = stage.sort_order;
  if (stage.is_required !== undefined) payload.required = stage.is_required;
  return payload;
}

/** Map a backend prospect response to a frontend Applicant-like shape */
function mapProspectToApplicant(data: any): any {
  return {
    ...data,
    current_stage_id: data.current_step_id,
    current_stage_name: data.current_step?.name ?? data.current_step_name,
    current_stage_type: data.current_step?.step_type
      ? mapStepTypeToFrontend(data.current_step.step_type, data.current_step.action_type)
      : undefined,
    stage_history: (data.step_progress || []).map((sp: any) => ({
      id: sp.id,
      stage_id: sp.step_id,
      stage_name: sp.step?.name ?? '',
      stage_type: sp.step?.step_type
        ? mapStepTypeToFrontend(sp.step.step_type, sp.step.action_type)
        : 'manual_approval',
      entered_at: sp.created_at,
      completed_at: sp.completed_at,
      completed_by: sp.completed_by,
      notes: sp.notes,
      artifacts: [],
    })),
    stage_entered_at: data.created_at,
    target_membership_type: 'probationary',
    status_token: data.status_token,
    status: typeof data.status === 'object' ? data.status.value ?? data.status : data.status,
    last_activity_at: data.updated_at,
  };
}

/** Map a backend prospect list item to a frontend ApplicantListItem-like shape */
function mapProspectListToApplicantList(data: any): any {
  return {
    id: data.id,
    pipeline_id: data.pipeline_id,
    first_name: data.first_name,
    last_name: data.last_name,
    email: data.email,
    phone: data.phone,
    current_stage_id: data.current_step_id,
    current_stage_name: data.current_step_name,
    stage_entered_at: data.created_at,
    target_membership_type: 'probationary',
    status: typeof data.status === 'object' ? data.status.value ?? data.status : data.status,
    days_in_stage: 0,
    days_in_pipeline: 0,
    last_activity_at: data.created_at,
    days_since_activity: 0,
    inactivity_alert_level: 'normal',
    created_at: data.created_at,
  };
}

/** Map a backend election package response to a frontend ElectionPackage */
function mapElectionPackageResponse(data: any): ElectionPackage {
  const snapshot = data.applicant_snapshot || {};
  const config = data.package_config || {};
  return {
    id: data.id,
    applicant_id: data.prospect_id,
    pipeline_id: data.pipeline_id ?? '',
    stage_id: data.step_id ?? '',
    applicant_name: `${snapshot.first_name || ''} ${snapshot.last_name || ''}`.trim(),
    applicant_email: snapshot.email,
    applicant_phone: snapshot.phone,
    target_membership_type: 'probationary',
    coordinator_notes: data.coordinator_notes,
    supporting_statement: config.supporting_statement,
    documents: config.documents,
    stage_summary: config.stage_summary,
    custom_fields: config.custom_fields,
    recommended_ballot_item: config.recommended_ballot_item,
    status: data.status,
    election_id: data.election_id,
    candidate_id: config.candidate_id,
    created_at: data.created_at,
    updated_at: data.updated_at,
    submitted_at: config.submitted_at,
    submitted_by: config.submitted_by,
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// =============================================================================
// Pipeline Service
// =============================================================================

export const pipelineService = {
  async getPipelines(): Promise<PipelineListItem[]> {
    const response = await api.get('/prospective-members/pipelines');
    return response.data.map(mapPipelineListItem);
  },

  async getPipeline(pipelineId: string): Promise<Pipeline> {
    const response = await api.get(`/prospective-members/pipelines/${pipelineId}`);
    return mapPipelineResponse(response.data);
  },

  async createPipeline(data: PipelineCreate): Promise<Pipeline> {
    const payload: Record<string, unknown> = {
      name: data.name,
      description: data.description,
      is_active: data.is_active ?? true,
      inactivity_config: data.inactivity_config,
    };
    const response = await api.post('/prospective-members/pipelines', payload);
    return mapPipelineResponse(response.data);
  },

  async updatePipeline(pipelineId: string, data: PipelineUpdate): Promise<Pipeline> {
    const payload: Record<string, unknown> = {};
    if (data.name !== undefined) payload.name = data.name;
    if (data.description !== undefined) payload.description = data.description;
    if (data.is_active !== undefined) payload.is_active = data.is_active;
    if (data.inactivity_config !== undefined) payload.inactivity_config = data.inactivity_config;

    const response = await api.put(
      `/prospective-members/pipelines/${pipelineId}`,
      payload
    );
    return mapPipelineResponse(response.data);
  },

  async deletePipeline(pipelineId: string): Promise<void> {
    await api.delete(`/prospective-members/pipelines/${pipelineId}`);
  },

  async getPipelineStats(pipelineId: string): Promise<PipelineStats> {
    const response = await api.get(`/prospective-members/pipelines/${pipelineId}/stats`);
    const d = response.data;
    return {
      pipeline_id: d.pipeline_id,
      total_applicants: d.total_prospects ?? 0,
      active_applicants: d.active_count ?? 0,
      converted_count: d.transferred_count ?? 0,
      rejected_count: d.rejected_count ?? 0,
      withdrawn_count: d.withdrawn_count ?? 0,
      on_hold_count: 0,
      inactive_count: 0,
      warning_count: 0,
      avg_days_to_convert: d.avg_days_to_transfer ?? 0,
      by_stage: (d.by_step || []).map((s: { stage_id: string; stage_name: string; count: number }) => ({
        stage_id: s.stage_id,
        stage_name: s.stage_name,
        count: s.count,
      })),
      conversion_rate: d.conversion_rate ?? 0,
    };
  },

  // Stage management (backend calls these "steps")
  async addStage(pipelineId: string, data: PipelineStageCreate): Promise<PipelineStage> {
    const payload = mapStageCreateToBackend(data);
    const response = await api.post(
      `/prospective-members/pipelines/${pipelineId}/steps`,
      payload
    );
    return mapStepToStage(response.data);
  },

  async updateStage(
    pipelineId: string,
    stageId: string,
    data: PipelineStageUpdate
  ): Promise<PipelineStage> {
    const payload = mapStageUpdateToBackend(data);
    // Backend uses PUT, not PATCH
    const response = await api.put(
      `/prospective-members/pipelines/${pipelineId}/steps/${stageId}`,
      payload
    );
    return mapStepToStage(response.data);
  },

  async deleteStage(pipelineId: string, stageId: string): Promise<void> {
    await api.delete(`/prospective-members/pipelines/${pipelineId}/steps/${stageId}`);
  },

  async reorderStages(
    pipelineId: string,
    stageIds: string[]
  ): Promise<PipelineStage[]> {
    // Backend uses PUT and expects step_ids, not stage_ids
    const response = await api.put(
      `/prospective-members/pipelines/${pipelineId}/steps/reorder`,
      { step_ids: stageIds }
    );
    return response.data.map(mapStepToStage);
  },

  async updateInactivitySettings(
    pipelineId: string,
    config: InactivityConfig
  ): Promise<Pipeline> {
    const response = await api.put(
      `/prospective-members/pipelines/${pipelineId}`,
      { inactivity_config: config }
    );
    return mapPipelineResponse(response.data);
  },
};

// =============================================================================
// Applicant Service (backend calls these "prospects")
// =============================================================================

export const applicantService = {
  async getApplicants(params?: {
    filters?: ApplicantListFilters;
    page?: number;
    pageSize?: number;
  }): Promise<PaginatedApplicantList> {
    const page = params?.page ?? 1;
    const pageSize = params?.pageSize ?? 25;
    const offset = (page - 1) * pageSize;

    // Backend uses /prospects with limit/offset, not /applicants with page/page_size
    const response = await api.get(
      '/prospective-members/prospects',
      {
        params: {
          pipeline_id: params?.filters?.pipeline_id,
          status: params?.filters?.status,
          search: params?.filters?.search,
          limit: pageSize,
          offset,
        },
      }
    );

    // Backend returns { items, total, limit, offset }
    const data = response.data;
    const items = Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []);
    const total = data?.total ?? items.length;
    const mappedItems = items.map(mapProspectListToApplicantList);
    return {
      items: mappedItems,
      total,
      page,
      page_size: pageSize,
      total_pages: Math.max(1, Math.ceil(total / pageSize)),
    };
  },

  async getApplicant(applicantId: string): Promise<Applicant> {
    const response = await api.get(
      `/prospective-members/prospects/${applicantId}`
    );
    return mapProspectToApplicant(response.data);
  },

  async createApplicant(data: ApplicantCreate): Promise<Applicant> {
    // Map frontend applicant create to backend prospect create
    const payload: Record<string, unknown> = {
      first_name: data.first_name,
      last_name: data.last_name,
      email: data.email,
      phone: data.phone,
      date_of_birth: data.date_of_birth,
      pipeline_id: data.pipeline_id,
      notes: data.notes,
    };
    if (data.address) {
      payload.address_street = data.address.street;
      payload.address_city = data.address.city;
      payload.address_state = data.address.state;
      payload.address_zip = data.address.zip_code;
    }
    const response = await api.post(
      '/prospective-members/prospects',
      payload
    );
    return mapProspectToApplicant(response.data);
  },

  async updateApplicant(
    applicantId: string,
    data: ApplicantUpdate
  ): Promise<Applicant> {
    // Map frontend field names to backend and use PUT
    const payload: Record<string, unknown> = {};
    if (data.first_name !== undefined) payload.first_name = data.first_name;
    if (data.last_name !== undefined) payload.last_name = data.last_name;
    if (data.email !== undefined) payload.email = data.email;
    if (data.phone !== undefined) payload.phone = data.phone;
    if (data.date_of_birth !== undefined) payload.date_of_birth = data.date_of_birth;
    if (data.notes !== undefined) payload.notes = data.notes;
    if (data.status !== undefined) payload.status = data.status;
    if (data.address) {
      payload.address_street = data.address.street;
      payload.address_city = data.address.city;
      payload.address_state = data.address.state;
      payload.address_zip = data.address.zip_code;
    }
    // Backend uses PUT, not PATCH
    const response = await api.put(
      `/prospective-members/prospects/${applicantId}`,
      payload
    );
    return mapProspectToApplicant(response.data);
  },

  async deleteApplicant(applicantId: string): Promise<void> {
    // Backend doesn't have a delete prospect endpoint; this may 404
    await api.delete(`/prospective-members/prospects/${applicantId}`);
  },

  async checkExisting(email: string, firstName?: string, lastName?: string): Promise<{ has_matches: boolean; match_count: number; matches: Array<{ status: string; match_type: string }> }> {
    const params: Record<string, string> = { email };
    if (firstName) params.first_name = firstName;
    if (lastName) params.last_name = lastName;
    const response = await api.post('/prospective-members/prospects/check-existing', null, { params });
    return response.data;
  },

  async getActivity(applicantId: string, limit?: number): Promise<Array<{ id: string; prospect_id: string; action: string; details: Record<string, unknown>; performed_by: string; performer_name: string; created_at: string }>> {
    const params: Record<string, unknown> = {};
    if (limit) params.limit = limit;
    const response = await api.get(`/prospective-members/prospects/${applicantId}/activity`, { params });
    return response.data;
  },

  async completeStep(applicantId: string, stepId: string, notes?: string): Promise<Applicant> {
    const response = await api.post(
      `/prospective-members/prospects/${applicantId}/complete-step`,
      { step_id: stepId, notes }
    );
    return mapProspectToApplicant(response.data);
  },

  async advanceStage(
    applicantId: string,
    data?: AdvanceStageRequest
  ): Promise<Applicant> {
    const response = await api.post(
      `/prospective-members/prospects/${applicantId}/advance`,
      data ? { notes: data.notes } : {}
    );
    return mapProspectToApplicant(response.data);
  },

  async rejectApplicant(
    applicantId: string,
    reason?: string
  ): Promise<Applicant> {
    // Backend doesn't have a dedicated reject endpoint; use update with status
    const response = await api.put(
      `/prospective-members/prospects/${applicantId}`,
      { status: 'rejected', notes: reason }
    );
    return mapProspectToApplicant(response.data);
  },

  async putOnHold(
    applicantId: string,
    reason?: string
  ): Promise<Applicant> {
    const response = await api.put(
      `/prospective-members/prospects/${applicantId}`,
      { status: 'on_hold', notes: reason }
    );
    return mapProspectToApplicant(response.data);
  },

  async withdrawApplicant(
    applicantId: string,
    data?: WithdrawApplicantRequest
  ): Promise<Applicant> {
    const response = await api.put(
      `/prospective-members/prospects/${applicantId}`,
      { status: 'withdrawn', notes: data?.reason }
    );
    return mapProspectToApplicant(response.data);
  },

  async resumeApplicant(applicantId: string): Promise<Applicant> {
    // Resume by setting status back to active
    const response = await api.put(
      `/prospective-members/prospects/${applicantId}`,
      { status: 'active' }
    );
    return mapProspectToApplicant(response.data);
  },

  async reactivateApplicant(
    applicantId: string,
    data?: ReactivateApplicantRequest
  ): Promise<Applicant> {
    const response = await api.put(
      `/prospective-members/prospects/${applicantId}`,
      { status: 'active', notes: data?.notes }
    );
    return mapProspectToApplicant(response.data);
  },

  async getInactiveApplicants(params?: {
    pipeline_id?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<PaginatedApplicantList> {
    return this.getApplicants({
      filters: {
        pipeline_id: params?.pipeline_id,
        status: 'inactive',
        search: params?.search,
      },
      page: params?.page,
      pageSize: params?.pageSize,
    });
  },

  async getWithdrawnApplicants(params?: {
    pipeline_id?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<PaginatedApplicantList> {
    return this.getApplicants({
      filters: {
        pipeline_id: params?.pipeline_id,
        status: 'withdrawn',
        search: params?.search,
      },
      page: params?.page,
      pageSize: params?.pageSize,
    });
  },

  async purgeInactiveApplicants(
    pipelineId: string,
    data: PurgeInactiveRequest
  ): Promise<PurgeInactiveResponse> {
    const response = await api.post(
      `/prospective-members/pipelines/${pipelineId}/purge-inactive`,
      {
        prospect_ids: data.applicant_ids,
        confirm: data.confirm,
      }
    );
    return {
      purged_count: response.data.purged_count,
      message: response.data.message,
    };
  },

  async convertToMember(
    applicantId: string,
    data: ConvertApplicantRequest
  ): Promise<ConvertApplicantResponse> {
    // Backend uses /transfer endpoint with different payload shape
    const payload: Record<string, unknown> = {
      send_welcome_email: data.send_welcome_email,
      membership_type: data.target_membership_type,
    };
    if (data.target_role_id) {
      payload.role_ids = [data.target_role_id];
    }
    if (data.middle_name) payload.middle_name = data.middle_name;
    if (data.hire_date) payload.hire_date = data.hire_date;
    if (data.rank) payload.rank = data.rank;
    if (data.station) payload.station = data.station;
    if (data.emergency_contacts?.length) payload.emergency_contacts = data.emergency_contacts;
    const response = await api.post(
      `/prospective-members/prospects/${applicantId}/transfer`,
      payload
    );
    return {
      applicant_id: applicantId,
      user_id: response.data.user_id,
      membership_type: data.target_membership_type,
      message: response.data.message ?? 'Transfer successful',
    };
  },

  async getDocuments(applicantId: string): Promise<ApplicantDocument[]> {
    const response = await api.get(
      `/prospective-members/prospects/${applicantId}/documents`
    );
    return (response.data || []).map((d: any) => ({
      id: d.id,
      applicant_id: d.prospect_id,
      stage_id: d.step_id,
      document_type: d.document_type,
      file_name: d.file_name,
      file_url: `/api/v1/prospective-members/prospects/${applicantId}/documents/${d.id}/download`,
      file_size: d.file_size,
      mime_type: d.mime_type,
      uploaded_by: d.uploaded_by,
      uploaded_at: d.created_at,
    }));
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

    // For now, record the document metadata (actual file storage TBD)
    const response = await api.post(
      `/prospective-members/prospects/${applicantId}/documents`,
      null,
      {
        params: {
          document_type: documentType,
          file_name: file.name,
          file_path: `/uploads/prospects/${applicantId}/${file.name}`,
          file_size: file.size,
          mime_type: file.type || undefined,
          step_id: stageId || undefined,
        },
      }
    );
    const d = response.data;
    return {
      id: d.id,
      applicant_id: d.prospect_id,
      stage_id: d.step_id,
      document_type: d.document_type,
      file_name: d.file_name,
      file_url: `/api/v1/prospective-members/prospects/${applicantId}/documents/${d.id}/download`,
      file_size: d.file_size,
      mime_type: d.mime_type,
      uploaded_by: d.uploaded_by,
      uploaded_at: d.created_at,
    };
  },

  async deleteDocument(
    applicantId: string,
    documentId: string
  ): Promise<void> {
    await api.delete(
      `/prospective-members/prospects/${applicantId}/documents/${documentId}`
    );
  },

  async getElectionPackage(applicantId: string): Promise<ElectionPackage | null> {
    try {
      const response = await api.get(
        `/prospective-members/prospects/${applicantId}/election-package`
      );
      return mapElectionPackageResponse(response.data);
    } catch (err: any) {
      if (err.response?.status === 404) return null;
      throw err;
    }
  },

  async createElectionPackage(
    applicantId: string,
    data: ElectionPackageCreate
  ): Promise<ElectionPackage> {
    const response = await api.post(
      `/prospective-members/prospects/${applicantId}/election-package`,
      {
        prospect_id: applicantId,
        pipeline_id: data.pipeline_id,
        step_id: data.stage_id,
        coordinator_notes: data.coordinator_notes,
        package_config: {
          supporting_statement: data.supporting_statement,
        },
      }
    );
    return mapElectionPackageResponse(response.data);
  },

  async updateElectionPackage(
    applicantId: string,
    data: ElectionPackageUpdate
  ): Promise<ElectionPackage> {
    const payload: Record<string, unknown> = {};
    if (data.status !== undefined) payload.status = data.status;
    if (data.coordinator_notes !== undefined) payload.coordinator_notes = data.coordinator_notes;
    // Pack extra fields into package_config
    const configUpdates: Record<string, unknown> = {};
    if (data.supporting_statement !== undefined) configUpdates.supporting_statement = data.supporting_statement;
    if (data.custom_fields !== undefined) configUpdates.custom_fields = data.custom_fields;
    if (Object.keys(configUpdates).length > 0) payload.package_config = configUpdates;

    const response = await api.put(
      `/prospective-members/prospects/${applicantId}/election-package`,
      payload
    );
    return mapElectionPackageResponse(response.data);
  },
};

// =============================================================================
// Election Package Service (cross-module query for Elections module)
// =============================================================================

// =============================================================================
// Public Application Status (no auth required)
// =============================================================================

export const publicStatusService = {
  async getApplicationStatus(token: string): Promise<{
    first_name: string;
    last_name: string;
    status: string;
    current_stage_name?: string;
    pipeline_name?: string;
    total_stages: number;
    stage_timeline: { stage_name: string; status: string; completed_at?: string }[];
    applied_at?: string;
  }> {
    const response = await axios.get(`/api/public/v1/application-status/${token}`);
    return response.data;
  },
};

export const electionPackageService = {
  async getPendingPackages(pipelineId?: string): Promise<ElectionPackage[]> {
    const params: Record<string, string> = { status: 'ready' };
    if (pipelineId) params.pipeline_id = pipelineId;
    const response = await api.get('/prospective-members/election-packages', { params });
    return (response.data || []).map(mapElectionPackageResponse);
  },

  async getAllPackages(params?: {
    pipeline_id?: string;
    status?: string;
  }): Promise<ElectionPackage[]> {
    const response = await api.get('/prospective-members/election-packages', {
      params: {
        pipeline_id: params?.pipeline_id,
        status: params?.status,
      },
    });
    return (response.data || []).map(mapElectionPackageResponse);
  },
};
