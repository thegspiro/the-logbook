/**
 * Scheduling Module Types
 *
 * Request/response types for the scheduling API service.
 * These mirror the backend Pydantic schemas in backend/app/schemas/scheduling.py.
 */

// ============================================================================
// Shift Create/Update
// ============================================================================

export interface ShiftCreate {
  shift_date: string; // ISO date
  start_time: string; // ISO datetime
  end_time?: string;
  apparatus_id?: string;
  station_id?: string;
  shift_officer_id?: string;
  color?: string;
  notes?: string;
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
// Shift Call Create/Update
// ============================================================================

export interface ShiftCallCreate {
  incident_type: string;
  incident_number?: string;
  dispatched_at?: string;
  on_scene_at?: string;
  cleared_at?: string;
  cancelled_en_route?: boolean;
  medical_refusal?: boolean;
  responding_members?: string[];
  notes?: string;
}

export interface ShiftCallUpdate {
  incident_number?: string;
  incident_type?: string;
  dispatched_at?: string;
  on_scene_at?: string;
  cleared_at?: string;
  cancelled_en_route?: boolean;
  medical_refusal?: boolean;
  responding_members?: string[];
  notes?: string;
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
  assignment_status?: string;
  notes?: string;
}

// ============================================================================
// Swap Request Create/Review
// ============================================================================

export interface SwapRequestCreate {
  offering_shift_id: string;
  requesting_shift_id?: string;
  target_user_id?: string;
  reason?: string;
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
  reason?: string;
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
}

// ============================================================================
// Pattern Create/Update/Generate
// ============================================================================

export interface ShiftPatternCreate {
  name: string;
  pattern_type: 'daily' | 'weekly' | 'platoon' | 'custom';
  start_date: string;
  description?: string;
  template_id?: string;
  rotation_days?: number;
  days_on?: number;
  days_off?: number;
  schedule_config?: Record<string, unknown>;
  end_date?: string;
  assigned_members?: Array<{ user_id: string; position: string; platoon?: string }>;
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
  status?: string;
  user_id?: string;
}

export interface TimeOffFilters {
  status?: string;
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
  user_name: string;
  total_hours: number;
  shift_count: number;
  average_hours_per_shift: number;
}

export interface MemberHoursReport {
  entries: MemberHoursReportEntry[];
  period_start: string;
  period_end: string;
  total_members: number;
}

export interface CoverageReportEntry {
  date: string;
  shifts_scheduled: number;
  positions_filled: number;
  positions_needed: number;
  coverage_percentage: number;
}

export interface CoverageReport {
  entries: CoverageReportEntry[];
  period_start: string;
  period_end: string;
  average_coverage: number;
}

export interface CallVolumeReportEntry {
  date: string;
  call_count: number;
  incident_types: Record<string, number>;
}

export interface CallVolumeReport {
  entries: CallVolumeReportEntry[];
  period_start: string;
  period_end: string;
  total_calls: number;
}

export interface AvailabilityRecord {
  user_id: string;
  user_name: string;
  date: string;
  is_available: boolean;
  reason?: string;
}

// ============================================================================
// Signup Response
// ============================================================================

export interface ShiftSignupResponse {
  id: string;
  shift_id: string;
  user_id: string;
  position: string;
  status: string;
}
