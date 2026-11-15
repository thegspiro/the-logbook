/**
 * Leave settings and leave requests. Served under `/users/`, which the API
 * cache never stores: a request carries the member's own reason.
 */

import api from './apiClient';
import { expectArray } from '../utils/asArray';
import type {
  LeaveRequest,
  LeaveRequestCreate,
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

  async vote(id: string, vote: LeaveVote, note?: string): Promise<LeaveRequest> {
    const response = await api.post<LeaveRequest>(`/users/leave-requests/${id}/vote`, {
      vote,
      note: note?.trim() || undefined,
    });
    return response.data;
  },
};
