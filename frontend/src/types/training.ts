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
  organization_id?: string;
  event_id: string;
  course_id?: string;

  // Category and program linkage
  category_id?: string;
  program_id?: string;
  phase_id?: string;
  requirement_id?: string;

  // Training-specific details
  course_name: string;
  course_code?: string;
  training_type: TrainingType;
  credit_hours: number;
  instructor?: string;
  instructor_id?: string;
  co_instructors?: string[];
  apparatus_id?: string;
  max_participants?: number;

  // Certification details
  issues_certification?: boolean;
  certification_number_prefix?: string;
  issuing_agency?: string;
  expiration_months?: number;

  // Auto-completion & approval settings
  auto_create_records?: boolean;
  require_completion_confirmation?: boolean;
  approval_required?: boolean;
  approval_deadline_days?: number;

  // Finalization status
  is_finalized?: boolean;
  finalized_at?: string;
  finalized_by?: string;

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
  description?: string | undefined;
  location_id?: string | undefined;
  location?: string | undefined;
  location_details?: string | undefined;
  start_datetime: string;
  end_datetime: string;
  requires_rsvp?: boolean | undefined;
  rsvp_deadline?: string | undefined;
  max_attendees?: number | undefined;
  is_mandatory?: boolean | undefined;

  // Use existing course or create new
  use_existing_course?: boolean | undefined;
  course_id?: string | undefined;  // If using existing course

  // Category and program linkage
  category_id?: string | undefined;     // Training category (Fire, EMS, Hazmat, etc.)
  program_id?: string | undefined;      // Training program (Recruit School, Driver Training, etc.)
  phase_id?: string | undefined;        // Program phase
  requirement_id?: string | undefined;  // Specific requirement this satisfies

  // Training details (for new course)
  course_name?: string | undefined;
  course_code?: string | undefined;
  training_type: TrainingType;
  credit_hours: number;
  instructor?: string | undefined;

  // Certification
  issues_certification?: boolean | undefined;
  certification_number_prefix?: string | undefined;
  issuing_agency?: string | undefined;
  expiration_months?: number | undefined;

  // Requirements
  prerequisites?: string[] | undefined;
  materials_required?: string[] | undefined;

  // Auto-completion settings
  auto_create_records?: boolean | undefined;  // Create TrainingRecords on check-in
  require_completion_confirmation?: boolean | undefined;  // Instructor must confirm completion
}

export interface RecurringTrainingSessionCreate extends TrainingSessionCreate {
  recurrence_pattern: import('./event').RecurrencePattern;
  recurrence_end_date: string;
  recurrence_custom_days?: number[] | undefined;
  recurrence_weekday?: number | undefined;
  recurrence_week_ordinal?: number | undefined;
  recurrence_month?: number | undefined;
  recurrence_exceptions?: string[] | undefined;
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
  category_id?: string;
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
  location_id?: string;
  apparatus_id?: string;
  external_provider_id?: string;
  external_record_id?: string;
  notes?: string;
  attachments?: string[];
  rank_at_completion?: string;
  station_at_completion?: string;
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface TrainingRecordCreate {
  user_id: string;
  course_id?: string;
  category_id?: string;
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
  rank_at_completion?: string;
  station_at_completion?: string;
}

export interface TrainingRecordUpdate {
  course_name?: string;
  course_code?: string;
  training_type?: TrainingType;
  category_id?: string | undefined;
  scheduled_date?: string;
  completion_date?: string;
  expiration_date?: string | undefined;
  hours_completed?: number;
  credit_hours?: number;
  certification_number?: string | undefined;
  issuing_agency?: string | undefined;
  status?: TrainingStatus;
  score?: number;
  passing_score?: number;
  passed?: boolean;
  instructor?: string | undefined;
  location?: string | undefined;
  notes?: string;
  attachments?: string[];
  rank_at_completion?: string | undefined;
  station_at_completion?: string | undefined;
}

// Bulk Training Record Creation
export interface BulkTrainingRecordEntry {
  user_id: string;
  course_name: string;
  course_code?: string;
  course_id?: string;
  category_id?: string;
  training_type?: string;
  completion_date?: string;
  expiration_date?: string;
  hours_completed: number;
  credit_hours?: number;
  certification_number?: string;
  issuing_agency?: string;
  status?: string;
  score?: number;
  passing_score?: number;
  passed?: boolean;
  instructor?: string;
  location?: string;
  notes?: string;
}

export interface BulkTrainingRecordCreate {
  records: BulkTrainingRecordEntry[];
  skip_duplicates?: boolean;
  override_duplicates?: boolean;
}

export interface DuplicateWarning {
  user_id: string;
  course_name: string;
  completion_date?: string;
  existing_record_id: string;
  existing_completion_date?: string;
  message: string;
}

export interface BulkTrainingRecordResult {
  total: number;
  created: number;
  skipped: number;
  failed: number;
  duplicate_warnings: DuplicateWarning[];
  errors: string[];
  created_record_ids: string[];
}

// Compliance Summary
export interface ComplianceSummary {
  user_id: string;
  requirements_met: number;
  requirements_total: number;
  certs_expiring_soon: number;
  certs_expired: number;
  compliance_status: 'green' | 'yellow' | 'red' | 'exempt';
  compliance_label: string;
  hours_this_year: number;
  active_certifications: number;
  is_exempt?: boolean | undefined;
}

export interface TrainingRequirement {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  requirement_type: RequirementType;
  source: RequirementSource;
  registry_name?: string;
  registry_code?: string;
  is_editable?: boolean;
  training_type?: TrainingType;
  // Requirement quantities (field used depends on requirement_type)
  required_hours?: number;
  required_courses?: string[];
  required_shifts?: number;
  required_calls?: number;
  required_call_types?: string[];
  required_skills?: string[];
  checklist_items?: string[];
  passing_score?: number;
  max_attempts?: number;
  frequency: RequirementFrequency;
  year?: number;
  applies_to_all: boolean;
  required_roles?: string[];
  required_positions?: string[];
  required_membership_types?: string[];
  start_date?: string;
  due_date?: string;
  time_limit_days?: number;
  // Due date calculation fields
  due_date_type: DueDateType;
  rolling_period_months?: number;
  period_start_month?: number;
  period_start_day?: number;
  period_end_month?: number;
  period_end_day?: number;
  category_ids?: string[];
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface TrainingRequirementCreate {
  name: string;
  description?: string | undefined;
  requirement_type: RequirementType;
  source?: RequirementSource | undefined;
  registry_name?: string | undefined;
  registry_code?: string | undefined;
  is_editable?: boolean | undefined;
  training_type?: TrainingType | undefined;
  required_hours?: number | undefined;
  required_courses?: string[] | undefined;
  required_shifts?: number | undefined;
  required_calls?: number | undefined;
  required_call_types?: string[] | undefined;
  required_skills?: string[] | undefined;
  checklist_items?: string[] | undefined;
  passing_score?: number | undefined;
  max_attempts?: number | undefined;
  frequency: RequirementFrequency;
  year?: number | undefined;
  applies_to_all?: boolean | undefined;
  required_roles?: string[] | undefined;
  required_positions?: string[] | undefined;
  required_membership_types?: string[] | undefined;
  start_date?: string | undefined;
  due_date?: string | undefined;
  time_limit_days?: number | undefined;
  // Due date calculation fields
  due_date_type?: DueDateType | undefined;
  rolling_period_months?: number | undefined;
  period_start_month?: number | undefined;
  period_start_day?: number | undefined;
  period_end_month?: number | undefined;
  period_end_day?: number | undefined;
  category_ids?: string[] | undefined;
}

export interface TrainingRequirementUpdate {
  name?: string;
  description?: string | undefined;
  requirement_type?: RequirementType;
  source?: RequirementSource | undefined;
  registry_name?: string | undefined;
  registry_code?: string | undefined;
  is_editable?: boolean | undefined;
  training_type?: TrainingType | undefined;
  required_hours?: number | undefined;
  required_courses?: string[] | undefined;
  required_shifts?: number | undefined;
  required_calls?: number | undefined;
  required_call_types?: string[] | undefined;
  required_skills?: string[] | undefined;
  checklist_items?: string[] | undefined;
  passing_score?: number | undefined;
  max_attempts?: number | undefined;
  frequency?: RequirementFrequency;
  year?: number | undefined;
  applies_to_all?: boolean | undefined;
  required_roles?: string[] | undefined;
  required_positions?: string[] | undefined;
  required_membership_types?: string[] | undefined;
  start_date?: string | undefined;
  due_date?: string | undefined;
  time_limit_days?: number | undefined;
  // Due date calculation fields
  due_date_type?: DueDateType | undefined;
  rolling_period_months?: number | undefined;
  period_start_month?: number | undefined;
  period_start_day?: number | undefined;
  period_end_month?: number | undefined;
  period_end_day?: number | undefined;
  category_ids?: string[] | undefined;
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
  | 'checklist'
  | 'knowledge_test';

export type RequirementSource = 'department' | 'state' | 'national';

export type ProgramStructureType = 'sequential' | 'phases' | 'flexible';

export type EnrollmentStatus = 'active' | 'completed' | 'expired' | 'on_hold' | 'withdrawn' | 'failed';

export type RequirementProgressStatus = 'not_started' | 'in_progress' | 'completed' | 'verified' | 'waived';

/**
 * TrainingRequirementEnhanced is now unified with TrainingRequirement,
 * which includes all requirement type fields (shifts, calls, skills, etc.).
 */
export type TrainingRequirementEnhanced = TrainingRequirement;

export type TrainingRequirementEnhancedCreate = TrainingRequirementCreate;

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
  description?: string | undefined;
  code?: string | undefined;
  target_position?: string | undefined;
  target_roles?: string[] | undefined;
  structure_type?: ProgramStructureType | undefined;
  prerequisite_program_ids?: string[] | undefined;
  allows_concurrent_enrollment?: boolean | undefined;
  time_limit_days?: number | undefined;
  warning_days_before?: number | undefined;
  reminder_conditions?: {
    milestone_threshold?: number | undefined;
    days_before_deadline?: number | undefined;
    send_if_below_percentage?: number | undefined;
  } | undefined;
  is_template?: boolean | undefined;
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
  description?: string | undefined;
  prerequisite_phase_ids?: string[] | undefined;
  requires_manual_advancement?: boolean | undefined;
  time_limit_days?: number | undefined;
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
  phase_id?: string | undefined;
  name: string;
  description?: string | undefined;
  completion_percentage_threshold: number;
  notification_message?: string | undefined;
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
  last_updated?: string;
  source_url?: string;
}

export interface RegistryInfo {
  key: string;
  name: string;
  description: string;
  last_updated?: string;
  source_url?: string;
  requirement_count: number;
}

// Bulk Enrollment
export interface BulkEnrollmentRequest {
  user_ids: string[];
  target_completion_date?: string | undefined;
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
  site_id?: string | undefined;  // Required for Vector Solutions - the TS site identifier
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
  description?: string | undefined;
  api_base_url?: string | undefined;
  api_key?: string | undefined;
  api_secret?: string | undefined;
  client_id?: string | undefined;
  client_secret?: string | undefined;
  auth_type?: 'api_key' | 'oauth2' | 'basic' | undefined;
  config?: ExternalProviderConfig | undefined;
  auto_sync_enabled?: boolean | undefined;
  sync_interval_hours?: number | undefined;
  default_category_id?: string | undefined;
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

// Import enum type from the canonical source and re-export
import type { SubmissionStatus } from '../constants/enums';
export type { SubmissionStatus };

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
  course_code?: string | undefined;
  training_type: TrainingType;
  description?: string | undefined;
  completion_date: string;
  hours_completed: number;
  credit_hours?: number | undefined;
  instructor?: string | undefined;
  location?: string | undefined;
  certification_number?: string | undefined;
  issuing_agency?: string | undefined;
  expiration_date?: string | undefined;
  category_id?: string | undefined;
  attachments?: string[] | undefined;
}

export interface TrainingSubmissionUpdate {
  course_name?: string | undefined;
  course_code?: string | undefined;
  training_type?: TrainingType | undefined;
  description?: string | undefined;
  completion_date?: string | undefined;
  hours_completed?: number | undefined;
  credit_hours?: number | undefined;
  instructor?: string | undefined;
  location?: string | undefined;
  certification_number?: string | undefined;
  issuing_agency?: string | undefined;
  expiration_date?: string | undefined;
  category_id?: string | undefined;
  attachments?: string[] | undefined;
}

export interface SubmissionReviewRequest {
  action: 'approve' | 'reject' | 'revision_requested';
  reviewer_notes?: string | undefined;
  override_hours?: number | undefined;
  override_credit_hours?: number | undefined;
  override_training_type?: TrainingType | undefined;
}

// ==================== Shift Completion Reports ====================

export interface SkillObservation {
  skill_name: string;
  demonstrated: boolean;
  score?: number | undefined;
  notes?: string;
  comment?: string | undefined;
}

export interface TaskPerformed {
  task: string;
  description?: string | undefined;
  comment?: string;
}

export interface ShiftCompletionReportCreate {
  shift_id?: string | undefined;
  shift_date: string;
  trainee_id: string;
  hours_on_shift: number;
  calls_responded?: number | undefined;
  call_types?: string[] | undefined;
  performance_rating?: number | undefined;
  areas_of_strength?: string | undefined;
  areas_for_improvement?: string | undefined;
  officer_narrative?: string | undefined;
  skills_observed?: SkillObservation[] | undefined;
  tasks_performed?: TaskPerformed[] | undefined;
  enrollment_id?: string | undefined;
  save_as_draft?: boolean | undefined;
}

export interface ShiftCompletionReport {
  id: string;
  organization_id: string;
  shift_id?: string;
  shift_date: string;
  trainee_id: string;
  officer_id: string;
  hours_on_shift: number;
  calls_responded: number;
  call_types?: string[];
  performance_rating?: number;
  areas_of_strength?: string;
  areas_for_improvement?: string;
  officer_narrative?: string;
  skills_observed?: SkillObservation[];
  tasks_performed?: TaskPerformed[];
  data_sources?: Record<string, string>;
  enrollment_id?: string;
  requirements_progressed?: { requirement_progress_id: string; value_added: number }[];
  review_status: string;  // draft, pending_review, approved, flagged
  reviewed_by?: string;
  reviewed_at?: string;
  reviewer_notes?: string;
  trainee_acknowledged: boolean;
  trainee_acknowledged_at?: string;
  trainee_comments?: string;
  created_at: string;
  updated_at: string;
}

export interface MonthlyShiftData {
  month: string;
  reports: number;
  hours: number;
  calls?: number;
}

export interface TraineeShiftStats {
  total_reports: number;
  total_hours: number | null;
  total_calls: number | null;
  avg_rating: number | null;
  monthly: MonthlyShiftData[];
}

export interface OfficerAnalyticsTrainee {
  trainee_id: string;
  name: string;
  reports: number;
  hours: number;
  calls: number;
  avg_rating: number | null;
}

export interface OfficerShiftAnalytics {
  total_reports: number;
  total_hours: number;
  total_calls: number;
  avg_rating: number | null;
  status_counts: Record<string, number>;
  trainees: OfficerAnalyticsTrainee[];
  monthly: MonthlyShiftData[];
}


// ============================================
// Training Module Configuration (Visibility)
// ============================================

export interface TrainingModuleConfig {
  id: string;
  organization_id: string;
  show_training_history: boolean;
  show_training_hours: boolean;
  show_certification_status: boolean;
  show_pipeline_progress: boolean;
  show_requirement_details: boolean;
  show_shift_reports: boolean;
  show_shift_stats: boolean;
  show_officer_narrative: boolean;
  show_performance_rating: boolean;
  show_areas_of_strength: boolean;
  show_areas_for_improvement: boolean;
  show_skills_observed: boolean;
  show_submission_history: boolean;
  allow_member_report_export: boolean;
  report_review_required: boolean;
  report_review_role: string;
  rating_label: string;
  rating_scale_type: string;  // stars, competency, custom
  rating_scale_labels?: Record<string, string>;  // {"1":"Unsatisfactory","2":"Developing",...}
  apparatus_type_skills?: Record<string, string[]>;
  apparatus_type_tasks?: Record<string, string[]>;
  form_show_performance_rating: boolean;
  form_show_areas_of_strength: boolean;
  form_show_areas_for_improvement: boolean;
  form_show_officer_narrative: boolean;
  form_show_skills_observed: boolean;
  form_show_tasks_performed: boolean;
  form_show_call_types: boolean;
  shift_review_call_types?: string[];
  shift_review_default_skills?: string[];
  shift_review_default_tasks?: string[];
}

export interface MemberVisibility {
  show_training_history: boolean;
  show_training_hours: boolean;
  show_certification_status: boolean;
  show_pipeline_progress: boolean;
  show_requirement_details: boolean;
  show_shift_reports: boolean;
  show_shift_stats: boolean;
  show_officer_narrative: boolean;
  show_performance_rating: boolean;
  show_areas_of_strength: boolean;
  show_areas_for_improvement: boolean;
  show_skills_observed: boolean;
  show_submission_history: boolean;
  allow_member_report_export: boolean;
  report_review_required: boolean;
  report_review_role: string;
  rating_label: string;
  rating_scale_type: string;
  rating_scale_labels?: Record<string, string>;
}

export interface RequirementDetail {
  id: string;
  name: string;
  description?: string;
  frequency: string;
  training_type?: string;
  required_hours: number;
  original_required_hours?: number;
  completed_hours: number;
  progress_percentage: number;
  is_met: boolean;
  due_date?: string;
  days_until_due?: number;
  waived_months?: number;
  active_months?: number;
  cert_expired?: boolean;
  blocks_activity?: boolean;
}

export interface MyTrainingSummary {
  visibility: MemberVisibility;
  requirements_detail?: RequirementDetail[];
  training_records?: Array<{
    id: string;
    course_name: string;
    course_code?: string;
    training_type: string;
    status: string;
    completion_date: string | null;
    hours_completed: number;
    expiration_date: string | null;
    instructor?: string;
  }>;
  hours_summary?: { total_records: number; total_hours: number; completed_courses: number };
  requirements_summary?: { total_requirements: number; met_requirements: number; avg_compliance: number | null };
  certifications?: Array<{
    id: string;
    course_name: string;
    certification_number?: string;
    expiration_date: string | null;
    is_expired: boolean;
    days_until_expiry: number | null;
  }>;
  enrollments?: Array<{
    id: string;
    program_id: string;
    status: string;
    progress_percentage: number;
    enrolled_at: string | null;
    target_completion_date: string | null;
    completed_at: string | null;
    requirements?: Array<{
      id: string;
      requirement_id: string;
      requirement_name?: string;
      status: string;
      progress_value: number;
      progress_percentage: number;
      completed_at: string | null;
    }>;
  }>;
  shift_reports?: Array<{
    id: string;
    shift_date: string;
    hours_on_shift: number;
    calls_responded: number;
    call_types?: string[];
    tasks_performed?: unknown[];
    trainee_acknowledged: boolean;
    performance_rating?: number;
    areas_of_strength?: string;
    areas_for_improvement?: string;
    officer_narrative?: string;
    skills_observed?: unknown[];
  }>;
  shift_stats?: {
    total_shifts: number;
    total_hours: number;
    total_calls: number;
    avg_rating: number | null;
  };
  submissions?: Array<{
    id: string;
    course_name: string;
    training_type: string;
    completion_date: string | null;
    hours_completed: number;
    status: string;
    submitted_at: string | null;
    reviewed_at: string | null;
  }>;
}


// ==================== Historical Training Import ====================

export interface HistoricalImportParsedRow {
  row_number: number;
  email?: string;
  membership_number?: string;
  member_name?: string;
  user_id?: string;
  matched_member_name?: string;
  member_matched: boolean;
  course_name: string;
  course_code?: string;
  course_matched: boolean;
  matched_course_id?: string;
  training_type?: string;
  completion_date?: string;
  expiration_date?: string;
  hours_completed?: number;
  credit_hours?: number;
  certification_number?: string;
  issuing_agency?: string;
  instructor?: string;
  location?: string;
  score?: number;
  passed?: boolean;
  notes?: string;
  errors: string[];
}

export interface UnmatchedCourse {
  csv_course_name: string;
  csv_course_code?: string;
  occurrences: number;
}

export interface HistoricalImportParseResponse {
  total_rows: number;
  valid_rows: number;
  members_matched: number;
  members_unmatched: number;
  courses_matched: number;
  unmatched_courses: UnmatchedCourse[];
  column_headers: string[];
  rows: HistoricalImportParsedRow[];
  parse_errors: string[];
}

export interface CourseMappingEntry {
  csv_course_name: string;
  action: 'map_existing' | 'create_new' | 'skip';
  existing_course_id?: string;
  new_training_type?: string;
}

export interface HistoricalImportConfirmRequest {
  rows: HistoricalImportParsedRow[];
  course_mappings: CourseMappingEntry[];
  default_training_type: TrainingType;
  default_status: string;
}

export interface HistoricalImportResult {
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  errors: string[];
}

// ==================== Recertification Pathway Types ====================

export interface CategoryHourRequirement {
  category_id: string;
  hours: number;
  label: string;
}

export interface RecertificationPathway {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  source_requirement_id?: string;
  renewal_type: 'hours' | 'courses' | 'assessment' | 'combination';
  required_hours?: number;
  required_courses?: string[];
  category_hour_requirements?: CategoryHourRequirement[];
  requires_assessment: boolean;
  assessment_course_id?: string;
  renewal_window_days: number;
  grace_period_days: number;
  max_lapse_days?: number;
  prerequisite_pathway_ids?: string[];
  new_expiration_months?: number;
  auto_create_record: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface RecertificationPathwayCreate {
  name: string;
  description?: string | undefined;
  source_requirement_id?: string | undefined;
  renewal_type: 'hours' | 'courses' | 'assessment' | 'combination';
  required_hours?: number | undefined;
  required_courses?: string[] | undefined;
  category_hour_requirements?: CategoryHourRequirement[] | undefined;
  requires_assessment?: boolean | undefined;
  assessment_course_id?: string | undefined;
  renewal_window_days?: number | undefined;
  grace_period_days?: number | undefined;
  max_lapse_days?: number | undefined;
  prerequisite_pathway_ids?: string[] | undefined;
  new_expiration_months?: number | undefined;
  auto_create_record?: boolean | undefined;
}

export interface RecertificationPathwayUpdate {
  name?: string;
  description?: string | undefined;
  source_requirement_id?: string | undefined;
  renewal_type?: 'hours' | 'courses' | 'assessment' | 'combination';
  required_hours?: number | undefined;
  required_courses?: string[] | undefined;
  category_hour_requirements?: CategoryHourRequirement[] | undefined;
  requires_assessment?: boolean | undefined;
  renewal_window_days?: number | undefined;
  grace_period_days?: number | undefined;
  prerequisite_pathway_ids?: string[] | undefined;
  new_expiration_months?: number | undefined;
  active?: boolean;
}

export type RenewalTaskStatus = 'pending' | 'in_progress' | 'completed' | 'expired' | 'lapsed';

export interface RenewalTask {
  id: string;
  organization_id: string;
  user_id: string;
  pathway_id: string;
  training_record_id?: string;
  status: RenewalTaskStatus;
  certification_expiration_date: string;
  renewal_window_opens: string;
  grace_period_ends?: string;
  hours_completed: number;
  courses_completed?: string[];
  category_hours_completed?: Record<string, number>;
  assessment_passed: boolean;
  progress_percentage: number;
  completed_at?: string;
  new_record_id?: string;
  created_at: string;
  updated_at: string;
  pathway_name?: string;
  required_hours?: number;
}

// ==================== Competency Level Types ====================

export type CompetencyLevel = 'novice' | 'advanced_beginner' | 'competent' | 'proficient' | 'expert';

export interface CompetencySkillRequirement {
  skill_evaluation_id: string;
  required_level: CompetencyLevel;
  priority: 'required' | 'recommended' | 'optional';
  skill_name?: string;
}

export interface CompetencyMatrix {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  position: string;
  role_id?: string;
  skill_requirements: CompetencySkillRequirement[];
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface CompetencyMatrixCreate {
  name: string;
  description?: string | undefined;
  position: string;
  role_id?: string | undefined;
  skill_requirements: CompetencySkillRequirement[];
}

export interface CompetencyMatrixUpdate {
  name?: string;
  description?: string | undefined;
  position?: string;
  role_id?: string | undefined;
  skill_requirements?: CompetencySkillRequirement[];
  active?: boolean;
}

export interface MemberCompetency {
  id: string;
  organization_id: string;
  user_id: string;
  skill_evaluation_id: string;
  current_level: CompetencyLevel;
  previous_level?: CompetencyLevel;
  last_evaluated_at?: string;
  last_evaluator_id?: string;
  evaluation_count: number;
  last_score?: number;
  decay_months?: number;
  decay_warning_sent: boolean;
  next_evaluation_due?: string;
  score_history?: Array<{ date: string; score: number; level: CompetencyLevel }>;
  created_at: string;
  updated_at: string;
  skill_name?: string;
}

// ==================== Instructor Qualification Types ====================

export type InstructorQualificationType = 'instructor' | 'evaluator' | 'lead_instructor' | 'mentor';

export interface InstructorQualification {
  id: string;
  organization_id: string;
  user_id: string;
  qualification_type: InstructorQualificationType;
  course_id?: string;
  skill_evaluation_id?: string;
  category_id?: string;
  certification_number?: string;
  issuing_agency?: string;
  certification_level?: string;
  issued_date?: string;
  expiration_date?: string;
  active: boolean;
  verified: boolean;
  verified_by?: string;
  verified_at?: string;
  created_at: string;
  updated_at: string;
  created_by?: string;
  user_name?: string;
  course_name?: string;
  skill_name?: string;
}

export interface InstructorQualificationCreate {
  user_id: string;
  qualification_type: InstructorQualificationType;
  course_id?: string | undefined;
  skill_evaluation_id?: string | undefined;
  category_id?: string | undefined;
  certification_number?: string | undefined;
  issuing_agency?: string | undefined;
  certification_level?: string | undefined;
  issued_date?: string | undefined;
  expiration_date?: string | undefined;
}

export interface InstructorQualificationUpdate {
  qualification_type?: InstructorQualificationType;
  course_id?: string | undefined;
  skill_evaluation_id?: string | undefined;
  category_id?: string | undefined;
  certification_number?: string | undefined;
  issuing_agency?: string | undefined;
  certification_level?: string | undefined;
  issued_date?: string | undefined;
  expiration_date?: string | undefined;
  active?: boolean;
  verified?: boolean;
}

// ==================== Training Effectiveness Types ====================

export type EvaluationLevel = 'reaction' | 'learning' | 'behavior' | 'results';

export interface TrainingEffectivenessEvaluation {
  id: string;
  organization_id: string;
  user_id: string;
  training_record_id?: string;
  training_session_id?: string;
  course_id?: string;
  evaluation_level: EvaluationLevel;
  survey_responses?: Record<string, unknown>;
  overall_rating?: number;
  pre_assessment_score?: number;
  post_assessment_score?: number;
  knowledge_gain_percentage?: number;
  behavior_observations?: Record<string, unknown>;
  behavior_rating?: number;
  results_metrics?: Record<string, unknown>;
  results_notes?: string;
  evaluated_by?: string;
  evaluated_at?: string;
  created_at: string;
  updated_at: string;
}

export interface TrainingEffectivenessCreate {
  user_id: string;
  training_record_id?: string | undefined;
  training_session_id?: string | undefined;
  course_id?: string | undefined;
  evaluation_level: EvaluationLevel;
  survey_responses?: Record<string, unknown> | undefined;
  overall_rating?: number | undefined;
  pre_assessment_score?: number | undefined;
  post_assessment_score?: number | undefined;
  behavior_observations?: Record<string, unknown> | undefined;
  behavior_rating?: number | undefined;
  results_metrics?: Record<string, unknown> | undefined;
  results_notes?: string | undefined;
}

export interface TrainingEffectivenessSummary {
  course_id?: string;
  session_id?: string;
  course_name?: string;
  total_evaluations: number;
  avg_overall_rating?: number;
  avg_knowledge_gain?: number;
  avg_behavior_rating?: number;
  completion_rate?: number;
  evaluations_by_level: Record<string, number>;
}

// ==================== Multi-Agency Training Types ====================

export interface ParticipatingOrganization {
  name: string;
  role: 'host' | 'participant' | 'observer' | 'evaluator';
  contact_name?: string;
  contact_email?: string;
  participant_count?: number;
}

export interface MultiAgencyTraining {
  id: string;
  organization_id: string;
  training_session_id?: string;
  training_record_id?: string;
  exercise_name: string;
  exercise_type: 'joint_training' | 'mutual_aid_drill' | 'regional_exercise' | 'tabletop' | 'full_scale';
  description?: string;
  participating_organizations: ParticipatingOrganization[];
  lead_agency?: string;
  total_participants?: number;
  ics_position_assignments?: Array<Record<string, unknown>>;
  nims_compliant: boolean;
  after_action_report?: string;
  lessons_learned?: Array<{ area: string; finding: string; recommendation: string }>;
  mutual_aid_agreement_id?: string;
  exercise_date: string;
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface MultiAgencyTrainingCreate {
  exercise_name: string;
  exercise_type: 'joint_training' | 'mutual_aid_drill' | 'regional_exercise' | 'tabletop' | 'full_scale';
  description?: string | undefined;
  training_session_id?: string | undefined;
  training_record_id?: string | undefined;
  participating_organizations: ParticipatingOrganization[];
  lead_agency?: string | undefined;
  total_participants?: number | undefined;
  ics_position_assignments?: Array<Record<string, unknown>> | undefined;
  nims_compliant?: boolean | undefined;
  after_action_report?: string | undefined;
  lessons_learned?: Array<{ area: string; finding: string; recommendation: string }> | undefined;
  mutual_aid_agreement_id?: string | undefined;
  exercise_date: string;
}

export interface MultiAgencyTrainingUpdate {
  exercise_name?: string;
  exercise_type?: 'joint_training' | 'mutual_aid_drill' | 'regional_exercise' | 'tabletop' | 'full_scale';
  description?: string | undefined;
  participating_organizations?: ParticipatingOrganization[];
  lead_agency?: string | undefined;
  total_participants?: number | undefined;
  nims_compliant?: boolean;
  after_action_report?: string | undefined;
  lessons_learned?: Array<{ area: string; finding: string; recommendation: string }> | undefined;
}

// ==================== xAPI / SCORM Types ====================

export interface XAPIStatement {
  id: string;
  organization_id: string;
  actor_email?: string;
  actor_name?: string;
  user_id?: string;
  verb_id: string;
  verb_display?: string;
  object_id: string;
  object_name?: string;
  score_scaled?: number;
  score_raw?: number;
  success?: boolean;
  completion?: boolean;
  duration_seconds?: number;
  context_platform?: string;
  processed: boolean;
  training_record_id?: string;
  statement_timestamp: string;
  created_at: string;
}

export interface XAPIBatchResponse {
  total: number;
  accepted: number;
  rejected: number;
  errors: string[];
}

// ==================== Document/Certificate Upload Types ====================

export interface DocumentUploadResponse {
  file_id: string;
  file_name: string;
  file_size: number;
  content_type: string;
  upload_url: string;
  created_at: string;
}

export interface TrainingRecordAttachment {
  file_id: string;
  file_name: string;
  file_size: number;
  content_type: string;
  url: string;
  uploaded_at: string;
  uploaded_by?: string;
}

// ==================== Report Export Types ====================

export interface ReportExportRequest {
  report_type: 'compliance' | 'individual' | 'department' | 'certification' | 'hours_summary' | 'state_report';
  format: 'csv' | 'pdf';
  user_id?: string | undefined;
  start_date?: string | undefined;
  end_date?: string | undefined;
  include_details?: boolean | undefined;
  filters?: Record<string, unknown> | undefined;
}

export interface ReportExportResponse {
  report_id: string;
  report_type: string;
  format: string;
  file_name: string;
  download_url: string;
  generated_at: string;
  record_count: number;
}

export interface ComplianceForecast {
  user_id: string;
  user_name?: string;
  current_compliance_percentage: number;
  forecast_30_days: number;
  forecast_60_days: number;
  forecast_90_days: number;
  at_risk_requirements: Array<Record<string, unknown>>;
  expiring_certifications: Array<Record<string, unknown>>;
}

export interface DepartmentComplianceTrend {
  period: string;
  compliance_percentage: number;
  total_members: number;
  compliant_members: number;
  total_hours: number;
  certifications_active: number;
  certifications_expired: number;
}

// ============================================
// Compliance Officer Dashboard Types
// ============================================

export interface ISOCategory {
  name: string;
  nfpa_standard: string;
  required_hours: number;
  avg_hours_completed: number;
  total_department_hours: number;
  members_meeting_requirement: number;
  total_members: number;
  compliance_pct: number;
}

export interface ISOReadiness {
  year: number;
  categories: ISOCategory[];
  overall_readiness_pct: number;
  iso_class_estimate: number;
  total_members: number;
}

export interface ComplianceAttestation {
  attestation_id: string;
  period_type: string;
  period_year: number;
  period_quarter?: number | undefined;
  compliance_percentage: number;
  notes: string;
  areas_reviewed: string[];
  exceptions: Array<Record<string, unknown>>;
  attested_at: string;
  attested_by: string;
  created_at: string;
  timestamp?: string | undefined;
}

export interface AttestationCreate {
  period_type: string;
  period_year: number;
  period_quarter?: number | undefined;
  compliance_percentage: number;
  notes: string;
  areas_reviewed: string[];
  exceptions: Array<{ requirement_name: string; reason: string; mitigation: string }>;
}

export interface RecordCompletenessField {
  field_name: string;
  records_with_value: number;
  fill_rate_pct: number;
}

export interface RecordCompleteness {
  total_records: number;
  fields: RecordCompletenessField[];
  overall_completeness_pct: number;
  nfpa_1401_compliant: boolean;
  period_start: string;
  period_end: string;
}

export interface IncompleteRecord {
  record_id: string;
  course_name: string;
  user_id: string;
  completion_date?: string | undefined;
  missing_fields: string[];
}

export interface AnnualReportMember {
  user_id: string;
  name: string;
  compliance_pct: number;
  hours_completed: number;
  admin_hours_approved: number;
  admin_hours_pending: number;
  total_contributed_hours: number;
  requirements_met: number;
  requirements_total: number;
  expired_certifications: number;
  status: 'compliant' | 'at_risk' | 'non_compliant';
}

export interface AnnualReportRequirement {
  requirement_id: string;
  name: string;
  type: string;
  members_compliant: number;
  members_total: number;
  compliance_pct: number;
}

export interface AnnualComplianceReport {
  report_type: 'annual_compliance';
  organization_id: string;
  year: number;
  generated_at: string;
  executive_summary: {
    overall_compliance_pct: number;
    total_members: number;
    fully_compliant_members: number;
    total_training_hours: number;
    total_admin_hours: number;
    total_contributed_hours: number;
    total_certifications_active: number;
    total_certifications_expired: number;
    iso_readiness_pct: number;
    iso_class_estimate: number;
  };
  admin_hours_summary: {
    total_approved_hours: number;
    total_pending_hours: number;
    total_entries: number;
    by_category: Array<{
      category_id: string;
      category_name: string;
      approved_hours: number;
      pending_hours: number;
      total_entries: number;
    }>;
  };
  member_compliance: AnnualReportMember[];
  requirement_analysis: AnnualReportRequirement[];
  recertification_summary: {
    active_pathways: number;
    tasks_completed: number;
    tasks_pending: number;
    tasks_expired: number;
  };
  instructor_summary: {
    total_qualified: number;
    active_instructors: number;
    active_qualifications: number;
    expiring_qualifications: number;
  };
  multi_agency_summary: {
    total_exercises: number;
    nims_compliant_exercises: number;
    total_participants: number;
  };
  effectiveness_summary: {
    total_evaluations: number;
    avg_reaction_rating: number | null;
    avg_knowledge_gain: number | null;
  };
  record_completeness: {
    total_records: number;
    completeness_pct: number;
    nfpa_1401_compliant: boolean;
    field_details: RecordCompletenessField[];
  };
  iso_readiness: {
    overall_pct: number;
    class_estimate: number;
    categories: ISOCategory[];
  };
}

// =============================================================================
// Compliance Requirements Configuration
// =============================================================================

export interface AdminHoursRequirementItem {
  category_id: string;
  required_hours: number;
  frequency: string;
}

export interface AdminHoursComplianceItem {
  categoryId: string;
  categoryName: string;
  categoryColor: string | null;
  requiredHours: number;
  loggedHours: number;
  frequency: string;
  status: string;
  periodStart: string;
  periodEnd: string;
}

export interface ComplianceProfile {
  id: string;
  configId: string;
  name: string;
  description?: string;
  membershipTypes?: string[];
  roleIds?: string[];
  compliantThresholdOverride?: number;
  atRiskThresholdOverride?: number;
  requiredRequirementIds?: string[];
  optionalRequirementIds?: string[];
  adminHoursRequirements?: AdminHoursRequirementItem[];
  isActive: boolean;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export interface ComplianceProfileCreate {
  name: string;
  description?: string | undefined;
  membership_types?: string[] | undefined;
  role_ids?: string[] | undefined;
  compliant_threshold_override?: number | undefined;
  at_risk_threshold_override?: number | undefined;
  required_requirement_ids?: string[] | undefined;
  optional_requirement_ids?: string[] | undefined;
  admin_hours_requirements?: AdminHoursRequirementItem[] | undefined;
  is_active?: boolean | undefined;
  priority?: number | undefined;
}

export interface ComplianceProfileUpdate {
  name?: string | undefined;
  description?: string | undefined;
  membership_types?: string[] | undefined;
  role_ids?: string[] | undefined;
  compliant_threshold_override?: number | undefined;
  at_risk_threshold_override?: number | undefined;
  required_requirement_ids?: string[] | undefined;
  optional_requirement_ids?: string[] | undefined;
  admin_hours_requirements?: AdminHoursRequirementItem[] | undefined;
  is_active?: boolean | undefined;
  priority?: number | undefined;
}

export interface ComplianceConfigData {
  id: string;
  organizationId: string;
  thresholdType: string;
  compliantThreshold: number;
  atRiskThreshold: number;
  gracePeriodDays: number;
  autoReportFrequency: string;
  reportEmailRecipients?: string[];
  reportDayOfMonth?: number;
  notifyNonCompliantMembers: boolean;
  notifyDaysBeforeDeadline?: number[];
  profiles: ComplianceProfile[];
  createdAt: string;
  updatedAt: string;
  updatedBy?: string;
}

export interface ComplianceConfigUpdate {
  threshold_type?: string | undefined;
  compliant_threshold?: number | undefined;
  at_risk_threshold?: number | undefined;
  grace_period_days?: number | undefined;
  auto_report_frequency?: string | undefined;
  report_email_recipients?: string[] | undefined;
  report_day_of_month?: number | undefined;
  notify_non_compliant_members?: boolean | undefined;
  notify_days_before_deadline?: number[] | undefined;
}

export interface AvailableRequirement {
  id: string;
  name: string;
  requirement_type: string;
  source: string | null;
  frequency: string | null;
}

export interface ComplianceReportGenerate {
  report_type: string;
  year: number;
  month?: number | undefined;
  send_email?: boolean | undefined;
  additional_recipients?: string[] | undefined;
}

export interface ComplianceReportSummary {
  id: string;
  organizationId: string;
  reportType: string;
  periodLabel: string;
  periodYear: number;
  periodMonth?: number;
  status: string;
  summary?: {
    overall_compliance_pct: number;
    fully_compliant_members: number;
    total_members: number;
    at_risk_members: number;
    non_compliant_members: number;
    total_training_hours: number;
  };
  emailedTo?: string[];
  emailedAt?: string;
  generatedBy?: string;
  generatedAt: string;
  generationDurationMs?: number;
  errorMessage?: string;
}

export interface ComplianceReportDetail extends ComplianceReportSummary {
  reportData?: Record<string, unknown>;
}

// =============================================================================
// Contributed Hours (combined training + admin hours for reporting)
// =============================================================================

export interface ContributedHoursMember {
  user_id: string;
  name: string;
  training_hours: number;
  admin_hours: number;
  total_hours: number;
}

export interface ContributedHoursCategoryBreakdown {
  category_id: string;
  category_name: string;
  hours: number;
  entries: number;
}

export interface ContributedHoursResponse {
  year: number;
  total_training_hours: number;
  total_admin_hours: number;
  total_contributed_hours: number;
  total_members: number;
  members: ContributedHoursMember[];
  admin_hours_by_category: ContributedHoursCategoryBreakdown[];
}

export interface SeedDefaultsResponse {
  categories_count: number;
  category_names: string[];
  mappings_created: number;
}
