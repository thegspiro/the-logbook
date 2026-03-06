/**
 * Reports Module Types
 *
 * TypeScript interfaces for report requests, responses, and configuration.
 */

import type { UserStatus } from '../../../constants/enums';

// ============================================================================
// Report Category & Type Enums
// ============================================================================

export const ReportCategory = {
  MEMBER: 'member',
  TRAINING: 'training',
  EVENT: 'event',
  COMPLIANCE: 'compliance',
  ADMIN: 'admin',
  OPERATIONS: 'operations',
} as const;
export type ReportCategory = (typeof ReportCategory)[keyof typeof ReportCategory];

export const ReportExportFormat = {
  CSV: 'csv',
  PDF: 'pdf',
} as const;
export type ReportExportFormat = (typeof ReportExportFormat)[keyof typeof ReportExportFormat];

export const DatePreset = {
  THIS_YEAR: 'this-year',
  LAST_YEAR: 'last-year',
  LAST_90: 'last-90',
  LAST_30: 'last-30',
  THIS_QUARTER: 'this-quarter',
  LAST_QUARTER: 'last-quarter',
  CUSTOM: 'custom',
} as const;
export type DatePreset = (typeof DatePreset)[keyof typeof DatePreset];

export const SavedReportFrequency = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  QUARTERLY: 'quarterly',
} as const;
export type SavedReportFrequency = (typeof SavedReportFrequency)[keyof typeof SavedReportFrequency];

// ============================================================================
// Report Request
// ============================================================================

export interface ReportRequest {
  report_type: string;
  start_date?: string;
  end_date?: string;
  filters?: Record<string, unknown>;
}

// ============================================================================
// Report Card (UI metadata)
// ============================================================================

export interface ReportCardDefinition {
  id: string;
  title: string;
  description: string;
  icon: string;
  category: ReportCategory;
  available: boolean;
  usesDateRange?: boolean;
}

// ============================================================================
// Available Reports API Response
// ============================================================================

export interface AvailableReport {
  id: string;
  title: string;
  description: string;
  category: string;
  available: boolean;
  usesDateRange?: boolean;
}

export interface AvailableReportsResponse {
  available_reports: AvailableReport[];
}

// ============================================================================
// Report Data: Member Roster
// ============================================================================

export interface MemberRosterEntry {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  membership_number?: string;
  rank?: string;
  status: UserStatus;
  station?: string;
  joined_date?: string;
  roles: string[];
}

export interface MemberRosterReport {
  report_type: 'member_roster';
  generated_at: string;
  total_members: number;
  active_members: number;
  inactive_members: number;
  members: MemberRosterEntry[];
}

// ============================================================================
// Report Data: Training Summary
// ============================================================================

export interface TrainingSummaryEntry {
  member_id: string;
  member_name: string;
  total_courses: number;
  completed_courses: number;
  total_hours: number;
  compliance_percentage: number;
}

export interface CourseBreakdownEntry {
  course_id: string;
  course_name: string;
  total: number;
  completed: number;
  total_hours: number;
}

export interface RequirementBreakdownEntry {
  requirement_id: string;
  requirement_name: string;
  total_members: number;
  completed: number;
  completion_pct: number;
}

export interface TrainingSummaryReport {
  report_type: 'training_summary';
  generated_at: string;
  period_start?: string;
  period_end?: string;
  total_courses: number;
  total_records: number;
  completion_rate: number;
  entries: TrainingSummaryEntry[];
  course_breakdown: CourseBreakdownEntry[];
  requirement_breakdown: RequirementBreakdownEntry[];
}

// ============================================================================
// Report Data: Event Attendance
// ============================================================================

export interface EventAttendanceEntry {
  event_id: string;
  event_title: string;
  event_date?: string;
  total_rsvps: number;
  attended: number;
  attendance_rate: number;
}

export interface EventAttendanceReport {
  report_type: 'event_attendance';
  generated_at: string;
  period_start?: string;
  period_end?: string;
  total_events: number;
  average_attendance_rate: number;
  events: EventAttendanceEntry[];
}

// ============================================================================
// Report Data: Training Progress
// ============================================================================

export interface TrainingProgressEntry {
  enrollment_id: string;
  member_name: string;
  member_id: string;
  program_name: string;
  program_id: string;
  status: string;
  progress_percentage: number;
  requirements_completed: number;
  requirements_total: number;
  enrolled_at?: string;
  target_completion?: string;
  completed_at?: string;
}

export interface TrainingProgressReport {
  report_type: 'training_progress';
  generated_at: string;
  total_enrollments: number;
  status_summary: Record<string, number>;
  average_progress: number;
  entries: TrainingProgressEntry[];
}

// ============================================================================
// Report Data: Annual Training
// ============================================================================

export interface AnnualTrainingEntry {
  member_id: string;
  member_name: string;
  rank?: string;
  training_hours: number;
  courses_completed: number;
  shift_hours: number;
  shifts_completed: number;
  calls_responded: number;
  avg_performance_rating?: number;
}

export interface AnnualTrainingSummary {
  total_members: number;
  total_training_hours: number;
  total_shift_hours: number;
  total_combined_hours: number;
  total_completions: number;
  total_calls_responded: number;
  avg_hours_per_member: number;
  avg_performance_rating?: number;
  training_by_type: Record<string, number>;
}

export interface AnnualTrainingReport {
  report_type: 'annual_training';
  generated_at: string;
  period_start: string;
  period_end: string;
  year: number;
  summary: AnnualTrainingSummary;
  entries: AnnualTrainingEntry[];
}

// ============================================================================
// Report Data: Admin Hours
// ============================================================================

export interface AdminHoursReportEntry {
  member_name: string;
  category_name: string;
  date?: string;
  hours: number;
  entry_method: string;
  status: string;
}

export interface AdminHoursReportSummary {
  total_hours: number;
  total_entries: number;
  unique_members: number;
  hours_by_category: Record<string, number>;
}

export interface AdminHoursReport {
  report_type: 'admin_hours';
  generated_at: string;
  period_start?: string;
  period_end?: string;
  summary: AdminHoursReportSummary;
  entries: AdminHoursReportEntry[];
}

// ============================================================================
// Report Data: Department Overview
// ============================================================================

export interface DepartmentOverviewReport {
  report_type: 'department_overview';
  generated_at: string;
  period_start: string;
  period_end: string;
  members: {
    total: number;
    active: number;
    inactive: number;
  };
  training: {
    total_records: number;
    completed: number;
    completion_rate: number;
    total_hours: number;
    avg_hours_per_member: number;
  };
  events: {
    total_events: number;
    total_checkins: number;
  };
  action_items: {
    open_from_meetings: number;
    open_from_minutes: number;
  };
}

// ============================================================================
// Report Data: Certification Expiration
// ============================================================================

export interface CertExpirationEntry {
  member_id: string;
  member_name: string;
  rank?: string;
  course_name: string;
  certification_number?: string;
  issuing_agency?: string;
  completion_date: string;
  expiration_date?: string;
  days_until_expiry?: number;
  expiry_status: 'expired' | 'expiring_soon' | 'valid' | 'no_expiry';
}

export interface CertExpirationReport {
  report_type: 'certification_expiration';
  generated_at: string;
  total_certifications: number;
  expired_count: number;
  expiring_soon_count: number;
  valid_count: number;
  no_expiry_count: number;
  entries: CertExpirationEntry[];
}

// ============================================================================
// Report Data: Apparatus/Fleet Status
// ============================================================================

export interface ApparatusStatusEntry {
  apparatus_id: string;
  name: string;
  apparatus_type: string;
  status: string;
  station?: string;
  year?: number;
  mileage?: number;
  last_inspection_date?: string;
  next_inspection_due?: string;
  days_until_inspection?: number;
  open_work_orders: number;
}

export interface ApparatusStatusReport {
  report_type: 'apparatus_status';
  generated_at: string;
  total_apparatus: number;
  in_service_count: number;
  out_of_service_count: number;
  maintenance_due_count: number;
  entries: ApparatusStatusEntry[];
}

// ============================================================================
// Report Data: Inventory Status
// ============================================================================

export interface InventoryStatusEntry {
  item_id: string;
  name: string;
  item_type: string;
  category_name?: string;
  total_quantity: number;
  assigned_quantity: number;
  available_quantity: number;
  condition: string;
  minimum_stock?: number;
  is_low_stock: boolean;
  last_audit_date?: string;
}

export interface InventoryStatusReport {
  report_type: 'inventory_status';
  generated_at: string;
  total_items: number;
  total_value?: number;
  low_stock_count: number;
  assigned_count: number;
  entries: InventoryStatusEntry[];
}

// ============================================================================
// Report Data: Compliance Status
// ============================================================================

export interface ComplianceMemberEntry {
  member_id: string;
  member_name: string;
  rank?: string;
  total_requirements: number;
  completed_requirements: number;
  compliance_percentage: number;
  overdue_items: string[];
  upcoming_deadlines: Array<{ name: string; due_date: string }>;
}

export interface ComplianceStatusReport {
  report_type: 'compliance_status';
  generated_at: string;
  total_members: number;
  fully_compliant_count: number;
  partially_compliant_count: number;
  non_compliant_count: number;
  overall_compliance_rate: number;
  entries: ComplianceMemberEntry[];
}

// ============================================================================
// Report Data: Incident / Call Volume
// ============================================================================

export interface CallVolumeEntry {
  date: string;
  total_calls: number;
  by_type: Record<string, number>;
}

export interface CallVolumeSummary {
  total_calls: number;
  avg_calls_per_day: number;
  busiest_day: string;
  busiest_day_count: number;
  by_type_totals: Record<string, number>;
}

export interface CallVolumeReport {
  report_type: 'call_volume';
  generated_at: string;
  period_start: string;
  period_end: string;
  summary: CallVolumeSummary;
  entries: CallVolumeEntry[];
}

// ============================================================================
// Saved / Scheduled Reports
// ============================================================================

export interface SavedReportConfig {
  id: string;
  name: string;
  description?: string;
  report_type: string;
  filters: Record<string, unknown>;
  is_scheduled: boolean;
  schedule_frequency?: SavedReportFrequency;
  schedule_day?: number;
  email_recipients?: string[];
  last_run_at?: string;
  next_run_at?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface SavedReportCreate {
  name: string;
  description?: string;
  report_type: string;
  filters?: Record<string, unknown>;
  is_scheduled?: boolean;
  schedule_frequency?: SavedReportFrequency;
  schedule_day?: number;
  email_recipients?: string[];
}

export interface SavedReportUpdate {
  name?: string;
  description?: string;
  filters?: Record<string, unknown>;
  is_scheduled?: boolean;
  schedule_frequency?: SavedReportFrequency;
  schedule_day?: number;
  email_recipients?: string[];
}

// ============================================================================
// Union type for all report responses
// ============================================================================

export type ReportData =
  | MemberRosterReport
  | TrainingSummaryReport
  | EventAttendanceReport
  | TrainingProgressReport
  | AnnualTrainingReport
  | AdminHoursReport
  | DepartmentOverviewReport
  | CertExpirationReport
  | ApparatusStatusReport
  | InventoryStatusReport
  | ComplianceStatusReport
  | CallVolumeReport
  | Record<string, unknown>;
