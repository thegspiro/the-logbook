/**
 * Prospective Members API Service
 *
 * API client for the prospective member pipeline module.
 *
 * MAPPING LAYER: The frontend uses "stages/applicants" terminology while the
 * backend uses "steps/prospects". This service translates between the two so
 * frontend components don't need to know about backend field names.
 */

import axios, { AxiosError } from 'axios';
import { createApiClient } from '../../../utils/createApiClient';
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
  ApplicantListItem,
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
  StageHistoryEntry,
  BackendStepResponse,
  BackendPipelineResponse,
  BackendPipelineListResponse,
  BackendProspectResponse,
  BackendProspectListResponse,
  BackendElectionPackageResponse,
  BackendPipelineStatsResponse,
  BackendDocumentResponse,
  BackendStepCreatePayload,
  BackendStepUpdatePayload,
  BackendStepProgressResponse,
  FormPipelineValidation,
  Interview,
  InterviewCreate,
  InterviewUpdate,
  ProspectEventLink,
  ReportStageGroup,
  TargetMembershipType,
} from '../types';
import { DEFAULT_INACTIVITY_CONFIG, FILE_UPLOAD_LIMITS, StepProgressStatus } from '../types';
import { StageType as StageTypeConst } from '../../../constants/enums';

const api = createApiClient();

// =============================================================================
// Backend <-> Frontend Mapping Helpers
// =============================================================================

/** Map frontend stage_type to backend step_type + action_type */
function mapStageTypeToBackend(stageType: StageType): { step_type: string; action_type?: string } {
  switch (stageType) {
    case StageTypeConst.FORM_SUBMISSION:
      return { step_type: 'action', action_type: 'custom' };
    case StageTypeConst.DOCUMENT_UPLOAD:
      return { step_type: 'action', action_type: 'collect_document' };
    case StageTypeConst.ELECTION_VOTE:
      return { step_type: 'action', action_type: 'custom' };
    case StageTypeConst.MEETING:
      return { step_type: 'action', action_type: 'schedule_meeting' };
    case StageTypeConst.STATUS_PAGE_TOGGLE:
      return { step_type: 'action', action_type: 'custom' };
    case StageTypeConst.AUTOMATED_EMAIL:
      return { step_type: 'action', action_type: 'send_email' };
    case StageTypeConst.MANUAL_APPROVAL:
    default:
      return { step_type: 'checkbox' };
  }
}

/** Map backend step_type + action_type to frontend stage_type */
/**
 * Map backend desired_membership_type to frontend TargetMembershipType.
 * Legacy records may store 'probationary'; new records store 'regular'.
 * Both map to 'regular' on the frontend since probationary is a status,
 * not a membership type applicants choose.
 */
function mapDesiredMembershipType(value: string | null | undefined): TargetMembershipType {
  if (value === 'administrative') return 'administrative';
  return 'regular';
}

function mapStepTypeToFrontend(
  stepType: string,
  actionType?: string | null,
  config?: Record<string, unknown> | null
): StageType {
  if (stepType === 'action') {
    if (actionType === 'collect_document') return StageTypeConst.DOCUMENT_UPLOAD;
    if (actionType === 'schedule_meeting') return StageTypeConst.MEETING;
    if (actionType === 'send_email') return StageTypeConst.AUTOMATED_EMAIL;
    // Distinguish between form_submission, election_vote, and status_page_toggle
    // by inspecting the config JSON
    if (config && 'enable_public_status' in config) return StageTypeConst.STATUS_PAGE_TOGGLE;
    if (config && 'voting_method' in config) return StageTypeConst.ELECTION_VOTE;
    return StageTypeConst.FORM_SUBMISSION;
  }
  // checkbox and note both map to manual_approval
  return StageTypeConst.MANUAL_APPROVAL;
}

/** Provide a valid default StageConfig for a given stage type */
function getDefaultStageConfig(stageType: StageType): PipelineStage['config'] {
  switch (stageType) {
    case StageTypeConst.FORM_SUBMISSION:
      return { form_id: '', form_name: '' };
    case StageTypeConst.DOCUMENT_UPLOAD:
      return { required_document_types: [], allow_multiple: true };
    case StageTypeConst.ELECTION_VOTE:
      return {
        voting_method: 'simple_majority',
        victory_condition: 'majority',
        eligible_voter_roles: [],
        anonymous_voting: true,
      };
    case StageTypeConst.MEETING:
      return { meeting_type: 'chief_meeting', meeting_description: '' };
    case StageTypeConst.STATUS_PAGE_TOGGLE:
      return { enable_public_status: true, custom_message: '' };
    case StageTypeConst.AUTOMATED_EMAIL:
      return {
        email_subject: 'Welcome to the Membership Process',
        include_welcome: true,
        welcome_message: '',
        include_faq_link: false,
        faq_url: '',
        include_next_meeting: false,
        next_meeting_details: '',
        include_status_tracker: false,
        custom_sections: [],
      };
    case StageTypeConst.MANUAL_APPROVAL:
    default:
      return { approver_roles: [], require_notes: false };
  }
}

/** Map a backend pipeline step response to a frontend PipelineStage */
function mapStepToStage(step: BackendStepResponse): PipelineStage {
  const backendConfig = step.config ?? null;
  const stageType = mapStepTypeToFrontend(step.step_type, step.action_type, backendConfig);
  return {
    id: step.id,
    pipeline_id: step.pipeline_id,
    name: step.name,
    description: step.description ?? undefined,
    stage_type: stageType,
    config: backendConfig
      ? { ...getDefaultStageConfig(stageType), ...backendConfig }
      : getDefaultStageConfig(stageType),
    sort_order: step.sort_order ?? 0,
    is_required: step.required ?? true,
    notify_prospect_on_completion: step.notify_prospect_on_completion ?? false,
    public_visible: step.public_visible ?? true,
    created_at: step.created_at,
    updated_at: step.updated_at,
  };
}

/** Map a backend pipeline response to a frontend Pipeline */
function mapPipelineResponse(data: BackendPipelineResponse): Pipeline {
  const inactivityConfig =
    data.inactivity_config && Object.keys(data.inactivity_config).length > 0
      ? (data.inactivity_config as unknown as InactivityConfig)
      : DEFAULT_INACTIVITY_CONFIG;
  return {
    id: data.id,
    organization_id: data.organization_id,
    name: data.name,
    description: data.description ?? undefined,
    is_active: data.is_active ?? !data.is_template,
    is_template: data.is_template ?? false,
    is_default: data.is_default ?? false,
    inactivity_config: inactivityConfig,
    public_status_enabled: data.public_status_enabled ?? false,
    report_stage_groups: data.report_stage_groups ?? undefined,
    stages: (data.steps || []).map(mapStepToStage),
    applicant_count: data.prospect_count ?? 0,
    created_at: data.created_at,
    updated_at: data.updated_at,
  };
}

/** Map a backend pipeline list response to a frontend PipelineListItem */
function mapPipelineListItem(data: BackendPipelineListResponse): PipelineListItem {
  return {
    id: data.id,
    name: data.name,
    description: data.description ?? undefined,
    is_active: data.is_active ?? !data.is_template,
    is_template: data.is_template ?? false,
    is_default: data.is_default ?? false,
    stage_count: data.step_count ?? 0,
    applicant_count: data.prospect_count ?? 0,
    created_at: data.created_at,
  };
}

/** Map a frontend PipelineStageCreate to a backend step create payload */
function mapStageCreateToBackend(stage: PipelineStageCreate): BackendStepCreatePayload {
  const { step_type, action_type } = mapStageTypeToBackend(stage.stage_type);
  return {
    name: stage.name,
    description: stage.description,
    step_type,
    action_type,
    sort_order: stage.sort_order,
    required: stage.is_required ?? true,
    config: stage.config as unknown as Record<string, unknown> | undefined,
    notify_prospect_on_completion: stage.notify_prospect_on_completion ?? false,
    public_visible: stage.public_visible ?? true,
  };
}

/** Map a frontend PipelineStageUpdate to a backend step update payload */
function mapStageUpdateToBackend(stage: PipelineStageUpdate): BackendStepUpdatePayload {
  const payload: BackendStepUpdatePayload = {};
  if (stage.name !== undefined) payload.name = stage.name;
  if (stage.description !== undefined) payload.description = stage.description;
  if (stage.stage_type !== undefined) {
    const { step_type, action_type } = mapStageTypeToBackend(stage.stage_type);
    payload.step_type = step_type;
    payload.action_type = action_type;
  }
  if (stage.sort_order !== undefined) payload.sort_order = stage.sort_order;
  if (stage.is_required !== undefined) payload.required = stage.is_required;
  if (stage.config !== undefined)
    payload.config = stage.config as unknown as Record<string, unknown>;
  if (stage.notify_prospect_on_completion !== undefined)
    payload.notify_prospect_on_completion = stage.notify_prospect_on_completion;
  if (stage.public_visible !== undefined) payload.public_visible = stage.public_visible;
  return payload;
}

/** Extract a plain string status from a backend status value that may be a string or object. */
function extractStatus(status: string | { value: string }): string {
  if (typeof status === 'object' && status !== null) {
    return status.value ?? JSON.stringify(status);
  }
  return status;
}

/** Map a backend prospect response to a frontend Applicant */
export function mapProspectToApplicant(data: BackendProspectResponse): Applicant {
  // Only include steps the prospect has actually reached (not PENDING future steps).
  // When a prospect is created, the backend initializes progress records for ALL
  // pipeline steps — first step as IN_PROGRESS, the rest as PENDING. We filter out
  // PENDING steps so the stage history only shows stages the prospect has entered.
  const stageHistory: StageHistoryEntry[] = (data.step_progress || [])
    .filter((sp: BackendStepProgressResponse) => sp.status !== StepProgressStatus.PENDING)
    .map((sp: BackendStepProgressResponse) => {
    const stageType = sp.step?.step_type
      ? mapStepTypeToFrontend(sp.step.step_type, sp.step.action_type)
      : (StageTypeConst.MANUAL_APPROVAL as StageType);

    // Build artifacts from action_result when available
    const artifacts: StageHistoryEntry['artifacts'] = [];
    const actionResult = sp.action_result;
    if (actionResult && typeof actionResult === 'object') {
      const mappedData = actionResult['mapped_data'] as Record<string, unknown> | undefined;
      if (mappedData && stageType === StageTypeConst.FORM_SUBMISSION) {
        artifacts.push({
          id: `${sp.id}-form`,
          type: StageTypeConst.FORM_SUBMISSION,
          name: 'Membership Interest Form',
          data: mappedData,
          created_at: sp.completed_at ?? sp.created_at,
        });
      }
    }

    return {
      id: sp.id,
      stage_id: sp.step_id,
      stage_name: sp.step?.name ?? '',
      stage_type: stageType,
      entered_at: sp.created_at,
      completed_at: sp.completed_at ?? undefined,
      completed_by: sp.completed_by ?? undefined,
      notes: sp.notes ?? undefined,
      artifacts,
      action_result: actionResult ?? undefined,
    };
  });

  return {
    id: data.id,
    pipeline_id: data.pipeline_id ?? '',
    pipeline_name: data.pipeline_name ?? undefined,
    first_name: data.first_name,
    last_name: data.last_name,
    email: data.email,
    phone: data.phone ?? undefined,
    date_of_birth: data.date_of_birth ?? undefined,
    address: data.address_street
      ? {
          street: data.address_street ?? undefined,
          city: data.address_city ?? undefined,
          state: data.address_state ?? undefined,
          zip_code: data.address_zip ?? undefined,
        }
      : undefined,
    current_stage_id: data.current_step_id ?? '',
    current_stage_name: data.current_step?.name ?? undefined,
    current_stage_type: data.current_step?.step_type
      ? mapStepTypeToFrontend(data.current_step.step_type, data.current_step.action_type)
      : undefined,
    stage_history: stageHistory,
    total_stages: (data.step_progress || []).length,
    stage_entered_at: data.created_at,
    target_membership_type: mapDesiredMembershipType(data.desired_membership_type),
    form_submission_id: data.form_submission_id ?? undefined,
    status_token: data.status_token ?? undefined,
    status: extractStatus(data.status) as Applicant['status'],
    notes: data.notes ?? undefined,
    last_activity_at: data.updated_at,
    created_at: data.created_at,
    updated_at: data.updated_at,
  };
}

/** Map a backend prospect list item to a frontend ApplicantListItem */
function mapProspectListToApplicantList(data: BackendProspectListResponse): ApplicantListItem {
  return {
    id: data.id,
    pipeline_id: data.pipeline_id ?? '',
    first_name: data.first_name,
    last_name: data.last_name,
    email: data.email,
    phone: data.phone ?? undefined,
    current_stage_id: data.current_step_id ?? '',
    current_stage_name: data.current_step_name ?? undefined,
    stage_entered_at: data.created_at,
    target_membership_type: mapDesiredMembershipType(data.desired_membership_type),
    status: extractStatus(data.status) as ApplicantListItem['status'],
    days_in_stage: 0,
    days_in_pipeline: 0,
    last_activity_at: data.created_at,
    days_since_activity: 0,
    inactivity_alert_level: 'normal',
    created_at: data.created_at,
  };
}

/** Map a backend election package response to a frontend ElectionPackage */
function mapElectionPackageResponse(data: BackendElectionPackageResponse): ElectionPackage {
  const snapshot = data.applicant_snapshot ?? {};
  const config = data.package_config ?? {};
  return {
    id: data.id,
    applicant_id: data.prospect_id,
    pipeline_id: data.pipeline_id ?? '',
    stage_id: data.step_id ?? '',
    applicant_name: `${snapshot.first_name ?? ''} ${snapshot.last_name ?? ''}`.trim(),
    applicant_email: snapshot.email,
    applicant_phone: snapshot.phone,
    target_membership_type: mapDesiredMembershipType((snapshot as Record<string, unknown>).desired_membership_type as string | null | undefined),
    coordinator_notes: data.coordinator_notes ?? undefined,
    supporting_statement: config.supporting_statement,
    documents: config.documents,
    stage_summary: config.stage_summary,
    custom_fields: config.custom_fields,
    recommended_ballot_item: config.recommended_ballot_item,
    status: data.status,
    election_id: data.election_id ?? undefined,
    candidate_id: config.candidate_id,
    created_at: data.created_at,
    updated_at: data.updated_at,
    submitted_at: config.submitted_at,
    submitted_by: config.submitted_by,
  };
}

/** Map a backend pipeline stats response to a frontend PipelineStats */
function mapPipelineStatsResponse(data: BackendPipelineStatsResponse): PipelineStats {
  return {
    pipeline_id: data.pipeline_id,
    total_applicants: data.total_prospects ?? 0,
    active_applicants: data.active_count ?? 0,
    converted_count: data.transferred_count ?? 0,
    rejected_count: data.rejected_count ?? 0,
    withdrawn_count: data.withdrawn_count ?? 0,
    on_hold_count: 0,
    inactive_count: 0,
    warning_count: 0,
    avg_days_to_convert: data.avg_days_to_transfer ?? 0,
    by_stage: (data.by_step || []).map((s) => ({
      stage_id: s.stage_id,
      stage_name: s.stage_name,
      count: s.count,
    })),
    conversion_rate: data.conversion_rate ?? 0,
  };
}

/** Map a backend document response to a frontend ApplicantDocument */
function mapDocumentResponse(doc: BackendDocumentResponse, applicantId: string): ApplicantDocument {
  return {
    id: doc.id,
    applicant_id: doc.prospect_id,
    stage_id: doc.step_id ?? '',
    document_type: doc.document_type,
    file_name: doc.file_name,
    file_url: `/api/v1/prospective-members/prospects/${applicantId}/documents/${doc.id}/download`,
    file_size: doc.file_size,
    mime_type: doc.mime_type ?? '',
    uploaded_by: doc.uploaded_by ?? '',
    uploaded_at: doc.created_at,
  };
}

// =============================================================================
// Pipeline Service
// =============================================================================

export const pipelineService = {
  async getPipelines(includeTemplates?: boolean): Promise<PipelineListItem[]> {
    const params: Record<string, unknown> = {};
    if (includeTemplates) params.include_templates = true;
    const response = await api.get<BackendPipelineListResponse[]>('/prospective-members/pipelines', { params });
    return response.data.map(mapPipelineListItem);
  },

  async getTemplates(): Promise<PipelineListItem[]> {
    const all = await this.getPipelines(true);
    return all.filter((p) => p.is_template);
  },

  async getPipeline(pipelineId: string): Promise<Pipeline> {
    const response = await api.get<BackendPipelineResponse>(`/prospective-members/pipelines/${pipelineId}`);
    return mapPipelineResponse(response.data);
  },

  async createPipeline(data: PipelineCreate): Promise<Pipeline> {
    const payload: Record<string, unknown> = {
      name: data.name,
      description: data.description,
      is_active: data.is_active ?? true,
      is_template: data.is_template ?? false,
      inactivity_config: data.inactivity_config,
    };
    const response = await api.post<BackendPipelineResponse>('/prospective-members/pipelines', payload);
    return mapPipelineResponse(response.data);
  },

  async updatePipeline(pipelineId: string, data: PipelineUpdate): Promise<Pipeline> {
    const payload: Record<string, unknown> = {};
    if (data.name !== undefined) payload.name = data.name;
    if (data.description !== undefined) payload.description = data.description;
    if (data.is_active !== undefined) payload.is_active = data.is_active;
    if (data.is_default !== undefined) payload.is_default = data.is_default;
    if (data.is_template !== undefined) payload.is_template = data.is_template;
    if (data.inactivity_config !== undefined) payload.inactivity_config = data.inactivity_config;
    if (data.public_status_enabled !== undefined) payload.public_status_enabled = data.public_status_enabled;

    const response = await api.put<BackendPipelineResponse>(`/prospective-members/pipelines/${pipelineId}`, payload);
    return mapPipelineResponse(response.data);
  },

  async deletePipeline(pipelineId: string): Promise<void> {
    await api.delete(`/prospective-members/pipelines/${pipelineId}`);
  },

  async duplicatePipeline(pipelineId: string, name: string): Promise<Pipeline> {
    const response = await api.post<BackendPipelineResponse>(
      `/prospective-members/pipelines/${pipelineId}/duplicate`,
      null,
      { params: { name } }
    );
    return mapPipelineResponse(response.data);
  },

  async saveAsTemplate(pipelineId: string, name: string): Promise<Pipeline> {
    // Duplicate the pipeline and mark it as a template
    const duplicated = await this.duplicatePipeline(pipelineId, name);
    return this.updatePipeline(duplicated.id, { is_template: true, is_active: false });
  },

  async getPipelineStats(pipelineId: string): Promise<PipelineStats> {
    const response = await api.get<BackendPipelineStatsResponse>(`/prospective-members/pipelines/${pipelineId}/stats`);
    return mapPipelineStatsResponse(response.data);
  },

  // Form validation for pipeline stages
  async validateFormForPipeline(formId: string): Promise<FormPipelineValidation> {
    const response = await api.get<FormPipelineValidation>(`/prospective-members/validate-form/${formId}`);
    return response.data;
  },

  // Stage management (backend calls these "steps")
  async addStage(pipelineId: string, data: PipelineStageCreate): Promise<PipelineStage> {
    const payload = mapStageCreateToBackend(data);
    const response = await api.post<BackendStepResponse>(`/prospective-members/pipelines/${pipelineId}/steps`, payload);
    return mapStepToStage(response.data);
  },

  async updateStage(pipelineId: string, stageId: string, data: PipelineStageUpdate): Promise<PipelineStage> {
    const payload = mapStageUpdateToBackend(data);
    // Backend uses PUT, not PATCH
    const response = await api.put<BackendStepResponse>(
      `/prospective-members/pipelines/${pipelineId}/steps/${stageId}`,
      payload
    );
    return mapStepToStage(response.data);
  },

  async deleteStage(pipelineId: string, stageId: string): Promise<void> {
    await api.delete(`/prospective-members/pipelines/${pipelineId}/steps/${stageId}`);
  },

  async reorderStages(pipelineId: string, stageIds: string[]): Promise<PipelineStage[]> {
    // Backend uses PUT and expects step_ids, not stage_ids
    const response = await api.put<BackendStepResponse[]>(
      `/prospective-members/pipelines/${pipelineId}/steps/reorder`,
      { step_ids: stageIds }
    );
    return response.data.map(mapStepToStage);
  },

  async updateInactivitySettings(pipelineId: string, config: InactivityConfig): Promise<Pipeline> {
    const response = await api.put<BackendPipelineResponse>(`/prospective-members/pipelines/${pipelineId}`, {
      inactivity_config: config,
    });
    return mapPipelineResponse(response.data);
  },

  async updateReportSettings(
    pipelineId: string,
    reportStageGroups: ReportStageGroup[],
  ): Promise<Pipeline> {
    const response = await api.patch<BackendPipelineResponse>(
      `/prospective-members/pipelines/${pipelineId}/report-settings`,
      { report_stage_groups: reportStageGroups },
    );
    return mapPipelineResponse(response.data);
  },
};

// =============================================================================
// Applicant Service (backend calls these "prospects")
// =============================================================================

/** Shape of the paginated prospect list from the backend. */
interface BackendPaginatedProspectList {
  items: BackendProspectListResponse[];
  total: number;
  limit: number;
  offset: number;
}

export const applicantService = {
  async getApplicants(params?: {
    filters?: ApplicantListFilters | undefined;
    page?: number | undefined;
    pageSize?: number | undefined;
  }): Promise<PaginatedApplicantList> {
    const page = params?.page ?? 1;
    const pageSize = params?.pageSize ?? 25;
    const offset = (page - 1) * pageSize;

    // Backend uses /prospects with limit/offset, not /applicants with page/page_size
    const response = await api.get<BackendPaginatedProspectList | BackendProspectListResponse[]>(
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

    // Backend returns { items, total, limit, offset } or a bare array
    const data = response.data;
    let items: BackendProspectListResponse[];
    let total: number;

    if (Array.isArray(data)) {
      items = data;
      total = data.length;
    } else if (data && 'items' in data && Array.isArray(data.items)) {
      items = data.items;
      total = data.total ?? items.length;
    } else {
      items = [];
      total = 0;
    }

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
    const response = await api.get<BackendProspectResponse>(`/prospective-members/prospects/${applicantId}`);
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
      desired_membership_type: data.target_membership_type,
      notes: data.notes,
    };
    if (data.address) {
      payload.address_street = data.address.street;
      payload.address_city = data.address.city;
      payload.address_state = data.address.state;
      payload.address_zip = data.address.zip_code;
    }
    const response = await api.post<BackendProspectResponse>('/prospective-members/prospects', payload);
    return mapProspectToApplicant(response.data);
  },

  async updateApplicant(applicantId: string, data: ApplicantUpdate): Promise<Applicant> {
    // Map frontend field names to backend and use PUT
    const payload: Record<string, unknown> = {};
    if (data.first_name !== undefined) payload.first_name = data.first_name;
    if (data.last_name !== undefined) payload.last_name = data.last_name;
    if (data.email !== undefined) payload.email = data.email;
    if (data.phone !== undefined) payload.phone = data.phone;
    if (data.date_of_birth !== undefined) payload.date_of_birth = data.date_of_birth;
    if (data.target_membership_type !== undefined) payload.desired_membership_type = data.target_membership_type;
    if (data.notes !== undefined) payload.notes = data.notes;
    if (data.status !== undefined) payload.status = data.status;
    if (data.address) {
      payload.address_street = data.address.street;
      payload.address_city = data.address.city;
      payload.address_state = data.address.state;
      payload.address_zip = data.address.zip_code;
    }
    // Backend uses PUT, not PATCH
    const response = await api.put<BackendProspectResponse>(`/prospective-members/prospects/${applicantId}`, payload);
    return mapProspectToApplicant(response.data);
  },

  async deleteApplicant(applicantId: string): Promise<void> {
    // Backend doesn't have a delete prospect endpoint; this may 404
    await api.delete(`/prospective-members/prospects/${applicantId}`);
  },

  async checkExisting(
    email: string,
    firstName?: string,
    lastName?: string
  ): Promise<{ has_matches: boolean; match_count: number; matches: Array<{ status: string; match_type: string }> }> {
    const params: Record<string, string> = { email };
    if (firstName) params.first_name = firstName;
    if (lastName) params.last_name = lastName;
    const response = await api.post<{
      has_matches: boolean;
      match_count: number;
      matches: Array<{ status: string; match_type: string }>;
    }>('/prospective-members/prospects/check-existing', null, { params });
    return response.data;
  },

  async getActivity(
    applicantId: string,
    limit?: number
  ): Promise<
    Array<{
      id: string;
      prospect_id: string;
      action: string;
      details: Record<string, unknown>;
      performed_by: string;
      performer_name: string;
      created_at: string;
    }>
  > {
    const params: Record<string, unknown> = {};
    if (limit) params.limit = limit;
    const response = await api.get<
      Array<{
        id: string;
        prospect_id: string;
        action: string;
        details: Record<string, unknown>;
        performed_by: string;
        performer_name: string;
        created_at: string;
      }>
    >(`/prospective-members/prospects/${applicantId}/activity`, { params });
    return response.data;
  },

  async completeStep(applicantId: string, stepId: string, notes?: string): Promise<Applicant> {
    const response = await api.post<BackendProspectResponse>(
      `/prospective-members/prospects/${applicantId}/complete-step`,
      { step_id: stepId, notes }
    );
    return mapProspectToApplicant(response.data);
  },

  async advanceStage(applicantId: string, data?: AdvanceStageRequest): Promise<Applicant> {
    const response = await api.post<BackendProspectResponse>(
      `/prospective-members/prospects/${applicantId}/advance`,
      data ? { notes: data.notes } : {}
    );
    return mapProspectToApplicant(response.data);
  },

  async regressStage(applicantId: string, data?: AdvanceStageRequest): Promise<Applicant> {
    const response = await api.post<BackendProspectResponse>(
      `/prospective-members/prospects/${applicantId}/regress`,
      data ? { notes: data.notes } : {}
    );
    return mapProspectToApplicant(response.data);
  },

  async rejectApplicant(applicantId: string, reason?: string): Promise<Applicant> {
    // Backend doesn't have a dedicated reject endpoint; use update with status
    const response = await api.put<BackendProspectResponse>(`/prospective-members/prospects/${applicantId}`, {
      status: 'rejected',
      notes: reason,
    });
    return mapProspectToApplicant(response.data);
  },

  async putOnHold(applicantId: string, reason?: string): Promise<Applicant> {
    const response = await api.put<BackendProspectResponse>(`/prospective-members/prospects/${applicantId}`, {
      status: 'on_hold',
      notes: reason,
    });
    return mapProspectToApplicant(response.data);
  },

  async withdrawApplicant(applicantId: string, data?: WithdrawApplicantRequest): Promise<Applicant> {
    const response = await api.put<BackendProspectResponse>(`/prospective-members/prospects/${applicantId}`, {
      status: 'withdrawn',
      notes: data?.reason,
    });
    return mapProspectToApplicant(response.data);
  },

  async resumeApplicant(applicantId: string): Promise<Applicant> {
    // Resume by setting status back to active
    const response = await api.put<BackendProspectResponse>(`/prospective-members/prospects/${applicantId}`, {
      status: 'active',
    });
    return mapProspectToApplicant(response.data);
  },

  async reactivateApplicant(applicantId: string, data?: ReactivateApplicantRequest): Promise<Applicant> {
    const response = await api.put<BackendProspectResponse>(`/prospective-members/prospects/${applicantId}`, {
      status: 'active',
      notes: data?.notes,
    });
    return mapProspectToApplicant(response.data);
  },

  async getInactiveApplicants(params?: {
    pipeline_id?: string | undefined;
    search?: string | undefined;
    page?: number | undefined;
    pageSize?: number | undefined;
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
    pipeline_id?: string | undefined;
    search?: string | undefined;
    page?: number | undefined;
    pageSize?: number | undefined;
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

  async purgeInactiveApplicants(pipelineId: string, data: PurgeInactiveRequest): Promise<PurgeInactiveResponse> {
    const response = await api.post<{ purged_count: number; message: string }>(
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

  async convertToMember(applicantId: string, data: ConvertApplicantRequest): Promise<ConvertApplicantResponse> {
    // Backend uses /transfer endpoint with different payload shape.
    // Map 'regular' → 'probationary' since all regular members start as probationary.
    const backendMembershipType = data.target_membership_type === 'regular' ? 'probationary' : data.target_membership_type;
    const payload: Record<string, unknown> = {
      send_welcome_email: data.send_welcome_email,
      membership_type: backendMembershipType,
    };
    if (data.target_role_id) {
      payload.role_ids = [data.target_role_id];
    }
    if (data.middle_name) payload.middle_name = data.middle_name;
    if (data.hire_date) payload.hire_date = data.hire_date;
    if (data.rank) payload.rank = data.rank;
    if (data.station) payload.station = data.station;
    if (data.emergency_contacts?.length) payload.emergency_contacts = data.emergency_contacts;
    const response = await api.post<{ user_id: string; message?: string }>(
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
    const response = await api.get<BackendDocumentResponse[]>(
      `/prospective-members/prospects/${applicantId}/documents`
    );
    const docs: BackendDocumentResponse[] = response.data || [];
    return docs.map((d) => mapDocumentResponse(d, applicantId));
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
    const response = await api.post<BackendDocumentResponse>(
      `/prospective-members/prospects/${applicantId}/documents`,
      null,
      {
        params: {
          document_type: documentType,
          file_name: file.name,
          file_path: `/uploads/prospects/${applicantId}/${file.name}`,
          file_size: file.size,
          mime_type: file.type ?? undefined,
          step_id: stageId ?? undefined,
        },
      }
    );
    return mapDocumentResponse(response.data, applicantId);
  },

  async deleteDocument(applicantId: string, documentId: string): Promise<void> {
    await api.delete(`/prospective-members/prospects/${applicantId}/documents/${documentId}`);
  },

  async getElectionPackage(applicantId: string): Promise<ElectionPackage | null> {
    try {
      const response = await api.get<BackendElectionPackageResponse>(
        `/prospective-members/prospects/${applicantId}/election-package`
      );
      return mapElectionPackageResponse(response.data);
    } catch (err: unknown) {
      if (err instanceof AxiosError && err.response?.status === 404) return null;
      throw err;
    }
  },

  async createElectionPackage(applicantId: string, data: ElectionPackageCreate): Promise<ElectionPackage> {
    const response = await api.post<BackendElectionPackageResponse>(
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

  async updateElectionPackage(applicantId: string, data: ElectionPackageUpdate): Promise<ElectionPackage> {
    const payload: Record<string, unknown> = {};
    if (data.status !== undefined) payload.status = data.status;
    if (data.coordinator_notes !== undefined) payload.coordinator_notes = data.coordinator_notes;
    // Pack extra fields into package_config
    const configUpdates: Record<string, unknown> = {};
    if (data.supporting_statement !== undefined) configUpdates.supporting_statement = data.supporting_statement;
    if (data.custom_fields !== undefined) configUpdates.custom_fields = data.custom_fields;
    if (Object.keys(configUpdates).length > 0) payload.package_config = configUpdates;

    const response = await api.put<BackendElectionPackageResponse>(
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
    current_stage_name?: string | undefined;
    pipeline_name?: string | undefined;
    total_stages: number;
    stage_timeline: { stage_name: string; status: string; completed_at?: string | undefined }[];
    applied_at?: string | undefined;
  }> {
    const response = await axios.get<{
      first_name: string;
      last_name: string;
      status: string;
      current_stage_name?: string | undefined;
      pipeline_name?: string | undefined;
      total_stages: number;
      stage_timeline: { stage_name: string; status: string; completed_at?: string | undefined }[];
      applied_at?: string | undefined;
    }>(`/api/public/v1/application-status/${token}`);
    return response.data;
  },
};

// =============================================================================
// Interview Service
// =============================================================================

export const interviewService = {
  async getInterviews(applicantId: string): Promise<Interview[]> {
    const response = await api.get<Interview[]>(
      `/prospective-members/prospects/${applicantId}/interviews`
    );
    return response.data;
  },

  async createInterview(applicantId: string, data: InterviewCreate): Promise<Interview> {
    const response = await api.post<Interview>(
      `/prospective-members/prospects/${applicantId}/interviews`,
      data
    );
    return response.data;
  },

  async updateInterview(interviewId: string, data: InterviewUpdate): Promise<Interview> {
    const response = await api.put<Interview>(
      `/prospective-members/interviews/${interviewId}`,
      data
    );
    return response.data;
  },

  async deleteInterview(interviewId: string): Promise<void> {
    await api.delete(`/prospective-members/interviews/${interviewId}`);
  },
};

// =============================================================================
// Event Link Service
// =============================================================================

export const eventLinkService = {
  async getLinkedEvents(applicantId: string): Promise<ProspectEventLink[]> {
    const response = await api.get<ProspectEventLink[]>(
      `/prospective-members/prospects/${applicantId}/events`
    );
    return response.data;
  },

  async linkEvent(applicantId: string, eventId: string): Promise<ProspectEventLink> {
    const response = await api.post<ProspectEventLink>(
      `/prospective-members/prospects/${applicantId}/events`,
      { event_id: eventId }
    );
    return response.data;
  },

  async unlinkEvent(applicantId: string, linkId: string): Promise<void> {
    await api.delete(`/prospective-members/prospects/${applicantId}/events/${linkId}`);
  },
};

export const electionPackageService = {
  async getPendingPackages(pipelineId?: string): Promise<ElectionPackage[]> {
    const params: Record<string, string> = { status: 'ready' };
    if (pipelineId) params.pipeline_id = pipelineId;
    const response = await api.get<BackendElectionPackageResponse[]>('/prospective-members/election-packages', {
      params,
    });
    return (response.data || []).map(mapElectionPackageResponse);
  },

  async getAllPackages(params?: {
    pipeline_id?: string | undefined;
    status?: string | undefined;
  }): Promise<ElectionPackage[]> {
    const response = await api.get<BackendElectionPackageResponse[]>('/prospective-members/election-packages', {
      params: {
        pipeline_id: params?.pipeline_id,
        status: params?.status,
      },
    });
    return (response.data || []).map(mapElectionPackageResponse);
  },
};
