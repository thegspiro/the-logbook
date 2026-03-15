/**
 * Scheduling API Service
 *
 * Handles all API calls for the Scheduling module.
 */

import { createApiClient } from '../../../utils/createApiClient';
import type {
  Assignment,
  ShiftCall,
  SwapRequest as SchedulingSwapRequest,
  TimeOffRequest as SchedulingTimeOffRequest,
  ShiftPattern as SchedulingShiftPattern,
} from '../../../types/scheduling';
import type {
  ShiftCreate,
  ShiftUpdate,
  AttendanceCreate,
  AttendanceUpdate,
  ShiftCallCreate,
  ShiftCallUpdate,
  AssignmentCreate,
  AssignmentUpdate,
  SwapRequestCreate,
  SwapRequestReview,
  SwapRequestFilters,
  TimeOffCreate,
  TimeOffReview,
  TimeOffFilters,
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
  CoverageReport,
  CallVolumeReport,
  AvailabilityRecord,
  ShiftSignupResponse,
} from '../types';
import type {
  EquipmentCheckTemplate,
  ShiftEquipmentCheckRecord,
  ShiftCheckSummary,
  CheckTemplateCompartment,
  CheckTemplateItem,
  CheckItemHistory,
} from '../types/equipmentCheck';

declare module 'axios' {
  export interface InternalAxiosRequestConfig {
    _retry?: boolean;
  }
}

// ============================================
// Types
// ============================================

export interface ShiftRecord {
  id: string;
  organization_id: string;
  shift_date: string;
  start_time: string;
  end_time?: string;
  apparatus_id?: string;
  apparatus_name?: string;
  apparatus_unit_number?: string;
  positions?: string[] | null;
  apparatus_positions?: string[] | null;
  min_staffing?: number | null;
  station_id?: string;
  shift_officer_id?: string;
  shift_officer_name?: string;
  color?: string | null;
  notes?: string;
  activities?: unknown;
  attendee_count: number;
  created_at: string;
  updated_at: string;
  created_by?: string;
  attendees?: ShiftAttendanceRecord[];
}

export interface ShiftAttendanceRecord {
  id: string;
  shift_id: string;
  user_id: string;
  user_name?: string;
  checked_in_at?: string;
  checked_out_at?: string;
  duration_minutes?: number;
  created_at: string;
}

export interface SchedulingSummary {
  total_shifts: number;
  shifts_this_week: number;
  shifts_this_month: number;
  total_hours_this_month: number;
}

export interface ShiftTemplateRecord {
  id: string;
  name: string;
  start_time_of_day: string;
  end_time_of_day: string;
  duration_hours: number;
  color?: string;
  positions?: string[];
  min_staffing: number;
  category?: string;
  apparatus_type?: string;
  is_default: boolean;
  is_active: boolean;
}

export interface BasicApparatusRecord {
  id: string;
  unit_number: string;
  name: string;
  apparatus_type: string;
  min_staffing?: number;
  positions?: string[];
  is_active: boolean;
}

export interface ApparatusOption {
  id?: string;
  name: string;
  unit_number?: string;
  apparatus_type: string;
  source: 'apparatus' | 'basic' | 'default';
  positions?: string[];
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
  async getShifts(params?: { start_date?: string; end_date?: string; skip?: number; limit?: number }): Promise<{ shifts: ShiftRecord[]; total: number; skip: number; limit: number }> {
    const response = await api.get<{ shifts: ShiftRecord[]; total: number; skip: number; limit: number }>('/scheduling/shifts', { params });
    return response.data;
  },

  async createShift(data: ShiftCreate): Promise<ShiftRecord> {
    const response = await api.post<ShiftRecord>('/scheduling/shifts', data);
    return response.data;
  },

  async getShift(shiftId: string): Promise<ShiftRecord> {
    const response = await api.get<ShiftRecord>(`/scheduling/shifts/${shiftId}`);
    return response.data;
  },

  async updateShift(shiftId: string, data: ShiftUpdate): Promise<ShiftRecord> {
    const response = await api.patch<ShiftRecord>(`/scheduling/shifts/${shiftId}`, data);
    return response.data;
  },

  async deleteShift(shiftId: string): Promise<void> {
    await api.delete(`/scheduling/shifts/${shiftId}`);
  },

  async addAttendance(shiftId: string, data: AttendanceCreate): Promise<ShiftAttendanceRecord> {
    const response = await api.post<ShiftAttendanceRecord>(`/scheduling/shifts/${shiftId}/attendance`, data);
    return response.data;
  },

  async getWeekCalendar(weekStart?: string): Promise<ShiftRecord[]> {
    const params: Record<string, string> = {};
    if (weekStart) params.week_start = weekStart;
    const response = await api.get<ShiftRecord[]>('/scheduling/calendar/week', { params });
    return response.data;
  },

  async getMonthCalendar(year?: number, month?: number): Promise<ShiftRecord[]> {
    const params: Record<string, number> = {};
    if (year) params.year = year;
    if (month) params.month = month;
    const response = await api.get<ShiftRecord[]>('/scheduling/calendar/month', { params });
    return response.data;
  },

  async getSummary(): Promise<SchedulingSummary> {
    const response = await api.get<SchedulingSummary>('/scheduling/summary');
    return response.data;
  },

  async getMyShifts(params?: { start_date?: string; end_date?: string; skip?: number; limit?: number }): Promise<{ shifts: ShiftRecord[]; total: number }> {
    const response = await api.get<{ shifts: ShiftRecord[]; total: number }>('/scheduling/my-shifts', { params });
    return response.data;
  },

  async getMyAssignments(): Promise<Assignment[]> {
    const response = await api.get<Assignment[]>('/scheduling/my-assignments');
    // Backend returns assignment_status; provide status alias for convenience
    return (response.data ?? []).map((a) => ({
      ...a,
      status: a.assignment_status ?? a.status,
    }));
  },

  // Shift Calls
  async getShiftCalls(shiftId: string): Promise<ShiftCall[]> {
    const response = await api.get<ShiftCall[]>(`/scheduling/shifts/${shiftId}/calls`);
    return response.data;
  },
  async getCall(callId: string): Promise<ShiftCall> {
    const response = await api.get<ShiftCall>(`/scheduling/calls/${callId}`);
    return response.data;
  },
  async createCall(shiftId: string, data: ShiftCallCreate): Promise<ShiftCall> {
    const response = await api.post<ShiftCall>(`/scheduling/shifts/${shiftId}/calls`, data);
    return response.data;
  },
  async updateCall(callId: string, data: ShiftCallUpdate): Promise<ShiftCall> {
    const response = await api.patch<ShiftCall>(`/scheduling/calls/${callId}`, data);
    return response.data;
  },
  async deleteCall(callId: string): Promise<void> {
    await api.delete(`/scheduling/calls/${callId}`);
  },

  // Shift Assignments
  async getShiftAssignments(shiftId: string): Promise<Assignment[]> {
    const response = await api.get<Assignment[]>(`/scheduling/shifts/${shiftId}/assignments`);
    // Normalize assignment_status → status for consistency
    return (response.data ?? []).map((a) => ({
      ...a,
      status: a.assignment_status ?? a.status ?? 'assigned',
    }));
  },
  async createAssignment(shiftId: string, data: AssignmentCreate): Promise<Assignment> {
    const response = await api.post<Assignment>(`/scheduling/shifts/${shiftId}/assignments`, data);
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

  // Swap Requests
  async getSwapRequests(params?: SwapRequestFilters): Promise<SchedulingSwapRequest[]> {
    const response = await api.get<SchedulingSwapRequest[]>('/scheduling/swap-requests', { params });
    return response.data;
  },
  async getSwapRequest(requestId: string): Promise<SchedulingSwapRequest> {
    const response = await api.get<SchedulingSwapRequest>(`/scheduling/swap-requests/${requestId}`);
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
  async getTimeOffRequests(params?: TimeOffFilters): Promise<SchedulingTimeOffRequest[]> {
    const response = await api.get<SchedulingTimeOffRequest[]>('/scheduling/time-off', { params });
    return response.data;
  },
  async getTimeOff(requestId: string): Promise<SchedulingTimeOffRequest> {
    const response = await api.get<SchedulingTimeOffRequest>(`/scheduling/time-off/${requestId}`);
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
    return response.data;
  },
  async updateAttendance(attendanceId: string, data: AttendanceUpdate): Promise<ShiftAttendanceRecord> {
    const response = await api.patch<ShiftAttendanceRecord>(`/scheduling/attendance/${attendanceId}`, data);
    return response.data;
  },
  async deleteAttendance(attendanceId: string): Promise<void> {
    await api.delete(`/scheduling/attendance/${attendanceId}`);
  },

  // Templates
  async getTemplates(params?: { active_only?: boolean }): Promise<ShiftTemplateRecord[]> {
    const response = await api.get<ShiftTemplateRecord[]>('/scheduling/templates', { params });
    return response.data;
  },
  async getTemplate(templateId: string): Promise<ShiftTemplateRecord> {
    const response = await api.get<ShiftTemplateRecord>(`/scheduling/templates/${templateId}`);
    return response.data;
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
    return response.data;
  },
  async getPattern(patternId: string): Promise<SchedulingShiftPattern> {
    const response = await api.get<SchedulingShiftPattern>(`/scheduling/patterns/${patternId}`);
    return response.data;
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
  async getCoverageReport(params?: ReportFilters): Promise<CoverageReport> {
    const response = await api.get<CoverageReport>('/scheduling/reports/coverage', { params });
    return response.data;
  },
  async getCallVolumeReport(params?: ReportFilters): Promise<CallVolumeReport> {
    const response = await api.get<CallVolumeReport>('/scheduling/reports/call-volume', { params });
    return response.data;
  },
  async getAvailability(params?: AvailabilityFilters): Promise<AvailabilityRecord[]> {
    const response = await api.get<AvailabilityRecord[]>('/scheduling/availability', { params });
    return response.data;
  },

  // --- Basic Apparatus (lightweight, for departments without full Apparatus module) ---
  async getBasicApparatus(params?: { is_active?: boolean }): Promise<BasicApparatusRecord[]> {
    const response = await api.get<BasicApparatusRecord[]>('/scheduling/apparatus', { params });
    return response.data;
  },
  async createBasicApparatus(data: BasicApparatusCreate): Promise<BasicApparatusRecord> {
    const response = await api.post<BasicApparatusRecord>('/scheduling/apparatus', data);
    return response.data;
  },
  async updateBasicApparatus(apparatusId: string, data: BasicApparatusUpdate): Promise<BasicApparatusRecord> {
    const response = await api.patch<BasicApparatusRecord>(`/scheduling/apparatus/${apparatusId}`, data);
    return response.data;
  },
  async deleteBasicApparatus(apparatusId: string): Promise<void> {
    await api.delete(`/scheduling/apparatus/${apparatusId}`);
  },

  // --- Apparatus Options (unified vehicle picker for templates) ---
  async getApparatusOptions(): Promise<ApparatusOptionsResponse> {
    const response = await api.get<ApparatusOptionsResponse>('/scheduling/apparatus-options');
    return response.data;
  },

  // --- Shift Signup (member self-service) ---
  async signupForShift(shiftId: string, data: { position: string }): Promise<ShiftSignupResponse> {
    const response = await api.post<ShiftSignupResponse>(`/scheduling/shifts/${shiftId}/signup`, data);
    return response.data;
  },
  async withdrawSignup(shiftId: string): Promise<void> {
    await api.delete(`/scheduling/shifts/${shiftId}/signup`);
  },

  // --- Open Shifts ---
  async getOpenShifts(params?: { start_date?: string | undefined; end_date?: string; apparatus_id?: string }): Promise<ShiftRecord[]> {
    const response = await api.get<ShiftRecord[]>('/scheduling/shifts/open', { params });
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
  async getEquipmentCheckTemplates(params?: { apparatus_id?: string; apparatus_type?: string; check_timing?: string }): Promise<EquipmentCheckTemplate[]> {
    const response = await api.get<EquipmentCheckTemplate[]>('/equipment-checks/templates', { params });
    return response.data;
  },
  async getEquipmentCheckTemplate(templateId: string): Promise<EquipmentCheckTemplate> {
    const response = await api.get<EquipmentCheckTemplate>(`/equipment-checks/templates/${templateId}`);
    return response.data;
  },
  async updateEquipmentCheckTemplate(templateId: string, data: EquipmentCheckTemplateUpdate): Promise<EquipmentCheckTemplate> {
    const response = await api.put<EquipmentCheckTemplate>(`/equipment-checks/templates/${templateId}`, data);
    return response.data;
  },
  async deleteEquipmentCheckTemplate(templateId: string): Promise<void> {
    await api.delete(`/equipment-checks/templates/${templateId}`);
  },
  async cloneEquipmentCheckTemplate(templateId: string, targetApparatusId: string): Promise<EquipmentCheckTemplate> {
    const response = await api.post<EquipmentCheckTemplate>(
      `/equipment-checks/templates/${templateId}/clone`,
      null,
      { params: { target_apparatus_id: targetApparatusId } },
    );
    return response.data;
  },

  // --- Compartment CRUD ---
  async addCompartment(templateId: string, data: CheckTemplateCompartmentCreate): Promise<CheckTemplateCompartment> {
    const response = await api.post<CheckTemplateCompartment>(`/equipment-checks/templates/${templateId}/compartments`, data);
    return response.data;
  },
  async updateCompartment(compartmentId: string, data: CheckTemplateCompartmentUpdate): Promise<CheckTemplateCompartment> {
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
  async updateCheckItem(itemId: string, data: CheckTemplateItemUpdate): Promise<CheckTemplateItem> {
    const response = await api.put<CheckTemplateItem>(`/equipment-checks/items/${itemId}`, data);
    return response.data;
  },
  async deleteCheckItem(itemId: string): Promise<void> {
    await api.delete(`/equipment-checks/items/${itemId}`);
  },

  // =====================================================================
  // Shift Equipment Checks
  // =====================================================================

  async getShiftChecklists(shiftId: string): Promise<ShiftCheckSummary[]> {
    const response = await api.get<ShiftCheckSummary[]>(`/equipment-checks/shifts/${shiftId}/checklists`);
    return response.data;
  },
  async submitEquipmentCheck(shiftId: string, data: ShiftEquipmentCheckCreate): Promise<ShiftEquipmentCheckRecord> {
    const response = await api.post<ShiftEquipmentCheckRecord>(`/equipment-checks/shifts/${shiftId}/checks`, data);
    return response.data;
  },
  async getShiftChecks(shiftId: string, checkTiming?: string): Promise<ShiftEquipmentCheckRecord[]> {
    const response = await api.get<ShiftEquipmentCheckRecord[]>(
      `/equipment-checks/shifts/${shiftId}/checks`,
      { params: checkTiming ? { check_timing: checkTiming } : undefined },
    );
    return response.data;
  },
  async getEquipmentCheck(checkId: string): Promise<ShiftEquipmentCheckRecord> {
    const response = await api.get<ShiftEquipmentCheckRecord>(`/equipment-checks/checks/${checkId}`);
    return response.data;
  },
  async getItemCheckHistory(itemId: string, limit?: number): Promise<CheckItemHistory[]> {
    const response = await api.get<CheckItemHistory[]>(
      `/equipment-checks/items/${itemId}/history`,
      { params: limit ? { limit } : undefined },
    );
    return response.data;
  },

  // --- My Checklists ---
  async getMyChecklists(): Promise<unknown[]> {
    const response = await api.get<unknown[]>('/equipment-checks/my-checklists');
    return response.data;
  },
  async getMyChecklistHistory(params?: { start_date?: string; end_date?: string; limit?: number; offset?: number }): Promise<ShiftEquipmentCheckRecord[]> {
    const response = await api.get<ShiftEquipmentCheckRecord[]>('/equipment-checks/my-checklists/history', { params });
    return response.data;
  },
};
