/**
 * Meeting Minutes Type Definitions
 */

export type MeetingType = 'business' | 'special' | 'committee' | 'board' | 'trustee' | 'executive' | 'annual' | 'other';
export type MinutesStatus = 'draft' | 'submitted' | 'approved' | 'rejected';
export type MotionStatus = 'passed' | 'failed' | 'tabled' | 'withdrawn';
export type ActionItemStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'overdue';
export type ActionItemPriority = 'low' | 'medium' | 'high' | 'urgent';

// ── Section Types ──

export interface SectionEntry {
  order: number;
  key: string;
  title: string;
  content: string;
}

export interface TemplateSectionEntry {
  order: number;
  key: string;
  title: string;
  default_content: string;
  required: boolean;
}

// ── Header / Footer Config ──

export interface HeaderConfig {
  org_name?: string;
  logo_url?: string;
  subtitle?: string;
  show_date?: boolean;
  show_meeting_type?: boolean;
}

export interface FooterConfig {
  left_text?: string;
  center_text?: string;
  right_text?: string;
  show_page_numbers?: boolean;
  confidentiality_notice?: string;
}

// ── Template Types ──

export interface MinutesTemplate {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  meeting_type: MeetingType;
  is_default: boolean;
  sections: TemplateSectionEntry[];
  header_config?: HeaderConfig;
  footer_config?: FooterConfig;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface TemplateListItem {
  id: string;
  name: string;
  meeting_type: MeetingType;
  is_default: boolean;
  section_count: number;
  created_at: string;
}

export interface TemplateCreate {
  name: string;
  description?: string;
  meeting_type: MeetingType;
  is_default?: boolean;
  sections: TemplateSectionEntry[];
  header_config?: HeaderConfig;
  footer_config?: FooterConfig;
}

export interface TemplateUpdate {
  name?: string;
  description?: string;
  meeting_type?: MeetingType;
  is_default?: boolean;
  sections?: TemplateSectionEntry[];
  header_config?: HeaderConfig;
  footer_config?: FooterConfig;
}

// ── Existing types (unchanged) ──

export type AttendanceStatus = 'present' | 'late' | 'left_early' | 'excused' | 'absent' | 'guest';

/**
 * One line of the roll call. `status` is the record; `present` is derived from
 * it by the server and means "counted toward quorum" (present, late, left
 * early). Rows saved before statuses existed have no `status`.
 */
export interface AttendeeEntry {
  user_id?: string | null;
  name: string;
  role?: string | null;
  status?: AttendanceStatus;
  present: boolean;
  note?: string | null;
}

export interface Motion {
  id: string;
  minutes_id: string;
  order: number;
  motion_text: string;
  moved_by?: string;
  seconded_by?: string;
  discussion_notes?: string;
  status: MotionStatus;
  votes_for?: number;
  votes_against?: number;
  votes_abstain?: number;
  created_at: string;
  updated_at: string;
}

export interface ActionItem {
  id: string;
  minutes_id: string;
  description: string;
  assignee_id?: string;
  assignee_name?: string;
  due_date?: string;
  priority: ActionItemPriority;
  status: ActionItemStatus;
  completed_at?: string;
  completion_notes?: string;
  /** The earlier item this one continues, when it was carried forward. */
  carried_from_id?: string | null;
  /** Set on the original once it has been carried into later minutes. */
  carried_forward_at?: string | null;
  created_at: string;
  updated_at: string;
}

/** An open item from an earlier meeting, offered for carry-forward. */
export interface OpenActionItem extends ActionItem {
  minutes_title: string;
  meeting_date: string;
}

/** An item assigned to the caller, with the minutes it came from. */
export interface MyActionItem extends ActionItem {
  minutes_title: string;
  meeting_date: string;
  minutes_status: MinutesStatus;
}

export interface MeetingMinutes {
  id: string;
  organization_id: string;
  title: string;
  meeting_type: MeetingType;
  meeting_date: string;
  location?: string;
  called_by?: string;
  called_to_order_at?: string;
  adjourned_at?: string;
  attendees?: AttendeeEntry[];
  quorum_met?: boolean;
  quorum_count?: number;
  event_id?: string;
  template_id?: string;
  sections: SectionEntry[];
  header_config?: HeaderConfig;
  footer_config?: FooterConfig;
  published_document_id?: string;
  status: MinutesStatus;
  submitted_at?: string;
  submitted_by?: string;
  approved_at?: string;
  approved_by?: string;
  rejected_at?: string;
  rejected_by?: string;
  rejection_reason?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
  motions: Motion[];
  action_items: ActionItem[];
}

export interface MinutesListItem {
  id: string;
  title: string;
  meeting_type: MeetingType;
  meeting_date: string;
  status: MinutesStatus;
  location?: string;
  called_by?: string;
  template_id?: string;
  /** The meeting record these minutes were written from, if any. */
  meeting_id?: string | null;
  motions_count: number;
  action_items_count: number;
  open_action_items: number;
  created_at: string;
}

export interface MinutesCreate {
  title: string;
  meeting_type: MeetingType;
  meeting_date: string;
  location?: string;
  called_by?: string;
  event_id?: string;
  template_id?: string;
  sections?: SectionEntry[];
  header_config?: HeaderConfig;
  footer_config?: FooterConfig;
  motions?: MotionCreate[];
  action_items?: ActionItemCreate[];
}

export interface MinutesUpdate {
  title?: string;
  meeting_type?: MeetingType;
  meeting_date?: string;
  location?: string;
  called_by?: string;
  event_id?: string;
  sections?: SectionEntry[];
  header_config?: HeaderConfig;
  footer_config?: FooterConfig;
}

export interface MotionCreate {
  motion_text: string;
  moved_by?: string | undefined;
  seconded_by?: string | undefined;
  discussion_notes?: string | undefined;
  status?: MotionStatus | undefined;
  votes_for?: number | undefined;
  votes_against?: number | undefined;
  votes_abstain?: number | undefined;
  order?: number | undefined;
}

export interface MotionUpdate {
  motion_text?: string;
  moved_by?: string;
  seconded_by?: string;
  discussion_notes?: string;
  status?: MotionStatus;
  votes_for?: number;
  votes_against?: number;
  votes_abstain?: number;
  order?: number;
}

/** A member an action item may be assigned to (W52-6). */
export interface ActionItemAssignee {
  id: string;
  name: string;
}

export interface ActionItemCreate {
  description: string;
  assignee_id?: string | undefined;
  assignee_name?: string | undefined;
  due_date?: string | undefined;
  priority?: ActionItemPriority | undefined;
}

export interface ActionItemUpdate {
  description?: string;
  assignee_id?: string;
  assignee_name?: string;
  due_date?: string;
  priority?: ActionItemPriority;
  status?: ActionItemStatus;
  completion_notes?: string;
}

export interface MinutesStats {
  total: number;
  this_month: number;
  open_action_items: number;
  pending_approval: number;
}

export interface MinutesSearchResult {
  id: string;
  title: string;
  meeting_type: MeetingType;
  meeting_date: string;
  status: MinutesStatus;
  snippet: string;
  match_field: string;
}

// ── Roll call suggestions ──

export interface AttendanceSuggestions {
  source: 'event' | 'roster';
  event_title?: string | null;
  entries: AttendeeEntry[];
}

// ── Election results ──

export interface ImportableElection {
  id: string;
  title: string;
  election_type?: string | null;
  closed_at?: string | null;
  positions?: string[] | null;
  already_imported: boolean;
}

export interface FiledCandidateResult {
  candidate_name: string;
  vote_count: number;
  percentage: number;
  is_winner: boolean;
  is_tied?: boolean;
}

export interface FiledPositionResult {
  position: string;
  label?: string | null;
  total_votes: number;
  candidates: FiledCandidateResult[];
}

/** The ElectionResults dump frozen into the minutes. */
export interface ElectionResultSnapshot {
  election_title?: string;
  total_votes?: number;
  total_eligible_voters?: number;
  voter_turnout_percentage?: number;
  quorum_met?: boolean | null;
  quorum_detail?: string | null;
  results_by_position?: FiledPositionResult[];
  overall_results?: FiledCandidateResult[];
}

export interface MinutesElectionResult {
  id: string;
  minutes_id: string;
  election_id?: string | null;
  election_title: string;
  election_closed_at?: string | null;
  snapshot: ElectionResultSnapshot;
  captured_by?: string | null;
  captured_by_name?: string | null;
  captured_at: string;
}

// ── Attachments ──

export type AttachmentCategory = 'signed_copy' | 'report' | 'agenda' | 'handout' | 'correspondence' | 'other';

export interface MinutesAttachment {
  id: string;
  minutes_id: string;
  title: string;
  category: AttachmentCategory;
  description?: string | null;
  original_name: string;
  mime_type: string;
  file_size: number;
  sha256: string;
  uploaded_by?: string | null;
  uploaded_by_name?: string | null;
  uploaded_at: string;
}

// ── Approved versions ──

export interface MinutesRevision {
  id: string;
  minutes_id: string;
  version: number;
  content_hash: string;
  submitted_by?: string | null;
  submitted_by_name?: string | null;
  approved_by?: string | null;
  approved_by_name?: string | null;
  approved_at: string;
  superseded_at?: string | null;
  superseded_by?: string | null;
  superseded_by_name?: string | null;
  superseded_reason?: string | null;
}

export interface MinutesVerification {
  verified: boolean;
  version?: number | null;
  content_hash?: string | null;
  current_hash?: string | null;
  changed: string[];
  detail: string;
}
