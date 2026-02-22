/**
 * Membership Pipeline API Service — Compatibility Shim
 *
 * This file re-exports the canonical API from the prospective-members module.
 * Pages that still import from here will get the same functionality without
 * maintaining a second axios client or duplicating request logic.
 *
 * New code should import directly from
 *   '@/modules/prospective-members/services/api'
 */

import { api } from '../modules/prospective-members/services/api';

// ---------------------------------------------------------------------------
// Re-exported types
//
// These mirror the "backend terminology" types that the three legacy pages use.
// The canonical module types use "applicant/stage" terminology instead.
// ---------------------------------------------------------------------------

export interface PipelineStep {
  id: string;
  pipeline_id: string;
  name: string;
  description?: string;
  step_type: 'action' | 'checkbox' | 'note' | 'interview' | 'reference_check';
  action_type?: 'send_email' | 'schedule_meeting' | 'collect_document' | 'custom';
  is_first_step: boolean;
  is_final_step: boolean;
  sort_order: number;
  email_template_id?: string;
  required: boolean;
  created_at: string;
  updated_at: string;
}

export interface Pipeline {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  is_template: boolean;
  is_default: boolean;
  is_active: boolean;
  auto_transfer_on_approval: boolean;
  created_by?: string;
  created_at: string;
  updated_at: string;
  steps: PipelineStep[];
  prospect_count?: number;
}

export interface PipelineListItem {
  id: string;
  name: string;
  description?: string;
  is_template: boolean;
  is_default: boolean;
  is_active: boolean;
  auto_transfer_on_approval: boolean;
  step_count?: number;
  prospect_count?: number;
  created_at: string;
}

export interface ProspectListItem {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  status: string;
  pipeline_id?: string;
  pipeline_name?: string;
  current_step_id?: string;
  current_step_name?: string;
  created_at: string;
}

export interface StepProgress {
  id: string;
  prospect_id: string;
  step_id: string;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  completed_at?: string;
  completed_by?: string;
  notes?: string;
  action_result?: Record<string, unknown>;
  step?: PipelineStep;
  created_at: string;
  updated_at: string;
}

export interface Prospect {
  id: string;
  organization_id: string;
  pipeline_id?: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  mobile?: string;
  date_of_birth?: string;
  address_street?: string;
  address_city?: string;
  address_state?: string;
  address_zip?: string;
  interest_reason?: string;
  referral_source?: string;
  referred_by?: string;
  current_step_id?: string;
  status: string;
  metadata?: Record<string, unknown>;
  form_submission_id?: string;
  transferred_user_id?: string;
  transferred_at?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
  current_step?: PipelineStep;
  step_progress?: StepProgress[];
  pipeline_name?: string;
}

export interface ActivityLogEntry {
  id: string;
  prospect_id: string;
  action: string;
  details?: Record<string, unknown>;
  performed_by?: string;
  performer_name?: string;
  created_at: string;
}

export interface KanbanColumn {
  step: PipelineStep;
  prospects: ProspectListItem[];
  count: number;
}

export interface KanbanBoard {
  pipeline: PipelineListItem;
  columns: KanbanColumn[];
  total_prospects: number;
}

export interface PipelineStepCreate {
  name: string;
  description?: string;
  step_type?: 'action' | 'checkbox' | 'note' | 'interview' | 'reference_check';
  action_type?: string;
  is_first_step?: boolean;
  is_final_step?: boolean;
  sort_order?: number;
  email_template_id?: string;
  required?: boolean;
}

export interface PipelineCreate {
  name: string;
  description?: string;
  is_template?: boolean;
  is_default?: boolean;
  auto_transfer_on_approval?: boolean;
  steps?: PipelineStepCreate[];
}

export interface PipelineUpdate {
  name?: string;
  description?: string;
  is_default?: boolean;
  is_active?: boolean;
  auto_transfer_on_approval?: boolean;
}

export interface ProspectCreate {
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  mobile?: string;
  date_of_birth?: string;
  address_street?: string;
  address_city?: string;
  address_state?: string;
  address_zip?: string;
  interest_reason?: string;
  referral_source?: string;
  referred_by?: string;
  pipeline_id?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface ProspectUpdate {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  date_of_birth?: string;
  address_street?: string;
  address_city?: string;
  address_state?: string;
  address_zip?: string;
  interest_reason?: string;
  referral_source?: string;
  referred_by?: string;
  notes?: string;
  status?: string;
}

export interface TransferRequest {
  username?: string;
  membership_id?: string;
  rank?: string;
  station?: string;
  role_ids?: string[];
  send_welcome_email?: boolean;
}

export interface TransferResponse {
  success: boolean;
  prospect_id: string;
  user_id: string;
  membership_number?: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Service facade — delegates to the canonical module APIs
//
// Method names match the old API so existing pages don't need changes.
// ---------------------------------------------------------------------------

export const membershipPipelineService = {
  // Pipeline CRUD — direct API calls return backend-native shapes
  listPipelines: async (includeTemplates = true): Promise<PipelineListItem[]> => {
    const { data } = await api.get('/prospective-members/pipelines', {
      params: { include_templates: includeTemplates },
    });
    return data;
  },

  getPipeline: async (pipelineId: string): Promise<Pipeline> => {
    const { data } = await api.get(`/prospective-members/pipelines/${pipelineId}`);
    return data;
  },

  createPipeline: async (payload: PipelineCreate): Promise<Pipeline> => {
    const { data } = await api.post('/prospective-members/pipelines', payload);
    return data;
  },

  updatePipeline: async (pipelineId: string, payload: PipelineUpdate): Promise<Pipeline> => {
    const { data } = await api.put(`/prospective-members/pipelines/${pipelineId}`, payload);
    return data;
  },

  deletePipeline: async (pipelineId: string): Promise<void> => {
    await api.delete(`/prospective-members/pipelines/${pipelineId}`);
  },

  duplicatePipeline: async (pipelineId: string, name: string): Promise<Pipeline> => {
    const { data } = await api.post(`/prospective-members/pipelines/${pipelineId}/duplicate`, null, {
      params: { name },
    });
    return data;
  },

  seedTemplates: async (): Promise<{ message: string }> => {
    const { data } = await api.post('/prospective-members/pipelines/default/seed-templates');
    return data;
  },

  // Pipeline Steps
  addStep: async (pipelineId: string, payload: PipelineStepCreate): Promise<PipelineStep> => {
    const { data } = await api.post(`/prospective-members/pipelines/${pipelineId}/steps`, payload);
    return data;
  },

  updateStep: async (pipelineId: string, stepId: string, payload: Partial<PipelineStepCreate>): Promise<PipelineStep> => {
    const { data } = await api.put(`/prospective-members/pipelines/${pipelineId}/steps/${stepId}`, payload);
    return data;
  },

  deleteStep: async (pipelineId: string, stepId: string): Promise<void> => {
    await api.delete(`/prospective-members/pipelines/${pipelineId}/steps/${stepId}`);
  },

  reorderSteps: async (pipelineId: string, stepIds: string[]): Promise<PipelineStep[]> => {
    const { data } = await api.put(`/prospective-members/pipelines/${pipelineId}/steps/reorder`, {
      step_ids: stepIds,
    });
    return data;
  },

  // Kanban Board
  getKanbanBoard: async (pipelineId: string): Promise<KanbanBoard> => {
    const { data } = await api.get(`/prospective-members/pipelines/${pipelineId}/kanban`);
    return data;
  },

  // Prospects
  getProspect: async (prospectId: string): Promise<Prospect> => {
    const { data } = await api.get(`/prospective-members/prospects/${prospectId}`);
    return data;
  },

  createProspect: async (payload: ProspectCreate): Promise<Prospect> => {
    const { data } = await api.post('/prospective-members/prospects', payload);
    return data;
  },

  updateProspect: async (prospectId: string, payload: ProspectUpdate): Promise<Prospect> => {
    const { data } = await api.put(`/prospective-members/prospects/${prospectId}`, payload);
    return data;
  },

  completeStep: async (prospectId: string, stepId: string, notes?: string): Promise<Prospect> => {
    const { data } = await api.post(`/prospective-members/prospects/${prospectId}/complete-step`, {
      step_id: stepId, notes,
    });
    return data;
  },

  advanceProspect: async (prospectId: string, notes?: string): Promise<Prospect> => {
    const { data } = await api.post(`/prospective-members/prospects/${prospectId}/advance`, { notes });
    return data;
  },

  transferProspect: async (prospectId: string, payload: TransferRequest): Promise<TransferResponse> => {
    const { data } = await api.post(
      `/prospective-members/prospects/${prospectId}/transfer`,
      payload
    );
    return data;
  },

  getProspectActivity: async (prospectId: string, limit = 50): Promise<ActivityLogEntry[]> => {
    const { data } = await api.get(`/prospective-members/prospects/${prospectId}/activity`, {
      params: { limit },
    });
    return data;
  },
};

// ---------------------------------------------------------------------------
// Re-exported types from the canonical module
//
// Interview and reference check types are defined in the module's types and
// exposed here so that consumers of this shim can access them without adding
// a second import path.
// ---------------------------------------------------------------------------

export type {
  InterviewRecord,
  InterviewCreate,
  InterviewUpdate,
  InterviewHistory,
  InterviewStatus,
  InterviewQuestionItem,
  InterviewStageConfig,
  ReferenceCheckRecord,
  ReferenceCheckCreate,
  ReferenceCheckUpdate,
  ReferenceCheckStatus,
  ReferenceCheckStageConfig,
} from '../modules/prospective-members/types';
