/**
 * Scheduling Module Types
 *
 * Shared TypeScript interfaces for the scheduling/shift management module.
 * These mirror the backend Pydantic schemas and are used across all
 * scheduling pages and components.
 */

import type { ShiftRecord, ShiftAttendanceRecord, SchedulingSummary, ShiftTemplateRecord, BasicApparatusRecord } from '../modules/scheduling/services/api';
import type { AssignmentStatus, RequestStatus } from '../constants/enums';

// Re-export the API-level types so consumers can import from one place
export type { ShiftRecord, ShiftAttendanceRecord, SchedulingSummary, ShiftTemplateRecord, BasicApparatusRecord };

/** A member's assignment to a specific shift.
 *
 * The backend canonical field is `assignment_status`. The `status` field is a
 * convenience alias kept for backward compatibility — both resolve to the same
 * value. Prefer `status` in new code.
 */
export interface Assignment {
  id: string;
  user_id: string;
  shift_id: string;
  position: string;
  /** Canonical status field, mirrored from the backend `assignment_status`. */
  status: AssignmentStatus;
  /** Raw backend field — prefer `status` in display code. */
  assignment_status?: AssignmentStatus;
  user_name?: string;
  shift?: ShiftRecord;
  confirmed_at?: string;
  notes?: string;
  /** Training slot: this seat is a supervised training/rider position. */
  is_training?: boolean;
  training_program_id?: string | null;
  training_program_name?: string | null;
  training_evaluator_id?: string | null;
  training_evaluator_name?: string | null;
}

/** A request to swap shifts between two members. */
export interface SwapRequest {
  id: string;
  requesting_user_id?: string;
  user_id?: string;
  user_name?: string;
  requesting_user_name?: string;
  offering_shift_id: string;
  requesting_shift_id?: string;
  target_user_id?: string;
  target_user_name?: string;
  reason?: string;
  status: RequestStatus;
  reviewer_notes?: string;
  reviewed_at?: string;
  created_at: string;
  // Enriched by the backend in a single query (no N+1)
  offering_shift_date?: string;
  offering_shift_start_time?: string;
  requesting_shift_date?: string;
  requesting_shift_start_time?: string;
  // Legacy: full shift objects (loaded client-side, deprecated)
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
  status: RequestStatus;
  reviewer_notes?: string;
  approved_by?: string;
  approved_at?: string;
  created_at: string;
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
