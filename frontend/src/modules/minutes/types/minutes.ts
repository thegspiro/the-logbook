/**
 * Meeting Minutes Type Definitions
 */

export type MeetingType = 'business' | 'special' | 'committee' | 'board' | 'trustee' | 'executive' | 'annual' | 'other';
export type MinutesStatus = 'draft' | 'submitted' | 'approved' | 'rejected';
/** `pending` is a motion the outline prepared that the meeting has not acted on; it is never part of the record. */
export type MotionStatus = 'pending' | 'passed' | 'failed' | 'tabled' | 'withdrawn';
/** The previous minutes were accepted as submitted, or as revised. */
export type MotionAcceptance = 'as_submitted' | 'as_revised';
export type ActionItemStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'overdue';
export type ActionItemPriority = 'low' | 'medium' | 'high' | 'urgent';

// ── Section Types ──

export interface SectionEntry {
  order: number;
  key: string;
  title: string;
  content: string;
  /** 'html' is the rich-text subset; absent or 'text' is plain text, as written before the editor. */
  format?: 'text' | 'html' | undefined;
  /** From the outline: a required section needs text before minutes circulate. */
  required?: boolean;
  /** From the outline: the body moves and seconds this section, as to adopt minutes or adjourn. */
  needs_motion?: boolean | undefined;
  /** From the outline: the wording the section's motion starts with. */
  motion_text?: string | undefined;
  /** From the agenda item: who reports on this item. */
  presenter?: string | undefined;
  /** The meeting never reached this item; it stays in the record, marked so. */
  not_taken_up?: boolean | undefined;
  /** The agenda item this section was made from (set by the server). */
  agenda_key?: string | null | undefined;
  /** Documents-library files linked from the agenda item (set by the server). */
  documents?: { id: string; name: string }[] | undefined;
}

export interface TemplateSectionEntry {
  order: number;
  key: string;
  title: string;
  default_content: string;
  format?: 'text' | 'html' | undefined;
  required: boolean;
  needs_motion?: boolean | undefined;
  motion_text?: string | undefined;
}

// ── Header / Footer Config ──

export interface HeaderConfig {
  org_name?: string;
  logo_url?: string;
  subtitle?: string | null | undefined;
  show_date?: boolean;
  show_meeting_type?: boolean;
}

export interface FooterConfig {
  left_text?: string;
  center_text?: string;
  right_text?: string;
  show_page_numbers?: boolean;
  confidentiality_notice?: string | null | undefined;
}

// ── Template Types ──

export interface MinutesTemplate {
  id: string;
  organization_id: string;
  name: string;
  description?: string | null | undefined;
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
  description?: string | null | undefined;
  meeting_type: MeetingType;
  is_default?: boolean;
  sections: TemplateSectionEntry[];
  header_config?: HeaderConfig;
  footer_config?: FooterConfig;
}

export interface TemplateUpdate {
  name?: string;
  description?: string | null | undefined;
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

export type MotionThreshold = 'majority_cast' | 'majority_present' | 'two_thirds';
export type RollCallVote = 'yes' | 'no' | 'abstain' | 'recuse';

/** One member's vote in a roll call. The server fills in `user_id` from the minutes' roll. */
export interface RollCallEntry {
  name: string;
  vote: RollCallVote;
  user_id?: string | null;
}

export interface Motion {
  id: string;
  minutes_id: string;
  order: number;
  motion_text: string;
  moved_by?: string;
  seconded_by?: string;
  /** The outline section the motion was made from, when it was made from one. */
  section_key?: string | null;
  discussion_notes?: string;
  status: MotionStatus;
  /** For the motion accepting the previous minutes: how they were accepted. */
  acceptance?: MotionAcceptance | null;
  /** The minutes this motion accepts, set by the server; and where they stand. */
  previous_minutes_id?: string | null;
  previous_minutes_title?: string | null;
  previous_minutes_status?: string | null;
  votes_for?: number;
  votes_against?: number;
  votes_abstain?: number;
  votes_recused?: number | null;
  /** What the motion needed to carry; a majority of the votes cast when absent. */
  threshold?: MotionThreshold | null;
  /** Each member's vote, when taken by roll call. */
  roll_call?: RollCallEntry[] | null;
  /** passed or failed when the counts and threshold decide it, as the server reads them. */
  suggested_status?: 'passed' | 'failed' | null;
  /** The ballot that decided the motion, when it went to a ballot. */
  election_id?: string | null;
  ballot_item_id?: string | null;
  election_title?: string | null;
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

/** Which attendance statuses minutes name; the roll is always recorded in full. */
export type AttendanceListing = 'all' | 'present_excused' | 'present';

export interface MeetingMinutes {
  id: string;
  organization_id: string;
  title: string;
  /** The meeting record these minutes were drafted from, if any. */
  meeting_id?: string | null;
  meeting_type: MeetingType;
  meeting_date: string;
  location?: string;
  called_by?: string;
  called_to_order_at?: string;
  adjourned_at?: string;
  attendees?: AttendeeEntry[];
  /** This set's own choice; null follows the department default. */
  attendance_listing?: AttendanceListing | null;
  /** What is in force: the choice above, else the department default. */
  attendance_listing_effective?: AttendanceListing;
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
  /** When the body voted to adopt, as presented or as amended, and where. */
  adopted_on?: string | null;
  adopted_as_amended?: boolean | null;
  adoption_moved_by?: string | null;
  adoption_seconded_by?: string | null;
  adopting_minutes_id?: string | null;
  adopting_minutes_title?: string | null;
  created_by?: string;
  created_at: string;
  updated_at: string;
  /** Bumped by every content save; sent back as `expected_version` so a stale save is refused (409). */
  edit_version?: number;
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
  section_key?: string | undefined;
  discussion_notes?: string | undefined;
  status?: MotionStatus | undefined;
  acceptance?: MotionAcceptance | null | undefined;
  votes_for?: number | undefined;
  votes_against?: number | undefined;
  votes_abstain?: number | undefined;
  votes_recused?: number | undefined;
  threshold?: MotionThreshold | undefined;
  roll_call?: RollCallEntry[] | undefined;
  order?: number | undefined;
  election_id?: string | undefined;
  ballot_item_id?: string | undefined;
}

export interface MotionUpdate {
  motion_text?: string | undefined;
  moved_by?: string | undefined;
  seconded_by?: string | undefined;
  discussion_notes?: string | undefined;
  status?: MotionStatus | undefined;
  /** An explicit null clears it. */
  acceptance?: MotionAcceptance | null | undefined;
  votes_for?: number | undefined;
  votes_against?: number | undefined;
  votes_abstain?: number | undefined;
  votes_recused?: number | undefined;
  threshold?: MotionThreshold | undefined;
  roll_call?: RollCallEntry[] | null | undefined;
  order?: number | undefined;
  election_id?: string | null | undefined;
  ballot_item_id?: string | null | undefined;
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

// ── Archive search ──

export interface ArchiveSnippetPart {
  text: string;
  hit: boolean;
}

export interface ArchiveMatch {
  kind: 'title' | 'section' | 'motion' | 'action_item';
  label: string;
  parts: ArchiveSnippetPart[];
}

export interface ArchiveHit {
  id: string;
  title: string;
  meeting_type: MeetingType;
  meeting_date: string;
  status: MinutesStatus;
  match_count: number;
  matches: ArchiveMatch[];
}

export interface ArchiveSearchResponse {
  terms: string[];
  hits: ArchiveHit[];
  searched: number;
  truncated: boolean;
}

// ── Roll call suggestions ──

export interface AttendanceSuggestions {
  source: 'event' | 'roster';
  event_title?: string | null;
  entries: AttendeeEntry[];
}

// ── Election results ──

export interface BallotItemRef {
  id: string;
  title: string;
}

export interface ImportableElection {
  id: string;
  title: string;
  election_type?: string | null;
  closed_at?: string | null;
  positions?: string[] | null;
  already_imported: boolean;
  /** Held at this meeting's event or recorded against its meeting record. */
  linked_to_meeting?: boolean;
  ballot_items?: BallotItemRef[];
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
  /** Filed after the minutes were circulated: permanent, outside the adopted text. */
  is_addendum?: boolean;
  captured_by?: string | null;
  captured_by_name?: string | null;
  created_at: string;
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

// ── Closed sessions ──

export interface ClosedSessionParticipant {
  user_id?: string | null;
  name: string;
  joined_at?: string | null;
  left_at?: string | null;
}

export interface ClosedSession {
  id: string;
  minutes_id: string;
  motion_id?: string | null;
  reason: string;
  legal_basis?: string | null;
  started_at: string;
  ended_at?: string | null;
  participants: ClosedSessionParticipant[];
  summary?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClosedSessionInput {
  reason: string;
  legal_basis: string | null;
  started_at: string;
  ended_at: string | null;
  motion_id: string | null;
  participants: ClosedSessionParticipant[];
  summary: string | null;
}

// ── Review ──

export type SuggestionStatus = 'open' | 'accepted' | 'declined';

export type ChangeKind = 'replace' | 'insert' | 'delete' | 'format';
export type ChangeDecision = 'open' | 'accepted' | 'rejected';

/** One tracked change in a suggestion: the words removed and added, with context. */
export interface SuggestionChange {
  id: string;
  kind: ChangeKind;
  deleted: string;
  inserted: string;
  before: string;
  after: string;
  decision: ChangeDecision;
}

export interface MinutesSuggestion {
  id: string;
  minutes_id: string;
  section_key?: string | null;
  comment: string;
  proposed_text?: string | null;
  /** The section as the reviewer saw it, and their edited copy (tracked changes only). */
  base_content?: string | null;
  proposed_content?: string | null;
  changes?: SuggestionChange[];
  /** The section has been edited since the reviewer saw it. */
  section_changed?: boolean;
  applied_at?: string | null;
  status: SuggestionStatus;
  resolution_note?: string | null;
  resolved_by_name?: string | null;
  resolved_at?: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
  created_at: string;
}

/** What a later meeting's passed acceptance motion implies for these minutes' adoption. */
export interface AdoptionProposal {
  motion_id: string;
  adopted_on: string;
  adopting_minutes_id: string;
  adopting_minutes_title: string;
  as_amended: boolean;
  moved_by?: string | null;
  seconded_by?: string | null;
}

export interface AdoptionDetails {
  adopted_on?: string | undefined;
  adopting_minutes_id?: string | undefined;
  as_amended?: boolean | undefined;
  moved_by?: string | undefined;
  seconded_by?: string | undefined;
}

/** The department's action item reminder settings, as the server applies them. */
export interface MinutesReminderSettings {
  action_item_reminders: boolean;
  reminder_days_before_due: number;
  overdue_repeat_days: number;
  open_items_digest: boolean;
  signature_slots: SignatureSlot[];
  /** Also post published minutes on the public minutes page. */
  public_posting: boolean;
  executive_library_publishing: boolean;
  executive_public_posting: boolean;
  /** What the server will actually do for executive-session minutes, whatever the switches read. */
  executive_effective_library: boolean;
  executive_effective_public: boolean;
  attendance_listing: AttendanceListing;
  /** File a closed election's result with its meeting's minutes without being asked. */
  auto_file_election_results: boolean;
}

/** What every panel on the minutes settings page is given. */
export interface MinutesSettingsPanelProps {
  /** The department's settings as the server applies them. */
  settings: MinutesReminderSettings;
  /** Whether the viewer may change them (`settings.manage`); anyone else reads. */
  canEdit: boolean;
  /** Called after a save so the page re-reads what the server now holds. */
  onSaved: () => Promise<void> | void;
}

/** Where one set of minutes stands: the library copy, the public copy, and what the settings allow. */
export interface MinutesPublishingStatus {
  library_allowed: boolean;
  library_published: boolean;
  library_version: number | null;
  library_published_at: string | null;
  public_allowed: boolean;
  public_posted: boolean;
  public_withdrawn: boolean;
  public_version: number | null;
  public_posted_at: string | null;
  public_replaced_version: number | null;
  public_under_correction: boolean;
  public_copy_id: string | null;
}

/** What publishing did, so the screen can say posted or not posted. */
export interface MinutesPublishResult {
  public_allowed: boolean;
  public_posted: boolean;
}

/** A place on adopted minutes for a signature. */
export interface SignatureSlot {
  key: string;
  title: string;
  /** The position whose holders may sign; anyone who manages minutes may when absent. */
  position_slug?: string | null;
}

export interface MinutesSignature {
  id: string;
  slot_key: string;
  slot_title: string;
  signed_name: string;
  signed_at: string;
  /** The signature was given on the version now on file. */
  intact: boolean;
}

export interface SignatureStatusSlot extends SignatureSlot {
  can_sign: boolean;
  signature: MinutesSignature | null;
}

export interface SignatureStatus {
  /** The adopted version being signed; null before adoption. */
  version: number | null;
  slots: SignatureStatusSlot[];
}

// ── Agenda sync ──

export type AgendaSyncChangeType = 'add' | 'update' | 'remove' | 'reorder';

export interface AgendaSyncChange {
  id: string;
  type: AgendaSyncChangeType;
  key: string;
  title: string;
  /** The section already holds text, so removing its item detaches it instead of deleting it. */
  has_content: boolean;
  fields: { field: string; before: unknown; after: unknown }[];
}

export interface AgendaSyncPreview {
  meeting_id: string;
  changes: AgendaSyncChange[];
}
