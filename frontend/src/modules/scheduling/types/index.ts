/**
 * Scheduling Module Types
 *
 * Request/response types for the scheduling API service.
 * These mirror the backend Pydantic schemas in backend/app/schemas/scheduling.py.
 */

import type { AssignmentStatus, RequestStatus } from '../../../constants/enums';

// ============================================================================
// Shift Create/Update
// ============================================================================

export interface ShiftCreate {
  shift_date: string; // ISO date
  start_time: string; // ISO datetime
  end_time?: string | undefined;
  apparatus_id?: string | undefined;
  station_id?: string | undefined;
  shift_officer_id?: string | undefined;
  color?: string | undefined;
  positions?: Array<string | { position: string; required?: boolean }> | undefined;
  min_staffing?: number | undefined;
  notes?: string | undefined;
  activities?: unknown;
}

export interface ShiftUpdate {
  shift_date?: string;
  start_time?: string;
  end_time?: string;
  apparatus_id?: string;
  station_id?: string;
  shift_officer_id?: string;
  color?: string;
  notes?: string;
  activities?: unknown;
}

// ============================================================================
// Attendance Create/Update
// ============================================================================

export interface AttendanceCreate {
  user_id: string;
  checked_in_at?: string;
  checked_out_at?: string;
}

export interface AttendanceUpdate {
  checked_in_at?: string;
  checked_out_at?: string;
  duration_minutes?: number;
}

// ============================================================================
// Assignment Create/Update
// ============================================================================

export interface AssignmentCreate {
  user_id: string;
  position?: string;
  notes?: string;
}

export interface AssignmentUpdate {
  position?: string;
  assignment_status?: AssignmentStatus;
  notes?: string | undefined;
}

// ============================================================================
// Swap Request Create/Review
// ============================================================================

export interface SwapRequestCreate {
  offering_shift_id: string;
  requesting_shift_id?: string | undefined;
  target_user_id?: string | undefined;
  reason?: string | undefined;
}

export interface SwapRequestReview {
  status: 'approved' | 'denied' | 'cancelled';
  reviewer_notes?: string;
}

// ============================================================================
// Time Off Create/Review
// ============================================================================

export interface TimeOffCreate {
  start_date: string;
  end_date: string;
  reason?: string | undefined;
}

export interface TimeOffReview {
  status: 'approved' | 'denied' | 'cancelled';
  reviewer_notes?: string;
}

// ============================================================================
// Template Create/Update
// ============================================================================

export interface ShiftTemplateCreate {
  name: string;
  start_time_of_day: string;
  end_time_of_day: string;
  duration_hours: number;
  description?: string;
  color?: string;
  positions?: string[];
  min_staffing?: number;
  category?: string;
  apparatus_type?: string;
  apparatus_id?: string;
  is_default?: boolean;
  open_to_all_members?: boolean;
}

export interface ShiftTemplateUpdate {
  name?: string;
  description?: string;
  start_time_of_day?: string;
  end_time_of_day?: string;
  duration_hours?: number;
  color?: string;
  positions?: string[];
  min_staffing?: number;
  category?: string;
  apparatus_type?: string;
  apparatus_id?: string;
  is_default?: boolean;
  open_to_all_members?: boolean;
}

// ============================================================================
// Position Eligibility
// ============================================================================

export interface EligiblePositionsResponse {
  positions: string[];
  is_excluded: boolean;
}

export interface SchedulingEligibilitySettings {
  excluded_membership_types: string[];
  open_positions: string[];
}

// ============================================================================
// Pattern Create/Update/Generate
// ============================================================================

export interface ShiftPatternCreate {
  name: string;
  pattern_type: 'daily' | 'weekly' | 'platoon' | 'custom';
  start_date: string;
  description?: string | undefined;
  template_id?: string | undefined;
  rotation_days?: number | undefined;
  days_on?: number | undefined;
  days_off?: number | undefined;
  schedule_config?: Record<string, unknown> | undefined;
  end_date?: string | undefined;
  assigned_members?: Array<{ user_id: string; position: string; platoon?: string }> | undefined;
}

export interface ShiftPatternUpdate {
  name?: string;
  description?: string;
  pattern_type?: 'daily' | 'weekly' | 'platoon' | 'custom';
  template_id?: string;
  rotation_days?: number;
  days_on?: number;
  days_off?: number;
  schedule_config?: Record<string, unknown>;
  start_date?: string;
  end_date?: string;
  assigned_members?: Array<{ user_id: string; position: string; platoon?: string }>;
}

export interface PatternGenerateRequest {
  start_date: string;
  end_date: string;
}

export interface PatternGenerateResponse {
  shifts_created: number;
}

// ============================================================================
// Basic Apparatus Create/Update
// ============================================================================

export interface BasicApparatusCreate {
  unit_number: string;
  name: string;
  apparatus_type?: string;
  min_staffing?: number;
  positions?: string[];
}

export interface BasicApparatusUpdate {
  unit_number?: string;
  name?: string;
  apparatus_type?: string;
  min_staffing?: number;
  positions?: string[];
}

// ============================================================================
// Query Filters
// ============================================================================

export interface SwapRequestFilters {
  status?: RequestStatus;
  user_id?: string;
}

export interface TimeOffFilters {
  status?: RequestStatus;
  user_id?: string;
}

export interface ReportFilters {
  start_date?: string;
  end_date?: string;
  user_id?: string;
  group_by?: string;
}

export interface AvailabilityFilters {
  date?: string;
  start_date?: string;
  end_date?: string;
}

// ============================================================================
// Report Responses
// ============================================================================

export interface MemberHoursReportEntry {
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  shift_count: number;
  total_minutes: number;
  total_hours: number;
}

export interface MemberHoursReport {
  members: MemberHoursReportEntry[];
  period_start: string;
  period_end: string;
  total_members: number;
}

// The coverage and call-volume report endpoints return a bare array of
// per-period entries (see backend get_shift_coverage_report /
// get_call_volume_report), not a wrapper object.
export interface CoverageReportEntry {
  date: string;
  total_shifts: number;
  total_assigned: number;
  total_confirmed: number;
  understaffed_shifts: number;
}

export interface CallVolumeReportEntry {
  period: string;
  total_calls: number;
  by_type: Record<string, number>;
  avg_response_seconds?: number;
}

export interface AvailabilityRecord {
  user_id: string;
  user_name?: string;
  email?: string;
  available_dates: string[];
  unavailable_dates: string[];
  total_shifts_assigned: number;
  time_off_days: number;
}

// ============================================================================
// EVOC Warning (returned with driver assignments)
// ============================================================================

export interface EvocWarning {
  type: string;
  message: string;
  severity: 'warning' | 'error';
}

// ============================================================================
// Signup Response
// ============================================================================

export interface ShiftSignupResponse {
  id: string;
  shift_id: string;
  user_id: string;
  position: string;
  status: AssignmentStatus;
}

// ============================================================================
// Shift Calls / Runs
// ============================================================================

export interface ShiftCallRecord {
  id: string;
  organization_id: string;
  shift_id: string;
  incident_number?: string | null;
  incident_type: string;
  dispatched_at?: string | null;
  on_scene_at?: string | null;
  cleared_at?: string | null;
  cancelled_en_route: boolean;
  medical_refusal: boolean;
  responding_members?: string[] | null;
  notes?: string | null;
  created_at: string;
}

export interface ShiftCallCreate {
  incident_type: string;
  incident_number?: string | undefined;
  dispatched_at?: string | undefined;
  on_scene_at?: string | undefined;
  cleared_at?: string | undefined;
  cancelled_en_route?: boolean | undefined;
  medical_refusal?: boolean | undefined;
  responding_members?: string[] | undefined;
  notes?: string | undefined;
}

export type ShiftCallUpdate = Partial<ShiftCallCreate>;

// Re-export equipment check types
export type {
  CheckTemplateItem,
  CheckTemplateItemCreate,
  CheckTemplateItemUpdate,
  CheckTemplateCompartment,
  CheckTemplateCompartmentCreate,
  CheckTemplateCompartmentUpdate,
  EquipmentCheckTemplate,
  EquipmentCheckTemplateCreate,
  EquipmentCheckTemplateUpdate,
  CheckItemResultSubmit,
  ShiftEquipmentCheckCreate,
  StandaloneEquipmentCheckCreate,
  ShiftEquipmentCheckItemRecord,
  ShiftEquipmentCheckRecord,
  ShiftCheckSummary,
  CheckItemHistory,
} from './equipmentCheck';
