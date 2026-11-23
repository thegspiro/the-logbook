/**
 * Event Type Definitions
 */

// Import enum types from the canonical source and re-export
import type { AttendancePetitionStatus, EventRequestSource, EventType, RSVPStatus } from '../constants/enums';
export type { AttendancePetitionStatus, EventType, RSVPStatus };

export interface Event {
  id: string;
  organization_id: string;
  title: string;
  description?: string;
  event_type: EventType;
  custom_category?: string;
  location_id?: string;
  location?: string;
  location_name?: string;
  location_details?: string;
  start_datetime: string;
  end_datetime: string;
  actual_start_time?: string;
  actual_end_time?: string;
  requires_rsvp: boolean;
  rsvp_deadline?: string;
  max_attendees?: number;
  allowed_rsvp_statuses?: RSVPStatus[];
  is_mandatory: boolean;
  /** A session-attendance requirement counts this event; absent from an older backend. */
  counts_toward_attendance?: boolean;
  mandatory_membership_types?: string[];

  allow_guests: boolean;
  /** Who may see the going list: 'members', 'managers', or null to inherit the
   * organization's events default. */
  attendee_visibility?: 'members' | 'managers' | null;
  send_reminders: boolean;
  reminder_target: 'going' | 'all' | 'none';
  reminder_schedule: number[];
  check_in_window_type?: 'flexible' | 'strict' | 'window';
  check_in_minutes_before?: number;
  check_in_minutes_after?: number;
  require_checkout?: boolean;
  allow_guest_check_in?: boolean;
  guest_check_in_creates_prospect?: boolean;
  custom_fields?: Record<string, string | number | boolean | null>;
  attachments?: EventAttachment[];
  is_recurring?: boolean;
  recurrence_pattern?: RecurrencePattern;
  recurrence_end_date?: string;
  rolling_recurrence?: boolean;
  recurrence_custom_days?: number[];
  recurrence_weekday?: number;
  recurrence_week_ordinal?: number;
  recurrence_month?: number;
  recurrence_exceptions?: string[];
  recurrence_parent_id?: string;
  template_id?: string;
  is_draft?: boolean;
  is_cancelled: boolean;
  cancellation_reason?: string;
  cancelled_at?: string;
  /** Set when the event was postponed; postponed_from_start is its start before the first postponement. */
  postponed_at?: string | null;
  postponed_from_start?: string | null;
  postponement_reason?: string | null;
  /**
   * Attendance lock. Set means the event is closed: check-in, attendee edits,
   * time corrections and deletion are all refused by the API until someone
   * with `events.reopen_attendance` reopens it. Absent on list payloads.
   */
  attendance_finalized_at?: string | null;
  attendance_finalized_by?: string | null;
  /** Resolved on the detail endpoint only; null for rows finalized before the
   * actor was recorded. */
  attendance_finalized_by_name?: string | null;
  created_by?: string;
  /**
   * Who organized the event. Resolved on the detail endpoint only, and only for
   * a caller holding `events.manage` — the server withholds it from everyone
   * else, so an absent name here means "not yours to see" or "no creator
   * recorded", never "the field was forgotten".
   */
  created_by_name?: string | null;
  /** Who runs the event, and their stand-in. Attendance requests go to these
   * two; changing them is a transfer (`eventService.transferEvent`). */
  organizer_id?: string | null;
  alternate_organizer_id?: string | null;
  /** Resolved on the detail endpoint only, for a caller who may transfer the
   * event (its organizer, its alternate or an events manager). */
  organizer_name?: string | null;
  alternate_organizer_name?: string | null;
  /** Server-decided: may this caller decide the event's attendance requests
   * and hand it over. Detail endpoint only; false elsewhere. */
  can_manage_organizers?: boolean;
  /** Server-decided: may this caller see and decide the event's attendance
   * requests — the above, plus a fallback position holder a request was
   * sent to. Detail endpoint only; false elsewhere. */
  can_review_attendance_requests?: boolean;
  /** Server-decided: how this caller may use the attendance tools — the
   * roster, adding, checking in and removing members — or null. An
   * `organizer` may not write their own row. Detail endpoint only. */
  attendance_access?: 'events_manager' | 'training_manager' | 'organizer' | null;
  /** Server-decided: may this caller correct check-in times and credited
   * hours. False for an organizer on a Training event. */
  can_correct_attendance_times?: boolean;
  /** Server-decided: may this caller edit the event and close its attendance
   * (End Event, Finalize, Record Times) — events.manage, or training.manage
   * on a Training event. Detail endpoint only. */
  can_edit_event?: boolean;
  /** Server-decided: may this caller reopen finalized attendance —
   * events.reopen_attendance, or training.manage on a Training event. */
  can_reopen_attendance?: boolean;
  /** Guests a coordinator counted at an outreach event nobody signed in at. */
  guest_headcount?: number | null;
  /** Server-decided: events.manage on an event that counts as community
   * outreach. Detail endpoint only. */
  can_record_guest_headcount?: boolean;
  /** May this caller see and open the event's volunteer signup sheet (detail only). */
  can_staff_event?: boolean;
  /** The live signup sheet as any member sees it, to sign up from the event page (detail only). */
  volunteer_signup?: EventVolunteerSignup | null;
  /** What happened at an outreach event, recorded when it closes. */
  outreach_outcome_note?: string | null;
  outreach_apparatus_ids?: string[] | null;
  outreach_materials?: OutreachMaterial[] | null;
  outreach_photos?: OutreachPhotos | null;
  created_at: string;
  updated_at: string;
  rsvp_count?: number;
  going_count?: number;
  not_going_count?: number;
  maybe_count?: number;
  user_rsvp_status?: RSVPStatus;

  /** How many members are waiting, and where the current user sits in that
   * queue (1-based). Position is null unless the caller is waitlisted. */
  waitlist_count?: number | null;
  user_waitlist_position?: number | null;
  /** True when the caller is waitlisted with a party larger than the event
   * holds. Promotion passes such a party over, so they have no position and
   * must not be told a spot will open for them. */
  user_waitlist_exceeds_capacity?: boolean;
  /** Seats taken. See EventListItem.occupied_seats. */
  occupied_seats?: number | null;

  /** The caller's own RSVP, so the modal can open prefilled rather than
   * resetting and silently discarding what they had entered. */
  user_rsvp?: UserRSVP | null;

  /** When self check-in closes, as the backend's check-in window defines it.
   * Later than end_datetime for a "window" event with minutes after. */
  check_in_closes_at?: string | null;
  /** When self check-in opens, from the same window as check_in_closes_at. */
  check_in_opens_at?: string | null;

  /** The list card's per-caller fields, computed by the same helpers on the
   * detail endpoint: has this member checked in (by scan or an officer's
   * override), and what the event would credit. See EventListItem. */
  user_attended?: boolean;
  credited_hours?: number | null;
  hour_category_label?: string | null;
  /** Whether GET /events/{id}/attendees will answer this caller. The page asks
   * for the roster only when it will. */
  can_view_attendees?: boolean;
}

/** A member's request to be marked present at an event that is over. */
export interface AttendancePetition {
  id: string;
  event_id: string;
  user_id: string;
  user_name?: string | null;
  status: AttendancePetitionStatus;
  reason: string;
  requested_check_in_at?: string | null;
  requested_check_out_at?: string | null;
  reviewed_by?: string | null;
  reviewed_by_name?: string | null;
  reviewed_at?: string | null;
  review_note?: string | null;
  created_at: string;
  /** How many times the member withdrew and resent this request. */
  withdrawal_count?: number;
}

/** A pending request with the event it is about, for the cross-event list. */
export interface PendingAttendancePetition extends AttendancePetition {
  event_title: string;
  event_start_datetime: string;
  event_end_datetime: string;
  event_actual_start_time?: string | null;
  event_actual_end_time?: string | null;
  attendance_finalized: boolean;
}

/** The caller's own request, and whether the server would accept one now.
 * `can_request` is the server's decision; the screen does not re-derive it. */
export interface MyAttendancePetition {
  petition: AttendancePetition | null;
  can_request: boolean;
  unavailable_reason?: string | null;
  /** False once the request has been withdrawn the maximum number of times. */
  can_withdraw?: boolean;
}

export interface AttendancePetitionCreate {
  reason: string;
  requested_check_in_at?: string | undefined;
  requested_check_out_at?: string | undefined;
}

export interface AttendancePetitionApprove {
  check_in_at: string;
  check_out_at: string;
  review_note?: string | undefined;
}

/** The current user's own RSVP, echoed back on the event detail response.
 *
 * Deliberately carries neither dietary restrictions nor accessibility needs.
 * Event detail is a cacheable GET, and putting accommodation data on it made
 * the app's most-visited endpoint PHI-bearing. Those two fields simply start
 * empty when the modal reopens, as they did before prefill existed;
 * `guest_count` is the one prefill was actually for. */
export interface UserRSVP {
  status: RSVPStatus;
  guest_count: number;
  notes?: string | null;
}

/** One row of the member-visible going list.
 *
 * Three fields, on purpose. The manager roster (`RSVP`) additionally carries
 * email, notes, dietary restrictions, accessibility needs, guest counts and
 * check-in times; none of that is served to ordinary members, and widening
 * this interface is how it would start being. */
export interface EventAttendee {
  user_id: string;
  user_name?: string | null;
  status: RSVPStatus;
}

/** A guest — someone who is not a member — signed in at an event
 * (`GET /events/{id}/external-attendees`, events.manage). Snake_case, as the
 * events endpoints serve it. Guests are not RSVPs and are not counted in
 * member attendance. */
export interface ExternalAttendee {
  id: string;
  event_id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  organization_name?: string | null;
  checked_in: boolean;
  checked_in_at?: string | null;
  source?: string | null;
  notes?: string | null;
  prospect_id?: string | null;
  created_at: string;
}

/** A guest a staff member enters by hand on the event page. */
export interface ExternalAttendeeCreate {
  name: string;
  email?: string | undefined;
  phone?: string | undefined;
  organization_name?: string | undefined;
  notes?: string | undefined;
}

export interface ExternalAttendeeCheckInResult {
  status: string;
  attendee_id: string;
  /** The applicant the guest is linked to — found, or opened at a pipeline event. */
  prospect_id?: string | null;
}

export interface EventListItem {
  id: string;
  title: string;
  description?: string;
  event_type: EventType;
  custom_category?: string;
  start_datetime: string;
  end_datetime: string;
  location_id?: string;
  location?: string;
  location_name?: string;
  requires_rsvp: boolean;
  is_mandatory: boolean;
  /** A session-attendance requirement counts this event; absent from an older backend. */
  counts_toward_attendance?: boolean;
  /** Where the event came from, decided by the server: "Imported" or "The Logbook". */
  source?: string | null;
  source_label?: string | null;
  is_draft?: boolean;
  is_cancelled: boolean;
  /** The start before the first postponement; absent for an event never postponed. */
  postponed_from_start?: string | null;
  is_recurring?: boolean;
  recurrence_parent_id?: string;
  /** The attendance lock; absent from an older backend. */
  attendance_finalized_at?: string | null;
  rsvp_count?: number;
  going_count?: number;
  /** How many members are waiting. The caller's own position is not on the
   * list payload — it needs a window function per row, and the card already
   * knows the member is waitlisted from user_rsvp_status. */
  waitlist_count?: number | null;
  /** Seats taken (1 + guest_count per going RSVP), which is what
   * `max_attendees` caps. Capacity UI uses this; `going_count` is the people
   * count. */
  occupied_seats?: number | null;
  /** Which responses this event accepts. The list surfaces RSVP controls, and
   * hardcoding Going/Not Going rendered a button the API always rejected on an
   * event configured for, say, 'maybe' only. */
  allowed_rsvp_statuses?: RSVPStatus[] | null;
  user_rsvp_status?: RSVPStatus;

  /**
   * Fields the list needs to rank an event by urgency without a per-card
   * request. `check_in_*` are derived server-side from the event's check-in
   * window settings; `credited_hours` is what the *scheduled* duration would
   * credit under the org's active event-hour mappings — the real credit is
   * the attended duration, settled at check-out.
   */
  rsvp_deadline?: string | null;
  max_attendees?: number | null;
  check_in_opens_at?: string | null;
  check_in_closes_at?: string | null;
  user_attended?: boolean;
  credited_hours?: number | null;
  hour_category_label?: string | null;
}

/**
 * The training details a Training event is created with: its training
 * session, which files attendance credit under a course and category, feeds a
 * program requirement and decides which session-attendance requirements the
 * event counts toward. Mirrors `TrainingSessionAttach`
 * (backend/app/schemas/training_session.py), which refuses unknown keys.
 *
 * A create payload, so a blank is omitted rather than sent (CLAUDE.md pitfall
 * #1). With no course and no one-off name the session is filed under the
 * event's title; with no type it is Continuing Education; with no hours it
 * credits the scheduled length. `course_id` and `course_name`/`course_code`
 * are exclusive. Every id is validated server-side against the org.
 */
export interface EventTrainingDetails {
  course_id?: string | undefined;
  /** A one-off course name, not added to the Course Library. */
  course_name?: string | undefined;
  course_code?: string | undefined;
  category_id?: string | undefined;
  program_id?: string | undefined;
  phase_id?: string | undefined;
  requirement_id?: string | undefined;
  training_type?: string | undefined;
  credit_hours?: number | undefined;
  instructor?: string | undefined;
  instructor_id?: string | undefined;
  issues_certification?: boolean | undefined;
  certification_number_prefix?: string | undefined;
  issuing_agency?: string | undefined;
  expiration_months?: number | undefined;
  counts_toward_certification?: boolean | undefined;
  auto_create_records?: boolean | undefined;
  require_completion_confirmation?: boolean | undefined;
  approval_deadline_days?: number | undefined;
  attendance_requirement_ids?: string[] | undefined;
}

/**
 * The training details an event edit changes, as `TrainingSessionDetailsUpdate`
 * on `EventUpdate.training_details`. Three-state like every update payload: a
 * key left out is untouched, `null` clears it, a value sets it. A null
 * `credit_hours`, `instructor` or `expiration_months` falls back to the
 * library course's value (the scheduled length, for hours with no course).
 * `training_type` and the completion settings cannot be null.
 * `attendance_requirement_ids` replaces the whole set. On a finalized event
 * only `attendance_requirement_ids` may differ from what is stored (409
 * otherwise), and a caller let in only as training manager is refused (403).
 */
export interface EventTrainingDetailsUpdate {
  course_id?: string | null | undefined;
  course_name?: string | null | undefined;
  course_code?: string | null | undefined;
  category_id?: string | null | undefined;
  program_id?: string | null | undefined;
  phase_id?: string | null | undefined;
  requirement_id?: string | null | undefined;
  training_type?: string | undefined;
  credit_hours?: number | null | undefined;
  instructor?: string | null | undefined;
  instructor_id?: string | null | undefined;
  issues_certification?: boolean | undefined;
  certification_number_prefix?: string | null | undefined;
  issuing_agency?: string | null | undefined;
  expiration_months?: number | null | undefined;
  counts_toward_certification?: boolean | undefined;
  auto_create_records?: boolean | undefined;
  require_completion_confirmation?: boolean | undefined;
  approval_deadline_days?: number | undefined;
  attendance_requirement_ids?: string[] | undefined;
}

/**
 * What finalizing a Training event credited. Present (defaulted) on every
 * finalize and End Event response; `training_credit` is false for any other
 * kind of event.
 */
export interface TrainingCreditReport {
  training_credit?: boolean | undefined;
  training_records_completed?: number | undefined;
  training_approval_pending?: boolean | undefined;
  training_attendees_pending?: number | undefined;
  training_attendees_uncredited?: number | undefined;
  training_uncredited_names?: string[] | undefined;
  admin_hours_entries_removed?: number | undefined;
}

export interface FinalizeAttendanceResult extends TrainingCreditReport {
  updated_count: number;
}

export interface EndEventResult extends TrainingCreditReport {
  checked_out_count: number;
  actual_end_time: string;
}

export interface EventCreate {
  title: string;
  // The `| null` fields below (all Optional on the backend) are shared with
  // the event form's edit payload, where null clears a stored value: an update
  // reads an omitted key as "leave alone" (CLAUDE.md pitfall #1). A create
  // omits blanks instead.
  description?: string | null | undefined;
  /** Omitted, the organizer is the member creating the event. */
  organizer_id?: string | undefined;
  alternate_organizer_id?: string | undefined;
  event_type: EventType;
  custom_category?: string | null | undefined;
  location_id?: string | null | undefined;
  location?: string | null | undefined;
  location_details?: string | null | undefined;
  start_datetime: string;
  end_datetime: string;
  requires_rsvp?: boolean | undefined;
  rsvp_deadline?: string | null | undefined;
  max_attendees?: number | null | undefined;
  allowed_rsvp_statuses?: RSVPStatus[] | undefined;
  is_mandatory?: boolean | undefined;
  mandatory_membership_types?: string[] | undefined;

  allow_guests?: boolean | undefined;
  /** null means "go back to inheriting the org default" and is a real value the
   * organizer can pick. On an update it MUST be sent, not omitted: the backend
   * dumps with exclude_unset, so an omitted key leaves the old override in
   * place behind a success toast (CLAUDE.md pitfall #1). */
  attendee_visibility?: 'members' | 'managers' | null | undefined;
  send_reminders?: boolean | undefined;
  reminder_target?: 'going' | 'all' | 'none' | undefined;
  reminder_schedule?: number[] | undefined;
  check_in_window_type?: 'flexible' | 'strict' | 'window' | undefined;
  check_in_minutes_before?: number | undefined;
  check_in_minutes_after?: number | undefined;
  require_checkout?: boolean | undefined;
  allow_guest_check_in?: boolean | undefined;
  guest_check_in_creates_prospect?: boolean | undefined;
  custom_fields?: Record<string, string | number | boolean | null> | undefined;
  attachments?: EventAttachment[] | undefined;
  is_draft?: boolean | undefined;
  /** Only for event_type "training"; attaches the event's training session. */
  training_details?: EventTrainingDetails | undefined;
}

export interface EventUpdate {
  title?: string | undefined;
  description?: string | null | undefined;
  event_type?: EventType | undefined;
  custom_category?: string | null | undefined;
  location_id?: string | null | undefined;
  location?: string | null | undefined;
  location_details?: string | null | undefined;
  start_datetime?: string | undefined;
  end_datetime?: string | undefined;
  requires_rsvp?: boolean | undefined;
  rsvp_deadline?: string | null | undefined;
  max_attendees?: number | null | undefined;
  allowed_rsvp_statuses?: RSVPStatus[] | undefined;
  is_mandatory?: boolean | undefined;
  mandatory_membership_types?: string[] | undefined;

  allow_guests?: boolean | undefined;
  /** null means "go back to inheriting the org default" and is a real value the
   * organizer can pick. On an update it MUST be sent, not omitted: the backend
   * dumps with exclude_unset, so an omitted key leaves the old override in
   * place behind a success toast (CLAUDE.md pitfall #1). */
  attendee_visibility?: 'members' | 'managers' | null | undefined;
  send_reminders?: boolean | undefined;
  reminder_target?: 'going' | 'all' | 'none' | undefined;
  reminder_schedule?: number[] | undefined;
  check_in_window_type?: 'flexible' | 'strict' | 'window' | undefined;
  check_in_minutes_before?: number | undefined;
  check_in_minutes_after?: number | undefined;
  require_checkout?: boolean | undefined;
  allow_guest_check_in?: boolean | undefined;
  guest_check_in_creates_prospect?: boolean | undefined;
  custom_fields?: Record<string, string | number | boolean | null> | undefined;
  attachments?: EventAttachment[] | undefined;
  /** Only on a Training event; see EventTrainingDetailsUpdate. On a series edit it reaches every occurrence the scope covers. */
  training_details?: EventTrainingDetailsUpdate | undefined;
}

export interface EventCancel {
  cancellation_reason: string;
  send_notifications?: boolean;
}

export interface EventPostpone {
  new_start_datetime: string;
  new_end_datetime: string;
  reason: string;
  send_notifications?: boolean;
}

export interface ManagerAddAttendee {
  user_id: string;
  status?: RSVPStatus;
  checked_in?: boolean;
  notes?: string;
}

export interface RSVPOverride {
  /** null clears the override; an omitted key leaves it as stored. */
  override_check_in_at?: string | null;
  override_check_out_at?: string | null;
  override_duration_minutes?: number;
}

export interface RSVP {
  id: string;
  event_id: string;
  user_id: string;
  /** Where the check-in came from, on the roster listing: "Imported" or "The Logbook". */
  source?: string | null;
  source_label?: string | null;
  status: RSVPStatus;
  guest_count: number;
  notes?: string;
  dietary_restrictions?: string;
  accessibility_needs?: string;
  responded_at: string;
  updated_at: string;
  checked_in: boolean;
  checked_in_at?: string | undefined;
  checked_out_at?: string | undefined;
  attendance_duration_minutes?: number | undefined;
  /**
   * Minutes this member's self check-in preceded the scheduled start, or
   * absent when it did not. Their credited time starts at the scheduled start
   * either way; this is what an organizer looks at to decide whether it should.
   */
  early_check_in_minutes?: number | null | undefined;
  /**
   * When the backend credits this member's attendance from — the override if
   * set, otherwise the tap clamped to the scheduled start. Reported by the
   * roster listing only; the Edit Times dialog pre-fills it rather than
   * re-deriving the clamp.
   */
  credited_check_in_at?: string | null | undefined;
  override_check_in_at?: string | undefined;
  override_check_out_at?: string | undefined;
  override_duration_minutes?: number | undefined;
  user_name?: string | undefined;
  /** Null when the member's contact settings hide it from this viewer (an
   * organizer reading the roster without events.manage). */
  user_email?: string | null | undefined;
  // Non-blocking message returned on an early self-check-in: tells the member
  // when the official check-in window the event creator configured opens.
  notice?: string | null | undefined;
}

export interface RSVPCreate {
  status: RSVPStatus;
  guest_count?: number | undefined;
  // An explicit null clears each field; omitting the key on an update leaves
  // the stored value alone (backend applies exclude_unset). For
  // dietary_restrictions/accessibility_needs specifically, the modal only
  // ever sends the key once the member has actually touched that field this
  // time it was open — see useRSVPForm's *Touched flags — since the field
  // always starts blank regardless of what is stored (PHI, cacheable
  // response) and a blank box alone can't mean "clear it".
  notes?: string | null | undefined;
  dietary_restrictions?: string | null | undefined;
  accessibility_needs?: string | null | undefined;
}

export interface CheckInRequest {
  user_id: string;
}

export interface RecordActualTimes {
  actual_start_time?: string | undefined;
  actual_end_time?: string | undefined;
}

export interface EventStats {
  event_id: string;
  total_rsvps: number;
  going_count: number;
  not_going_count: number;
  maybe_count: number;
  checked_in_count: number;
  total_guests: number;
  capacity_percentage?: number;
}

export interface QRCheckInData {
  event_id: string;
  event_name: string;
  event_type?: string | undefined;
  event_description?: string | undefined;
  start_datetime: string;
  end_datetime: string;
  actual_end_time?: string | undefined;
  check_in_start: string;
  check_in_end: string;
  is_valid: boolean;
  can_check_in: boolean;
  location?: string | undefined;
  location_id?: string | undefined;
  location_name?: string | undefined;
  require_checkout?: boolean | undefined;
  timezone?: string | undefined;
  allow_guest_check_in?: boolean | undefined;
  /**
   * Set by the server: whether attendance here is credited to members'
   * training records (every Training event, when attendance is finalized).
   */
  records_training?: boolean | undefined;
  /** Whether that credit waits for a training officer's approval. */
  training_requires_approval?: boolean | undefined;
  /**
   * The scanning member's own check-in and check-out times, so the page can
   * offer check-out to someone already checked in. Null when they have not
   * checked in; the check-out time stays null until they leave.
   */
  user_checked_in_at?: string | null | undefined;
  user_checked_out_at?: string | null | undefined;
}

/**
 * An event's own guest QR code, returned only to events.manage holders.
 * `guest_token` is a credential for the public guest sign-in page.
 */
export interface GuestCheckInLink {
  event_id: string;
  allow_guest_check_in: boolean;
  guest_token: string | null;
  /** Whether a scan would be accepted now: the check-in window and the attendance lock. */
  is_open: boolean;
  closed_reason: string | null;
  check_in_opens_at: string | null;
  check_in_closes_at: string | null;
}

/** Public event detail shown on the unauthenticated guest sign-in page. */
export interface GuestCheckInEventInfo {
  event_id: string;
  event_name: string;
  event_type?: string | undefined;
  start_datetime: string;
  end_datetime: string;
  location_name?: string | undefined;
  organization_name?: string | undefined;
  is_open: boolean;
  closed_reason?: string | undefined;
  collects_prospect_details: boolean;
  timezone?: string | undefined;
}

/** Confirmation returned after a guest records their attendance. */
export interface GuestCheckInResult {
  status: string;
  attendee_id: string;
  event_name: string;
  checked_in_at: string;
  message: string;
}

/**
 * What the kiosk may say about an email typed into it at a pipeline-linked
 * event. A prospect is named by first name and last initial only.
 */
export interface GuestLookupResult {
  // A member account answers 'not_found': the page is public, and a distinct
  // answer told anyone holding the link which addresses belong to members.
  status: 'prospect' | 'not_found';
  display_name?: string | null | undefined;
  confirm_token?: string | null | undefined;
  message: string;
}

export interface CheckInActivity {
  user_id: string;
  user_name: string;
  user_email: string;
  checked_in_at: string;
  rsvp_status: RSVPStatus;
  guest_count: number;
  /**
   * Minutes this check-in preceded the event's scheduled start, or null when
   * it did not. The member's credited time starts at the scheduled start
   * regardless; this is what an organizer looks at to decide whether it should.
   */
  early_check_in_minutes: number | null;
  /** True once a manager has set an explicit check-in time for this member. */
  check_in_overridden: boolean;
}

export interface CheckInMonitoringStats {
  event_id: string;
  event_name: string;
  event_type: string;
  /** The organizer. This route has no event payload of its own to read it from. */
  created_by_name?: string | null;
  start_datetime: string;
  end_datetime: string;
  is_check_in_active: boolean;
  check_in_window_start: string;
  check_in_window_end: string;
  total_eligible_members: number;
  total_rsvps: number;
  total_checked_in: number;
  check_in_rate: number;
  recent_check_ins: CheckInActivity[];
  /**
   * Members who tapped in materially before the event started and that nobody
   * has ruled on yet. Not a slice of `recent_check_ins` and not capped at ten.
   */
  early_check_ins: CheckInActivity[];
  early_check_in_count: number;
  /** How early counts as early, decided by the server. */
  early_check_in_threshold_minutes: number;
  avg_check_in_time_minutes: number | null;
  last_check_in_at: string | null;
}

export interface RSVPHistory {
  id: string;
  rsvp_id: string;
  event_id: string;
  user_id: string;
  old_status: string | null;
  new_status: string;
  changed_at: string;
  changed_by: string | null;
  /** The system made the change (an automatic waitlist promotion); changed_by is null then. */
  is_automatic: boolean;
  user_name: string | null;
  changer_name: string | null;
}

// Event Templates
export type RecurrencePattern =
  'daily' | 'weekly' | 'biweekly' | 'monthly' | 'monthly_weekday' | 'annually' | 'annually_weekday' | 'custom';

/**
 * The training details a Training template stores (owner decisions
 * 2026-11-20 and 2026-11-23), as the backend's EventTemplateTrainingDetails
 * settles them:
 * always complete, snake_case on the wire. The backend is the authority on
 * this shape; `toTemplateTrainingDetails` builds it for a save.
 */
export interface EventTemplateTrainingDetails {
  course_mode: 'none' | 'library' | 'oneoff';
  course_id: string | null;
  course_name: string | null;
  course_code: string | null;
  training_type: string;
  credit_hours: number | null;
  credit_hours_source: 'duration' | 'course' | 'manual';
  instructor_id: string | null;
  instructor: string | null;
  issues_certification: boolean;
  certification_number_prefix: string | null;
  issuing_agency: string | null;
  expiration_months: number | null;
  // Kept since the owner decision of 2026-11-23. Optional because a template
  // read from an older client's cache, or a test fixture, may lack them; the
  // backend always answers them.
  category_id?: string | null | undefined;
  program_id?: string | null | undefined;
  phase_id?: string | null | undefined;
  requirement_id?: string | null | undefined;
  attendance_requirement_ids?: string[] | undefined;
  counts_toward_certification?: boolean | undefined;
  auto_create_records?: boolean | undefined;
  require_completion_confirmation?: boolean | undefined;
  approval_deadline_days?: number | undefined;
}

export interface EventTemplate {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  event_type: EventType;
  default_title?: string;
  default_description?: string;
  default_location_id?: string;
  default_location?: string;
  default_location_details?: string;
  default_duration_minutes?: number;
  requires_rsvp: boolean;
  max_attendees?: number;
  is_mandatory: boolean;

  allow_guests: boolean;
  /** null inherits the organization's events default. */
  attendee_visibility?: 'members' | 'managers' | null;
  check_in_window_type?: 'flexible' | 'strict' | 'window';
  check_in_minutes_before?: number;
  check_in_minutes_after?: number;
  require_checkout: boolean;
  send_reminders: boolean;
  reminder_target: 'going' | 'all' | 'none';
  reminder_schedule: number[];
  custom_fields_template?: Record<string, unknown>;
  /** Training templates only; null when none were saved. */
  training_details?: EventTemplateTrainingDetails | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface EventTemplateCreate {
  // `null` clears a field on update; a create omits blanks instead.
  name: string;
  description?: string | null | undefined;
  event_type?: EventType | undefined;
  default_title?: string | null | undefined;
  default_description?: string | null | undefined;
  default_location_id?: string | undefined;
  default_location?: string | null | undefined;
  default_location_details?: string | undefined;
  default_duration_minutes?: number | null | undefined;
  requires_rsvp?: boolean | undefined;
  max_attendees?: number | null | undefined;
  is_mandatory?: boolean | undefined;

  allow_guests?: boolean | undefined;
  attendee_visibility?: 'members' | 'managers' | null | undefined;
  check_in_window_type?: 'flexible' | 'strict' | 'window' | null | undefined;
  check_in_minutes_before?: number | null | undefined;
  check_in_minutes_after?: number | null | undefined;
  require_checkout?: boolean | undefined;
  send_reminders?: boolean | undefined;
  reminder_target?: 'going' | 'all' | 'none' | undefined;
  reminder_schedule?: number[] | undefined;
  custom_fields_template?: Record<string, unknown> | undefined;
  /** Training templates only. `null` clears it on an update. */
  training_details?: EventTemplateTrainingDetails | null | undefined;
}

export interface RecurringEventCreate {
  title: string;
  description?: string | null | undefined;
  organizer_id?: string | undefined;
  alternate_organizer_id?: string | undefined;
  event_type?: EventType | undefined;
  location_id?: string | null | undefined;
  location?: string | null | undefined;
  location_details?: string | null | undefined;
  start_datetime: string;
  end_datetime: string;
  recurrence_pattern: RecurrencePattern;
  recurrence_end_date?: string | undefined;
  rolling_recurrence?: boolean | undefined;
  recurrence_custom_days?: number[] | undefined;
  recurrence_weekday?: number | undefined;
  recurrence_week_ordinal?: number | undefined;
  recurrence_month?: number | undefined;
  recurrence_exceptions?: string[] | undefined;
  requires_rsvp?: boolean | undefined;
  rsvp_deadline?: string | null | undefined;
  max_attendees?: number | null | undefined;
  is_mandatory?: boolean | undefined;
  mandatory_membership_types?: string[] | undefined;

  allow_guests?: boolean | undefined;
  /** null means "go back to inheriting the org default" and is a real value the
   * organizer can pick. On an update it MUST be sent, not omitted: the backend
   * dumps with exclude_unset, so an omitted key leaves the old override in
   * place behind a success toast (CLAUDE.md pitfall #1). */
  attendee_visibility?: 'members' | 'managers' | null | undefined;
  send_reminders?: boolean | undefined;
  reminder_target?: 'going' | 'all' | 'none' | undefined;
  reminder_schedule?: number[] | undefined;
  check_in_window_type?: 'flexible' | 'strict' | 'window' | undefined;
  check_in_minutes_before?: number | undefined;
  check_in_minutes_after?: number | undefined;
  require_checkout?: boolean | undefined;
  allow_guest_check_in?: boolean | undefined;
  guest_check_in_creates_prospect?: boolean | undefined;
  custom_category?: string | null | undefined;
  custom_fields?: Record<string, string | number | boolean | null> | undefined;
  attachments?: EventAttachment[] | undefined;
  allowed_rsvp_statuses?: RSVPStatus[] | undefined;
  template_id?: string | undefined;
  /** Attached to every occurrence. A rolling series copies them on to the
   *  occurrences it adds later. */
  training_details?: EventTrainingDetails | undefined;
}

// Event Attachments & Document Folder

export interface EventAttachment {
  id: string;
  file_name: string;
  file_path: string;
  file_size: number;
  file_type: string;
  description?: string;
  uploaded_by: string;
  uploaded_at: string;
}

export interface EventAttachmentUploadResponse {
  message: string;
  attachment: EventAttachment;
  total_attachments: number;
}

export interface EventDocumentFolder {
  id: string;
  organization_id: string;
  name: string;
  parent_id?: string;
  description: string;
  created_at: string;
  updated_at: string;
  created_by: string;
  status: string;
  document_count: number;
}

// Custom event category (organization-defined)
export interface EventCategoryConfig {
  value: string;
  label: string;
  color: string;
}

// Event Module Settings (organization-level)
export interface EventModuleSettings {
  // Which event types are enabled for this organization
  enabled_event_types: EventType[];
  // Which event types are shown as primary filter tabs (rest grouped under "Other")
  visible_event_types: EventType[];
  // Custom labels for event types (overrides defaults)
  event_type_labels: Partial<Record<EventType, string>>;
  // Organization-defined custom event categories
  custom_event_categories: EventCategoryConfig[];
  // Which custom categories appear as primary filter tabs
  visible_custom_categories: string[];
  // Defaults applied when creating a new event
  defaults: {
    event_type: EventType;
    check_in_window_type: 'flexible' | 'strict' | 'window';
    check_in_minutes_before: number;
    check_in_minutes_after: number;
    require_checkout: boolean;
    requires_rsvp: boolean;
    allowed_rsvp_statuses: RSVPStatus[];
    allow_guests: boolean;
    /** Fallback for events that set no override of their own. Unlike the
     * per-event field this has no inherit state — it is the bottom of the
     * chain. Ships as 'managers', which is how rosters behaved before they
     * were shareable at all. */
    attendee_visibility: 'members' | 'managers';
    is_mandatory: boolean;
    send_reminders: boolean;
    reminder_target: 'going' | 'all' | 'none';
    reminder_schedule: number[];
    default_reminder_time: string;
    default_duration_minutes: number;
  };
  // QR code page settings
  qr_code: {
    show_event_description: boolean;
    show_location_details: boolean;
    custom_instructions: string;
  };
  // Cancellation policy
  cancellation: {
    require_reason: boolean;
    notify_attendees: boolean;
  };
  // Configurable outreach event types for the public request pipeline
  outreach_event_types: OutreachEventTypeConfig[];
  /**
   * Roles a member fills at a community outreach event. Separate from the crew
   * positions on a duty shift on purpose — nobody is riding a seat on an engine
   * at a school visit.
   */
  outreach_roles: OutreachRole[];
  // Configurable pipeline settings for event requests
  request_pipeline: RequestPipelineSettings;
  /**
   * Event type -> position id whose members take an attendance request the
   * event's organizer and alternate cannot. An absent or null type goes to the
   * Secretary, then to every events manager.
   */
  attendance_request_fallback_positions: Partial<Record<EventType, string | null>>;
  /** Days before an unanswered mandatory event starts that members are asked to respond. */
  mandatory_rsvp_window_days: number;
}

/** A transfer of an event to a new organizer and alternate. */
export type EventTransferScope = 'this' | 'future';

export interface EventTransferRequest {
  organizer_id: string;
  /** null clears the alternate. */
  alternate_organizer_id: string | null;
  scope: EventTransferScope;
}

export interface EventTransferResponse {
  updated_count: number;
  organizer_id: string;
  alternate_organizer_id: string | null;
}

/** A position, for choosing who takes attendance requests nobody else can. */
export interface EventPositionOption {
  id: string;
  name: string;
  slug: string;
}

// Event Request Pipeline

export interface OutreachEventTypeConfig {
  value: string;
  label: string;
  /** The roles an event of this type usually needs; prefills its signup sheet. */
  default_roles?: StaffingRoleNeed[] | undefined;
}

export interface PipelineTaskConfig {
  id: string;
  label: string;
  description: string;
}

export interface EmailTriggerConfig {
  enabled: boolean;
  notify_assignee?: boolean;
  notify_requester?: boolean;
  days?: number[];
}

export interface RequestPipelineSettings {
  min_lead_time_days: number;
  default_assignee_id: string | null;
  public_progress_visible: boolean;
  /** Whether the department accepts event requests from the public at all (EV-5). Off until an admin turns it on. */
  accept_public_requests: boolean;
  /** Per-day ceiling on accepted public requests; counts valid submissions only. */
  public_daily_limit: number;
  /** The form a requester is offered once their request is Completed; null asks nothing. */
  feedback_form_id?: string | null;
  /** The question on that form whose answer the report averages as the rating. */
  feedback_rating_field_id?: string | null;
  tasks: PipelineTaskConfig[];
  email_triggers: Record<string, EmailTriggerConfig>;
}

/** A published form that can be the outreach feedback form, and its rating-capable questions. */
export interface FeedbackFormOption {
  id: string;
  name: string;
  rating_fields: { id: string; label: string }[];
}

export type EventRequestStatus =
  'submitted' | 'in_progress' | 'scheduled' | 'postponed' | 'completed' | 'declined' | 'cancelled';

export type DateFlexibility = 'specific_dates' | 'general_timeframe' | 'flexible';
export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'flexible';

export interface TaskCompletion {
  completed: boolean;
  /** Absent on a step the request's state ticks (`automatic`). */
  completed_by?: string;
  completed_at?: string;
  notes?: string;
  /** Ticked by the request's state, not by a coordinator. */
  automatic?: boolean;
}

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body_html: string;
  body_text?: string;
  trigger?: string;
  trigger_days_before?: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface TaskProgressPublic {
  total: number;
  completed: number;
  tasks: { label: string; completed: boolean }[];
}

export interface EventRequestActivity {
  id: string;
  action: string;
  old_status?: string;
  new_status?: string;
  notes?: string;
  details?: Record<string, unknown>;
  performed_by?: string;
  performer_name?: string;
  created_at: string;
}

export interface EventRequest {
  id: string;
  organization_id: string;
  contact_name: string;
  /** Null for a request a coordinator entered for a caller who gave only a phone number. */
  contact_email?: string | null;
  contact_phone?: string;
  organization_name?: string;
  outreach_type: string;
  description: string;
  date_flexibility: DateFlexibility;
  /** Calendar dates, "YYYY-MM-DD": the days the requester named. */
  preferred_date_start?: string;
  preferred_date_end?: string;
  preferred_timeframe?: string;
  preferred_time_of_day?: TimeOfDay;
  audience_size?: number;
  age_group?: string;
  venue_preference: string;
  venue_address?: string;
  special_requests?: string;
  status: EventRequestStatus;
  assigned_to?: string;
  assignee_name?: string;
  reviewer_notes?: string;
  decline_reason?: string;
  task_completions?: Record<string, TaskCompletion>;
  /** Task id to how it ticks itself; a coordinator cannot toggle these. */
  automatic_tasks?: Record<string, string>;
  event_id?: string;
  event_date?: string;
  event_end_date?: string;
  event_location_id?: string;
  event_location_name?: string;
  /** Shift members sign up on to cover this event; null until signups are opened. */
  staffing_shift_id?: string;
  staffing_roles?: StaffingRoleNeed[];
  volunteer_call_sent_at?: string;
  status_token?: string;
  /** How it arrived: `web` for the public form, otherwise as the coordinator entered it. */
  source?: EventRequestSource;
  created_at: string;
  updated_at: string;
  activity_log: EventRequestActivity[];
}

/**
 * A request a coordinator enters for somebody who phoned, wrote or came by
 * (EventRequestStaffCreate). Optional keys are omitted, not sent blank; the
 * dates are plain YYYY-MM-DD calendar dates.
 */
export interface EventRequestStaffCreate {
  source: EventRequestSource;
  contact_name: string;
  contact_email?: string | undefined;
  contact_phone?: string | undefined;
  organization_name?: string | undefined;
  outreach_type: string;
  description: string;
  date_flexibility: DateFlexibility;
  preferred_date_start?: string | undefined;
  preferred_date_end?: string | undefined;
  preferred_timeframe?: string | undefined;
  preferred_time_of_day: TimeOfDay;
  audience_size?: number | undefined;
  age_group?: string | undefined;
  venue_preference: VenuePreference;
  venue_address?: string | undefined;
  special_requests?: string | undefined;
  assigned_to?: string | undefined;
  notify_requester: boolean;
}

export type VenuePreference = 'their_location' | 'our_station' | 'either';

/**
 * One outreach event on the Outreach Overview's calendar
 * (GET /events/outreach-calendar). A fill pair is null when the event has no
 * live signup sheet, or no apparatus crew, so "none" never reads as "empty".
 */
export interface OutreachCalendarItem {
  event_id: string;
  title: string;
  event_type: string;
  start_datetime: string;
  end_datetime: string;
  location: string | null;
  is_draft: boolean;
  request_id: string | null;
  request_organization: string | null;
  volunteers_filled: number | null;
  volunteers_total: number | null;
  crew_filled: number | null;
  crew_total: number | null;
  unit_numbers: string[];
  attendance_finalized: boolean;
}

export interface EventRequestListItem {
  id: string;
  contact_name: string;
  contact_email?: string | null;
  organization_name?: string;
  outreach_type: string;
  status: EventRequestStatus;
  date_flexibility: DateFlexibility;
  preferred_date_start?: string;
  preferred_timeframe?: string;
  audience_size?: number;
  assigned_to?: string;
  assignee_name?: string;
  task_completions?: Record<string, TaskCompletion>;
  event_date?: string;
  staffing_shift_id?: string;
  /** Intake flagged it as arriving inside the department's lead time. */
  short_notice?: boolean;
  source?: EventRequestSource;
  /** Seats on the live signup sheet; both null when the request has none. */
  staffing_slots_filled?: number | null;
  staffing_slots_total?: number | null;
  created_at: string;
}

/**
 * A role a member fills at a community outreach event — tour guide, educator,
 * facilitator. Deliberately a separate vocabulary from the crew positions on a
 * duty shift: nobody is riding a seat on an engine at a school visit.
 * Configurable per department in Events settings.
 */
export interface OutreachRole {
  value: string;
  label: string;
}

/** How many people the department needs in one outreach role. */
export interface StaffingRoleNeed {
  role: string;
  count: number;
}

/** One role on a signup sheet, and how full it is. */
export interface StaffingRoleStatus {
  role: string;
  label: string;
  total: number;
  filled: number;
  remaining: number;
}

/** One member who has signed up to cover an outreach event. */
export interface EventRequestVolunteer {
  user_id: string;
  member_name: string;
  position: string;
  outreach_role?: string;
  outreach_role_label?: string;
  status: string;
  assigned_at?: string;
}

/** Volunteer staffing state for a scheduled request. */
export interface EventRequestStaffing {
  shift_id?: string;
  shift_date?: string;
  slots_total: number;
  slots_filled: number;
  roles: StaffingRoleStatus[];
  volunteers: EventRequestVolunteer[];
  volunteer_call_sent_at?: string;
}

/** Something handed out at an outreach event, and how many. */
export interface OutreachMaterial {
  item: string;
  quantity: number;
}

/** Whether photos were taken at an outreach event, and with the host's consent. */
export type OutreachPhotos = 'none' | 'consented' | 'not_consented';

/** The close-out record an outreach event's page saves; every field, every time. */
export interface OutreachCloseoutUpdate {
  outcome_note: string | null;
  apparatus_ids: string[];
  materials: OutreachMaterial[];
  photos: OutreachPhotos | null;
}

/** The signup sheet staffing an event; `request_id` when it is the request's. */
/** An outreach event's signup sheet as a member sees it: roles and their own seat, no other names. */
export interface EventVolunteerSignup {
  shift_id: string;
  roles: StaffingRoleStatus[];
  signed_up: boolean;
  my_role_label?: string | null;
}

export interface EventStaffing extends EventRequestStaffing {
  request_id?: string | null;
}

export interface EventRequestVolunteerCallResult {
  message: string;
  recipients: number;
  skipped_opted_out: number;
  volunteer_call_sent_at: string;
}

export interface EventRequestPublicStatus {
  contact_name: string;
  outreach_type: string;
  status: EventRequestStatus;
  date_flexibility: DateFlexibility;
  /** Calendar dates, "YYYY-MM-DD". */
  preferred_date_start?: string;
  preferred_date_end?: string;
  preferred_timeframe?: string;
  created_at: string;
  updated_at: string;
  event_date?: string;
  decline_reason?: string;
  task_progress?: TaskProgressPublic;
  can_cancel: boolean;
  /** A Completed request whose department asks for feedback, not yet given. */
  feedback_offered?: boolean;
  /** The requester has already sent their one response. */
  feedback_sent?: boolean;
  /** The department's IANA timezone, which the page shows times in. */
  timezone?: string | null;
}

/** The department's feedback form, as the requester's status page shows it. */
export interface PublicFeedbackForm {
  form_name: string;
  form_description?: string | null;
  organization_name?: string | null;
  contact_name: string;
  fields: import('../components/forms/publicFormFields').PublicFormField[];
}

/** A request's feedback, as officers read it on the request. */
export interface EventRequestFeedback {
  rating: number | null;
  submitted_at: string;
  form_name: string | null;
  answers: { question: string; answer: string }[];
  /** Answers to Sensitive questions, kept with the submission in Forms. */
  sensitive_answers: number;
}
