/**
 * meetingsServices — extracted from services/api.ts
 */

import api from './apiClient';
import type { MeetingRecord, MeetingAttendee, MeetingActionItem, MeetingsSummary } from './documentsService';
import { asArray } from '../utils/asArray';

/**
 * One member's row of `GET /meetings/attendance/dashboard` (snake_case, as
 * the endpoint returns a plain dict). Every figure is the backend's — the
 * same calculation the ballot eligibility check uses — so the screen shows
 * these values and never recomputes them.
 */
export interface AttendanceDashboardMember {
  user_id: string;
  name: string;
  membership_tier: string;
  tier_name: string;
  hire_date: string | null;
  attendance_pct: number;
  meetings_attended: number;
  meetings_waived: number;
  meetings_on_leave: number;
  meetings_absent: number;
  total_meetings: number;
  eligible_meetings: number;
  voting_eligible: boolean;
  voting_blocked_reason: string | null;
}

export interface AttendanceDashboard {
  generated_at: string;
  period_months: number;
  meeting_type_filter: string | null;
  total_meetings_in_period: number;
  members: AttendanceDashboardMember[];
  summary: {
    total_members: number;
    avg_attendance_pct: number;
    voting_eligible_count: number;
    voting_blocked_by_attendance: number;
  };
}

export const meetingsService = {
  async getMeetings(params?: {
    meeting_type?: string;
    status?: string;
    search?: string;
    from_date?: string;
    skip?: number;
    limit?: number;
  }): Promise<{ meetings: MeetingRecord[]; total: number; skip: number; limit: number }> {
    const response = await api.get<{ meetings: MeetingRecord[]; total: number; skip: number; limit: number }>(
      '/meetings',
      { params }
    );
    return response.data;
  },

  async createMeeting(data: Record<string, unknown>): Promise<MeetingRecord> {
    const response = await api.post<MeetingRecord>('/meetings', data);
    return response.data;
  },

  async getMeeting(meetingId: string): Promise<MeetingRecord> {
    const response = await api.get<MeetingRecord>(`/meetings/${meetingId}`);
    return response.data;
  },

  async updateMeeting(meetingId: string, data: Record<string, unknown>): Promise<MeetingRecord> {
    const response = await api.patch<MeetingRecord>(`/meetings/${meetingId}`, data);
    return response.data;
  },

  async deleteMeeting(meetingId: string): Promise<void> {
    await api.delete(`/meetings/${meetingId}`);
  },

  async approveMeeting(meetingId: string): Promise<MeetingRecord> {
    const response = await api.post<MeetingRecord>(`/meetings/${meetingId}/approve`);
    return response.data;
  },

  async addAttendee(
    meetingId: string,
    data: { user_id: string; present?: boolean; excused?: boolean }
  ): Promise<MeetingAttendee> {
    const response = await api.post<MeetingAttendee>(`/meetings/${meetingId}/attendees`, data);
    return response.data;
  },

  async removeAttendee(meetingId: string, attendeeId: string): Promise<void> {
    await api.delete(`/meetings/${meetingId}/attendees/${attendeeId}`);
  },

  async createActionItem(meetingId: string, data: Record<string, unknown>): Promise<MeetingActionItem> {
    const response = await api.post<MeetingActionItem>(`/meetings/${meetingId}/action-items`, data);
    return response.data;
  },

  async updateActionItem(itemId: string, data: Record<string, unknown>): Promise<MeetingActionItem> {
    const response = await api.patch<MeetingActionItem>(`/meetings/action-items/${itemId}`, data);
    return response.data;
  },

  async deleteActionItem(itemId: string): Promise<void> {
    await api.delete(`/meetings/action-items/${itemId}`);
  },

  async getSummary(): Promise<MeetingsSummary> {
    const response = await api.get<MeetingsSummary>('/meetings/stats/summary');
    return response.data;
  },

  async getOpenActionItems(params?: { assigned_to?: string }): Promise<MeetingActionItem[]> {
    const response = await api.get<MeetingActionItem[]>('/meetings/action-items/open', { params });
    return asArray(response.data);
  },

  async getAttendanceDashboard(params?: {
    period_months?: number;
    meeting_type?: string;
  }): Promise<AttendanceDashboard> {
    const response = await api.get<AttendanceDashboard>('/meetings/attendance/dashboard', { params });
    return { ...response.data, members: asArray(response.data.members) };
  },

  async grantAttendanceWaiver(
    meetingId: string,
    data: { user_id: string; reason: string }
  ): Promise<Record<string, unknown>> {
    const response = await api.post<Record<string, unknown>>(`/meetings/${meetingId}/attendance-waiver`, data);
    return response.data;
  },

  async getAttendanceWaivers(meetingId: string): Promise<Array<Record<string, unknown>>> {
    const response = await api.get<Array<Record<string, unknown>>>(`/meetings/${meetingId}/attendance-waivers`);
    return response.data;
  },

  async createFromEvent(eventId: string): Promise<MeetingRecord> {
    const response = await api.post<MeetingRecord>(`/meetings/from-event/${eventId}`);
    return response.data;
  },
};

// Minutes service re-exported from the minutes module for backward compatibility.
// New code should import from '@/modules/minutes/services/api'.
export { minutesService } from '../modules/minutes/services/api';

// Scheduling service moved to modules/scheduling/services/api.ts

// ============================================
// Reports Service
// ============================================
