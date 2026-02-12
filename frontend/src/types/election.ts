/**
 * Election Type Definitions
 */

export type ElectionStatus = 'draft' | 'open' | 'closed' | 'cancelled';

export interface BallotItem {
  id: string;
  type: string; // membership_approval, officer_election, general_vote
  title: string;
  description?: string;
  position?: string;
  eligible_voter_types: string[]; // ['all'], ['regular'], ['life'], ['probationary'], ['operational'], ['administrative'], or specific role slugs
  vote_type: string; // approval, candidate_selection
  required_for_approval?: number;
  require_attendance?: boolean; // If true, voter must be checked in as present at the meeting
}

export interface PositionEligibility {
  voter_types: string[]; // Role slugs that can vote for this position
  min_votes_required?: number;
}

export type VotingMethod = 'simple_majority' | 'ranked_choice' | 'approval' | 'supermajority';
export type VictoryCondition = 'most_votes' | 'majority' | 'supermajority' | 'threshold';

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
  created_by?: string;
  created_at: string;
  updated_at: string;
  total_votes?: number;
  total_voters?: number;
  voter_turnout_percentage?: number;
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
}

export interface ElectionCreate {
  title: string;
  description?: string;
  election_type: string;
  positions?: string[];
  ballot_items?: BallotItem[];
  position_eligibility?: { [position: string]: PositionEligibility };
  meeting_date?: string;
  start_date: string;
  end_date: string;
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
}

export interface ElectionUpdate {
  title?: string;
  description?: string;
  election_type?: string;
  positions?: string[];
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
  user_id?: string;
  name: string;
  position?: string;
  statement?: string;
  photo_url?: string;
  display_order?: number;
  is_write_in?: boolean;
}

export interface CandidateUpdate {
  name?: string;
  position?: string;
  statement?: string;
  photo_url?: string;
  accepted?: boolean;
  display_order?: number;
}

export interface Vote {
  id: string;
  election_id: string;
  candidate_id: string;
  position?: string;
  vote_rank?: number; // For ranked-choice voting (1 = first choice)
  voted_at: string;
  voter_id?: string;
}

export interface VoteCreate {
  election_id: string;
  candidate_id: string;
  position?: string;
  vote_rank?: number; // For ranked-choice voting (1 = first choice)
}

export interface VoteIntegrityResult {
  election_id: string;
  total_votes: number;
  valid_signatures: number;
  unsigned_votes: number;
  tampered_votes: number;
  tampered_vote_ids: string[];
  integrity_status: 'PASS' | 'FAIL';
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
  status: string;
  total_votes: number;
  total_eligible_voters: number;
  voter_turnout_percentage: number;
  results_by_position: PositionResults[];
  overall_results: CandidateResult[];
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
  recipient_user_ids?: string[];
  subject?: string;
  message?: string;
  include_ballot_link?: boolean;
}

export interface EmailBallotResponse {
  success: boolean;
  recipients_count: number;
  failed_count: number;
  message: string;
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
