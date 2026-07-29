/**
 * Election Type Definitions
 */

// Import enum types from the canonical source and re-export
import type {
  ElectionStatus,
  VotingMethod,
  VictoryCondition,
  BallotChoice,
  RunoffType,
  QuorumType,
} from '../constants/enums';
export type {
  ElectionStatus,
  VotingMethod,
  VictoryCondition,
  BallotChoice,
  RunoffType,
  QuorumType,
};

export interface BallotItem {
  id: string;
  type: string; // membership_approval, officer_election, general_vote
  title: string;
  description?: string | undefined;
  position?: string | undefined;
  eligible_voter_types: string[]; // Based on membership_type: 'all', 'operational' (active), 'administrative', 'regular' (active+life), 'life', 'probationary', or specific role slugs as fallback
  vote_type: string; // approval, candidate_selection
  required_for_approval?: number;
  require_attendance?: boolean; // If true, voter must be checked in as present at the meeting
  // Per-item victory condition overrides (optional — defaults to election-level)
  victory_condition?: VictoryCondition | undefined;
  victory_percentage?: number | undefined;
  voting_method?: VotingMethod | undefined;
  prospect_package_id?: string | undefined;
}

export interface PositionEligibility {
  voter_types: string[]; // Role slugs that can vote for this position
  min_votes_required?: number;
}

// VotingMethod and VictoryCondition are now defined in constants/enums.ts

export interface Election {
  id: string;
  organization_id: string;
  title: string;
  description?: string;
  election_type: string;
  positions?: string[];
  ballot_items?: BallotItem[];
  position_eligibility?: { [position: string]: PositionEligibility };
  meeting_date?: string;
  meeting_id?: string;
  meeting_title?: string;
  meeting_type?: string;
  event_id?: string;
  attendees?: Attendee[];
  start_date: string;
  end_date: string;
  status: ElectionStatus;
  anonymous_voting: boolean;
  allow_write_ins: boolean;
  max_votes_per_position: number;
  results_visible_immediately: boolean;
  eligible_voters?: string[];
  email_sent: boolean;
  email_sent_at?: string;
  email_recipients?: string[];
  voting_method: VotingMethod;
  victory_condition: VictoryCondition;
  victory_threshold?: number;
  victory_percentage?: number;
  enable_runoffs: boolean;
  runoff_type: string;
  max_runoff_rounds: number;
  is_runoff: boolean;
  parent_election_id?: string;
  runoff_round: number;
  quorum_type?: string; // none, percentage, count
  quorum_value?: number;
  auto_open?: boolean;
  reminder_hours_before_close?: number;
  reminder_sent_at?: string;
  nomination_deadline?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
  total_votes?: number;
  total_voters?: number;
  voter_turnout_percentage?: number;
}

/**
 * Minimal election view returned by the public token-ballot endpoint
 * (GET /elections/ballot). Deliberately excludes roster/PII fields
 * (attendees, eligible_voters, email_recipients, created_by, ...).
 */
export interface BallotElection {
  id: string;
  title: string;
  description?: string;
  election_type: string;
  meeting_date?: string;
  start_date: string;
  end_date: string;
  status: ElectionStatus;
  positions?: string[];
  ballot_items?: BallotItem[];
  allow_write_ins: boolean;
  voting_method: VotingMethod;
  max_votes_per_position: number;
}

/** POST /elections/ballot/lookup — election + candidates in one round-trip */
export interface BallotLookupResponse {
  election: BallotElection;
  candidates: Candidate[];
}

export interface ElectionListItem {
  id: string;
  title: string;
  election_type: string;
  start_date: string;
  end_date: string;
  status: ElectionStatus;
  positions?: string[];
  total_votes?: number;
  meeting_id?: string;
  meeting_title?: string;
  meeting_date?: string;
}

export interface ElectionCreate {
  title: string;
  description?: string | undefined;
  election_type: string;
  positions?: string[] | undefined;
  ballot_items?: BallotItem[] | undefined;
  position_eligibility?: { [position: string]: PositionEligibility } | undefined;
  meeting_date?: string | undefined;
  meeting_id?: string | undefined;
  event_id?: string | undefined;
  start_date: string;
  end_date: string;
  anonymous_voting?: boolean | undefined;
  allow_write_ins?: boolean | undefined;
  max_votes_per_position?: number | undefined;
  results_visible_immediately?: boolean | undefined;
  eligible_voters?: string[] | undefined;
  voting_method?: VotingMethod | undefined;
  victory_condition?: VictoryCondition | undefined;
  victory_threshold?: number | undefined;
  victory_percentage?: number | undefined;
  enable_runoffs?: boolean | undefined;
  runoff_type?: string | undefined;
  max_runoff_rounds?: number | undefined;
  auto_open?: boolean | undefined;
  reminder_hours_before_close?: number | undefined;
  nomination_deadline?: string | undefined;
}

export interface ElectionUpdate {
  title?: string;
  description?: string;
  election_type?: string;
  positions?: string[];
  ballot_items?: BallotItem[];
  position_eligibility?: { [position: string]: PositionEligibility };
  meeting_date?: string | undefined;
  meeting_id?: string | undefined;
  event_id?: string | undefined;
  start_date?: string;
  end_date?: string;
  // NOTE: status is intentionally excluded — use /open, /close, /rollback endpoints
  anonymous_voting?: boolean;
  allow_write_ins?: boolean;
  max_votes_per_position?: number;
  results_visible_immediately?: boolean;
  eligible_voters?: string[];
  voting_method?: VotingMethod;
  victory_condition?: VictoryCondition;
  victory_threshold?: number;
  victory_percentage?: number;
  enable_runoffs?: boolean;
  runoff_type?: string;
  max_runoff_rounds?: number;
  auto_open?: boolean;
  reminder_hours_before_close?: number;
  nomination_deadline?: string | undefined;
}

export interface Candidate {
  id: string;
  election_id: string;
  user_id?: string;
  name: string;
  position?: string;
  statement?: string;
  photo_url?: string;
  nomination_date: string;
  nominated_by?: string;
  accepted: boolean;
  is_write_in: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
  vote_count?: number;
}

export interface CandidateCreate {
  election_id: string;
  user_id?: string | undefined;
  name: string;
  position?: string | undefined;
  statement?: string | undefined;
  photo_url?: string;
  display_order?: number;
  is_write_in?: boolean;
}

export interface CandidateUpdate {
  name?: string | undefined;
  position?: string | undefined;
  statement?: string | undefined;
  photo_url?: string;
  accepted?: boolean;
  display_order?: number;
}

export interface Vote {
  id: string;
  election_id: string;
  candidate_id: string;
  position?: string;
  receipt_hash?: string;
  vote_rank?: number; // For ranked-choice voting (1 = first choice)
  voted_at: string;
  voter_id?: string;
}

export interface VoteCreate {
  election_id: string;
  candidate_id: string;
  position?: string | undefined;
  vote_rank?: number; // For ranked-choice voting (1 = first choice)
}

/** One vote in an atomic bulk submission (approval / ranked-choice / multi-position). */
export interface BulkVoteItem {
  candidate_id: string;
  position?: string | undefined;
  vote_rank?: number | undefined;
}

export interface VoteIntegrityResult {
  election_id: string;
  total_votes: number;
  valid_signatures: number;
  unsigned_votes: number;
  tampered_votes: number;
  tampered_vote_ids: string[];
  chain_verified: boolean;
  chain_break_at?: string | null;
  integrity_status: 'PASS' | 'FAIL' | 'CHAIN_BROKEN';
}

export interface VoterEligibility {
  is_eligible: boolean;
  has_voted: boolean;
  positions_voted: string[];
  positions_remaining: string[];
  reason?: string;
}

export interface CandidateResult {
  candidate_id: string;
  candidate_name: string;
  position?: string;
  vote_count: number;
  percentage: number;
  is_winner: boolean;
}

export interface PositionResults {
  position: string;
  total_votes: number;
  candidates: CandidateResult[];
}

export interface ElectionResults {
  election_id: string;
  election_title: string;
  status: ElectionStatus;
  total_votes: number;
  total_eligible_voters: number;
  voter_turnout_percentage: number;
  results_by_position: PositionResults[];
  overall_results: CandidateResult[];
  quorum_met?: boolean;
  quorum_detail?: string | null;
}

export interface TimelineEvent {
  timestamp: string;
  event_type: string;
  description: string;
  user_id?: string;
}

export interface ElectionStats {
  election_id: string;
  total_candidates: number;
  total_votes_cast: number;
  total_eligible_voters: number;
  total_voters: number;
  voter_turnout_percentage: number;
  votes_by_position: { [position: string]: number };
  voting_timeline?: TimelineEvent[];
}

export interface EmailBallot {
  recipient_user_ids?: string[] | undefined;
  subject?: string | undefined;
  message?: string | undefined;
  include_ballot_link?: boolean | undefined;
  send_eligibility_summary?: boolean | undefined;
}

export interface SkippedVoterDetail {
  user_id: string;
  name: string;
  reason: string;
}

export interface EmailBallotResponse {
  success: boolean;
  recipients_count: number;
  failed_count: number;
  skipped_count: number;
  skipped_details: SkippedVoterDetail[];
  message: string;
}

export interface ElectionDeleteResponse {
  success: boolean;
  message: string;
  notifications_sent: number;
}

export interface ForensicsReport {
  election_id: string;
  election_title: string;
  election_status: ElectionStatus;
  anonymous_voting: boolean;
  voting_method: string;
  created_at: string;
  vote_integrity: VoteIntegrityResult;
  deleted_votes: {
    count: number;
    records: Array<{
      vote_id: string;
      candidate_id: string;
      position: string | null;
      deleted_at: string | null;
      deleted_by: string | null;
      deletion_reason: string | null;
    }>;
  };
  rollback_history: Array<Record<string, unknown>>;
  voting_tokens: {
    total_issued: number;
    total_used: number;
    records: Array<{
      token_id: string;
      used: boolean;
      used_at: string | null;
      first_accessed_at: string | null;
      access_count: number;
      positions_voted: string[];
      created_at: string | null;
      expires_at: string | null;
    }>;
  };
  audit_log: {
    total_entries: number;
    entries: Array<{
      id: string;
      timestamp: string | null;
      event_type: string;
      severity: string | null;
      user_id: string | null;
      ip_address: string | null;
      event_data: Record<string, unknown>;
    }>;
  };
  anomaly_detection: {
    suspicious_ips: Record<string, number>;
    unique_ip_count?: number;
    // True once an anonymous election closed and per-vote IP/user-agent
    // metadata was purged (ELEC-6)
    ip_metadata_purged?: boolean;
  };
  voting_timeline: Record<string, number>;
}

// Attendance types

export interface Attendee {
  user_id: string;
  name: string;
  checked_in_at: string;
  checked_in_by: string;
}

export interface AttendeeCheckInResponse {
  success: boolean;
  attendee: Attendee;
  message: string;
  total_attendees: number;
}

export interface ImportMeetingAttendeesResponse {
  success: boolean;
  imported: number;
  skipped: number;
  total_attendees: number;
  message: string;
}

// Election report response
export interface ElectionReportResponse {
  success: boolean;
  message: string;
}

// Pre-meeting package (secretary meeting prep)

/** Which PDF variant: 'member' = names + counts; 'full' = adds ineligibility reasons. */
export type PackageVariant = 'member' | 'full';

export interface PackageRecipient {
  user_id: string;
  name: string;
  email: string;
}

export interface PreMeetingPackageSend {
  recipient_emails: string[];
  message?: string | undefined;
  include_full_roster: boolean;
}

export interface PreMeetingPackageResponse {
  success: boolean;
  message: string;
  sent_count: number;
}

// Vote receipt verification
export interface VoteReceiptResponse {
  verified: boolean;
  message: string;
  voted_at?: string | null;
  position?: string | null;
}

// Ballot template types

export interface BallotTemplate {
  id: string;
  name: string;
  description: string;
  type: string;
  vote_type: string;
  eligible_voter_types: string[];
  require_attendance: boolean;
  title_template: string;
  description_template?: string;
}

// Ballot submission types (token-based voting)

export interface BallotItemVote {
  ballot_item_id: string;
  // Exactly one selection form per item; none at all = abstain.
  choice?: string | undefined; // 'approve', 'deny', 'abstain', 'write_in', or a candidate UUID
  candidate_ids?: string[] | undefined; // multi-select (approval / multi-vote items)
  rankings?: string[] | undefined; // ordered candidate ids, index 0 = rank 1 (ranked choice)
  write_in_name?: string | undefined;
}

export interface BallotSubmissionResponse {
  success: boolean;
  votes_cast: number;
  abstentions: number;
  message: string;
  receipt_hashes?: string[];
}

// Voter override types

export interface VoterOverride {
  user_id: string;
  user_name?: string;
  reason: string;
  overridden_by: string;
  overridden_by_name?: string;
  overridden_at: string;
}

export interface VoterOverrideCreate {
  user_id: string;
  reason: string;
}

export interface BulkVoterOverrideCreate {
  user_ids: string[];
  reason: string;
}

// Proxy voting types

export interface ProxyAuthorization {
  id: string;
  delegating_user_id: string;
  delegating_user_name?: string;
  proxy_user_id: string;
  proxy_user_name?: string;
  proxy_type: 'single_election' | 'regular';
  reason: string;
  authorized_by: string;
  authorized_by_name?: string;
  authorized_at: string;
  revoked_at?: string;
}

export interface ProxyAuthorizationCreate {
  delegating_user_id: string;
  proxy_user_id: string;
  proxy_type: 'single_election' | 'regular';
  reason: string;
}

export interface ProxyVoteCreate {
  election_id: string;
  candidate_id: string;
  proxy_authorization_id: string;
  position?: string;
  vote_rank?: number;
}

// Election Settings (org-level defaults)
export interface ElectionSettings {
  default_voting_method?: VotingMethod;
  default_victory_condition?: VictoryCondition;
  default_victory_percentage?: number;
  default_anonymous_voting?: boolean;
  default_allow_write_ins?: boolean;
  default_quorum_type?: string;
  default_quorum_value?: number;
  proxy_voting_enabled?: boolean;
  max_proxies_per_person?: number;
  // Per-department feature toggles (all default ON)
  nominations_enabled?: boolean;
  paper_ballots_enabled?: boolean;
  reminders_enabled?: boolean;
  auto_open_enabled?: boolean;
  // Officers (other than the recorder) who must attest a paper-ballot
  // batch before its votes count. 0 disables attestation. Default 2.
  paper_ballot_attestations_required?: number;
}

// Paper-ballot batches (attestation workflow)
export interface ManualBallotAttestation {
  user_id?: string | null;
  name?: string | null;
  attested_at?: string | null;
}

export interface ManualBallotBatchTotal {
  candidate_id: string;
  candidate_name: string;
  position?: string | null;
  count: number;
}

export interface ManualBallotBatch {
  batch_id: string;
  status: 'pending' | 'confirmed' | 'voided';
  recorded_by?: string | null;
  recorded_by_name?: string | null;
  recorded_at?: string | null;
  notes?: string | null;
  required_attestations: number;
  attestations: ManualBallotAttestation[];
  totals: ManualBallotBatchTotal[];
  total_ballots: number;
}

// Ballot Preview (secretary view with eligibility annotations)
export interface BallotPreviewItem {
  ballot_item: BallotItem;
  eligible: boolean;
  reason?: string;
}

export interface BallotPreview {
  election_id: string;
  user_id: string;
  user_name: string;
  items: BallotPreviewItem[];
  total_eligible: number;
  total_items: number;
}

// Eligibility Roster (secretary dashboard view)
export interface RosterItemEligibility {
  ballot_item_id: string;
  ballot_item_title: string;
  eligible: boolean;
  reason?: string;
}

export interface RosterMember {
  user_id: string;
  full_name: string;
  email: string;
  membership_type: string;
  has_override: boolean;
  has_voted: boolean;
  is_attending: boolean;
  will_receive_ballot: boolean;
  eligible_item_count: number;
  total_item_count: number;
  ineligibility_reason?: string;
  item_eligibility: RosterItemEligibility[];
}

export interface EligibilityRoster {
  election_id: string;
  election_title: string;
  election_status: string;
  total_members: number;
  total_eligible: number;
  total_ineligible: number;
  total_voted: number;
  total_overrides: number;
  roster: RosterMember[];
}
