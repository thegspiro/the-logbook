/**
 * Scheduling API Service
 *
 * Handles all API calls for the Scheduling module.
 */

import { AxiosError } from 'axios';
import { createApiClient } from '../../../utils/createApiClient';
import { asArray } from '../../../utils/asArray';
import type {
  Assignment,
  SwapRequest as SchedulingSwapRequest,
  TimeOffRequest as SchedulingTimeOffRequest,
  ShiftPattern as SchedulingShiftPattern,
} from '../../../types/scheduling';
import type {
  ShiftCreate,
  ShiftUpdate,
  AssignmentCreate,
  AssignmentUpdate,
  SwapRequestCreate,
  SwapRequestReview,
  SwapRequestFilters,
  PaginatedResponse,
  TimeOffCreate,
  TimeOffReview,
  TimeOffFilters,
  CallTypeOption,
  CloseoutState,
  CloseoutAttendanceEntry,
  CloseoutCallsPayload,
  MemberCallCredit,
  ShiftTemplateCreate,
  ShiftTemplateUpdate,
  ShiftPatternCreate,
  ShiftPatternUpdate,
  PatternGenerateRequest,
  PatternGenerateResponse,
  BasicApparatusCreate,
  BasicApparatusUpdate,
  ReportFilters,
  AvailabilityFilters,
  MemberHoursReport,
  CoverageReportEntry,
  CallVolumeReportEntry,
  AvailabilityRecord,
  ShiftSignupResponse,
  EligiblePositionsResponse,
  PositionRosterResponse,
  EvocWarning,
  SchedulingEligibilitySettings,
  ShiftCallRecord,
  ShiftCallCreate,
  ShiftCallUpdate,
  TradeCandidate,
  StandingShiftClaim,
  StandingShiftCreate,
  StandingShiftCreateResult,
  StandingShiftPreview,
  StandingShiftPreviewParams,
} from '../types';

// ============================================
// Types
// ============================================

/** A single position slot on a shift/apparatus/template. */
export interface PositionSlot {
  position: string;
  required: boolean;
  allow_administrative_members?: boolean;
}

/**
 * One occupied seat on a shift, carried on every shift the calendar fetches.
 *
 * The month fetch returns these so the day panel can render "who is on this
 * shift" without a request per day, and so a calendar cell can be coloured by
 * "you are on it" at all.
 */
export interface ShiftRosterSeat {
  assignment_id: string;
  user_id: string;
  user_name?: string | null;
  position?: string | null;
  /** What this member is doing at an outreach event. Null on a duty shift. */
  outreach_role?: string | null;
  outreach_role_label?: string | null;
  status?: string | null;
  is_training?: boolean;
}

/** One role on a community-outreach signup sheet, and how full it is. */
export interface OutreachRoleSlot {
  role: string;
  label: string;
  total: number;
  filled: number;
  remaining: number;
}

export interface ShiftRecord {
  id: string;
  organization_id: string;
  shift_date: string;
  start_time: string;
  end_time?: string;
  apparatus_id?: string;
  apparatus_name?: string;
  apparatus_unit_number?: string;
  apparatus_type?: string;
  platoon?: string | null;
  positions?: PositionSlot[] | null;
  apparatus_positions?: PositionSlot[] | null;
  min_staffing?: number | null;
  station_id?: string;
  shift_officer_id?: string;
  shift_officer_name?: string;
  color?: string | null;
  notes?: string;
  activities?: unknown;
  open_to_all_members?: boolean;
  /**
   * A community-outreach signup sheet rather than duty coverage. Its seats are
   * named by outreach role (tour guide, educator) instead of by crew position,
   * because nobody is riding a seat on an engine at a school visit.
   */
  is_outreach?: boolean;
  outreach_roles?: OutreachRoleSlot[];
  attendee_count: number;
  /** Occupied seats. Empty on responses served before the roster existed. */
  roster?: ShiftRosterSeat[];
  call_count: number;
  total_hours?: number | null;
  is_finalized: boolean;
  finalized_at?: string;
  finalized_by?: string;
  status?: 'scheduled' | 'cancelled';
  cancelled_at?: string;
  cancelled_by?: string;
  cancellation_reason?: string | null;
  created_at: string;
  updated_at: string;
  created_by?: string;
  attendees?: ShiftAttendanceRecord[];
  platoon_roster?: PlatoonRosterEntry[];
  /**
   * Whether the shift is inside its check-in window, decided by the backend so
   * the rule is not reimplemented here. Only the shift *detail* response carries
   * these; the list endpoint leaves them undefined.
   */
  checkin_open?: boolean;
  checkin_closed_reason?: string | null;
  /**
   * Leadership's per-shift late-signup window, when one is open — the instant
   * that reopening expires. Null on every shift nobody has opened one for.
   * Carried on the list responses too, because the board gates its claim
   * buttons on it.
   */
  late_signup_until?: string | null;
  /**
   * Whether signup is inside its window *for you*, decided by the backend so
   * the rule is not reimplemented here. Actor-relative — a scheduling admin
   * always reads open — so only the shift *detail* response carries them; the
   * list endpoint leaves them undefined.
   */
  signup_open?: boolean;
  signup_closed_reason?: string | null;
}

export interface PlatoonRosterEntry {
  user_id: string;
  user_name: string;
  status: 'assigned' | 'on_leave' | 'available';
}

export interface SchedulingFeatureSettings {
  platoons_enabled: boolean;
  max_hours_per_window?: number | null;
  hours_window_days: number;
  auto_generate_enabled: boolean;
  auto_generate_weeks: number;
  require_end_of_shift_checks: boolean;
  restrict_checkin_to_assigned: boolean;
  /** Minutes before start_time that member self-signup closes. 0 = at the start. */
  signup_closes_minutes_before: number;
  /** Minutes after start_time an officer may still seat somebody. */
  late_signup_grace_minutes: number;
  /** Block seating a driver who lacks the apparatus's required EVOC level. */
  enforce_evoc: boolean;
  /**
   * How the department records call volume. Absent means `detailed` — the
   * behaviour every existing organisation already has.
   */
  call_tracking?: { mode: string; call_types: CallTypeOption[] } | null;
  /**
   * Calls on record per type slug, all dates. Server-computed: it says which
   * types can be deleted outright and which carry history and must be retired
   * instead. Ignored if sent on a write.
   */
  call_type_usage?: Record<string, number>;
  /**
   * Types the editor must not offer to delete. Broader than a non-zero usage
   * count: a filed shift report can outlive the calls it was built from, and
   * deleting the type would leave that report showing a raw slug. Also
   * server-computed and ignored on a write.
   */
  call_type_locked?: string[];
}

export interface PlatoonMember {
  user_id: string;
  user_name: string;
  rank?: string | null;
}

export interface PlatoonGroup {
  // null = the "unassigned" bucket (members with no platoon).
  platoon: string | null;
  member_count: number;
  members: PlatoonMember[];
}

export interface PlatoonOverview {
  platoons_enabled: boolean;
  groups: PlatoonGroup[];
}

export interface ShiftAttendanceRecord {
  id: string;
  shift_id: string;
  user_id: string;
  user_name?: string;
  checked_in_at?: string;
  checked_out_at?: string;
  duration_minutes?: number;
  call_count?: number;
  created_at: string;
  // Populated by /scheduling/my-attendance-history so the frontend can
  // render attendance-only shifts without a separate shift lookup.
  shift_date?: string;
  shift_start_time?: string;
  shift_end_time?: string;
}

export interface SchedulingSummary {
  /**
   * Counts of *scheduled* shifts. The hours figure below is of hours
   * actually *worked* (from attendance), so the two will not reconcile —
   * the names carry the distinction because these sit side by side in the UI.
   */
  shifts_scheduled: number;
  shifts_scheduled_this_week: number;
  shifts_scheduled_this_month: number;
  hours_worked_this_month: number;
}

/**
 * One calendar month of the signed-in member's own shift work.
 *
 * `hours`/`shifts`/`calls` are credited figures — attendance on a shift an
 * officer has finalized, the same basis the department's member-hours report
 * uses. `pending_*` is time the member has worked that close-out has not
 * confirmed yet; it is shown alongside rather than added in, so the member's
 * number and their officer's number never disagree without explanation.
 */
export interface MemberHoursMonth {
  year: number;
  /** 1-12. */
  month: number;
  shifts: number;
  hours: number;
  calls: number;
  pending_shifts: number;
  pending_hours: number;
}

export interface MemberHoursTotals {
  shifts: number;
  hours: number;
  calls: number;
  pending_shifts: number;
  pending_hours: number;
}

export interface MemberHoursHistory {
  year: number;
  /** Earliest year the member has any attendance in; null when they have none. */
  earliest_year: number | null;
  timezone: string;
  /** Always twelve entries, January first, so quiet months read as quiet. */
  months: MemberHoursMonth[];
  /** The selected year only. */
  totals: MemberHoursTotals;
  /** Every year on record, so the year picker does not move it. */
  all_time: MemberHoursTotals;
  /** Carry their own year: every January, last month was last year. */
  current_month: MemberHoursMonth;
  previous_month: MemberHoursMonth;
}

export interface SchedulingWidgetSummary {
  timezone: string;
  window_start: string;
  window_end: string;
  today_staffing: number;
  future_coverage_gaps: number;
  open_slots: number;
  pending_staffing_changes: number;
  incomplete_closeouts: number;
  workload_imbalance: number;
  special_operations: number;
  scheduling_enabled: boolean;
}

export interface SchedulingWidgetFilters {
  station_id?: string;
  platoon?: string;
  horizon_days: number;
}

export interface SchedulingWidgetPreferences {
  widgets: Record<string, SchedulingWidgetFilters>;
}

/** Event template metadata stored in the positions field for event-category templates. */
export interface EventTemplatePositions {
  event_type?: string;
  resources?: Array<{ positions: Array<string | PositionSlot>; quantity: number }>;
  flat_positions?: Array<string | PositionSlot>;
}

export interface ShiftTemplateRecord {
  id: string;
  name: string;
  start_time_of_day: string;
  end_time_of_day: string;
  duration_hours: number;
  color?: string;
  positions?: Array<string | PositionSlot> | EventTemplatePositions;
  min_staffing: number;
  category?: string;
  apparatus_type?: string;
  apparatus_id?: string;
  is_default: boolean;
  is_active: boolean;
  open_to_all_members?: boolean;
}

/**
 * Extract a flat string[] of position names from a template's positions field,
 * which may be a plain string array (standard/specialty) or an event metadata
 * object containing flat_positions / resources (event category).
 */
/**
 * Normalize any position format to PositionSlot[].
 * Handles: string[], PositionSlot[], null/undefined.
 */
export function normalizePositions(positions: unknown[] | null | undefined): PositionSlot[] {
  if (!positions || !Array.isArray(positions)) return [];
  return positions.map((p) => {
    if (typeof p === 'string') {
      return { position: p, required: true, allow_administrative_members: false };
    }
    if (typeof p === 'object' && p !== null && 'position' in p) {
      const slot = p as { position: string; required?: boolean; allow_administrative_members?: boolean };
      return {
        position: slot.position,
        required: slot.required !== false,
        allow_administrative_members: slot.allow_administrative_members === true,
      };
    }
    return { position: String(p), required: true, allow_administrative_members: false };
  });
}

/**
 * Return a shift with both seat lists normalized to `PositionSlot[]`.
 *
 * A shift's `positions` is untyped JSON on the backend (`List[Any]`), and both
 * `ShiftCreate.positions` and rows written before the required/optional flag
 * existed carry bare strings. Consumers treat the field as `PositionSlot[]` —
 * the structured position editor spreads each entry, so a string reaches the
 * database as `{0:'o',1:'f',…}` — so the shape is settled once here, at the
 * boundary, rather than at each of the dozen call sites.
 */
function normalizeShift<T extends { positions?: unknown; apparatus_positions?: unknown }>(shift: T): T {
  if (!shift) return shift;
  return {
    ...shift,
    ...(shift.positions != null ? { positions: normalizePositions(shift.positions as unknown[]) } : {}),
    ...(shift.apparatus_positions != null
      ? { apparatus_positions: normalizePositions(shift.apparatus_positions as unknown[]) }
      : {}),
  };
}

/** Same treatment for an apparatus record, whose seat list is the same JSON. */
function normalizeApparatus<T extends { positions?: unknown }>(apparatus: T): T {
  if (!apparatus || apparatus.positions == null) return apparatus;
  return { ...apparatus, positions: normalizePositions(apparatus.positions as unknown[]) };
}

export function resolveTemplatePositions(positions: ShiftTemplateRecord['positions']): PositionSlot[] {
  if (!positions) return [];
  // Standard / specialty templates store a plain array
  if (Array.isArray(positions)) return normalizePositions(positions);
  // Event templates — prefer the pre-computed flat list
  if (Array.isArray(positions.flat_positions) && positions.flat_positions.length > 0) {
    return normalizePositions(positions.flat_positions);
  }
  // Legacy event templates — compute from resources
  if (Array.isArray(positions.resources)) {
    const flat = positions.resources.flatMap((r) =>
      Array.from({ length: r.quantity ?? 1 }, () => r.positions ?? []).flat()
    );
    return normalizePositions(flat);
  }
  return [];
}

export interface BasicApparatusRecord {
  id: string;
  unit_number: string;
  name: string;
  apparatus_type: string;
  min_staffing?: number;
  positions?: PositionSlot[];
  is_active: boolean;
}

export interface ApparatusOption {
  id?: string;
  name: string;
  unit_number?: string;
  apparatus_type: string;
  source: 'apparatus' | 'basic' | 'default';
  positions?: PositionSlot[];
  min_staffing?: number;
}

export interface ApparatusOptionsResponse {
  options: ApparatusOption[];
  source: 'apparatus' | 'basic' | 'default';
}

export interface MemberComplianceRecord {
  user_id: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  rank?: string;
  completed_value: number;
  percentage: number;
  compliant: boolean;
  shift_count: number;
  total_hours: number;
}

export interface RequirementComplianceSummary {
  requirement_id: string;
  requirement_name: string;
  requirement_type: string;
  required_value: number;
  frequency: string;
  period_start: string;
  period_end: string;
  members: MemberComplianceRecord[];
  total_members: number;
  compliant_count: number;
  non_compliant_count: number;
  compliance_rate: number;
}

export interface ShiftComplianceResponse {
  requirements: RequirementComplianceSummary[];
  reference_date: string;
  total_requirements: number;
}

// SEC: Use the shared axios factory to ensure consistent auth (CSRF, cookie
// credentials, 401 refresh) across all modules.  Do not create manual axios
// instances — drift from the global auth setup causes hard-to-debug 401/403s.
const api = createApiClient();

// ============================================
// Scheduling Service
// ============================================

export const schedulingService = {
  async getShifts(params?: {
    start_date?: string;
    end_date?: string;
    skip?: number;
    limit?: number;
  }): Promise<{ shifts: ShiftRecord[]; total: number; skip: number; limit: number }> {
    const response = await api.get<{ shifts: ShiftRecord[]; total: number; skip: number; limit: number }>(
      '/scheduling/shifts',
      { params }
    );
    return { ...response.data, shifts: asArray(response.data?.shifts).map(normalizeShift) };
  },

  async createShift(data: ShiftCreate): Promise<ShiftRecord> {
    const response = await api.post<ShiftRecord>('/scheduling/shifts', data);
    return normalizeShift(response.data);
  },

  async getShift(shiftId: string): Promise<ShiftRecord> {
    const response = await api.get<ShiftRecord>(`/scheduling/shifts/${shiftId}`);
    return normalizeShift(response.data);
  },

  async updateShift(shiftId: string, data: ShiftUpdate): Promise<ShiftRecord> {
    const response = await api.patch<ShiftRecord>(`/scheduling/shifts/${shiftId}`, data);
    return normalizeShift(response.data);
  },

  async deleteShift(shiftId: string): Promise<void> {
    await api.delete(`/scheduling/shifts/${shiftId}`);
  },

  async getCalendarFeed(): Promise<{ token: string; feed_path: string }> {
    const response = await api.get<{ token: string; feed_path: string }>('/scheduling/calendar-feed');
    return response.data;
  },

  async rotateCalendarFeed(): Promise<{ token: string; feed_path: string }> {
    const response = await api.post<{ token: string; feed_path: string }>('/scheduling/calendar-feed/rotate');
    return response.data;
  },

  async cancelShift(shiftId: string, reason?: string): Promise<ShiftRecord> {
    const response = await api.post<ShiftRecord>(`/scheduling/shifts/${shiftId}/cancel`, reason ? { reason } : {});
    return normalizeShift(response.data);
  },

  async finalizeShift(
    shiftId: string,
    manualHours?: { user_id: string; hours: number }[],
    opts?: {
      override_incomplete_checks?: boolean;
      override_reason?: string;
      pass_down_notes?: string;
      member_call_counts?: MemberCallCredit[];
    }
  ): Promise<ShiftRecord> {
    const body: Record<string, unknown> = {};
    if (manualHours?.length) body.manual_hours = manualHours;
    if (opts?.override_incomplete_checks) {
      body.override_incomplete_checks = true;
      if (opts.override_reason) body.override_reason = opts.override_reason;
    }
    if (opts?.pass_down_notes) body.pass_down_notes = opts.pass_down_notes;
    if (opts?.member_call_counts?.length) body.member_call_counts = opts.member_call_counts;
    const response = await api.post<ShiftRecord>(`/scheduling/shifts/${shiftId}/finalize`, body);
    return normalizeShift(response.data);
  },

  // -- Resumable close-out -------------------------------------------------

  async getCloseoutState(shiftId: string): Promise<CloseoutState> {
    const response = await api.get<CloseoutState>(`/scheduling/shifts/${shiftId}/closeout`);
    return response.data;
  },

  async saveCloseoutAttendance(shiftId: string, entries: CloseoutAttendanceEntry[]): Promise<CloseoutState> {
    const response = await api.patch<CloseoutState>(`/scheduling/shifts/${shiftId}/closeout/attendance`, { entries });
    return response.data;
  },

  async saveCloseoutCalls(shiftId: string, payload: CloseoutCallsPayload): Promise<CloseoutState> {
    const body: Record<string, unknown> = {};
    // null is meaningful here — it clears a previously reported count — so this
    // checks for undefined rather than using a falsy guard, which would also
    // drop a legitimate zero.
    if (payload.reported_call_count !== undefined) {
      body.reported_call_count = payload.reported_call_count;
    }
    if (payload.reported_call_types) body.reported_call_types = payload.reported_call_types;
    const response = await api.patch<CloseoutState>(`/scheduling/shifts/${shiftId}/closeout/calls`, body);
    return response.data;
  },

  async reopenShift(shiftId: string, reason?: string): Promise<ShiftRecord> {
    const response = await api.post<ShiftRecord>(`/scheduling/shifts/${shiftId}/reopen`, reason ? { reason } : {});
    return normalizeShift(response.data);
  },

  async getShiftHandoff(
    shiftId: string
  ): Promise<{ shift_id: string; shift_date: string | null; pass_down_notes: string } | null> {
    const response = await api.get<{ shift_id: string; shift_date: string | null; pass_down_notes: string } | null>(
      `/scheduling/shifts/${shiftId}/handoff`
    );
    return response.data;
  },

  async getWeekCalendar(weekStart?: string): Promise<ShiftRecord[]> {
    const params: Record<string, string> = {};
    if (weekStart) params.week_start = weekStart;
    const response = await api.get<ShiftRecord[]>('/scheduling/calendar/week', { params });
    return asArray(response.data).map(normalizeShift);
  },

  async getMonthCalendar(year?: number, month?: number): Promise<ShiftRecord[]> {
    const params: Record<string, number> = {};
    if (year) params.year = year;
    if (month) params.month = month;
    const response = await api.get<ShiftRecord[]>('/scheduling/calendar/month', { params });
    return asArray(response.data).map(normalizeShift);
  },

  async getSummary(): Promise<SchedulingSummary> {
    const response = await api.get<SchedulingSummary>('/scheduling/summary');
    return response.data;
  },
  /** The signed-in member's own hours and calls for a year, month by month. */
  async getMyHoursHistory(year?: number): Promise<MemberHoursHistory> {
    const response = await api.get<MemberHoursHistory>('/scheduling/my-hours-history', {
      params: year ? { year } : {},
    });
    return response.data;
  },
  async getWidgetSummary(params: {
    start_date: string;
    end_date: string;
    station_id?: string;
    platoon?: string;
    shift_type?: string;
    position?: string;
  }): Promise<SchedulingWidgetSummary> {
    const response = await api.get<SchedulingWidgetSummary>('/scheduling/dashboard/widgets', { params });
    return response.data;
  },
  async getWidgetPreferences(): Promise<SchedulingWidgetPreferences> {
    const response = await api.get<SchedulingWidgetPreferences>('/scheduling/dashboard/widget-preferences');
    return response.data;
  },
  async saveWidgetPreferences(preferences: SchedulingWidgetPreferences): Promise<SchedulingWidgetPreferences> {
    const response = await api.put<SchedulingWidgetPreferences>(
      '/scheduling/dashboard/widget-preferences',
      preferences
    );
    return response.data;
  },

  async getMyShifts(params?: {
    start_date?: string;
    end_date?: string;
    skip?: number;
    limit?: number;
  }): Promise<{ shifts: ShiftRecord[]; total: number }> {
    const response = await api.get<{ shifts: ShiftRecord[]; total: number }>('/scheduling/my-shifts', { params });
    return { ...response.data, shifts: asArray(response.data?.shifts).map(normalizeShift) };
  },

  async getMyAssignments(): Promise<Assignment[]> {
    const response = await api.get<Assignment[]>('/scheduling/my-assignments');
    // Backend returns assignment_status; provide status alias for convenience
    return asArray(response.data).map((a) => ({
      ...a,
      status: a.assignment_status ?? a.status,
    }));
  },

  // Shift Assignments
  async getUnavailableMembers(shiftId: string): Promise<string[]> {
    const response = await api.get<{ unavailable_user_ids: string[] }>(
      `/scheduling/shifts/${shiftId}/unavailable-members`
    );
    return asArray(response.data?.unavailable_user_ids);
  },
  async getShiftAssignments(shiftId: string): Promise<Assignment[]> {
    const response = await api.get<Assignment[]>(`/scheduling/shifts/${shiftId}/assignments`);
    // Normalize assignment_status → status for consistency
    return asArray(response.data).map((a) => ({
      ...a,
      status: a.assignment_status ?? a.status ?? 'assigned',
    }));
  },
  async createAssignment(
    shiftId: string,
    data: AssignmentCreate
  ): Promise<Assignment & { evoc_warnings?: EvocWarning[]; overtime_warnings?: string[] }> {
    const response = await api.post<Assignment & { evoc_warnings?: EvocWarning[]; overtime_warnings?: string[] }>(
      `/scheduling/shifts/${shiftId}/assignments`,
      data
    );
    return response.data;
  },
  async updateAssignment(assignmentId: string, data: AssignmentUpdate): Promise<Assignment> {
    const response = await api.patch<Assignment>(`/scheduling/assignments/${assignmentId}`, data);
    return response.data;
  },
  async deleteAssignment(assignmentId: string): Promise<void> {
    await api.delete(`/scheduling/assignments/${assignmentId}`);
  },
  async confirmAssignment(assignmentId: string): Promise<Assignment> {
    const response = await api.post<Assignment>(`/scheduling/assignments/${assignmentId}/confirm`);
    return response.data;
  },

  // Attendance history
  async getMyAttendanceHistory(
    options: { limit?: number; start_date?: string; end_date?: string } = {}
  ): Promise<ShiftAttendanceRecord[]> {
    const { limit = 50, start_date, end_date } = options;
    const response = await api.get<ShiftAttendanceRecord[]>('/scheduling/my-attendance-history', {
      params: { limit, start_date, end_date },
    });
    return asArray(response.data);
  },

  // Active shift lookup
  async getActiveShiftForApparatus(apparatusId: string): Promise<ShiftRecord> {
    const response = await api.get<ShiftRecord>(`/scheduling/apparatus/${apparatusId}/active-shift`);
    return normalizeShift(response.data);
  },

  // Shift Check-In / Check-Out
  async checkIn(shiftId: string): Promise<ShiftAttendanceRecord> {
    const response = await api.post<ShiftAttendanceRecord>(`/scheduling/shifts/${shiftId}/check-in`);
    return response.data;
  },
  async checkOut(shiftId: string): Promise<ShiftAttendanceRecord> {
    const response = await api.post<ShiftAttendanceRecord>(`/scheduling/shifts/${shiftId}/check-out`);
    return response.data;
  },
  async getMyAttendance(shiftId: string): Promise<ShiftAttendanceRecord | null> {
    try {
      const response = await api.get<ShiftAttendanceRecord>(`/scheduling/shifts/${shiftId}/my-attendance`);
      return response.data;
    } catch (err: unknown) {
      if (err instanceof AxiosError && err.response?.status === 404) return null;
      throw err;
    }
  },

  // Swap Requests
  /** Swaps the caller is a participant in — what is waiting on them. */
  async getMySwapRequests(status?: 'pending' | 'approved' | 'denied' | 'cancelled'): Promise<SchedulingSwapRequest[]> {
    const response = await api.get<PaginatedResponse<SchedulingSwapRequest>>('/scheduling/swap-requests', {
      params: { mine: true, ...(status ? { status } : {}) },
    });
    return asArray(response.data?.items);
  },
  async getSwapRequests(params?: SwapRequestFilters): Promise<PaginatedResponse<SchedulingSwapRequest>> {
    const response = await api.get<PaginatedResponse<SchedulingSwapRequest>>('/scheduling/swap-requests', { params });
    return response.data;
  },
  async createSwapRequest(data: SwapRequestCreate): Promise<SchedulingSwapRequest> {
    const response = await api.post<SchedulingSwapRequest>('/scheduling/swap-requests', data);
    return response.data;
  },
  async reviewSwapRequest(requestId: string, data: SwapRequestReview): Promise<SchedulingSwapRequest> {
    const response = await api.post<SchedulingSwapRequest>(`/scheduling/swap-requests/${requestId}/review`, data);
    return response.data;
  },
  /**
   * Answer an offer of someone else's seat. Member self-service — distinct
   * from `reviewSwapRequest`, which is the officer's verdict and refuses
   * participants.
   */
  async respondToSwapOffer(requestId: string, accept: boolean, note?: string): Promise<SchedulingSwapRequest> {
    const response = await api.post<SchedulingSwapRequest>(`/scheduling/swap-requests/${requestId}/respond`, {
      accept,
      ...(note ? { note } : {}),
    });
    return response.data;
  },
  async cancelSwapRequest(requestId: string): Promise<void> {
    await api.post(`/scheduling/swap-requests/${requestId}/cancel`);
  },

  // Time Off
  async getTimeOffRequests(params?: TimeOffFilters): Promise<PaginatedResponse<SchedulingTimeOffRequest>> {
    const response = await api.get<PaginatedResponse<SchedulingTimeOffRequest>>('/scheduling/time-off', { params });
    return response.data;
  },
  async createTimeOff(data: TimeOffCreate): Promise<SchedulingTimeOffRequest> {
    const response = await api.post<SchedulingTimeOffRequest>('/scheduling/time-off', data);
    return response.data;
  },
  async reviewTimeOff(requestId: string, data: TimeOffReview): Promise<SchedulingTimeOffRequest> {
    const response = await api.post<SchedulingTimeOffRequest>(`/scheduling/time-off/${requestId}/review`, data);
    return response.data;
  },
  async cancelTimeOff(requestId: string): Promise<void> {
    await api.post(`/scheduling/time-off/${requestId}/cancel`);
  },

  // Shift Attendance
  async getShiftAttendance(shiftId: string): Promise<ShiftAttendanceRecord[]> {
    const response = await api.get<ShiftAttendanceRecord[]>(`/scheduling/shifts/${shiftId}/attendance`);
    return asArray(response.data);
  },

  // Templates
  async getTemplates(params?: { active_only?: boolean }): Promise<ShiftTemplateRecord[]> {
    const response = await api.get<ShiftTemplateRecord[]>('/scheduling/templates', { params });
    return asArray(response.data);
  },
  async createTemplate(data: ShiftTemplateCreate): Promise<ShiftTemplateRecord> {
    const response = await api.post<ShiftTemplateRecord>('/scheduling/templates', data);
    return response.data;
  },
  async updateTemplate(templateId: string, data: ShiftTemplateUpdate): Promise<ShiftTemplateRecord> {
    const response = await api.patch<ShiftTemplateRecord>(`/scheduling/templates/${templateId}`, data);
    return response.data;
  },
  async deleteTemplate(templateId: string): Promise<void> {
    await api.delete(`/scheduling/templates/${templateId}`);
  },

  // Patterns
  async getPatterns(params?: { active_only?: boolean }): Promise<SchedulingShiftPattern[]> {
    const response = await api.get<SchedulingShiftPattern[]>('/scheduling/patterns', { params });
    return asArray(response.data);
  },
  async createPattern(data: ShiftPatternCreate): Promise<SchedulingShiftPattern> {
    const response = await api.post<SchedulingShiftPattern>('/scheduling/patterns', data);
    return response.data;
  },
  async updatePattern(patternId: string, data: ShiftPatternUpdate): Promise<SchedulingShiftPattern> {
    const response = await api.patch<SchedulingShiftPattern>(`/scheduling/patterns/${patternId}`, data);
    return response.data;
  },
  async deletePattern(patternId: string): Promise<void> {
    await api.delete(`/scheduling/patterns/${patternId}`);
  },
  async generateShiftsFromPattern(patternId: string, data: PatternGenerateRequest): Promise<PatternGenerateResponse> {
    const response = await api.post<PatternGenerateResponse>(`/scheduling/patterns/${patternId}/generate`, data);
    return response.data;
  },

  // Reports
  async getMemberHoursReport(params?: ReportFilters): Promise<MemberHoursReport> {
    const response = await api.get<MemberHoursReport>('/scheduling/reports/member-hours', { params });
    return response.data;
  },
  async getCoverageReport(params?: ReportFilters): Promise<CoverageReportEntry[]> {
    const response = await api.get<CoverageReportEntry[]>('/scheduling/reports/coverage', { params });
    return asArray(response.data);
  },
  async getCallVolumeReport(params?: ReportFilters): Promise<CallVolumeReportEntry[]> {
    const response = await api.get<CallVolumeReportEntry[]>('/scheduling/reports/call-volume', { params });
    return asArray(response.data);
  },
  async getAvailability(params?: AvailabilityFilters): Promise<AvailabilityRecord[]> {
    const response = await api.get<AvailabilityRecord[]>('/scheduling/availability', { params });
    return asArray(response.data);
  },

  // --- Basic Apparatus (lightweight, for departments without full Apparatus module) ---
  async getBasicApparatus(params?: { is_active?: boolean }): Promise<BasicApparatusRecord[]> {
    const response = await api.get<BasicApparatusRecord[]>('/scheduling/apparatus', { params });
    return asArray(response.data).map(normalizeApparatus);
  },
  async createBasicApparatus(data: BasicApparatusCreate): Promise<BasicApparatusRecord> {
    const response = await api.post<BasicApparatusRecord>('/scheduling/apparatus', data);
    return normalizeApparatus(response.data);
  },
  async updateBasicApparatus(apparatusId: string, data: BasicApparatusUpdate): Promise<BasicApparatusRecord> {
    const response = await api.patch<BasicApparatusRecord>(`/scheduling/apparatus/${apparatusId}`, data);
    return normalizeApparatus(response.data);
  },
  async deleteBasicApparatus(apparatusId: string): Promise<void> {
    await api.delete(`/scheduling/apparatus/${apparatusId}`);
  },

  // --- Apparatus Options (unified vehicle picker for templates) ---
  async getApparatusOptions(): Promise<ApparatusOptionsResponse> {
    const response = await api.get<ApparatusOptionsResponse>('/scheduling/apparatus-options');
    return { ...response.data, options: asArray(response.data?.options).map(normalizeApparatus) };
  },

  // --- Shift Signup (member self-service) ---
  async signupForShift(
    shiftId: string,
    data?: { position?: string; outreach_role?: string }
  ): Promise<ShiftSignupResponse & { evoc_warnings?: EvocWarning[]; overtime_warnings?: string[] }> {
    const response = await api.post<
      ShiftSignupResponse & { evoc_warnings?: EvocWarning[]; overtime_warnings?: string[] }
    >(`/scheduling/shifts/${shiftId}/signup`, data ?? {});
    return response.data;
  },
  async withdrawSignup(shiftId: string): Promise<void> {
    await api.delete(`/scheduling/shifts/${shiftId}/signup`);
  },

  /**
   * Reopen signup on one shift for `minutes` from now, for members and
   * officers alike. A duration rather than an instant: the server resolves it
   * against the same clock the enforcement reads, so a device running fast
   * cannot open a window shorter than the officer intended.
   */
  async openLateSignup(shiftId: string, minutes: number): Promise<ShiftRecord> {
    const response = await api.post<ShiftRecord>(`/scheduling/shifts/${shiftId}/late-signup`, { minutes });
    return response.data;
  },
  /** Withdraw a late-signup window, returning the shift to the org rule. */
  async closeLateSignup(shiftId: string): Promise<ShiftRecord> {
    const response = await api.delete<ShiftRecord>(`/scheduling/shifts/${shiftId}/late-signup`);
    return response.data;
  },

  /** Members who could take over the caller's seat on a shift. */
  async getTradeCandidates(shiftId: string): Promise<TradeCandidate[]> {
    const response = await api.get<TradeCandidate[]>(`/scheduling/shifts/${shiftId}/trade-candidates`);
    return asArray(response.data);
  },

  /** The caller's standing series this shift belongs to, or null. */
  async getStandingClaimForShift(shiftId: string): Promise<StandingShiftClaim | null> {
    const response = await api.get<StandingShiftClaim | null>(`/scheduling/shifts/${shiftId}/standing-claim`);
    return response.data ?? null;
  },

  // --- Standing Shifts (recurring self-signup) ---
  async getStandingShifts(activeOnly = true): Promise<StandingShiftClaim[]> {
    const response = await api.get<StandingShiftClaim[]>('/scheduling/standing-shifts', {
      params: { active_only: activeOnly },
    });
    return asArray(response.data);
  },
  async previewStandingShift(params: StandingShiftPreviewParams): Promise<StandingShiftPreview> {
    const response = await api.get<StandingShiftPreview>('/scheduling/standing-shifts/preview', { params });
    return { ...response.data, dates: asArray(response.data?.dates) };
  },
  async createStandingShift(data: StandingShiftCreate): Promise<StandingShiftCreateResult> {
    const response = await api.post<StandingShiftCreateResult>('/scheduling/standing-shifts', data);
    return response.data;
  },
  /**
   * End a series. `releaseFuture` also gives up the dates not yet worked —
   * off by default, because ending a series and emptying seats a duty officer
   * has already counted on are separate decisions.
   */
  async endStandingShift(claimId: string, releaseFuture = false): Promise<{ released: number }> {
    const response = await api.delete<{ released: number }>(`/scheduling/standing-shifts/${claimId}`, {
      params: { release_future: releaseFuture },
    });
    return response.data;
  },

  // --- Open Shifts ---
  async getOpenShifts(params?: {
    start_date?: string | undefined;
    end_date?: string;
    apparatus_id?: string;
  }): Promise<ShiftRecord[]> {
    const response = await api.get<ShiftRecord[]>('/scheduling/shifts/open', { params });
    return asArray(response.data).map(normalizeShift);
  },

  // --- Shift Calls / Runs ---
  async getShiftCalls(shiftId: string): Promise<ShiftCallRecord[]> {
    const response = await api.get<ShiftCallRecord[]>(`/scheduling/shifts/${shiftId}/calls`);
    return asArray(response.data);
  },
  async createCall(shiftId: string, data: ShiftCallCreate): Promise<ShiftCallRecord> {
    const response = await api.post<ShiftCallRecord>(`/scheduling/shifts/${shiftId}/calls`, data);
    return response.data;
  },
  async updateCall(callId: string, data: ShiftCallUpdate): Promise<ShiftCallRecord> {
    const response = await api.patch<ShiftCallRecord>(`/scheduling/calls/${callId}`, data);
    return response.data;
  },
  async deleteCall(callId: string): Promise<void> {
    await api.delete(`/scheduling/calls/${callId}`);
  },

  // --- Position Eligibility ---
  async getEligiblePositions(shiftId?: string): Promise<EligiblePositionsResponse> {
    const params = shiftId ? { shift_id: shiftId } : undefined;
    const response = await api.get<EligiblePositionsResponse>('/scheduling/eligibility/positions', { params });
    return response.data;
  },
  /** Eligible positions for several shifts at once, keyed by shift id. */
  async getEligiblePositionsBulk(shiftIds: string[]): Promise<Record<string, string[]>> {
    if (shiftIds.length === 0) return {};
    const response = await api.get<Record<string, string[]>>('/scheduling/eligibility/positions/bulk', {
      params: { shift_ids: shiftIds.join(',') },
    });
    return response.data ?? {};
  },
  async getPositionRoster(position: string): Promise<PositionRosterResponse> {
    const response = await api.get<PositionRosterResponse>('/scheduling/eligibility/roster', {
      params: { position },
    });
    return response.data;
  },
  async getEligibilitySettings(): Promise<SchedulingEligibilitySettings> {
    const response = await api.get<SchedulingEligibilitySettings>('/scheduling/eligibility/settings');
    return response.data;
  },
  async updateEligibilitySettings(
    data: Partial<SchedulingEligibilitySettings>
  ): Promise<SchedulingEligibilitySettings> {
    const response = await api.put<SchedulingEligibilitySettings>('/scheduling/eligibility/settings', data);
    return response.data;
  },

  // --- Department feature toggles ---
  async getFeatureSettings(): Promise<SchedulingFeatureSettings> {
    const response = await api.get<SchedulingFeatureSettings>('/scheduling/settings');
    return response.data;
  },
  async updateFeatureSettings(data: Partial<SchedulingFeatureSettings>): Promise<SchedulingFeatureSettings> {
    const response = await api.put<SchedulingFeatureSettings>('/scheduling/settings', data);
    return response.data;
  },

  // --- Platoon management ---
  async getPlatoonOverview(): Promise<PlatoonOverview> {
    const response = await api.get<PlatoonOverview>('/scheduling/platoons/overview');
    return response.data;
  },
  async bulkAssignPlatoon(
    userIds: string[],
    platoon: string | null
  ): Promise<{ updated: number; platoon: string | null }> {
    const response = await api.post<{ updated: number; platoon: string | null }>('/scheduling/platoons/bulk-assign', {
      user_ids: userIds,
      platoon,
    });
    return response.data;
  },

  // --- Shift Compliance ---
  async getComplianceReport(params?: { reference_date?: string }): Promise<ShiftComplianceResponse> {
    const response = await api.get<ShiftComplianceResponse>('/scheduling/reports/compliance', { params });
    return response.data;
  },
};
