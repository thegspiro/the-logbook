/**
 * Constants shared by the event form's model and its sections. Kept out of the
 * component files so each of those exports only components, which is what
 * React Fast Refresh needs to hot-swap them.
 */

import type { EventCreate, RecurrencePattern, EventType } from '../../types/event';
import { EventType as EventTypeEnum, RSVPStatus as RSVPStatusEnum } from '../../constants/enums';
import type { ServerFieldSpec } from '../../utils/serverFieldErrors';

export const EVENT_TYPES: EventType[] = [
  EventTypeEnum.BUSINESS_MEETING,
  EventTypeEnum.PUBLIC_EDUCATION,
  EventTypeEnum.TRAINING,
  EventTypeEnum.SOCIAL,
  EventTypeEnum.FUNDRAISER,
  EventTypeEnum.CEREMONY,
  EventTypeEnum.RECRUITMENT,
  EventTypeEnum.OTHER,
];

export const DEFAULT_FORM_DATA: EventCreate = {
  title: '',
  description: '',
  event_type: EventTypeEnum.BUSINESS_MEETING,
  custom_category: undefined,
  location_id: undefined,
  location: '',
  location_details: '',
  start_datetime: '',
  end_datetime: '',
  requires_rsvp: false,
  rsvp_deadline: '',
  max_attendees: undefined,
  allowed_rsvp_statuses: [RSVPStatusEnum.GOING, RSVPStatusEnum.NOT_GOING],
  is_mandatory: false,
  mandatory_membership_types: undefined,
  allow_guests: false,
  send_reminders: true,
  reminder_target: 'going',
  reminder_schedule: [24],
  check_in_window_type: 'flexible',
  check_in_minutes_before: 60,
  check_in_minutes_after: 15,
  require_checkout: false,
  allow_guest_check_in: false,
  guest_check_in_creates_prospect: false,
  is_draft: false,
};

/**
 * The event endpoints' field names as this form labels them, with the
 * schema's `max_length` (EventBase, backend/app/schemas/event.py), so a 422
 * lands on its field (forms review F-2).
 */
export const EVENT_FIELDS = {
  title: { label: 'Title', maxLength: 200 },
  description: { label: 'Description' },
  event_type: { label: 'Event type' },
  start_datetime: { label: 'Start' },
  end_datetime: { label: 'End' },
  location: { label: 'Location', maxLength: 300 },
  location_details: { label: 'Additional directions' },
  rsvp_deadline: { label: 'RSVP deadline' },
  max_attendees: { label: 'Max attendees' },
  recurrence_end_date: { label: 'Recurrence end date' },
} satisfies Record<string, ServerFieldSpec>;
export type EventField = keyof typeof EVENT_FIELDS;

/** The control each field's error points focus at, in reading order. */
export const EVENT_FIELD_IDS: Record<EventField, string> = {
  title: 'event-title',
  description: 'event-description',
  event_type: 'event-type',
  start_datetime: 'start-datetime',
  end_datetime: 'end-datetime',
  recurrence_end_date: 'recurrence-end-date',
  location: 'location-text',
  location_details: 'location-details',
  rsvp_deadline: 'rsvp-deadline',
  max_attendees: 'max-attendees',
};

/* Shared Tailwind classes for consistency */
export const inputClass = 'form-input py-3';

export const selectClass = 'form-input py-3';

export const labelClass = 'block text-sm font-semibold text-theme-text-primary mb-2';

// The box only: the 44px tap target comes from the <label> wrapping each one
// (see `form-checkbox` in index.css). `form-input` gave a 16px-wide box 44px of
// height and no wider target.
export const checkboxClass = 'form-checkbox';

export const RECURRENCE_PATTERNS: { value: RecurrencePattern; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 Weeks' },
  { value: 'monthly', label: 'Monthly (same date)' },
  { value: 'monthly_weekday', label: 'Monthly (by weekday)' },
  { value: 'annually', label: 'Annually (same date)' },
  { value: 'annually_weekday', label: 'Annually (by weekday)' },
  { value: 'custom', label: 'Custom Days' },
];

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const DEFAULT_MEMBERSHIP_TYPES = [
  { value: 'active', label: 'Active' },
  { value: 'probationary', label: 'Probationary' },
  { value: 'administrative', label: 'Administrative' },
  { value: 'life', label: 'Life' },
  { value: 'retired', label: 'Retired' },
];

/** Format a file size in bytes to a human-readable string. */
export const formatAttachmentSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const ORDINALS = [
  { value: 1, label: '1st' },
  { value: 2, label: '2nd' },
  { value: 3, label: '3rd' },
  { value: 4, label: '4th' },
  { value: 5, label: '5th' },
  { value: -1, label: 'Last' },
];

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
