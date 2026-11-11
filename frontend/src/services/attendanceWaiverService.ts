/**
 * Session waiver requests (`/api/v1/training/waivers/requests`).
 *
 * Every path sits under `/training/waivers`, which `UNCACHEABLE_PREFIXES`
 * already excludes from the response cache: a request carries a reason that
 * may be medical, and its status changes under the viewer.
 */

import api from './apiClient';
import type { AttendanceWaiverStatus } from '../constants/enums';
import type {
  AttendanceWaiverEligibility,
  AttendanceWaiverPolicy,
  AttendanceWaiverRequest,
  AttendanceWaiverRequestPage,
  AttendanceWaiverSubmit,
} from '../types/attendanceWaiver';

const BASE = '/training/waivers/requests';

export const attendanceWaiverService = {
  async getPolicy(): Promise<AttendanceWaiverPolicy> {
    const response = await api.get<AttendanceWaiverPolicy>(`${BASE}/policy`);
    return response.data;
  },

  async savePolicy(policy: AttendanceWaiverPolicy): Promise<AttendanceWaiverPolicy> {
    const response = await api.put<AttendanceWaiverPolicy>(`${BASE}/policy`, policy);
    return response.data;
  },

  async getEligibility(eventId: string): Promise<AttendanceWaiverEligibility> {
    const response = await api.get<AttendanceWaiverEligibility>(`${BASE}/eligibility`, {
      params: { event_id: eventId },
    });
    return response.data;
  },

  async submit(data: AttendanceWaiverSubmit): Promise<AttendanceWaiverRequest> {
    const response = await api.post<AttendanceWaiverRequest>(BASE, data);
    return response.data;
  },

  async listMine(): Promise<AttendanceWaiverRequest[]> {
    const response = await api.get<AttendanceWaiverRequest[]>(`${BASE}/mine`);
    return response.data;
  },

  /** The requests the caller may decide or has decided. */
  async list(
    params: { status?: AttendanceWaiverStatus | undefined; skip?: number; limit?: number } = {}
  ): Promise<AttendanceWaiverRequestPage> {
    const response = await api.get<AttendanceWaiverRequestPage>(BASE, { params });
    return response.data;
  },

  async get(requestId: string): Promise<AttendanceWaiverRequest> {
    const response = await api.get<AttendanceWaiverRequest>(`${BASE}/${encodeURIComponent(requestId)}`);
    return response.data;
  },

  async withdraw(requestId: string): Promise<AttendanceWaiverRequest> {
    const response = await api.post<AttendanceWaiverRequest>(`${BASE}/${encodeURIComponent(requestId)}/withdraw`);
    return response.data;
  },

  async approve(requestId: string, note?: string): Promise<AttendanceWaiverRequest> {
    const response = await api.post<AttendanceWaiverRequest>(`${BASE}/${encodeURIComponent(requestId)}/approve`, {
      note,
    });
    return response.data;
  },

  async deny(requestId: string, note: string): Promise<AttendanceWaiverRequest> {
    const response = await api.post<AttendanceWaiverRequest>(`${BASE}/${encodeURIComponent(requestId)}/deny`, {
      note,
    });
    return response.data;
  },

  async override(requestId: string, note: string): Promise<AttendanceWaiverRequest> {
    const response = await api.post<AttendanceWaiverRequest>(`${BASE}/${encodeURIComponent(requestId)}/override`, {
      note,
    });
    return response.data;
  },
};
