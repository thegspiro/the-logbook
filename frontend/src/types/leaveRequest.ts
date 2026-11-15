/**
 * Department leave settings and members' leave requests.
 *
 * The API serves these snake_case, like the rest of the member-leave
 * endpoints (`backend/app/schemas/leave_of_absence.py`).
 */

export const LeaveDecisionRule = {
  ANY: 'any',
  MAJORITY: 'majority',
  ALL: 'all',
} as const;
export type LeaveDecisionRule = (typeof LeaveDecisionRule)[keyof typeof LeaveDecisionRule];

export const LeaveRequestStatus = {
  PENDING: 'pending',
  APPROVED: 'approved',
  DENIED: 'denied',
  WITHDRAWN: 'withdrawn',
} as const;
export type LeaveRequestStatus = (typeof LeaveRequestStatus)[keyof typeof LeaveRequestStatus];

export type LeaveVote = 'approve' | 'deny';

export interface LeaveSettings {
  /** Days before a leave ends that the member is reminded; 0 sends none. */
  end_reminder_days: number;
  end_reminder_copy_officers: boolean;
  requests_enabled: boolean;
  request_approver_position_ids: string[];
  request_decision_rule: LeaveDecisionRule;
}

export interface LeaveApproverPosition {
  id: string;
  name: string;
  holder_count: number;
}

export interface LeaveSettingsResponse extends LeaveSettings {
  available_positions: LeaveApproverPosition[];
}

export interface LeaveRequestCreate {
  leave_type: string;
  start_date: string;
  end_date?: string | undefined;
  reason?: string | undefined;
}

export interface LeaveRequestVoteEntry {
  voter_id: string;
  voter_name: string;
  vote: LeaveVote;
  note: string | null;
  created_at: string;
}

export interface LeaveRequest {
  id: string;
  user_id: string;
  member_name: string;
  leave_type: string;
  start_date: string;
  end_date: string | null;
  /** Present only for the member and for those who may decide. */
  reason: string | null;
  status: LeaveRequestStatus;
  decision_rule: LeaveDecisionRule;
  created_at: string;
  decided_at: string | null;
  decided_by_name: string | null;
  leave_id: string | null;
  votes: LeaveRequestVoteEntry[];
  approvals: number;
  denials: number;
  approver_count: number;
  approvals_needed: number;
  can_vote: boolean;
  my_vote: LeaveVote | null;
}
