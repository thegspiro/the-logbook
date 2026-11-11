/**
 * Session waiver requests: a member asks to be excused from one training
 * session that counts against them, and an approver the department chose
 * decides.
 *
 * Mirrors `backend/app/schemas/attendance_waiver.py`, which has no alias
 * generator, so every field is snake_case as the Python attributes are named
 * (CLAUDE.md pitfall #5).
 */

import type {
  AttendanceWaiverCapPeriod,
  AttendanceWaiverDeadline,
  AttendanceWaiverReasonText,
  AttendanceWaiverStatus,
} from '../constants/enums';

/** The department's policy for the training-session workflow. */
export interface AttendanceWaiverPolicy {
  enabled: boolean;
  deadline: AttendanceWaiverDeadline;
  /** null means no cap. */
  cap: number | null;
  cap_period: AttendanceWaiverCapPeriod;
  categories: string[];
  category_required: boolean;
  reason_text: AttendanceWaiverReasonText;
  approver_position_ids: string[];
}

/** Whether the signed-in member may ask about one session, and the form's terms. */
export interface AttendanceWaiverEligibility {
  event_id: string;
  allowed: boolean;
  /** A stable key to branch on; `refusal` is the sentence to show. */
  refusal_code: string | null;
  refusal: string | null;
  deadline: string | null;
  deadline_preset: AttendanceWaiverDeadline;
  session_date: string | null;
  cap: number | null;
  cap_period: AttendanceWaiverCapPeriod;
  cap_used: number | null;
  cap_remaining: number | null;
  categories: string[];
  category_required: boolean;
  reason_text: AttendanceWaiverReasonText;
  existing_request_id: string | null;
  existing_request_status: AttendanceWaiverStatus | null;
}

export interface AttendanceWaiverActionEntry {
  id: string;
  /** submitted | withdrawn | approved | denied | chief_override | voided */
  action: string;
  actor_id: string | null;
  actor_name: string | null;
  note: string | null;
  created_at: string;
}

/**
 * One request, as its member or someone who may decide it sees it. Nobody
 * else is ever sent one, which is why `reason` is present.
 */
export interface AttendanceWaiverRequest {
  id: string;
  workflow: string;
  user_id: string;
  member_name: string | null;
  event_id: string | null;
  event_title: string;
  event_start: string;
  session_date: string;
  status: AttendanceWaiverStatus;
  category: string | null;
  reason: string | null;
  submitted_at: string;
  decided_at: string | null;
  decided_by: string | null;
  decided_by_name: string | null;
  chief_override: boolean;
  can_withdraw: boolean;
  can_decide: boolean;
  can_override: boolean;
  actions: AttendanceWaiverActionEntry[];
}

export interface AttendanceWaiverRequestPage {
  items: AttendanceWaiverRequest[];
  total: number;
  skip: number;
  limit: number;
}

export interface AttendanceWaiverSubmit {
  event_id: string;
  category?: string | undefined;
  reason?: string | undefined;
}
