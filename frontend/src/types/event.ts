/**
 * Event Type Definitions
 */

export type EventType =
  | 'business_meeting'
  | 'public_education'
  | 'training'
  | 'social'
  | 'fundraiser'
  | 'ceremony'
  | 'other';

export type RSVPStatus = 'going' | 'not_going' | 'maybe';

export interface Event {
  id: string;
  organization_id: string;
  title: string;
  description?: string;
  event_type: EventType;
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

  allow_guests: boolean;
  send_reminders: boolean;
  reminder_schedule: number[];
  check_in_window_type?: 'flexible' | 'strict' | 'window';
  check_in_minutes_before?: number;
  check_in_minutes_after?: number;
  require_checkout?: boolean;
  custom_fields?: Record<string, string | number | boolean | null>;
  attachments?: EventAttachment[];
  is_recurring?: boolean;
  recurrence_pattern?: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'custom';
  recurrence_end_date?: string;
  recurrence_parent_id?: string;
  template_id?: string;
  is_cancelled: boolean;
  cancellation_reason?: string;
  cancelled_at?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
  rsvp_count?: number;
  going_count?: number;
  not_going_count?: number;
  maybe_count?: number;
  user_rsvp_status?: RSVPStatus;
}

export interface EventListItem {
  id: string;
  title: string;
  event_type: EventType;
  start_datetime: string;
  end_datetime: string;
  location_id?: string;
  location?: string;
  location_name?: string;
  requires_rsvp: boolean;
  is_mandatory: boolean;
  is_cancelled: boolean;
  rsvp_count?: number;
  going_count?: number;
}

export interface EventCreate {
  title: string;
  description?: string;
  event_type: EventType;
  location_id?: string;
  location?: string;
  location_details?: string;
  start_datetime: string;
  end_datetime: string;
  requires_rsvp?: boolean;
  rsvp_deadline?: string;
  max_attendees?: number;
  allowed_rsvp_statuses?: RSVPStatus[];
  is_mandatory?: boolean;

  allow_guests?: boolean;
  send_reminders?: boolean;
  reminder_schedule?: number[];
  check_in_window_type?: 'flexible' | 'strict' | 'window';
  check_in_minutes_before?: number;
  check_in_minutes_after?: number;
  require_checkout?: boolean;
  custom_fields?: Record<string, string | number | boolean | null>;
  attachments?: EventAttachment[];
}

export interface EventUpdate {
  title?: string;
  description?: string;
  event_type?: EventType;
  location_id?: string;
  location?: string;
  location_details?: string;
  start_datetime?: string;
  end_datetime?: string;
  requires_rsvp?: boolean;
  rsvp_deadline?: string;
  max_attendees?: number;
  allowed_rsvp_statuses?: RSVPStatus[];
  is_mandatory?: boolean;

  allow_guests?: boolean;
  send_reminders?: boolean;
  reminder_schedule?: number[];
  check_in_window_type?: 'flexible' | 'strict' | 'window';
  check_in_minutes_before?: number;
  check_in_minutes_after?: number;
  require_checkout?: boolean;
  custom_fields?: Record<string, string | number | boolean | null>;
  attachments?: EventAttachment[];
}

export interface EventCancel {
  cancellation_reason: string;
  send_notifications?: boolean;
}

export interface ManagerAddAttendee {
  user_id: string;
  status?: RSVPStatus;
  checked_in?: boolean;
  notes?: string;
}

export interface RSVPOverride {
  override_check_in_at?: string;
  override_check_out_at?: string;
  override_duration_minutes?: number;
}

export interface RSVP {
  id: string;
  event_id: string;
  user_id: string;
  status: RSVPStatus;
  guest_count: number;
  notes?: string;
  responded_at: string;
  updated_at: string;
  checked_in: boolean;
  checked_in_at?: string;
  checked_out_at?: string;
  attendance_duration_minutes?: number;
  override_check_in_at?: string;
  override_check_out_at?: string;
  override_duration_minutes?: number;
  user_name?: string;
  user_email?: string;
}

export interface RSVPCreate {
  status: RSVPStatus;
  guest_count?: number;
  notes?: string;
}

export interface CheckInRequest {
  user_id: string;
}

export interface RecordActualTimes {
  actual_start_time?: string;
  actual_end_time?: string;
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
  event_type?: string;
  event_description?: string;
  start_datetime: string;
  end_datetime: string;
  actual_end_time?: string;
  check_in_start: string;
  check_in_end: string;
  is_valid: boolean;
  location?: string;
  location_id?: string;
  location_name?: string;
  require_checkout?: boolean;
}

export interface CheckInActivity {
  user_id: string;
  user_name: string;
  user_email: string;
  checked_in_at: string;
  rsvp_status: string;
  guest_count: number;
}

export interface CheckInMonitoringStats {
  event_id: string;
  event_name: string;
  event_type: string;
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
  avg_check_in_time_minutes: number | null;
  last_check_in_at: string | null;
}

// Event Templates
export type RecurrencePattern = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'custom';

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
  check_in_window_type?: 'flexible' | 'strict' | 'window';
  check_in_minutes_before?: number;
  check_in_minutes_after?: number;
  require_checkout: boolean;
  send_reminders: boolean;
  reminder_schedule: number[];
  custom_fields_template?: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface EventTemplateCreate {
  name: string;
  description?: string;
  event_type?: EventType;
  default_title?: string;
  default_description?: string;
  default_location_id?: string;
  default_location?: string;
  default_location_details?: string;
  default_duration_minutes?: number;
  requires_rsvp?: boolean;
  max_attendees?: number;
  is_mandatory?: boolean;

  allow_guests?: boolean;
  check_in_window_type?: 'flexible' | 'strict' | 'window';
  check_in_minutes_before?: number;
  check_in_minutes_after?: number;
  require_checkout?: boolean;
  send_reminders?: boolean;
  reminder_schedule?: number[];
  custom_fields_template?: Record<string, unknown>;
}

export interface RecurringEventCreate {
  title: string;
  description?: string;
  event_type?: EventType;
  location_id?: string;
  location?: string;
  location_details?: string;
  start_datetime: string;
  end_datetime: string;
  recurrence_pattern: RecurrencePattern;
  recurrence_end_date: string;
  recurrence_custom_days?: number[];
  requires_rsvp?: boolean;
  rsvp_deadline?: string;
  max_attendees?: number;
  is_mandatory?: boolean;

  allow_guests?: boolean;
  send_reminders?: boolean;
  reminder_schedule?: number[];
  check_in_window_type?: 'flexible' | 'strict' | 'window';
  check_in_minutes_before?: number;
  check_in_minutes_after?: number;
  require_checkout?: boolean;
  template_id?: string;
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
  parent_folder_id?: string;
  description: string;
  created_at: string;
  updated_at: string;
  created_by: string;
  status: string;
  document_count: number;
}

// Event Module Settings (organization-level)
export interface EventModuleSettings {
  // Which event types are enabled for this organization
  enabled_event_types: EventType[];
  // Which event types are shown as primary filter tabs (rest grouped under "Other")
  visible_event_types: EventType[];
  // Custom labels for event types (overrides defaults)
  event_type_labels: Partial<Record<EventType, string>>;
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
    is_mandatory: boolean;
    send_reminders: boolean;
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
  // Configurable pipeline settings for event requests
  request_pipeline: RequestPipelineSettings;
}

// Event Request Pipeline

export interface OutreachEventTypeConfig {
  value: string;
  label: string;
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
  tasks: PipelineTaskConfig[];
  email_triggers: Record<string, EmailTriggerConfig>;
}

export type EventRequestStatus =
  | 'submitted'
  | 'in_progress'
  | 'scheduled'
  | 'postponed'
  | 'completed'
  | 'declined'
  | 'cancelled';

export type DateFlexibility = 'specific_dates' | 'general_timeframe' | 'flexible';
export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'flexible';

export interface TaskCompletion {
  completed: boolean;
  completed_by: string;
  completed_at: string;
  notes?: string;
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
  contact_email: string;
  contact_phone?: string;
  organization_name?: string;
  outreach_type: string;
  description: string;
  date_flexibility: DateFlexibility;
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
  event_id?: string;
  event_date?: string;
  event_end_date?: string;
  event_location_id?: string;
  event_location_name?: string;
  status_token?: string;
  created_at: string;
  updated_at: string;
  activity_log: EventRequestActivity[];
}

export interface EventRequestListItem {
  id: string;
  contact_name: string;
  contact_email: string;
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
  created_at: string;
}

export interface EventRequestPublicStatus {
  contact_name: string;
  outreach_type: string;
  status: EventRequestStatus;
  date_flexibility: DateFlexibility;
  preferred_date_start?: string;
  preferred_date_end?: string;
  preferred_timeframe?: string;
  created_at: string;
  updated_at: string;
  event_date?: string;
  decline_reason?: string;
  task_progress?: TaskProgressPublic;
  can_cancel: boolean;
}
