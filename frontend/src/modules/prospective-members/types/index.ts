/**
 * Prospective Members Module Types
 *
 * TypeScript interfaces and types for the prospective member pipeline.
 */

// =============================================================================
// Enumerations
// =============================================================================

export type StageType =
  | 'form_submission'
  | 'document_upload'
  | 'election_vote'
  | 'manual_approval';

export type ApplicantStatus =
  | 'active'
  | 'on_hold'
  | 'withdrawn'
  | 'converted'
  | 'rejected';

export type TargetMembershipType = 'administrative' | 'probationary';

export type PipelineViewMode = 'kanban' | 'table';

// =============================================================================
// Pipeline Stage Configuration
// =============================================================================

export interface FormStageConfig {
  form_id: string;
  form_name?: string;
}

export interface DocumentStageConfig {
  required_document_types: string[];
  allow_multiple: boolean;
}

export interface ElectionStageConfig {
  voting_method: 'simple_majority' | 'approval' | 'supermajority';
  victory_condition: 'most_votes' | 'majority' | 'supermajority';
  victory_percentage?: number;
  eligible_voter_roles: string[];
  anonymous_voting: boolean;
}

export interface ManualApprovalConfig {
  approver_roles: string[];
  require_notes: boolean;
}

export type StageConfig =
  | FormStageConfig
  | DocumentStageConfig
  | ElectionStageConfig
  | ManualApprovalConfig;

// =============================================================================
// Pipeline Stage
// =============================================================================

export interface PipelineStage {
  id: string;
  pipeline_id: string;
  name: string;
  description?: string;
  stage_type: StageType;
  config: StageConfig;
  sort_order: number;
  is_required: boolean;
  created_at: string;
  updated_at: string;
}

export interface PipelineStageCreate {
  name: string;
  description?: string;
  stage_type: StageType;
  config: StageConfig;
  sort_order: number;
  is_required?: boolean;
}

export interface PipelineStageUpdate {
  name?: string;
  description?: string;
  stage_type?: StageType;
  config?: StageConfig;
  sort_order?: number;
  is_required?: boolean;
}

// =============================================================================
// Pipeline
// =============================================================================

export interface Pipeline {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  is_active: boolean;
  stages: PipelineStage[];
  applicant_count?: number;
  created_at: string;
  updated_at: string;
}

export interface PipelineCreate {
  name: string;
  description?: string;
  is_active?: boolean;
}

export interface PipelineUpdate {
  name?: string;
  description?: string;
  is_active?: boolean;
}

export interface PipelineListItem {
  id: string;
  name: string;
  description?: string;
  is_active: boolean;
  stage_count: number;
  applicant_count: number;
  created_at: string;
}

// =============================================================================
// Stage Artifacts (documents, form submissions, votes)
// =============================================================================

export interface StageArtifact {
  id: string;
  type: 'form_submission' | 'document' | 'election_result' | 'approval_note';
  name: string;
  url?: string;
  data?: Record<string, unknown>;
  created_at: string;
  created_by?: string;
}

// =============================================================================
// Stage History
// =============================================================================

export interface StageHistoryEntry {
  id: string;
  stage_id: string;
  stage_name: string;
  stage_type: StageType;
  entered_at: string;
  completed_at?: string;
  completed_by?: string;
  completed_by_name?: string;
  notes?: string;
  artifacts: StageArtifact[];
}

// =============================================================================
// Applicant
// =============================================================================

export interface Applicant {
  id: string;
  pipeline_id: string;
  pipeline_name?: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  date_of_birth?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zip_code?: string;
  };
  current_stage_id: string;
  current_stage_name?: string;
  current_stage_type?: StageType;
  stage_entered_at: string;
  target_membership_type: TargetMembershipType;
  target_role_id?: string;
  target_role_name?: string;
  form_submission_id?: string;
  status: ApplicantStatus;
  notes?: string;
  stage_history: StageHistoryEntry[];
  created_at: string;
  updated_at: string;
}

export interface ApplicantListItem {
  id: string;
  pipeline_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  current_stage_id: string;
  current_stage_name?: string;
  current_stage_type?: StageType;
  stage_entered_at: string;
  target_membership_type: TargetMembershipType;
  target_role_name?: string;
  status: ApplicantStatus;
  days_in_stage: number;
  days_in_pipeline: number;
  created_at: string;
}

export interface ApplicantCreate {
  pipeline_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  date_of_birth?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zip_code?: string;
  };
  target_membership_type: TargetMembershipType;
  target_role_id?: string;
  form_submission_id?: string;
  notes?: string;
}

export interface ApplicantUpdate {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  date_of_birth?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zip_code?: string;
  };
  target_membership_type?: TargetMembershipType;
  target_role_id?: string;
  status?: ApplicantStatus;
  notes?: string;
}

// =============================================================================
// Stage Actions
// =============================================================================

export interface AdvanceStageRequest {
  notes?: string;
  artifacts?: {
    type: StageArtifact['type'];
    name: string;
    url?: string;
    data?: Record<string, unknown>;
  }[];
}

export interface ConvertApplicantRequest {
  target_membership_type: TargetMembershipType;
  target_role_id?: string;
  send_welcome_email: boolean;
  notes?: string;
}

export interface ConvertApplicantResponse {
  applicant_id: string;
  user_id: string;
  membership_type: TargetMembershipType;
  message: string;
}

// =============================================================================
// Pagination & Filtering
// =============================================================================

export interface PaginatedApplicantList {
  items: ApplicantListItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface ApplicantListFilters {
  pipeline_id?: string;
  stage_id?: string;
  status?: ApplicantStatus;
  target_membership_type?: TargetMembershipType;
  search?: string;
}

// =============================================================================
// Pipeline Statistics
// =============================================================================

export interface PipelineStats {
  pipeline_id: string;
  total_applicants: number;
  active_applicants: number;
  converted_count: number;
  rejected_count: number;
  withdrawn_count: number;
  on_hold_count: number;
  avg_days_to_convert: number;
  by_stage: {
    stage_id: string;
    stage_name: string;
    count: number;
  }[];
  conversion_rate: number;
}

// =============================================================================
// Document Upload
// =============================================================================

export interface ApplicantDocument {
  id: string;
  applicant_id: string;
  stage_id: string;
  document_type: string;
  file_name: string;
  file_url: string;
  file_size: number;
  mime_type: string;
  uploaded_by: string;
  uploaded_at: string;
}

export interface DocumentUploadRequest {
  stage_id: string;
  document_type: string;
  file: File;
}
