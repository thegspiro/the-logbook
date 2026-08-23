/**
 * Scheduling API Service
 *
 * Handles all API calls for the Scheduling module.
 */

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
  EquipmentCheckTemplateCreate,
  EquipmentCheckTemplateUpdate,
  CheckTemplateCompartmentCreate,
  CheckTemplateCompartmentUpdate,
  CheckTemplateItemCreate,
  CheckTemplateItemUpdate,
  ShiftEquipmentCheckCreate,
  StandaloneEquipmentCheckCreate,
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
import type {
  EquipmentCheckTemplate,
  ShiftEquipmentCheckRecord,
  ShiftCheckSummary,
  CheckTemplateCompartment,
  CheckTemplateItem,
  LastCheckItemResult,
  LastSealRecord,
  ComplianceReport,
  FailureLogResponse,
  ItemTrendResponse,
  TemplateChangeLogResponse,
  SupplyOverview,
  ApparatusInventory,
  ItemDeployedLots,
  ItemDeployment,
  ItemRestockState,
  LotSwapResult,
  ExpiredStockDisposition,
  InventoryMatchesResult,
  InventoryLinkResult,
  FleetReadinessResponse,
  CheckLogResponse,
} from '../types/equipmentCheck';
import { blankToNull } from '@/utils/formValues';

declare module 'axios' {
  export interface InternalAxiosRequestConfig {
    _retry?: boolean;
  }
}

// ============================================
// Types
// ============================================

/** A single position slot on a shift/apparatus/template. */
export interface PositionSlot {
  position: string;
  required: boolean;
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
  status?: string | null;
  is_training?: boolean;
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
  /** Block seating a driver who lacks the apparatus's required EVOC level. */
  enforce_evoc: boolean;
  /**
   * How the department records call volume. Absent means `detailed` — the
   * behaviour every existing organisation already has.
   */
  call_tracking?: { mode: string; call_types: CallTypeOption[] } | null;
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
  resources?: Array<{ positions: string[]; quantity: number }>;
  flat_positions?: string[];
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
      return { position: p, required: true };
    }
    if (typeof p === 'object' && p !== null && 'position' in p) {
      const slot = p as { position: string; required?: boolean };
      return { position: slot.position, required: slot.required !== false };
    }
    return { position: String(p), required: true };
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

export interface ActiveChecklistRecord {
  shiftId: string;
  shiftDate: string;
  apparatusName: string;
  templateId: string;
  templateName: string;
  checkTiming: string;
  status: string;
  totalItems?: number;
  completedItems?: number;
  checkId?: string;
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
    } catch {
      return null;
    }
  },

  // Swap Requests
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
    data?: { position?: string }
  ): Promise<ShiftSignupResponse & { evoc_warnings?: EvocWarning[]; overtime_warnings?: string[] }> {
    const response = await api.post<
      ShiftSignupResponse & { evoc_warnings?: EvocWarning[]; overtime_warnings?: string[] }
    >(`/scheduling/shifts/${shiftId}/signup`, data ?? {});
    return response.data;
  },
  async withdrawSignup(shiftId: string): Promise<void> {
    await api.delete(`/scheduling/shifts/${shiftId}/signup`);
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

  // =====================================================================
  // Equipment Check Templates
  // =====================================================================

  async createEquipmentCheckTemplate(data: EquipmentCheckTemplateCreate): Promise<EquipmentCheckTemplate> {
    const response = await api.post<EquipmentCheckTemplate>('/equipment-checks/templates', data);
    return response.data;
  },
  async getEquipmentCheckTemplates(params?: {
    apparatus_id?: string;
    apparatus_type?: string;
    check_timing?: string;
  }): Promise<EquipmentCheckTemplate[]> {
    const response = await api.get<EquipmentCheckTemplate[]>('/equipment-checks/templates', { params });
    return asArray(response.data);
  },
  async getEquipmentCheckTemplate(templateId: string): Promise<EquipmentCheckTemplate> {
    const response = await api.get<EquipmentCheckTemplate>(`/equipment-checks/templates/${templateId}`);
    return response.data;
  },
  async updateEquipmentCheckTemplate(
    templateId: string,
    data: EquipmentCheckTemplateUpdate
  ): Promise<EquipmentCheckTemplate> {
    const response = await api.put<EquipmentCheckTemplate>(`/equipment-checks/templates/${templateId}`, data);
    return response.data;
  },
  async deleteEquipmentCheckTemplate(templateId: string): Promise<void> {
    await api.delete(`/equipment-checks/templates/${templateId}`);
  },
  async cloneEquipmentCheckTemplate(templateId: string, targetApparatusId: string): Promise<EquipmentCheckTemplate> {
    const response = await api.post<EquipmentCheckTemplate>(`/equipment-checks/templates/${templateId}/clone`, null, {
      params: { target_apparatus_id: targetApparatusId },
    });
    return response.data;
  },

  // --- Supply Officer: expiring items + lot swap ---
  async getSupplyExpiringItems(daysAhead = 30): Promise<SupplyOverview> {
    const response = await api.get<SupplyOverview>('/equipment-checks/supply/expiring-items', {
      params: { days_ahead: daysAhead },
    });
    return response.data;
  },
  async getApparatusInventory(apparatusId: string): Promise<ApparatusInventory> {
    const response = await api.get<ApparatusInventory>(`/equipment-checks/apparatus/${apparatusId}/inventory`);
    return response.data;
  },
  async reportItemUsed(templateItemId: string, note?: string, quantityUsed?: number): Promise<ItemRestockState> {
    const response = await api.post<ItemRestockState>(`/equipment-checks/items/${templateItemId}/used`, {
      // Create payload: a blank note is omitted rather than sent as "".
      note: note?.trim() || undefined,
      quantity_used: quantityUsed || undefined,
    });
    return response.data;
  },
  async getItemDeployedLots(templateItemId: string): Promise<ItemDeployedLots> {
    const response = await api.get<ItemDeployedLots>(`/equipment-checks/items/${templateItemId}/deployed-lots`);
    return response.data;
  },
  /**
   * Correct one lot aboard — count, lot number and date together.
   *
   * Update payload: `lotNumber` / `expirationDate` are omitted when not being
   * changed and sent as an explicit null to clear, so a corrected box cannot
   * silently keep the old expiration.
   */
  async updateDeployedLot(
    templateItemId: string,
    deployedLotId: string,
    changes: { quantity: number; lotNumber?: string | null; expirationDate?: string | null }
  ): Promise<ItemDeployedLots> {
    const body: Record<string, unknown> = { quantity: changes.quantity };
    if (changes.lotNumber !== undefined) body.lot_number = blankToNull(changes.lotNumber);
    if (changes.expirationDate !== undefined) body.expiration_date = blankToNull(changes.expirationDate);
    const response = await api.put<ItemDeployedLots>(
      `/equipment-checks/items/${templateItemId}/deployed-lots/${deployedLotId}`,
      body
    );
    return response.data;
  },
  async setItemQuantity(templateItemId: string, quantity: number): Promise<ItemRestockState> {
    const response = await api.put<ItemRestockState>(`/equipment-checks/items/${templateItemId}/quantity`, {
      quantity,
    });
    return response.data;
  },
  async clearItemRestock(templateItemId: string): Promise<ItemRestockState> {
    const response = await api.delete<ItemRestockState>(`/equipment-checks/items/${templateItemId}/used`);
    return response.data;
  },
  async getItemDeployments(inventoryItemId: string): Promise<ItemDeployment[]> {
    const response = await api.get<ItemDeployment[]>(`/equipment-checks/supply/item-deployments/${inventoryItemId}`);
    return response.data;
  },
  /**
   * `replaced` marks the swap a replacement: the expired units come off the
   * truck and the disposition records where they went. Omitting it tops the
   * position up and retires nothing.
   *
   * `deployedLotId` narrows that to one lot, which is what a position carrying
   * several boxes needs. A position whose units were never lot-tracked has no
   * id to send — one blob, one date — so the disposition stands alone.
   */
  async swapItemLot(
    templateItemId: string,
    inventoryLotId: string,
    quantity = 1,
    replaced?: { disposition: ExpiredStockDisposition; deployedLotId?: string | undefined }
  ): Promise<LotSwapResult> {
    const response = await api.post<LotSwapResult>(`/equipment-checks/items/${templateItemId}/swap`, {
      inventory_lot_id: inventoryLotId,
      quantity,
      ...(replaced
        ? {
            disposition: replaced.disposition,
            ...(replaced.deployedLotId ? { replaced_deployed_lot_id: replaced.deployedLotId } : {}),
          }
        : {}),
    });
    return response.data;
  },

  // --- Compartment CRUD ---
  async addCompartment(templateId: string, data: CheckTemplateCompartmentCreate): Promise<CheckTemplateCompartment> {
    const response = await api.post<CheckTemplateCompartment>(
      `/equipment-checks/templates/${templateId}/compartments`,
      data
    );
    return response.data;
  },
  async updateCompartment(
    compartmentId: string,
    data: CheckTemplateCompartmentUpdate
  ): Promise<CheckTemplateCompartment> {
    const response = await api.put<CheckTemplateCompartment>(`/equipment-checks/compartments/${compartmentId}`, data);
    return response.data;
  },
  async deleteCompartment(compartmentId: string): Promise<void> {
    await api.delete(`/equipment-checks/compartments/${compartmentId}`);
  },
  async reorderCompartments(templateId: string, orderedIds: string[]): Promise<void> {
    await api.put(`/equipment-checks/templates/${templateId}/compartments/reorder`, { ordered_ids: orderedIds });
  },

  // --- Item CRUD ---
  async addCheckItem(compartmentId: string, data: CheckTemplateItemCreate): Promise<CheckTemplateItem> {
    const response = await api.post<CheckTemplateItem>(`/equipment-checks/compartments/${compartmentId}/items`, data);
    return response.data;
  },
  async addCheckItemsBulk(compartmentId: string, items: CheckTemplateItemCreate[], idempotencyKey: string) {
    const response = await api.post<import('../types/equipmentCheck').CheckTemplateItemBulkResult>(
      `/equipment-checks/compartments/${compartmentId}/items/bulk`,
      { items, idempotency_key: idempotencyKey }
    );
    return response.data;
  },
  async updateCheckItem(itemId: string, data: CheckTemplateItemUpdate): Promise<CheckTemplateItem> {
    const response = await api.put<CheckTemplateItem>(`/equipment-checks/items/${itemId}`, data);
    return response.data;
  },
  async deleteCheckItem(itemId: string): Promise<void> {
    await api.delete(`/equipment-checks/items/${itemId}`);
  },
  async reorderItems(compartmentId: string, orderedIds: string[]): Promise<void> {
    await api.put(`/equipment-checks/compartments/${compartmentId}/items/reorder`, { ordered_ids: orderedIds });
  },

  // --- Catalog linking ---
  async getInventoryMatches(templateId: string): Promise<InventoryMatchesResult> {
    const response = await api.get<InventoryMatchesResult>(
      `/equipment-checks/templates/${templateId}/inventory-matches`
    );
    return response.data;
  },
  async linkInventoryItems(templateId: string, links: Record<string, string | null>): Promise<InventoryLinkResult> {
    const response = await api.post<InventoryLinkResult>(`/equipment-checks/templates/${templateId}/inventory-links`, {
      links,
    });
    return response.data;
  },

  // =====================================================================
  // Shift Equipment Checks
  // =====================================================================

  async getShiftChecklists(shiftId: string): Promise<ShiftCheckSummary[]> {
    const response = await api.get<ShiftCheckSummary[]>(`/equipment-checks/shifts/${shiftId}/checklists`);
    return asArray(response.data);
  },
  async submitEquipmentCheck(shiftId: string, data: ShiftEquipmentCheckCreate): Promise<ShiftEquipmentCheckRecord> {
    const response = await api.post<ShiftEquipmentCheckRecord>(`/equipment-checks/shifts/${shiftId}/checks`, data);
    return response.data;
  },
  async submitStandaloneCheck(data: StandaloneEquipmentCheckCreate): Promise<ShiftEquipmentCheckRecord> {
    const response = await api.post<ShiftEquipmentCheckRecord>('/equipment-checks/checks', data);
    return response.data;
  },
  async getEquipmentCheck(checkId: string): Promise<ShiftEquipmentCheckRecord> {
    const response = await api.get<ShiftEquipmentCheckRecord>(`/equipment-checks/checks/${checkId}`);
    return response.data;
  },
  async uploadCheckItemPhotos(
    checkId: string,
    itemId: string,
    files: File[]
  ): Promise<{ photoUrls: string[]; count: number }> {
    const formData = new FormData();
    files.forEach((file) => formData.append('files', file));
    const response = await api.post<{ photo_urls: string[]; count: number }>(
      `/equipment-checks/checks/${checkId}/items/${itemId}/photos`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );
    return { photoUrls: response.data.photo_urls ?? [], count: response.data.count };
  },
  async getLastCheckResults(templateId: string, apparatusId?: string): Promise<Record<string, LastCheckItemResult>> {
    const response = await api.get<Record<string, LastCheckItemResult>>(
      `/equipment-checks/templates/${templateId}/last-results`,
      { params: apparatusId ? { apparatus_id: apparatusId } : undefined }
    );
    return response.data;
  },
  /** Keyed by compartment id — what each sealed container carried last count. */
  async getLastCheckSeals(templateId: string, apparatusId?: string): Promise<Record<string, LastSealRecord>> {
    const response = await api.get<Record<string, LastSealRecord>>(
      `/equipment-checks/templates/${templateId}/last-seals`,
      { params: apparatusId ? { apparatus_id: apparatusId } : undefined }
    );
    return response.data;
  },

  // --- My Checklists ---
  async getMyChecklists(): Promise<ActiveChecklistRecord[]> {
    const response = await api.get<ActiveChecklistRecord[]>('/equipment-checks/my-checklists');
    return asArray(response.data);
  },
  async getMyChecklistHistory(params?: {
    start_date?: string;
    end_date?: string;
    limit?: number;
    offset?: number;
  }): Promise<ShiftEquipmentCheckRecord[]> {
    const response = await api.get<ShiftEquipmentCheckRecord[]>('/equipment-checks/my-checklists/history', { params });
    return asArray(response.data);
  },

  // =====================================================================
  // Fleet Readiness / Check Log
  // =====================================================================

  async getFleetReadiness(params?: { strip_dates?: number; expiring_days?: number }): Promise<FleetReadinessResponse> {
    const response = await api.get<FleetReadinessResponse>('/equipment-checks/fleet', { params });
    return response.data;
  },

  /**
   * Expected-vs-actual check history.
   *
   * The server decides the scope from the caller's permissions — a member
   * without `equipment_check.view` gets only their own checks and no grid —
   * so there is no client-side flag to get wrong here.
   */
  async getCheckLog(params?: { dates?: number; apparatus_id?: string }): Promise<CheckLogResponse> {
    const response = await api.get<CheckLogResponse>('/equipment-checks/log', { params });
    return response.data;
  },

  // =====================================================================
  // Reports
  // =====================================================================

  async getEquipmentComplianceReport(params?: { date_from?: string; date_to?: string }): Promise<ComplianceReport> {
    const response = await api.get<ComplianceReport>('/equipment-checks/reports/compliance', { params });
    return response.data;
  },
  async getFailureLog(params?: {
    date_from?: string | undefined;
    date_to?: string | undefined;
    apparatus_id?: string | undefined;
    item_name?: string | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
  }): Promise<FailureLogResponse> {
    const response = await api.get<FailureLogResponse>('/equipment-checks/reports/failures', { params });
    return response.data;
  },
  async getItemTrends(params: {
    template_item_id: string;
    date_from?: string;
    date_to?: string;
    interval?: string;
  }): Promise<ItemTrendResponse> {
    const response = await api.get<ItemTrendResponse>('/equipment-checks/reports/item-trends', { params });
    return response.data;
  },
  getReportExportUrl(params: {
    report_type: string;
    date_from?: string;
    date_to?: string;
    apparatus_id?: string;
    template_item_id?: string;
  }): string {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value) searchParams.set(key, value);
    });
    return `/api/v1/equipment-checks/reports/export/csv?${searchParams.toString()}`;
  },
  getReportPdfExportUrl(params: {
    report_type: string;
    date_from?: string;
    date_to?: string;
    apparatus_id?: string;
    check_id?: string;
  }): string {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value) searchParams.set(key, value);
    });
    return `/api/v1/equipment-checks/reports/export/pdf?${searchParams.toString()}`;
  },

  async getTemplateChangelog(
    templateId: string,
    params?: { limit?: number; offset?: number }
  ): Promise<TemplateChangeLogResponse> {
    const response = await api.get<TemplateChangeLogResponse>(`/equipment-checks/templates/${templateId}/changelog`, {
      params,
    });
    return response.data;
  },

  getCsvSampleUrl(): string {
    return '/api/v1/equipment-checks/csv-sample';
  },
};
