/**
 * Apparatus events API — templates, scheduling nights, and each night's crew.
 *
 * Every path sits under `/apparatus-events/`, which is in the API cache's
 * UNCACHEABLE_PREFIXES: a crew board names members, and must read fresh the
 * moment after someone takes a seat.
 */

import type { AxiosRequestConfig } from 'axios';
import api from './apiClient';
import type {
  ApparatusConflict,
  ApparatusEventTemplate,
  ApparatusEventTemplatePayload,
  AssignableMember,
  CalendarOutreachItem,
  CrewBoard,
  DriverCandidates,
  EditorOptions,
  NightPlanPayload,
  NightScope,
  NightSpec,
  NightSummary,
  ScheduleNightsPayload,
  ScheduleNightsResult,
} from '../types/apparatusEvent';

const BASE = '/apparatus-events';

export const apparatusEventService = {
  async listTemplates(): Promise<ApparatusEventTemplate[]> {
    const response = await api.get<ApparatusEventTemplate[]>(`${BASE}/templates`);
    return response.data;
  },

  async getEditorOptions(): Promise<EditorOptions> {
    const response = await api.get<EditorOptions>(`${BASE}/options`);
    return response.data;
  },

  async createTemplate(payload: ApparatusEventTemplatePayload): Promise<ApparatusEventTemplate> {
    const response = await api.post<ApparatusEventTemplate>(`${BASE}/templates`, payload);
    return response.data;
  },

  async updateTemplate(templateId: string, payload: ApparatusEventTemplatePayload): Promise<ApparatusEventTemplate> {
    const response = await api.put<ApparatusEventTemplate>(`${BASE}/templates/${templateId}`, payload);
    return response.data;
  },

  async archiveTemplate(templateId: string): Promise<void> {
    await api.delete(`${BASE}/templates/${templateId}`);
  },

  async checkConflicts(templateId: string, nights: NightSpec[]): Promise<ApparatusConflict[]> {
    const response = await api.post<{ conflicts: ApparatusConflict[] }>(`${BASE}/templates/${templateId}/conflicts`, {
      nights,
    });
    return response.data.conflicts;
  },

  async scheduleNights(templateId: string, payload: ScheduleNightsPayload): Promise<ScheduleNightsResult> {
    const response = await api.post<ScheduleNightsResult>(`${BASE}/templates/${templateId}/schedule`, payload);
    return response.data;
  },

  async listNights(scope: NightScope): Promise<NightSummary[]> {
    const response = await api.get<NightSummary[]>(`${BASE}/nights`, { params: { scope } });
    return response.data;
  },

  async getCalendar(start: string, end: string, config?: AxiosRequestConfig): Promise<CalendarOutreachItem[]> {
    const response = await api.get<CalendarOutreachItem[]>(`${BASE}/calendar`, {
      params: { start, end },
      ...config,
    });
    return response.data;
  },

  async getAssignableMembers(): Promise<AssignableMember[]> {
    const response = await api.get<AssignableMember[]>(`${BASE}/members`);
    return response.data;
  },

  async getCrewBoard(eventId: string): Promise<CrewBoard> {
    const response = await api.get<CrewBoard>(`${BASE}/events/${eventId}`);
    return response.data;
  },

  async claimSeat(eventId: string, seatId: string): Promise<CrewBoard> {
    const response = await api.post<CrewBoard>(`${BASE}/events/${eventId}/seats/${seatId}/claim`);
    return response.data;
  },

  async releaseSeat(eventId: string, seatId: string): Promise<CrewBoard> {
    const response = await api.post<CrewBoard>(`${BASE}/events/${eventId}/seats/${seatId}/release`);
    return response.data;
  },

  async assignSeat(eventId: string, seatId: string, userId: string | null): Promise<CrewBoard> {
    const response = await api.put<CrewBoard>(`${BASE}/events/${eventId}/seats/${seatId}/assignment`, {
      user_id: userId,
    });
    return response.data;
  },

  async getDriverCandidates(eventId: string, unitId: string): Promise<DriverCandidates> {
    const response = await api.get<DriverCandidates>(`${BASE}/events/${eventId}/units/${unitId}/driver-candidates`);
    return response.data;
  },

  async updateNightPlan(eventId: string, payload: NightPlanPayload): Promise<CrewBoard> {
    const response = await api.put<CrewBoard>(`${BASE}/events/${eventId}/plan`, payload);
    return response.data;
  },
};
