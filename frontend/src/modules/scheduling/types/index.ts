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
  /** Required on a community-outreach signup sheet, ignored on a duty shift. */
  outreach_role?: string | undefined;
  notes?: string;
  is_training?: boolean;
  training_program_id?: string | undefined;
  training_evaluator_id?: string | undefined;
}

export interface AssignmentUpdate {
  position?: string;
  assignment_status?: AssignmentStatus;
  notes?: string | undefined;
  is_training?: boolean;
  training_program_id?: string | undefined;
  training_evaluator_id?: string | undefined;
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

/**
 * A member who could take over the caller's seat on a shift.
 *
 * The server has already excluded anyone who cannot accept — on the shift
 * already, not cleared for the seat, or working a tour that abuts this one —
 * so the picker never offers a trade that would be refused.
 */
export interface TradeCandidate {
  user_id: string;
  user_name?: string | null;
  rank?: string | null;
  rank_display_name?: string | null;
  position: string;
  shifts_this_month: number;
  owes_trade: boolean;
}

// ============================================================================
// Standing Shifts (recurring member self-signup)
// ============================================================================

export const StandingShiftPattern = {
  WEEKLY: 'weekly',
  BIWEEKLY: 'biweekly',
  MONTHLY: 'monthly',
} as const;
export type StandingShiftPattern = (typeof StandingShiftPattern)[keyof typeof StandingShiftPattern];

/**
 * Which half of the day a standing claim targets. Departments define their own
 * templates and times, so a claim names the window rather than a template and
 * the series matches whatever shift starts in it.
 */
export const StandingShiftPeriod = {
  DAY: 'day',
  NIGHT: 'night',
} as const;
export type StandingShiftPeriod = (typeof StandingShiftPeriod)[keyof typeof StandingShiftPeriod];

export interface StandingShiftClaim {
  id: string;
  organization_id: string;
  user_id: string;
  pattern: StandingShiftPattern;
  /** 0 = Sunday … 6 = Saturday, matching the weekday picker. */
  weekday: number;
  period: StandingShiftPeriod;
  position: string;
  apparatus_id?: string | null;
  start_date: string;
  end_date: string;
  is_active: boolean;
  ended_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface StandingShiftPreviewParams {
  pattern: StandingShiftPattern;
  weekday: number;
  period: StandingShiftPeriod;
  start_date: string;
  end_date: string;
  apparatus_id?: string | undefined;
}

/**
 * Why one date in a series can or cannot be claimed. Every date is reported,
 * including the ones that cannot be taken — a preview that dropped them would
 * understate the commitment the member is about to make.
 */
export type StandingShiftDateStatus = 'available' | 'conflict' | 'already_yours' | 'no_shift';

export interface StandingShiftPreviewDate {
  date: string;
  shift_id?: string | null;
  status: StandingShiftDateStatus;
}

export interface StandingShiftPreview {
  dates: StandingShiftPreviewDate[];
  claimable_count: number;
  conflict_count: number;
  missing_count: number;
}

export interface StandingShiftCreate {
  pattern: StandingShiftPattern;
  weekday: number;
  period: StandingShiftPeriod;
  position: string;
  start_date: string;
  end_date: string;
  apparatus_id?: string | undefined;
}

export interface StandingShiftCreateResult {
  claim: StandingShiftClaim;
  claimed: number;
  skipped: number;
  no_shift: number;
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

/** Why a member holds a position: their rank, a completed program, or an
 *  org-wide open position. `label` names the specific rank or program. */
export interface PositionEligibilitySource {
  type: 'rank' | 'training' | 'open';
  label: string;
}

export interface RosterApparatusClearance {
  apparatus_id: string;
  unit_number: string;
  certification_expiration: string | null;
}

export interface PositionRosterMember {
  user_id: string;
  user_name: string;
  rank: string | null;
  rank_display_name: string | null;
  membership_type: string;
  platoon: string | null;
  sources: PositionEligibilitySource[];
  evoc_level_number: number | null;
  evoc_level_name: string | null;
  apparatus_cleared: RosterApparatusClearance[];
}

export interface PositionRosterResponse {
  position: string;
  members: PositionRosterMember[];
  excluded_membership_types: string[];
  is_open_position: boolean;
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
  skip?: number;
  limit?: number;
}

export interface TimeOffFilters {
  status?: RequestStatus;
  user_id?: string;
  skip?: number;
  limit?: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  skip: number;
  limit: number;
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
  /**
   * Worked: measured from attendance check-in/check-out. This is the
   * authoritative figure — anything that credits or pays a member uses it.
   */
  shifts_attended: number;
  worked_minutes: number;
  worked_hours: number;
  /**
   * Scheduled: assignment durations, i.e. the plan. Shown alongside so the
   * difference from what was actually worked is visible rather than being
   * something a reader has to know to ask about.
   */
  shifts_scheduled: number;
  scheduled_minutes: number;
  scheduled_hours: number;
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

// ============================================================================
// Shift Close-Out (resumable wizard)
// ============================================================================

/** One department-defined call type. The slug is stored; the label is display. */
export interface CallTypeOption {
  slug: string;
  label: string;
}

export interface CloseoutMemberState {
  user_id: string;
  user_name: string;
  checked_in_at?: string | null;
  checked_out_at?: string | null;
  hours: number;
  /** null means the officer has not set credit — the UI shows the shift count. */
  call_count?: number | null;
  missing_checkout: boolean;
}

export interface CloseoutAttachableCall {
  id: string;
  call_date: string;
  call_type?: string | null;
  source: string;
  apparatus_ids: string[];
}

export interface CloseoutState {
  shift_id: string;
  is_finalized: boolean;
  /** 0 = not started, 1 = attendance saved, 2 = calls saved. */
  closeout_step: number;
  call_tracking_mode: string;
  call_types: CallTypeOption[];
  members: CloseoutMemberState[];
  /** Summed across the crew — several times the length of the shift. */
  combined_hours: number;
  reported_call_count: number;
  reported_call_types: Record<string, number>;
  /** Served by the API; unused until the shared-call picker ships. */
  attachable_calls: CloseoutAttachableCall[];
}

export interface CloseoutAttendanceEntry {
  user_id: string;
  checked_in_at?: string | null;
  checked_out_at?: string | null;
}

export interface CloseoutCallsPayload {
  reported_call_count?: number | null;
  reported_call_types?: Record<string, number> | undefined;
}

export interface MemberCallCredit {
  user_id: string;
  call_count: number;
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
