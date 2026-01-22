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
  location?: string;
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
  eligible_roles?: string[];
  allow_guests: boolean;
  send_reminders: boolean;
  reminder_hours_before: number;
  check_in_window_type?: 'flexible' | 'strict' | 'window';
  check_in_minutes_before?: number;
  check_in_minutes_after?: number;
  require_checkout?: boolean;
  custom_fields?: { [key: string]: any };
  attachments?: Array<{ [key: string]: string }>;
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
  location?: string;
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
  location?: string;
  location_details?: string;
  start_datetime: string;
  end_datetime: string;
  requires_rsvp?: boolean;
  rsvp_deadline?: string;
  max_attendees?: number;
  allowed_rsvp_statuses?: RSVPStatus[];
  is_mandatory?: boolean;
  eligible_roles?: string[];
  allow_guests?: boolean;
  send_reminders?: boolean;
  reminder_hours_before?: number;
  check_in_window_type?: 'flexible' | 'strict' | 'window';
  check_in_minutes_before?: number;
  check_in_minutes_after?: number;
  require_checkout?: boolean;
  custom_fields?: { [key: string]: any };
  attachments?: Array<{ [key: string]: string }>;
}

export interface EventUpdate {
  title?: string;
  description?: string;
  event_type?: EventType;
  location?: string;
  location_details?: string;
  start_datetime?: string;
  end_datetime?: string;
  requires_rsvp?: boolean;
  rsvp_deadline?: string;
  max_attendees?: number;
  allowed_rsvp_statuses?: RSVPStatus[];
  is_mandatory?: boolean;
  eligible_roles?: string[];
  allow_guests?: boolean;
  send_reminders?: boolean;
  reminder_hours_before?: number;
  custom_fields?: { [key: string]: any };
  attachments?: Array<{ [key: string]: string }>;
}

export interface EventCancel {
  cancellation_reason: string;
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
  start_datetime: string;
  end_datetime: string;
  actual_end_time?: string;
  check_in_start: string;
  check_in_end: string;
  is_valid: boolean;
  location?: string;
}
