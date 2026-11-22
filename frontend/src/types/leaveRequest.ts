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
  /** Days a request may wait before the Chief is told, once; 0 never. */
  request_escalation_days: number;
}

/** A member ended their own leave: it now ends the day before they are back. */
export interface LeaveEndedEarly {
  leave_id: string;
  start_date: string;
  end_date: string;
  previous_end_date: string | null;
  first_day_back: string;
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
  /** The voting round it was cast in; only the request's current round counts. */
  round?: number;
  vote: LeaveVote;
  /** The away approver a stand-in voted in place of; null for an approver's own vote. */
  on_behalf_of_name?: string | null;
  note: string | null;
  created_at: string;
}

export interface LeaveDates {
  start_date: string;
  end_date: string | null;
}

export type LeaveMessageKind = 'question' | 'answer' | 'proposal' | 'proposal_accepted' | 'proposal_declined';

export interface LeaveRequestMessage {
  kind: LeaveMessageKind;
  author_name: string;
  body: string | null;
  created_at: string;
}

export interface LeaveProposal extends LeaveDates {
  proposed_by_name: string;
  proposed_at: string;
}

export interface LeaveRequestSummary {
  requests_enabled: boolean;
  /** Waiting requests the caller may vote on now and has not. */
  to_decide: number;
  /** The caller's own requests waiting on their answer. */
  waiting_on_me: number;
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
  /** The active leave this request extends, as it stands. */
  extends_leave?: LeaveDates | null;
  /** Set while the request waits on its member. */
  awaiting?: 'answer' | 'proposal' | null;
  proposal?: LeaveProposal | null;
  messages?: LeaveRequestMessage[];
  vote_round?: number;
  votes: LeaveRequestVoteEntry[];
  approvals: number;
  denials: number;
  approver_count: number;
  approvals_needed: number;
  /** The member held an approver position when they asked, so the Chief decides it. */
  routed_to_chief?: boolean;
  can_vote: boolean;
  can_ask?: boolean;
  can_answer?: boolean;
  can_respond_to_changes?: boolean;
  my_vote: LeaveVote | null;
}

/** An approver away for a period, and the officer deciding in their place. */
export interface LeaveApproverCover {
  id: string;
  approver_id: string;
  approver_name: string;
  stand_in_id: string;
  stand_in_name: string;
  start_date: string;
  end_date: string;
  /** Running today, in the department's timezone. */
  active: boolean;
  can_clear: boolean;
}

export interface LeaveCoverPerson {
  id: string;
  name: string;
}

export interface LeaveApproverCoverBoard {
  covers: LeaveApproverCover[];
  /** Approvers the caller may set a cover for. Empty when they may set none. */
  approvers: LeaveCoverPerson[];
  /** Who may stand in: the members who manage leave. */
  stand_ins: LeaveCoverPerson[];
  /** The department's today, as YYYY-MM-DD. */
  today: string;
}

export interface LeaveApproverCoverCreate {
  approver_id: string;
  stand_in_id: string;
  start_date: string;
  end_date: string;
}
