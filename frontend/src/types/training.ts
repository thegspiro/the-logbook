/**
 * Training type definitions
 */

import type { Event } from './event';

export type TrainingType =
  | 'certification'
  | 'continuing_education'
  | 'skills_practice'
  | 'orientation'
  | 'refresher'
  | 'specialty';

export type TrainingStatus =
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type RequirementFrequency =
  | 'annual'
  | 'biannual'
  | 'quarterly'
  | 'monthly'
  | 'one_time';

export type DueDateType =
  | 'calendar_period'   // Due by end of calendar period (e.g., Dec 31st)
  | 'rolling'           // Due X months from last completion
  | 'certification_period'  // Due when certification expires
  | 'fixed_date';       // Due by a specific fixed date

/**
 * Training Session
 *
 * Links a training event with a training course.
 * When created, generates both an Event (for scheduling/RSVP/QR codes)
 * and a TrainingCourse record.
 */
export interface TrainingSession {
  id: string;
  event_id: string;  // Links to Event table
  course_id?: string;  // Links to TrainingCourse if using existing course

  // Category and program linkage
  category_id?: string;     // Training category (Fire, EMS, Hazmat, etc.)
  program_id?: string;      // Training program (Recruit School, Driver Training, etc.)
  phase_id?: string;        // Program phase
  requirement_id?: string;  // Specific requirement this satisfies

  // Training-specific details
  course_name: string;
  course_code?: string;
  training_type: TrainingType;
  credit_hours: number;
  instructor?: string;
  max_participants?: number;

  // Certification details
  certification_number_prefix?: string;  // Will append member ID
  issuing_agency?: string;
  expiration_months?: number;

  // Requirements
  prerequisites?: string[];
  materials_required?: string[];

  // Populated from Event
  event?: Event;

  // Stats
  registered_count?: number;
  checked_in_count?: number;
  completed_count?: number;

  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface TrainingSessionCreate {
  // Event details
  title: string;
  description?: string;
  location?: string;
  location_details?: string;
  start_datetime: string;
  end_datetime: string;
  requires_rsvp?: boolean;
  rsvp_deadline?: string;
  max_attendees?: number;
  is_mandatory?: boolean;
  eligible_roles?: string[];

  // Use existing course or create new
  use_existing_course?: boolean;
  course_id?: string;  // If using existing course

  // Category and program linkage
  category_id?: string;     // Training category (Fire, EMS, Hazmat, etc.)
  program_id?: string;      // Training program (Recruit School, Driver Training, etc.)
  phase_id?: string;        // Program phase
  requirement_id?: string;  // Specific requirement this satisfies

  // Training details (for new course)
  course_name?: string;
  course_code?: string;
  training_type: TrainingType;
  credit_hours: number;
  instructor?: string;

  // Certification
  issues_certification?: boolean;
  certification_number_prefix?: string;
  issuing_agency?: string;
  expiration_months?: number;

  // Requirements
  prerequisites?: string[];
  materials_required?: string[];

  // Auto-completion settings
  auto_create_records?: boolean;  // Create TrainingRecords on check-in
  require_completion_confirmation?: boolean;  // Instructor must confirm completion
}

// Training Category Types
export interface TrainingCategory {
  id: string;
  organization_id: string;
  name: string;
  code?: string;
  description?: string;
  color?: string;  // Hex color like #FF5733
  parent_category_id?: string;
  sort_order: number;
  icon?: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface TrainingCategoryCreate {
  name: string;
  code?: string;
  description?: string;
  color?: string;
  parent_category_id?: string;
  sort_order?: number;
  icon?: string;
}

export interface TrainingCategoryUpdate {
  name?: string;
  code?: string;
  description?: string;
  color?: string;
  parent_category_id?: string;
  sort_order?: number;
  icon?: string;
  active?: boolean;
}

export interface TrainingCourse {
  id: string;
  organization_id: string;
  name: string;
  code?: string;
  description?: string;
  training_type: TrainingType;
  duration_hours?: number;
  credit_hours?: number;
  prerequisites?: string[];
  expiration_months?: number;
  instructor?: string;
  max_participants?: number;
  materials_required?: string[];
  category_ids?: string[];  // Categories this course belongs to
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface TrainingCourseCreate {
  name: string;
  code?: string;
  description?: string;
  training_type: TrainingType;
  duration_hours?: number;
  credit_hours?: number;
  prerequisites?: string[];
  expiration_months?: number;
  instructor?: string;
  max_participants?: number;
  materials_required?: string[];
  category_ids?: string[];
}

export interface TrainingCourseUpdate {
  name?: string;
  code?: string;
  description?: string;
  training_type?: TrainingType;
  duration_hours?: number;
  credit_hours?: number;
  prerequisites?: string[];
  expiration_months?: number;
  instructor?: string;
  max_participants?: number;
  materials_required?: string[];
  category_ids?: string[];
  active?: boolean;
}

export interface TrainingRecord {
  id: string;
  organization_id: string;
  user_id: string;
  course_id?: string;
  course_name: string;
  course_code?: string;
  training_type: TrainingType;
  scheduled_date?: string;
  completion_date?: string;
  expiration_date?: string;
  hours_completed: number;
  credit_hours?: number;
  certification_number?: string;
  issuing_agency?: string;
  status: TrainingStatus;
  score?: number;
  passing_score?: number;
  passed?: boolean;
  instructor?: string;
  location?: string;
  notes?: string;
  attachments?: string[];
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface TrainingRecordCreate {
  user_id: string;
  course_id?: string;
  course_name: string;
  course_code?: string;
  training_type: TrainingType;
  scheduled_date?: string;
  completion_date?: string;
  expiration_date?: string;
  hours_completed: number;
  credit_hours?: number;
  certification_number?: string;
  issuing_agency?: string;
  status?: TrainingStatus;
  score?: number;
  passing_score?: number;
  passed?: boolean;
  instructor?: string;
  location?: string;
  notes?: string;
  attachments?: string[];
}

export interface TrainingRecordUpdate {
  course_name?: string;
  course_code?: string;
  training_type?: TrainingType;
  scheduled_date?: string;
  completion_date?: string;
  expiration_date?: string;
  hours_completed?: number;
  credit_hours?: number;
  certification_number?: string;
  issuing_agency?: string;
  status?: TrainingStatus;
  score?: number;
  passing_score?: number;
  passed?: boolean;
  instructor?: string;
  location?: string;
  notes?: string;
  attachments?: string[];
}

export interface TrainingRequirement {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  training_type?: TrainingType;
  required_hours?: number;
  required_courses?: string[];
  frequency: RequirementFrequency;
  year?: number;
  applies_to_all: boolean;
  required_roles?: string[];
  start_date?: string;
  due_date?: string;
  // Due date calculation fields
  due_date_type: DueDateType;
  rolling_period_months?: number;  // For rolling due dates: months between required completions
  period_start_month?: number;     // For calendar period: month the period starts (1-12)
  period_start_day?: number;       // For calendar period: day the period starts (1-31)
  category_ids?: string[];         // Training categories that satisfy this requirement
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface TrainingRequirementCreate {
  name: string;
  description?: string;
  training_type?: TrainingType;
  required_hours?: number;
  required_courses?: string[];
  frequency: RequirementFrequency;
  year?: number;
  applies_to_all?: boolean;
  required_roles?: string[];
  start_date?: string;
  due_date?: string;
  // Due date calculation fields
  due_date_type?: DueDateType;
  rolling_period_months?: number;
  period_start_month?: number;
  period_start_day?: number;
  category_ids?: string[];
}

export interface TrainingRequirementUpdate {
  name?: string;
  description?: string;
  training_type?: TrainingType;
  required_hours?: number;
  required_courses?: string[];
  frequency?: RequirementFrequency;
  year?: number;
  applies_to_all?: boolean;
  required_roles?: string[];
  start_date?: string;
  due_date?: string;
  // Due date calculation fields
  due_date_type?: DueDateType;
  rolling_period_months?: number;
  period_start_month?: number;
  period_start_day?: number;
  category_ids?: string[];
  active?: boolean;
}

export interface UserTrainingStats {
  user_id: string;
  total_hours: number;
  hours_this_year: number;
  total_certifications: number;
  active_certifications: number;
  expiring_soon: number;
  expired: number;
  completed_courses: number;
}

export interface TrainingHoursSummary {
  training_type: TrainingType;
  total_hours: number;
  record_count: number;
}

export interface TrainingReport {
  user_id?: string;
  start_date: string;
  end_date: string;
  total_hours: number;
  hours_by_type: TrainingHoursSummary[];
  records: TrainingRecord[];
  requirements_met: string[];
  requirements_pending: string[];
}

export interface RequirementProgress {
  requirement_id: string;
  requirement_name: string;
  required_hours?: number;
  completed_hours: number;
  percentage_complete: number;
  is_complete: boolean;
  due_date?: string;
  due_date_type?: DueDateType;
  days_until_due?: number;  // Negative if overdue
}

// ==================== Training Program Types ====================

export type RequirementType =
  | 'hours'
  | 'courses'
  | 'certification'
  | 'shifts'
  | 'calls'
  | 'skills_evaluation'
  | 'checklist';

export type RequirementSource = 'department' | 'state' | 'national';

export type ProgramStructureType = 'sequential' | 'phases' | 'flexible';

export type EnrollmentStatus = 'active' | 'completed' | 'on_hold' | 'withdrawn' | 'failed';

export type RequirementProgressStatus = 'not_started' | 'in_progress' | 'completed' | 'waived';

// Enhanced Training Requirement (with all requirement types)
export interface TrainingRequirementEnhanced {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  requirement_type: RequirementType;
  source: RequirementSource;
  registry_name?: string;
  registry_code?: string;
  is_editable: boolean;

  // Different requirement quantities
  training_type?: TrainingType;
  required_hours?: number;
  required_courses?: string[];
  required_shifts?: number;
  required_calls?: number;
  required_call_types?: string[];
  required_skills?: string[];
  checklist_items?: string[];

  frequency: RequirementFrequency;
  time_limit_days?: number;
  applies_to_all: boolean;
  required_positions?: string[];
  required_roles?: string[];

  active: boolean;
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface TrainingRequirementEnhancedCreate {
  name: string;
  description?: string;
  requirement_type: RequirementType;
  source?: RequirementSource;
  registry_name?: string;
  registry_code?: string;
  is_editable?: boolean;
  training_type?: TrainingType;
  required_hours?: number;
  required_courses?: string[];
  required_shifts?: number;
  required_calls?: number;
  required_call_types?: string[];
  required_skills?: string[];
  checklist_items?: string[];
  frequency: RequirementFrequency;
  time_limit_days?: number;
  applies_to_all?: boolean;
  required_positions?: string[];
  required_roles?: string[];
}

// Training Program
export interface TrainingProgram {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  code?: string;
  version: number;
  target_position?: string;
  target_roles?: string[];
  structure_type: ProgramStructureType;
  prerequisite_program_ids?: string[];
  allows_concurrent_enrollment: boolean;
  time_limit_days?: number;
  warning_days_before: number;
  reminder_conditions?: {
    milestone_threshold?: number;
    days_before_deadline?: number;
    send_if_below_percentage?: number;
  };
  is_template: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface TrainingProgramCreate {
  name: string;
  description?: string;
  code?: string;
  target_position?: string;
  target_roles?: string[];
  structure_type?: ProgramStructureType;
  prerequisite_program_ids?: string[];
  allows_concurrent_enrollment?: boolean;
  time_limit_days?: number;
  warning_days_before?: number;
  reminder_conditions?: {
    milestone_threshold?: number;
    days_before_deadline?: number;
    send_if_below_percentage?: number;
  };
  is_template?: boolean;
}

export interface ProgramPhase {
  id: string;
  program_id: string;
  phase_number: number;
  name: string;
  description?: string;
  prerequisite_phase_ids?: string[];
  requires_manual_advancement: boolean;
  time_limit_days?: number;
  created_at: string;
  updated_at: string;
}

export interface ProgramPhaseCreate {
  program_id: string;
  phase_number: number;
  name: string;
  description?: string;
  prerequisite_phase_ids?: string[];
  requires_manual_advancement?: boolean;
  time_limit_days?: number;
}

export interface ProgramRequirement {
  id: string;
  program_id: string;
  phase_id?: string;
  requirement_id: string;
  is_required: boolean;
  is_prerequisite: boolean;
  sort_order: number;
  program_specific_description?: string;
  custom_deadline_days?: number;
  notification_message?: string;
  created_at: string;
  requirement?: TrainingRequirementEnhanced;
}

export interface ProgramRequirementCreate {
  program_id: string;
  phase_id?: string;
  requirement_id: string;
  is_required?: boolean;
  is_prerequisite?: boolean;
  sort_order?: number;
  program_specific_description?: string;
  custom_deadline_days?: number;
  notification_message?: string;
}

export interface ProgramMilestone {
  id: string;
  program_id: string;
  phase_id?: string;
  name: string;
  description?: string;
  completion_percentage_threshold: number;
  notification_message?: string;
  created_at: string;
}

export interface ProgramMilestoneCreate {
  program_id: string;
  phase_id?: string;
  name: string;
  description?: string;
  completion_percentage_threshold: number;
  notification_message?: string;
}

export interface ProgramEnrollment {
  id: string;
  user_id: string;
  program_id: string;
  enrolled_at: string;
  target_completion_date?: string;
  current_phase_id?: string;
  progress_percentage: number;
  status: EnrollmentStatus;
  completed_at?: string;
  deadline_warning_sent: boolean;
  notes?: string;
  created_at: string;
  updated_at: string;
  program?: TrainingProgram;
  current_phase?: ProgramPhase;
}

export interface ProgramEnrollmentCreate {
  user_id: string;
  program_id: string;
  target_completion_date?: string;
  notes?: string;
}

export interface RequirementProgressRecord {
  id: string;
  enrollment_id: string;
  requirement_id: string;
  status: RequirementProgressStatus;
  progress_value: number;
  progress_percentage: number;
  progress_notes?: string | null;
  started_at?: string;
  completed_at?: string;
  verified_by?: string;
  verified_at?: string;
  created_at: string;
  updated_at: string;
  requirement?: TrainingRequirementEnhanced;
}

export interface RequirementProgressUpdate {
  status?: RequirementProgressStatus;
  progress_value?: number;
  progress_notes?: string | null;
  verified_by?: string;
}

export interface ProgramWithDetails extends TrainingProgram {
  phases: ProgramPhase[];
  requirements: TrainingRequirementEnhanced[];
  milestones: ProgramMilestone[];
  total_requirements: number;
  total_required: number;
}

export interface MemberProgramProgress {
  enrollment: ProgramEnrollment;
  program: TrainingProgram;
  current_phase?: ProgramPhase;
  requirement_progress: RequirementProgressRecord[];
  completed_requirements: number;
  total_requirements: number;
  next_milestones: ProgramMilestone[];
  time_remaining_days?: number;
  is_behind_schedule: boolean;
}

export interface RegistryImportResult {
  registry_name: string;
  imported_count: number;
  skipped_count: number;
  errors: string[];
}

// Bulk Enrollment
export interface BulkEnrollmentRequest {
  user_ids: string[];
  target_completion_date?: string;
}

export interface BulkEnrollmentResponse {
  success_count: number;
  enrolled_users: string[];
  errors: string[];
}

// ==================== External Training Integration Types ====================

export type ExternalProviderType =
  | 'vector_solutions'
  | 'target_solutions'
  | 'lexipol'
  | 'i_am_responding'
  | 'custom_api';

export type SyncStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'partial';

export type ImportStatus =
  | 'pending'
  | 'imported'
  | 'failed'
  | 'skipped'
  | 'duplicate';

export interface ExternalProviderConfig {
  // Vector Solutions / TargetSolutions specific
  site_id?: string;              // Required for Vector Solutions - the TS site identifier
  page_size?: number;            // Max records per page (Vector Solutions max: 1000)
  date_filter_param?: string;    // Custom date filter parameter name

  // General endpoint overrides
  records_endpoint?: string;     // Override the default records endpoint path
  users_endpoint?: string;       // Override the default users endpoint path
  categories_endpoint?: string;  // Override the default categories endpoint path
  test_endpoint?: string;        // Override the default connection test endpoint

  // Custom API support
  param_mapping?: Record<string, string>;   // Map standard param names to provider-specific names
  field_mapping?: Record<string, string>;   // Map standard field names to provider-specific names
  records_path?: string;                     // JSON path to records array in response (e.g. "data.records")
  additional_headers?: Record<string, string>;
  date_format?: string;
}

export interface ExternalTrainingProvider {
  id: string;
  organization_id: string;
  name: string;
  provider_type: ExternalProviderType;
  description?: string;
  api_base_url?: string;
  auth_type: 'api_key' | 'oauth2' | 'basic';
  config?: ExternalProviderConfig;
  auto_sync_enabled: boolean;
  sync_interval_hours: number;
  default_category_id?: string;
  active: boolean;
  connection_verified: boolean;
  last_connection_test?: string;
  connection_error?: string;
  last_sync_at?: string;
  next_sync_at?: string;
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface ExternalTrainingProviderCreate {
  name: string;
  provider_type: ExternalProviderType;
  description?: string;
  api_base_url?: string;
  api_key?: string;
  api_secret?: string;
  client_id?: string;
  client_secret?: string;
  auth_type?: 'api_key' | 'oauth2' | 'basic';
  config?: ExternalProviderConfig;
  auto_sync_enabled?: boolean;
  sync_interval_hours?: number;
  default_category_id?: string;
}

export interface ExternalTrainingProviderUpdate {
  name?: string;
  description?: string;
  api_base_url?: string;
  api_key?: string;
  api_secret?: string;
  client_id?: string;
  client_secret?: string;
  auth_type?: 'api_key' | 'oauth2' | 'basic';
  config?: ExternalProviderConfig;
  auto_sync_enabled?: boolean;
  sync_interval_hours?: number;
  default_category_id?: string;
  active?: boolean;
}

export interface ExternalCategoryMapping {
  id: string;
  provider_id: string;
  organization_id: string;
  external_category_id: string;
  external_category_name: string;
  external_category_code?: string;
  internal_category_id?: string;
  is_mapped: boolean;
  auto_mapped: boolean;
  created_at: string;
  updated_at: string;
  mapped_by?: string;
  internal_category_name?: string;
}

export interface ExternalCategoryMappingUpdate {
  internal_category_id?: string;
  is_mapped?: boolean;
}

export interface ExternalUserMapping {
  id: string;
  provider_id: string;
  organization_id: string;
  external_user_id: string;
  external_username?: string;
  external_email?: string;
  external_name?: string;
  internal_user_id?: string;
  is_mapped: boolean;
  auto_mapped: boolean;
  created_at: string;
  updated_at: string;
  mapped_by?: string;
  internal_user_name?: string;
  internal_user_email?: string;
}

export interface ExternalUserMappingUpdate {
  internal_user_id?: string;
  is_mapped?: boolean;
}

export interface ExternalTrainingSyncLog {
  id: string;
  provider_id: string;
  organization_id: string;
  sync_type: 'full' | 'incremental' | 'manual';
  status: SyncStatus;
  started_at: string;
  completed_at?: string;
  records_fetched: number;
  records_imported: number;
  records_updated: number;
  records_skipped: number;
  records_failed: number;
  error_message?: string;
  sync_from_date?: string;
  sync_to_date?: string;
  created_at: string;
  initiated_by?: string;
}

export interface ExternalTrainingImport {
  id: string;
  provider_id: string;
  organization_id: string;
  sync_log_id?: string;
  external_record_id: string;
  external_user_id?: string;
  course_title: string;
  course_code?: string;
  description?: string;
  duration_minutes?: number;
  completion_date?: string;
  score?: number;
  passed?: boolean;
  external_category_name?: string;
  training_record_id?: string;
  user_id?: string;
  import_status: ImportStatus;
  import_error?: string;
  imported_at?: string;
  created_at: string;
  updated_at: string;
}

export interface SyncRequest {
  sync_type: 'full' | 'incremental';
  from_date?: string;
  to_date?: string;
}

export interface SyncResponse {
  sync_log_id: string | null;
  status: SyncStatus;
  message: string;
  records_fetched: number;
  records_imported: number;
  records_failed: number;
}

export interface TestConnectionResponse {
  success: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export interface ImportRecordRequest {
  external_import_id: string;
  user_id: string;
  category_id?: string;
}

export interface BulkImportRequest {
  external_import_ids: string[];
  auto_map_users?: boolean;
  default_category_id?: string;
}

export interface BulkImportResponse {
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  errors: string[];
}

// ==================== Self-Reported Training Types ====================

export type SubmissionStatus =
  | 'draft'
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'revision_requested';

export interface FieldConfig {
  visible: boolean;
  required: boolean;
  label: string;
}

export interface SelfReportConfig {
  id: string;
  organization_id: string;
  require_approval: boolean;
  auto_approve_under_hours?: number;
  approval_deadline_days: number;
  notify_officer_on_submit: boolean;
  notify_member_on_decision: boolean;
  field_config: Record<string, FieldConfig>;
  allowed_training_types?: string[];
  max_hours_per_submission?: number;
  member_instructions?: string;
  created_at: string;
  updated_at: string;
}

export interface SelfReportConfigUpdate {
  require_approval?: boolean;
  auto_approve_under_hours?: number | null;
  approval_deadline_days?: number;
  notify_officer_on_submit?: boolean;
  notify_member_on_decision?: boolean;
  field_config?: Record<string, FieldConfig>;
  allowed_training_types?: string[] | null;
  max_hours_per_submission?: number | null;
  member_instructions?: string | null;
}

export interface TrainingSubmission {
  id: string;
  organization_id: string;
  submitted_by: string;
  course_name: string;
  course_code?: string;
  training_type: TrainingType;
  description?: string;
  completion_date: string;
  hours_completed: number;
  credit_hours?: number;
  instructor?: string;
  location?: string;
  certification_number?: string;
  issuing_agency?: string;
  expiration_date?: string;
  category_id?: string;
  attachments?: string[];
  status: SubmissionStatus;
  reviewed_by?: string;
  reviewed_at?: string;
  reviewer_notes?: string;
  training_record_id?: string;
  submitted_at: string;
  updated_at: string;
}

export interface TrainingSubmissionCreate {
  course_name: string;
  course_code?: string;
  training_type: TrainingType;
  description?: string;
  completion_date: string;
  hours_completed: number;
  credit_hours?: number;
  instructor?: string;
  location?: string;
  certification_number?: string;
  issuing_agency?: string;
  expiration_date?: string;
  category_id?: string;
  attachments?: string[];
}

export interface TrainingSubmissionUpdate {
  course_name?: string;
  course_code?: string;
  training_type?: TrainingType;
  description?: string;
  completion_date?: string;
  hours_completed?: number;
  credit_hours?: number;
  instructor?: string;
  location?: string;
  certification_number?: string;
  issuing_agency?: string;
  expiration_date?: string;
  category_id?: string;
  attachments?: string[];
}

export interface SubmissionReviewRequest {
  action: 'approve' | 'reject' | 'revision_requested';
  reviewer_notes?: string;
  override_hours?: number;
  override_credit_hours?: number;
  override_training_type?: TrainingType;
}
