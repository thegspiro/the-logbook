/**
 * Membership Pipeline API Service
 *
 * Handles all API calls for the prospective member pipeline module.
 */

import axios from 'axios';

const API_BASE_URL = '/api/v1/membership-pipeline';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// Response interceptor for auth errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

// --- Types ---

export interface PipelineStep {
  id: string;
  pipeline_id: string;
  name: string;
  description?: string;
  step_type: 'action' | 'checkbox' | 'note';
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

// --- Create/Update types ---

export interface PipelineStepCreate {
  name: string;
  description?: string;
  step_type?: 'action' | 'checkbox' | 'note';
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
  rank?: string;
  station?: string;
  role_ids?: string[];
  send_welcome_email?: boolean;
}

export interface TransferResponse {
  success: boolean;
  prospect_id: string;
  user_id: string;
  message: string;
}

// --- API Service ---

export const membershipPipelineService = {
  // Pipeline CRUD
  listPipelines: async (includeTemplates = true): Promise<PipelineListItem[]> => {
    const { data } = await api.get('/pipelines', { params: { include_templates: includeTemplates } });
    return data;
  },

  getPipeline: async (pipelineId: string): Promise<Pipeline> => {
    const { data } = await api.get(`/pipelines/${pipelineId}`);
    return data;
  },

  createPipeline: async (payload: PipelineCreate): Promise<Pipeline> => {
    const { data } = await api.post('/pipelines', payload);
    return data;
  },

  updatePipeline: async (pipelineId: string, payload: PipelineUpdate): Promise<Pipeline> => {
    const { data } = await api.put(`/pipelines/${pipelineId}`, payload);
    return data;
  },

  deletePipeline: async (pipelineId: string): Promise<void> => {
    await api.delete(`/pipelines/${pipelineId}`);
  },

  duplicatePipeline: async (pipelineId: string, name: string): Promise<Pipeline> => {
    const { data } = await api.post(`/pipelines/${pipelineId}/duplicate`, null, { params: { name } });
    return data;
  },

  seedTemplates: async (): Promise<{ message: string }> => {
    const { data } = await api.post('/pipelines/default/seed-templates');
    return data;
  },

  // Pipeline Steps
  listSteps: async (pipelineId: string): Promise<PipelineStep[]> => {
    const { data } = await api.get(`/pipelines/${pipelineId}/steps`);
    return data;
  },

  addStep: async (pipelineId: string, payload: PipelineStepCreate): Promise<PipelineStep> => {
    const { data } = await api.post(`/pipelines/${pipelineId}/steps`, payload);
    return data;
  },

  updateStep: async (pipelineId: string, stepId: string, payload: Partial<PipelineStepCreate>): Promise<PipelineStep> => {
    const { data } = await api.put(`/pipelines/${pipelineId}/steps/${stepId}`, payload);
    return data;
  },

  deleteStep: async (pipelineId: string, stepId: string): Promise<void> => {
    await api.delete(`/pipelines/${pipelineId}/steps/${stepId}`);
  },

  reorderSteps: async (pipelineId: string, stepIds: string[]): Promise<PipelineStep[]> => {
    const { data } = await api.put(`/pipelines/${pipelineId}/steps/reorder`, { step_ids: stepIds });
    return data;
  },

  // Kanban Board
  getKanbanBoard: async (pipelineId: string): Promise<KanbanBoard> => {
    const { data } = await api.get(`/pipelines/${pipelineId}/kanban`);
    return data;
  },

  // Prospects
  listProspects: async (params?: {
    pipeline_id?: string;
    status?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<ProspectListItem[]> => {
    const { data } = await api.get('/prospects', { params });
    return data;
  },

  getProspect: async (prospectId: string): Promise<Prospect> => {
    const { data } = await api.get(`/prospects/${prospectId}`);
    return data;
  },

  createProspect: async (payload: ProspectCreate): Promise<Prospect> => {
    const { data } = await api.post('/prospects', payload);
    return data;
  },

  updateProspect: async (prospectId: string, payload: ProspectUpdate): Promise<Prospect> => {
    const { data } = await api.put(`/prospects/${prospectId}`, payload);
    return data;
  },

  completeStep: async (prospectId: string, stepId: string, notes?: string, actionResult?: Record<string, unknown>): Promise<Prospect> => {
    const { data } = await api.post(`/prospects/${prospectId}/complete-step`, {
      step_id: stepId,
      notes,
      action_result: actionResult,
    });
    return data;
  },

  advanceProspect: async (prospectId: string, notes?: string): Promise<Prospect> => {
    const { data } = await api.post(`/prospects/${prospectId}/advance`, { notes });
    return data;
  },

  transferProspect: async (prospectId: string, payload: TransferRequest): Promise<TransferResponse> => {
    const { data } = await api.post(`/prospects/${prospectId}/transfer`, payload);
    return data;
  },

  getProspectActivity: async (prospectId: string, limit = 50): Promise<ActivityLogEntry[]> => {
    const { data } = await api.get(`/prospects/${prospectId}/activity`, { params: { limit } });
    return data;
  },
};
