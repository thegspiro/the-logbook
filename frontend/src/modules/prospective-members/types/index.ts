/**
 * Prospective Members Module Types
 *
 * TypeScript interfaces and types for the prospective member pipeline.
 */

// =============================================================================
// Enumerations
// =============================================================================

// Import enum types from the canonical source and re-export
import type { StageType, ApplicantStatus } from '../../../constants/enums';
export type { StageType, ApplicantStatus };

/** Backend step progress status values (mirrors StepProgressStatus enum). */
export const StepProgressStatus = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  SKIPPED: 'skipped',
} as const;
export type StepProgressStatus = (typeof StepProgressStatus)[keyof typeof StepProgressStatus];

export type InactivityTimeoutPreset = '3_months' | '6_months' | '1_year' | 'never' | 'custom';

export type InactivityAlertLevel = 'normal' | 'warning' | 'critical';

export const TIMEOUT_PRESET_DAYS: Record<InactivityTimeoutPreset, number | null> = {
  '3_months': 90,
  '6_months': 180,
  '1_year': 365,
  never: null,
  custom: null,
};

export const TIMEOUT_PRESET_LABELS: Record<InactivityTimeoutPreset, string> = {
  '3_months': '3 Months',
  '6_months': '6 Months',
  '1_year': '1 Year',
  never: 'Never',
  custom: 'Custom',
};

export type TargetMembershipType = 'regular' | 'administrative';

export type PipelineViewMode = 'kanban' | 'table';

// =============================================================================
// Inactivity Configuration
// =============================================================================

export interface InactivityConfig {
  timeout_preset: InactivityTimeoutPreset;
  custom_timeout_days?: number | undefined;
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
  form_name?: string | undefined;
}

export interface FormPipelineValidation {
  valid: boolean;
  mapped_fields: Record<string, { field_id: string; label: string; method: string }>;
  missing_required: string[];
  suggestions: string[];
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
  custom_note_prompt?: string | undefined; // prompt shown to coordinator when packaging
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
  victory_percentage?: number | undefined;
  eligible_voter_roles: string[];
  anonymous_voting: boolean;
  package_fields?: ElectionPackageFieldConfig | undefined;
}

export interface ManualApprovalConfig {
  approver_roles: string[];
  require_notes: boolean;
}

export type MeetingType = 'chief_meeting' | 'president_meeting' | 'informational' | 'business_meeting' | 'other';

export interface MeetingStageConfig {
  meeting_type: MeetingType;
  meeting_description?: string | undefined;
  required_attendees?: string[] | undefined;
  linked_event_type?: string | undefined;
  linked_event_id?: string | undefined;
}

export interface StatusPageToggleConfig {
  enable_public_status: boolean;
  custom_message?: string | undefined;
}

export interface AutomatedEmailSection {
  id: string;
  title: string;
  content: string;
  enabled: boolean;
}

export interface AutomatedEmailStageConfig {
  email_subject: string;
  include_welcome: boolean;
  welcome_message?: string | undefined;
  include_faq_link: boolean;
  faq_url?: string | undefined;
  include_next_meeting: boolean;
  next_meeting_details?: string | undefined;
  next_meeting_event_type?: string | undefined;
  next_meeting_event_id?: string | undefined;
  include_status_tracker: boolean;
  custom_sections?: AutomatedEmailSection[] | undefined;
}

export type StageConfig =
  | FormStageConfig
  | DocumentStageConfig
  | ElectionStageConfig
  | ManualApprovalConfig
  | MeetingStageConfig
  | StatusPageToggleConfig
  | AutomatedEmailStageConfig;

// =============================================================================
// Pipeline Stage
// =============================================================================

export interface PipelineStage {
  id: string;
  pipeline_id: string;
  name: string;
  description?: string | undefined;
  stage_type: StageType;
  config: StageConfig;
  sort_order: number;
  is_required: boolean;
  inactivity_timeout_days?: number | null | undefined; // null = use pipeline default
  notify_prospect_on_completion: boolean;
  public_visible: boolean;
  created_at: string;
  updated_at: string;
}

export interface PipelineStageCreate {
  name: string;
  description?: string | undefined;
  stage_type: StageType;
  config: StageConfig;
  sort_order: number;
  is_required?: boolean | undefined;
  inactivity_timeout_days?: number | null | undefined;
  notify_prospect_on_completion?: boolean | undefined;
  public_visible?: boolean | undefined;
}

export interface PipelineStageUpdate {
  name?: string | undefined;
  description?: string | undefined;
  stage_type?: StageType | undefined;
  config?: StageConfig | undefined;
  sort_order?: number | undefined;
  is_required?: boolean | undefined;
  inactivity_timeout_days?: number | null | undefined;
  notify_prospect_on_completion?: boolean | undefined;
  public_visible?: boolean | undefined;
}

// =============================================================================
// Pipeline
// =============================================================================

export interface Pipeline {
  id: string;
  organization_id: string;
  name: string;
  description?: string | undefined;
  is_active: boolean;
  is_template: boolean;
  is_default: boolean;
  inactivity_config: InactivityConfig;
  public_status_enabled: boolean;
  stages: PipelineStage[];
  applicant_count?: number | undefined;
  created_at: string;
  updated_at: string;
}

export interface PipelineCreate {
  name: string;
  description?: string | undefined;
  is_active?: boolean | undefined;
  is_template?: boolean | undefined;
  inactivity_config?: InactivityConfig | undefined;
}

export interface PipelineUpdate {
  name?: string | undefined;
  description?: string | undefined;
  is_active?: boolean | undefined;
  is_default?: boolean | undefined;
  is_template?: boolean | undefined;
  inactivity_config?: InactivityConfig | undefined;
  public_status_enabled?: boolean | undefined;
}

export interface PipelineListItem {
  id: string;
  name: string;
  description?: string | undefined;
  is_active: boolean;
  is_template: boolean;
  is_default: boolean;
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
  url?: string | undefined;
  data?: Record<string, unknown> | undefined;
  created_at: string;
  created_by?: string | undefined;
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
  completed_at?: string | undefined;
  completed_by?: string | undefined;
  completed_by_name?: string | undefined;
  notes?: string | undefined;
  artifacts: StageArtifact[];
  /** Raw action_result from the backend step progress record */
  action_result?: Record<string, unknown> | undefined;
}

// =============================================================================
// Applicant
// =============================================================================

export interface Applicant {
  id: string;
  pipeline_id: string;
  pipeline_name?: string | undefined;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string | undefined;
  date_of_birth?: string | undefined;
  address?:
    | {
        street?: string | undefined;
        city?: string | undefined;
        state?: string | undefined;
        zip_code?: string | undefined;
      }
    | undefined;
  current_stage_id: string;
  current_stage_name?: string | undefined;
  current_stage_type?: StageType | undefined;
  stage_entered_at: string;
  target_membership_type: TargetMembershipType;
  target_role_id?: string | undefined;
  target_role_name?: string | undefined;
  form_submission_id?: string | undefined;
  status_token?: string | undefined;
  status: ApplicantStatus;
  notes?: string | undefined;
  stage_history: StageHistoryEntry[];
  total_stages: number;
  last_activity_at: string;
  deactivated_at?: string | undefined;
  deactivated_reason?: string | undefined;
  reactivated_at?: string | undefined;
  withdrawn_at?: string | undefined;
  withdrawal_reason?: string | undefined;
  created_at: string;
  updated_at: string;
}

export interface ApplicantListItem {
  id: string;
  pipeline_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string | undefined;
  current_stage_id: string;
  current_stage_name?: string | undefined;
  current_stage_type?: StageType | undefined;
  stage_entered_at: string;
  target_membership_type: TargetMembershipType;
  target_role_name?: string | undefined;
  status: ApplicantStatus;
  days_in_stage: number;
  days_in_pipeline: number;
  last_activity_at: string;
  days_since_activity: number;
  inactivity_alert_level: InactivityAlertLevel;
  inactivity_timeout_days?: number | undefined; // effective timeout for this applicant's current stage
  deactivated_at?: string | undefined;
  withdrawn_at?: string | undefined;
  withdrawal_reason?: string | undefined;
  created_at: string;
}

export interface ApplicantCreate {
  pipeline_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string | undefined;
  date_of_birth?: string | undefined;
  address?:
    | {
        street?: string | undefined;
        city?: string | undefined;
        state?: string | undefined;
        zip_code?: string | undefined;
      }
    | undefined;
  target_membership_type: TargetMembershipType;
  target_role_id?: string | undefined;
  form_submission_id?: string | undefined;
  notes?: string | undefined;
}

export interface ApplicantUpdate {
  first_name?: string | undefined;
  last_name?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
  date_of_birth?: string | undefined;
  address?:
    | {
        street?: string | undefined;
        city?: string | undefined;
        state?: string | undefined;
        zip_code?: string | undefined;
      }
    | undefined;
  target_membership_type?: TargetMembershipType | undefined;
  target_role_id?: string | undefined;
  status?: ApplicantStatus | undefined;
  notes?: string | undefined;
}

// =============================================================================
// Stage Actions
// =============================================================================

export interface AdvanceStageRequest {
  notes?: string | undefined;
  artifacts?:
    | {
        type: StageArtifact['type'];
        name: string;
        url?: string | undefined;
        data?: Record<string, unknown> | undefined;
      }[]
    | undefined;
}

export interface ConvertApplicantRequest {
  target_membership_type: TargetMembershipType;
  target_role_id?: string | undefined;
  send_welcome_email: boolean;
  notes?: string | undefined;
  // Two-step wizard fields
  middle_name?: string | undefined;
  hire_date?: string | undefined;
  rank?: string | undefined;
  station?: string | undefined;
  emergency_contacts?: EmergencyContact[] | undefined;
}

export interface EmergencyContact {
  name: string;
  relationship: string;
  phone: string;
  email?: string | undefined;
  is_primary?: boolean | undefined;
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
  status: ApplicantStatus;
  current_stage_name?: string | undefined;
  pipeline_name?: string | undefined;
  total_stages: number;
  stage_timeline: {
    stage_name: string;
    status: string;
    completed_at?: string | undefined;
  }[];
  applied_at?: string | undefined;
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
  pipeline_id?: string | undefined;
  stage_id?: string | undefined;
  status?: ApplicantStatus | undefined;
  target_membership_type?: TargetMembershipType | undefined;
  search?: string | undefined;
  include_inactive?: boolean | undefined;
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
  reason?: string | undefined;
}

export interface ReactivateApplicantRequest {
  notes?: string | undefined;
}

export interface PurgeInactiveRequest {
  applicant_ids?: string[] | undefined; // specific IDs, or omit to purge all eligible
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
  applicant_email?: string | undefined;
  applicant_phone?: string | undefined;
  target_membership_type: TargetMembershipType;
  target_role_name?: string | undefined;

  // Coordinator-provided context
  coordinator_notes?: string | undefined;
  supporting_statement?: string | undefined; // shown on ballot or to voters

  // Collected pipeline data
  documents?: { name: string; url: string }[] | undefined;
  stage_summary?: { stage_name: string; completed_at?: string | undefined }[] | undefined;
  custom_fields?: Record<string, string> | undefined;

  // Recommended ballot item configuration (from stage config)
  recommended_ballot_item?:
    | {
        type: 'membership_approval';
        title: string;
        description: string;
        eligible_voter_types: string[];
        vote_type: 'approval';
        voting_method: string;
        victory_condition: string;
        victory_percentage?: number | undefined;
        anonymous_voting: boolean;
      }
    | undefined;

  // Status tracking
  status: ElectionPackageStatus;
  election_id?: string | undefined;
  candidate_id?: string | undefined;

  created_at: string;
  updated_at: string;
  submitted_at?: string | undefined; // when coordinator marked as ready
  submitted_by?: string | undefined;
}

export interface ElectionPackageCreate {
  applicant_id: string;
  pipeline_id: string;
  stage_id: string;
  coordinator_notes?: string | undefined;
  supporting_statement?: string | undefined;
}

export interface ElectionPackageUpdate {
  coordinator_notes?: string | undefined;
  supporting_statement?: string | undefined;
  custom_fields?: Record<string, string> | undefined;
  status?: ElectionPackageStatus | undefined;
}

// =============================================================================
// Backend Response Types (used by services/api.ts mapping layer)
// =============================================================================

/**
 * Backend pipeline step response — the backend uses "steps" where the
 * frontend uses "stages". These types mirror the Pydantic schemas in
 * backend/app/schemas/membership_pipeline.py.
 */
export interface BackendStepResponse {
  id: string;
  pipeline_id: string;
  name: string;
  description: string | null;
  step_type: string;
  action_type: string | null;
  is_first_step: boolean;
  is_final_step: boolean;
  sort_order: number;
  email_template_id: string | null;
  required: boolean;
  config: Record<string, unknown> | null;
  inactivity_timeout_days: number | null;
  notify_prospect_on_completion: boolean;
  public_visible: boolean;
  created_at: string;
  updated_at: string;
}

/** Backend pipeline response (PipelineResponse schema). */
export interface BackendPipelineResponse {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  is_template: boolean;
  is_default: boolean;
  is_active: boolean;
  auto_transfer_on_approval: boolean;
  inactivity_config: Record<string, unknown> | null;
  public_status_enabled: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  steps: BackendStepResponse[];
  prospect_count: number | null;
}

/** Backend pipeline list response (PipelineListResponse schema). */
export interface BackendPipelineListResponse {
  id: string;
  name: string;
  description: string | null;
  is_template: boolean;
  is_default: boolean;
  is_active: boolean;
  auto_transfer_on_approval: boolean;
  step_count: number | null;
  prospect_count: number | null;
  created_at: string;
}

/** Backend step progress record (StepProgressResponse schema). */
export interface BackendStepProgressResponse {
  id: string;
  prospect_id: string;
  step_id: string;
  status: StepProgressStatus;
  completed_at: string | null;
  completed_by: string | null;
  notes: string | null;
  action_result: Record<string, unknown> | null;
  step: BackendStepResponse | null;
  created_at: string;
  updated_at: string;
}

/** Backend prospect response (ProspectResponse schema). */
export interface BackendProspectResponse {
  id: string;
  organization_id: string;
  pipeline_id: string | null;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  mobile: string | null;
  date_of_birth: string | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  interest_reason: string | null;
  referral_source: string | null;
  referred_by: string | null;
  desired_membership_type: string | null;
  notes: string | null;
  current_step_id: string | null;
  status: string | { value: string };
  metadata: Record<string, unknown> | null;
  form_submission_id: string | null;
  status_token: string | null;
  transferred_user_id: string | null;
  transferred_at: string | null;
  created_at: string;
  updated_at: string;
  current_step: BackendStepResponse | null;
  step_progress: BackendStepProgressResponse[] | null;
  pipeline_name: string | null;
}

/** Backend prospect list item response (ProspectListResponse schema). */
export interface BackendProspectListResponse {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  status: string | { value: string };
  pipeline_id: string | null;
  pipeline_name: string | null;
  current_step_id: string | null;
  current_step_name: string | null;
  desired_membership_type: string | null;
  created_at: string;
}

/** Backend election package response (ElectionPackageResponse schema). */
export interface BackendElectionPackageResponse {
  id: string;
  prospect_id: string;
  pipeline_id: string | null;
  step_id: string | null;
  election_id: string | null;
  status: ElectionPackageStatus;
  applicant_snapshot: {
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
  } | null;
  coordinator_notes: string | null;
  package_config: {
    supporting_statement?: string;
    documents?: { name: string; url: string }[];
    stage_summary?: { stage_name: string; completed_at?: string }[];
    custom_fields?: Record<string, string>;
    recommended_ballot_item?: ElectionPackage['recommended_ballot_item'];
    candidate_id?: string;
    submitted_at?: string;
    submitted_by?: string;
  } | null;
  created_at: string;
  updated_at: string;
}

/** Backend pipeline stats response (PipelineStatsResponse schema). */
export interface BackendPipelineStatsResponse {
  pipeline_id: string;
  total_prospects: number;
  active_count: number;
  approved_count: number;
  rejected_count: number;
  withdrawn_count: number;
  transferred_count: number;
  by_step: {
    stage_id: string;
    stage_name: string;
    count: number;
  }[];
  avg_days_to_transfer: number | null;
  conversion_rate: number | null;
}

/** Backend document response (ProspectDocumentResponse schema). */
export interface BackendDocumentResponse {
  id: string;
  prospect_id: string;
  step_id: string | null;
  document_type: string;
  file_name: string;
  file_size: number;
  mime_type: string | null;
  uploaded_by: string | null;
  created_at: string;
}

/** Payload shape sent to backend when creating a step. */
export interface BackendStepCreatePayload {
  name: string;
  description?: string | undefined;
  step_type: string;
  action_type?: string | undefined;
  sort_order: number;
  required: boolean;
  config?: Record<string, unknown> | undefined;
  notify_prospect_on_completion: boolean;
  public_visible: boolean;
}

/** Payload shape sent to backend when updating a step. */
export interface BackendStepUpdatePayload {
  name?: string | undefined;
  description?: string | undefined;
  step_type?: string | undefined;
  action_type?: string | undefined;
  sort_order?: number | undefined;
  required?: boolean | undefined;
  config?: Record<string, unknown> | undefined;
  notify_prospect_on_completion?: boolean | undefined;
  public_visible?: boolean | undefined;
}

// =============================================================================
// Linked Events
// =============================================================================

export interface ProspectEventLink {
  id: string;
  prospect_id: string;
  event_id: string;
  event_title?: string | undefined;
  event_type?: string | undefined;
  custom_category?: string | undefined;
  event_start?: string | undefined;
  event_end?: string | undefined;
  event_location?: string | undefined;
  is_cancelled: boolean;
  notes?: string | undefined;
  linked_by?: string | undefined;
  linked_by_name?: string | undefined;
  created_at: string;
}

// =============================================================================
// Interview Types
// =============================================================================

export const InterviewRecommendation = {
  RECOMMEND: 'recommend',
  RECOMMEND_WITH_RESERVATIONS: 'recommend_with_reservations',
  DO_NOT_RECOMMEND: 'do_not_recommend',
  UNDECIDED: 'undecided',
} as const;
export type InterviewRecommendation =
  (typeof InterviewRecommendation)[keyof typeof InterviewRecommendation];

export const INTERVIEW_RECOMMENDATION_LABELS: Record<InterviewRecommendation, string> = {
  recommend: 'Recommend',
  recommend_with_reservations: 'Recommend with Reservations',
  do_not_recommend: 'Do Not Recommend',
  undecided: 'Undecided',
};

export const INTERVIEW_RECOMMENDATION_COLORS: Record<InterviewRecommendation, string> = {
  recommend: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  recommend_with_reservations:
    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  do_not_recommend: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  undecided: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
};

export interface Interview {
  id: string;
  prospect_id: string;
  pipeline_id?: string | undefined;
  step_id?: string | undefined;
  interviewer_id: string;
  interviewer_name?: string | undefined;
  interviewer_role?: string | undefined;
  notes?: string | undefined;
  recommendation?: InterviewRecommendation | undefined;
  recommendation_notes?: string | undefined;
  interview_date?: string | undefined;
  created_at: string;
  updated_at: string;
}

export interface InterviewCreate {
  notes?: string | undefined;
  recommendation?: InterviewRecommendation | undefined;
  recommendation_notes?: string | undefined;
  interviewer_role?: string | undefined;
  interview_date?: string | undefined;
  step_id?: string | undefined;
}

export interface InterviewUpdate {
  notes?: string | undefined;
  recommendation?: InterviewRecommendation | undefined;
  recommendation_notes?: string | undefined;
  interviewer_role?: string | undefined;
  interview_date?: string | undefined;
}
