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
  | 'rejected'
  | 'inactive';

export type InactivityTimeoutPreset = '3_months' | '6_months' | '1_year' | 'never' | 'custom';

export type InactivityAlertLevel = 'normal' | 'warning' | 'critical';

export const TIMEOUT_PRESET_DAYS: Record<InactivityTimeoutPreset, number | null> = {
  '3_months': 90,
  '6_months': 180,
  '1_year': 365,
  'never': null,
  'custom': null,
};

export const TIMEOUT_PRESET_LABELS: Record<InactivityTimeoutPreset, string> = {
  '3_months': '3 Months',
  '6_months': '6 Months',
  '1_year': '1 Year',
  'never': 'Never',
  'custom': 'Custom',
};

export type TargetMembershipType = 'administrative' | 'probationary';

export type PipelineViewMode = 'kanban' | 'table';

// =============================================================================
// Inactivity Configuration
// =============================================================================

export interface InactivityConfig {
  timeout_preset: InactivityTimeoutPreset;
  custom_timeout_days?: number;
  warning_threshold_percent: number; // default 80 — warn at 80% of timeout
  notify_coordinator: boolean;
  notify_applicant: boolean;
  auto_purge_enabled: boolean;
  purge_days_after_inactive: number; // days after going inactive before purge
}

export const DEFAULT_INACTIVITY_CONFIG: InactivityConfig = {
  timeout_preset: '3_months',
  warning_threshold_percent: 80,
  notify_coordinator: true,
  notify_applicant: false,
  auto_purge_enabled: false,
  purge_days_after_inactive: 365,
};

/**
 * Compute effective timeout days from an InactivityConfig.
 * Returns null if the timeout is disabled ('never').
 */
export function getEffectiveTimeoutDays(config: InactivityConfig): number | null {
  if (config.timeout_preset === 'never') return null;
  if (config.timeout_preset === 'custom') {
    const days = config.custom_timeout_days;
    if (days == null || days <= 0 || !Number.isFinite(days)) return null;
    return days;
  }
  return TIMEOUT_PRESET_DAYS[config.timeout_preset];
}

/** Validate that a URL uses a safe protocol (http/https only). */
export function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Safe initials extraction that handles empty strings. */
export function getInitials(firstName: string, lastName: string): string {
  const f = firstName?.trim();
  const l = lastName?.trim();
  return `${f ? f[0] : '?'}${l ? l[0] : '?'}`.toUpperCase();
}

/** Basic email format validation. */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Allowed file upload constraints. */
export const FILE_UPLOAD_LIMITS = {
  maxSizeBytes: 10 * 1024 * 1024, // 10 MB
  maxSizeLabel: '10 MB',
  allowedMimeTypes: [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/gif',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  allowedExtensions: ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.doc', '.docx'],
} as const;

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

export interface ElectionPackageFieldConfig {
  include_email: boolean;
  include_phone: boolean;
  include_address: boolean;
  include_date_of_birth: boolean;
  include_documents: boolean;
  include_stage_history: boolean;
  custom_note_prompt?: string; // prompt shown to coordinator when packaging
}

export const DEFAULT_ELECTION_PACKAGE_FIELDS: ElectionPackageFieldConfig = {
  include_email: true,
  include_phone: false,
  include_address: false,
  include_date_of_birth: false,
  include_documents: true,
  include_stage_history: true,
};

export interface ElectionStageConfig {
  voting_method: 'simple_majority' | 'approval' | 'supermajority';
  victory_condition: 'most_votes' | 'majority' | 'supermajority';
  victory_percentage?: number;
  eligible_voter_roles: string[];
  anonymous_voting: boolean;
  package_fields?: ElectionPackageFieldConfig;
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
  inactivity_timeout_days?: number | null; // null = use pipeline default
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
  inactivity_timeout_days?: number | null;
}

export interface PipelineStageUpdate {
  name?: string;
  description?: string;
  stage_type?: StageType;
  config?: StageConfig;
  sort_order?: number;
  is_required?: boolean;
  inactivity_timeout_days?: number | null;
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
  inactivity_config: InactivityConfig;
  stages: PipelineStage[];
  applicant_count?: number;
  created_at: string;
  updated_at: string;
}

export interface PipelineCreate {
  name: string;
  description?: string;
  is_active?: boolean;
  inactivity_config?: InactivityConfig;
}

export interface PipelineUpdate {
  name?: string;
  description?: string;
  is_active?: boolean;
  inactivity_config?: InactivityConfig;
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
  status_token?: string;
  status: ApplicantStatus;
  notes?: string;
  stage_history: StageHistoryEntry[];
  last_activity_at: string;
  deactivated_at?: string;
  deactivated_reason?: string;
  reactivated_at?: string;
  withdrawn_at?: string;
  withdrawal_reason?: string;
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
  last_activity_at: string;
  days_since_activity: number;
  inactivity_alert_level: InactivityAlertLevel;
  inactivity_timeout_days?: number; // effective timeout for this applicant's current stage
  deactivated_at?: string;
  withdrawn_at?: string;
  withdrawal_reason?: string;
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
  // Two-step wizard fields
  middle_name?: string;
  hire_date?: string;
  rank?: string;
  station?: string;
  emergency_contacts?: EmergencyContact[];
}

export interface EmergencyContact {
  name: string;
  relationship: string;
  phone: string;
  email?: string;
  is_primary?: boolean;
}

export interface ConvertApplicantResponse {
  applicant_id: string;
  user_id: string;
  membership_type: TargetMembershipType;
  message: string;
}

// Public application status
export interface ApplicationStatus {
  first_name: string;
  last_name: string;
  status: string;
  current_stage_name?: string;
  pipeline_name?: string;
  total_stages: number;
  stage_timeline: {
    stage_name: string;
    status: string;
    completed_at?: string;
  }[];
  applied_at?: string;
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
  include_inactive?: boolean;
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
  inactive_count: number;
  warning_count: number;
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

// =============================================================================
// Inactivity Actions
// =============================================================================

export interface WithdrawApplicantRequest {
  reason?: string;
}

export interface ReactivateApplicantRequest {
  notes?: string;
}

export interface PurgeInactiveRequest {
  applicant_ids?: string[]; // specific IDs, or omit to purge all eligible
  confirm: boolean;
}

export interface PurgeInactiveResponse {
  purged_count: number;
  message: string;
}

// =============================================================================
// Election Package — Integration with Elections Module
// =============================================================================

export type ElectionPackageStatus = 'draft' | 'ready' | 'added_to_ballot' | 'elected' | 'not_elected';

export interface ElectionPackage {
  id: string;
  applicant_id: string;
  pipeline_id: string;
  stage_id: string;

  // Applicant snapshot (captured at package creation time)
  applicant_name: string;
  applicant_email?: string;
  applicant_phone?: string;
  target_membership_type: TargetMembershipType;
  target_role_name?: string;

  // Coordinator-provided context
  coordinator_notes?: string;
  supporting_statement?: string; // shown on ballot or to voters

  // Collected pipeline data
  documents?: { name: string; url: string }[];
  stage_summary?: { stage_name: string; completed_at?: string }[];
  custom_fields?: Record<string, string>;

  // Recommended ballot item configuration (from stage config)
  recommended_ballot_item?: {
    type: 'membership_approval';
    title: string;
    description: string;
    eligible_voter_types: string[];
    vote_type: 'approval';
    voting_method: string;
    victory_condition: string;
    victory_percentage?: number;
    anonymous_voting: boolean;
  };

  // Status tracking
  status: ElectionPackageStatus;
  election_id?: string;
  candidate_id?: string;

  created_at: string;
  updated_at: string;
  submitted_at?: string; // when coordinator marked as ready
  submitted_by?: string;
}

export interface ElectionPackageCreate {
  applicant_id: string;
  pipeline_id: string;
  stage_id: string;
  coordinator_notes?: string;
  supporting_statement?: string;
}

export interface ElectionPackageUpdate {
  coordinator_notes?: string;
  supporting_statement?: string;
  custom_fields?: Record<string, string>;
  status?: ElectionPackageStatus;
}
