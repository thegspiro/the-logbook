/**
 * Leave settings and leave requests. Served under `/users/`, which the API
 * cache never stores: a request carries the member's own reason.
 */

import api from './apiClient';
import { expectArray } from '../utils/asArray';
import type {
  LeaveEndedEarly,
  LeaveRequest,
  LeaveRequestCreate,
  LeaveRequestSummary,
  LeaveSettings,
  LeaveSettingsResponse,
  LeaveVote,
} from '../types/leaveRequest';

export const leaveRequestService = {
  async getSettings(): Promise<LeaveSettingsResponse> {
    const response = await api.get<LeaveSettingsResponse>('/users/leaves-of-absence/settings');
    return response.data;
  },

  async updateSettings(settings: LeaveSettings): Promise<LeaveSettingsResponse> {
    const response = await api.put<LeaveSettingsResponse>('/users/leaves-of-absence/settings', settings);
    return response.data;
  },

  async getConfig(): Promise<{ requests_enabled: boolean }> {
    const response = await api.get<{ requests_enabled: boolean }>('/users/leave-requests/config');
    return response.data;
  },

  async create(data: LeaveRequestCreate): Promise<LeaveRequest> {
    const response = await api.post<LeaveRequest>('/users/leave-requests', data);
    return response.data;
  },

  async listMine(): Promise<LeaveRequest[]> {
    const response = await api.get<LeaveRequest[]>('/users/leave-requests/me');
    return expectArray(response.data, 'leave requests');
  },

  async listToDecide(includeClosed = false): Promise<LeaveRequest[]> {
    const response = await api.get<LeaveRequest[]>('/users/leave-requests', {
      params: { include_closed: includeClosed },
    });
    // An empty list here is a claim ("nothing to decide"), not a degraded view.
    return expectArray(response.data, 'leave requests');
  },

  async withdraw(id: string): Promise<LeaveRequest> {
    const response = await api.post<LeaveRequest>(`/users/leave-requests/${id}/withdraw`);
    return response.data;
  },

  /** End the caller's own leave in progress; the day before `firstDayBack` is its last. */
  async endLeaveEarly(leaveId: string, firstDayBack: string): Promise<LeaveEndedEarly> {
    const response = await api.post<LeaveEndedEarly>(`/users/leave-requests/my-leaves/${leaveId}/end-early`, {
      first_day_back: firstDayBack,
    });
    return response.data;
  },

  async getSummary(): Promise<LeaveRequestSummary> {
    const response = await api.get<LeaveRequestSummary>('/users/leave-requests/summary');
    return response.data;
  },

  async askQuestion(id: string, text: string): Promise<LeaveRequest> {
    const response = await api.post<LeaveRequest>(`/users/leave-requests/${id}/question`, { text });
    return response.data;
  },

  async answer(id: string, text: string): Promise<LeaveRequest> {
    const response = await api.post<LeaveRequest>(`/users/leave-requests/${id}/answer`, { text });
    return response.data;
  },

  async proposeChanges(id: string, startDate: string, endDate: string | null, note?: string): Promise<LeaveRequest> {
    const response = await api.post<LeaveRequest>(`/users/leave-requests/${id}/changes`, {
      start_date: startDate,
      end_date: endDate,
      note: note?.trim() || undefined,
    });
    return response.data;
  },

  async respondToChanges(id: string, accept: boolean): Promise<LeaveRequest> {
    const response = await api.post<LeaveRequest>(`/users/leave-requests/${id}/changes/respond`, { accept });
    return response.data;
  },

  async vote(id: string, vote: LeaveVote, note?: string): Promise<LeaveRequest> {
    const response = await api.post<LeaveRequest>(`/users/leave-requests/${id}/vote`, {
      vote,
      note: note?.trim() || undefined,
    });
    return response.data;
  },
};
