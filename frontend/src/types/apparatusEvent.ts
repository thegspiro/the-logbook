/**
 * Apparatus events — outreach that rolls an apparatus with a named crew but is
 * not a shift. Mirrors backend/app/schemas/apparatus_event.py, which is
 * snake_case on the wire like the rest of the events module.
 */

export const ApparatusEventEvocMode = {
  ENFORCE: 'enforce',
  WARN: 'warn',
  IGNORE: 'ignore',
} as const;
export type ApparatusEventEvocMode = (typeof ApparatusEventEvocMode)[keyof typeof ApparatusEventEvocMode];

export const ApparatusEventSeatType = {
  DRIVER: 'driver',
  GENERAL: 'general',
} as const;
export type ApparatusEventSeatType = (typeof ApparatusEventSeatType)[keyof typeof ApparatusEventSeatType];

export const ApparatusEventSeatMethod = {
  SELF_SIGNUP: 'self_signup',
  ASSIGNED: 'assigned',
} as const;
export type ApparatusEventSeatMethod = (typeof ApparatusEventSeatMethod)[keyof typeof ApparatusEventSeatMethod];

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export interface TemplateSeatSpec {
  name: string;
  seat_type: ApparatusEventSeatType;
  count: number;
  note?: string | undefined;
}

export interface TemplateUnitSpec {
  apparatus_id: string;
  seats: TemplateSeatSpec[];
}

export interface ApparatusEventTemplatePayload {
  name: string;
  description?: string | undefined;
  event_type: string;
  default_start_time?: string | undefined;
  duration_minutes: number;
  location?: string | undefined;
  admin_hours_category_id?: string | undefined;
  evoc_mode: ApparatusEventEvocMode;
  allow_self_signup: boolean;
  show_on_schedule: boolean;
  units: TemplateUnitSpec[];
  duplicated_from_id?: string | undefined;
}

export interface TemplateSeat {
  id: string;
  name: string;
  seat_type: ApparatusEventSeatType;
  count: number;
  note: string | null;
}

export interface TemplateUnit {
  id: string;
  apparatus_id: string;
  unit_number: string;
  apparatus_name: string | null;
  required_evoc_level_name: string | null;
  seats: TemplateSeat[];
}

export interface ApparatusEventTemplate {
  id: string;
  name: string;
  description: string | null;
  event_type: string;
  default_start_time: string | null;
  duration_minutes: number;
  location: string | null;
  admin_hours_category_id: string | null;
  admin_hours_category_name: string | null;
  evoc_mode: ApparatusEventEvocMode;
  allow_self_signup: boolean;
  show_on_schedule: boolean;
  duplicated_from_id: string | null;
  duplicated_from_name: string | null;
  total_seats: number;
  nights_scheduled: number;
  last_scheduled_at: string | null;
  units: TemplateUnit[];
  created_at: string;
  updated_at: string;
}

export interface EditorApparatusOption {
  id: string;
  unit_number: string;
  name: string | null;
  required_evoc_level_name: string | null;
  status_name: string | null;
  is_available: boolean;
}

export interface EditorCategoryOption {
  id: string;
  name: string;
}

export interface EditorOptions {
  apparatus: EditorApparatusOption[];
  categories: EditorCategoryOption[];
}

// ---------------------------------------------------------------------------
// Scheduling nights
// ---------------------------------------------------------------------------

export interface NightSpec {
  start_datetime: string;
  end_datetime: string;
  location?: string | undefined;
}

export interface ApparatusConflict {
  night_index: number;
  apparatus_id: string;
  unit_number: string;
  reason: string;
  conflicting_event_id: string | null;
  conflicting_title: string | null;
}

export interface ScheduleNightsPayload {
  title: string;
  nights: NightSpec[];
  acknowledge_conflicts: boolean;
}

export interface ScheduleNightsResult {
  series_id: string;
  event_ids: string[];
}

// ---------------------------------------------------------------------------
// A night's crew
// ---------------------------------------------------------------------------

export interface DriverWarning {
  type: string;
  message: string;
  severity: string;
}

export interface CrewSeat {
  id: string;
  name: string;
  seat_type: ApparatusEventSeatType;
  note: string | null;
  user_id: string | null;
  user_name: string | null;
  assignment_method: ApparatusEventSeatMethod | null;
  is_me: boolean;
  checked_in: boolean;
}

export interface CrewUnit {
  id: string;
  apparatus_id: string;
  unit_number: string;
  apparatus_name: string | null;
  required_evoc_level_name: string | null;
  seats: CrewSeat[];
}

export interface SeriesNight {
  event_id: string;
  start_datetime: string;
  filled: number;
  total: number;
}

export interface CrewBoard {
  event_id: string;
  title: string;
  event_type: string;
  start_datetime: string;
  end_datetime: string;
  location: string | null;
  is_cancelled: boolean;
  attendance_finalized: boolean;
  template_id: string | null;
  template_name: string | null;
  evoc_mode: ApparatusEventEvocMode;
  allow_self_signup: boolean;
  show_on_schedule: boolean;
  admin_hours_category_id: string | null;
  admin_hours_category_name: string | null;
  night_number: number;
  night_count: number;
  series: SeriesNight[];
  units: CrewUnit[];
  my_seat_id: string | null;
  can_manage: boolean;
  can_sign_up: boolean;
  warnings: DriverWarning[];
}

export interface AssignableMember {
  user_id: string;
  name: string;
}

export interface DriverCandidate {
  user_id: string;
  name: string;
  allowed: boolean;
  blocked_reason: string | null;
  warnings: DriverWarning[];
  exception_valid_until: string | null;
}

export interface DriverCandidates {
  unit_id: string;
  required_evoc_level_name: string | null;
  evoc_mode: ApparatusEventEvocMode;
  candidates: DriverCandidate[];
}

export interface NightSeatSpec {
  id?: string | undefined;
  name: string;
  seat_type: ApparatusEventSeatType;
  note?: string | undefined;
}

export interface NightUnitSpec {
  id?: string | undefined;
  apparatus_id: string;
  seats: NightSeatSpec[];
}

export interface NightPlanPayload {
  evoc_mode: ApparatusEventEvocMode;
  allow_self_signup: boolean;
  show_on_schedule: boolean;
  admin_hours_category_id?: string | null | undefined;
  units: NightUnitSpec[];
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export type NightScope = 'upcoming' | 'needs_confirmation' | 'past';

export interface NightSummary {
  event_id: string;
  title: string;
  start_datetime: string;
  end_datetime: string;
  template_name: string | null;
  unit_numbers: string[];
  filled: number;
  total: number;
  is_cancelled: boolean;
  attendance_finalized: boolean;
  checked_in: number;
}

export interface CalendarOutreachItem {
  event_id: string;
  title: string;
  start_datetime: string;
  end_datetime: string;
  unit_numbers: string[];
  filled: number;
  total: number;
  is_mine: boolean;
}
