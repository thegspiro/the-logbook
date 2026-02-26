/**
 * Scheduling Module Types
 *
 * Shared TypeScript interfaces for the scheduling/shift management module.
 * These mirror the backend Pydantic schemas and are used across all
 * scheduling pages and components.
 */

import type { ShiftRecord, ShiftAttendanceRecord, SchedulingSummary, ShiftTemplateRecord, BasicApparatusRecord } from '../services/api';

// Re-export the API-level types so consumers can import from one place
export type { ShiftRecord, ShiftAttendanceRecord, SchedulingSummary, ShiftTemplateRecord, BasicApparatusRecord };

/** A member's assignment to a specific shift. */
export interface Assignment {
  id: string;
  user_id: string;
  shift_id: string;
  position: string;
  status: string;
  assignment_status?: string;
  user_name?: string;
  shift?: ShiftRecord;
  confirmed_at?: string;
  notes?: string;
}

/** A request to swap shifts between two members. */
export interface SwapRequest {
  id: string;
  requesting_user_id?: string;
  user_id?: string;
  user_name?: string;
  offering_shift_id: string;
  requesting_shift_id?: string;
  target_user_id?: string;
  target_user_name?: string;
  reason?: string;
  status: string;
  reviewer_notes?: string;
  reviewed_at?: string;
  created_at: string;
  // Enriched shift info (loaded client-side)
  offering_shift?: ShiftRecord;
  requesting_shift?: ShiftRecord;
}

/** A member's request for time off / unavailability. */
export interface TimeOffRequest {
  id: string;
  user_id?: string;
  user_name?: string;
  start_date: string;
  end_date: string;
  reason?: string;
  status: string;
  reviewer_notes?: string;
  approved_by?: string;
  approved_at?: string;
  created_at: string;
}

/** A shift template used for quick shift creation. */
export interface ShiftTemplate {
  id: string;
  name: string;
  start_time_of_day: string;
  end_time_of_day: string;
  duration_hours: number;
  color?: string;
  positions?: string[];
  min_staffing: number;
  category?: string;
  apparatus_type?: string;
  is_default: boolean;
  is_active: boolean;
}

/** A recurring shift pattern for automatic schedule generation. */
export interface ShiftPattern {
  id: string;
  name: string;
  description?: string;
  pattern_type: 'daily' | 'weekly' | 'platoon' | 'custom';
  template_id?: string;
  rotation_days?: number;
  days_on?: number;
  days_off?: number;
  schedule_config?: Record<string, unknown>;
  start_date: string;
  end_date?: string;
  assigned_members?: Array<{ user_id: string; position: string; platoon?: string }>;
  is_active: boolean;
}

/** A basic apparatus/vehicle definition for shift staffing. */
export interface BasicApparatus {
  id: string;
  unit_number: string;
  name: string;
  apparatus_type: string;
  min_staffing?: number;
  positions?: string[];
  is_active: boolean;
}

/** A call/incident responded to during a shift. */
export interface ShiftCall {
  id: string;
  shift_id: string;
  incident_number?: string;
  incident_type: string;
  dispatched_at?: string;
  on_scene_at?: string;
  cleared_at?: string;
  cancelled_en_route: boolean;
  medical_refusal: boolean;
  responding_members?: string[];
  notes?: string;
  created_at: string;
}

/** Shift completion report filed by an officer about a trainee. */
export interface ShiftCompletionReport {
  id: string;
  shift_date: string;
  trainee_id: string;
  officer_id: string;
  hours_on_shift: number;
  calls_responded: number;
  call_types: string[];
  performance_rating?: number;
  skills_observed?: Array<{ skill: string; rating: number; notes?: string }>;
  tasks_performed?: Array<{ task: string; completed: boolean; notes?: string }>;
  areas_of_strength?: string;
  areas_for_improvement?: string;
  officer_narrative?: string;
  trainee_comments?: string;
  trainee_acknowledged?: boolean;
  trainee_acknowledged_at?: string;
  review_status?: string;
  reviewer_notes?: string;
  redact_fields?: string[];
  created_at: string;
}
