/**
 * Minutes Module — API Service
 *
 * Module-local axios instance with auth interceptors (CSRF, cookie auth,
 * 401 auto-refresh) per CLAUDE.md module conventions.
 */

import { createApiClient } from '../../../utils/createApiClient';
import type {
  MeetingMinutes,
  Motion,
  MotionCreate,
  ActionItem,
  ActionItemCreate,
  MinutesStats,
  MinutesSearchResult,
} from '../types/minutes';

const api = createApiClient();

export const minutesService = {
  // ── Minutes CRUD ──

  async getMinutes(minutesId: string): Promise<MeetingMinutes> {
    const response = await api.get<MeetingMinutes>(`/minutes-records/${minutesId}`);
    return response.data;
  },

  async updateMinutes(minutesId: string, data: Record<string, unknown>): Promise<MeetingMinutes> {
    const response = await api.put<MeetingMinutes>(`/minutes-records/${minutesId}`, data);
    return response.data;
  },

  async deleteMinutes(minutesId: string): Promise<void> {
    await api.delete(`/minutes-records/${minutesId}`);
  },

  // ── Approval Workflow ──

  async submitForApproval(minutesId: string): Promise<MeetingMinutes> {
    const response = await api.post<MeetingMinutes>(`/minutes-records/${minutesId}/submit`);
    return response.data;
  },

  async approve(minutesId: string): Promise<MeetingMinutes> {
    const response = await api.post<MeetingMinutes>(`/minutes-records/${minutesId}/approve`);
    return response.data;
  },

  async reject(minutesId: string, reason: string): Promise<MeetingMinutes> {
    const response = await api.post<MeetingMinutes>(`/minutes-records/${minutesId}/reject`, { reason });
    return response.data;
  },

  // ── Publishing ──

  async publishMinutes(minutesId: string): Promise<void> {
    await api.post(`/minutes-records/${minutesId}/publish`);
  },

  // ── Motions ──

  async addMotion(minutesId: string, data: MotionCreate): Promise<Motion> {
    const response = await api.post<Motion>(`/minutes-records/${minutesId}/motions`, data);
    return response.data;
  },

  async deleteMotion(minutesId: string, motionId: string): Promise<void> {
    await api.delete(`/minutes-records/${minutesId}/motions/${motionId}`);
  },

  // ── Action Items ──

  async addActionItem(minutesId: string, data: ActionItemCreate): Promise<ActionItem> {
    const response = await api.post<ActionItem>(`/minutes-records/${minutesId}/action-items`, data);
    return response.data;
  },

  async updateActionItem(minutesId: string, itemId: string, data: Record<string, unknown>): Promise<ActionItem> {
    const response = await api.put<ActionItem>(`/minutes-records/${minutesId}/action-items/${itemId}`, data);
    return response.data;
  },

  async deleteActionItem(minutesId: string, itemId: string): Promise<void> {
    await api.delete(`/minutes-records/${minutesId}/action-items/${itemId}`);
  },

  // ── Cross-module Bridge ──

  async createFromMeeting(meetingId: string): Promise<MeetingMinutes> {
    const response = await api.post<MeetingMinutes>(`/minutes-records/from-meeting/${meetingId}`);
    return response.data;
  },

  // ── Stats & Search ──

  async getStats(): Promise<MinutesStats> {
    const response = await api.get<MinutesStats>('/minutes-records/stats');
    return response.data;
  },

  async search(query: string, limit = 20): Promise<MinutesSearchResult[]> {
    const response = await api.get<MinutesSearchResult[]>('/minutes-records/search', { params: { q: query, limit } });
    return response.data;
  },
};
