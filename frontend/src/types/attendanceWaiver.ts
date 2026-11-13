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
import type { WaiverAttachment, WaiverAttachmentMode } from '../services/waiverAttachmentService';

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
  /** Whether a member may, or must, file a document (off by default). */
  attachment: WaiverAttachmentMode;
  /** Days a closed request's documents are kept, 1–3650 (365 by default). */
  attachment_retention_days: number;
  approver_position_ids: string[];
  /** Positions emailed each final decision; never shown the reason. */
  cc_position_ids: string[];
  /** Decides the Chief's own request when the President's office is vacant. */
  chief_alternate_user_id: string | null;
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
  /** Absent from a backend older than documents; read as `off`. */
  attachment?: WaiverAttachmentMode;
  attachment_max_count?: number;
  attachment_max_bytes?: number;
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
  /**
   * When a pending request closes undecided, seven days after the session
   * (UTC instant, computed by the backend); null once it is settled.
   */
  expires_at?: string | null;
  /** Set while a decider's question waits on the member. */
  info_requested_at: string | null;
  /** Set while a rescheduled session waits on the member to confirm. */
  reconfirm_requested_at: string | null;
  can_withdraw: boolean;
  can_respond: boolean;
  can_confirm: boolean;
  can_request_info: boolean;
  can_decide: boolean;
  can_override: boolean;
  /** The member may file another document now (pending, policy takes them, under the limit). */
  can_attach?: boolean;
  /** The documents filed with the request; the service always sets this. */
  attachments?: WaiverAttachment[];
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
