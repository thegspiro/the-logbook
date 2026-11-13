/**
 * Session waiver requests (`/api/v1/training/waivers/requests`).
 *
 * Every path sits under `/training/waivers`, which `UNCACHEABLE_PREFIXES`
 * already excludes from the response cache: a request carries a reason that
 * may be medical, and its status changes under the viewer.
 */

import api from './apiClient';
import { asArray } from '../utils/asArray';
import { WaiverAttachmentMode, waiverAttachmentService } from './waiverAttachmentService';
import type { AttendanceWaiverStatus } from '../constants/enums';
import type {
  AttendanceWaiverAlternateOptions,
  AttendanceWaiverEligibility,
  AttendanceWaiverPolicy,
  AttendanceWaiverRequest,
  AttendanceWaiverRequestPage,
  AttendanceWaiverSubmit,
} from '../types/attendanceWaiver';

const BASE = '/training/waivers/requests';

// A body that is not the declared shape (a captive portal's HTML, an empty
// object) must not take a page down on `.map` or `.length`: the lists inside
// a request and a page are made arrays here, once, for every caller.
const normalizeRequest = (request: AttendanceWaiverRequest): AttendanceWaiverRequest => ({
  ...request,
  actions: asArray(request.actions),
  attachments: asArray(request.attachments ?? []),
  can_attach: request.can_attach === true,
});

const normalizePolicy = (policy: AttendanceWaiverPolicy): AttendanceWaiverPolicy => ({
  ...policy,
  categories: asArray(policy.categories),
  approver_position_ids: asArray(policy.approver_position_ids),
  cc_position_ids: asArray(policy.cc_position_ids ?? []),
  chief_alternate_user_id: policy.chief_alternate_user_id ?? null,
  attachment: policy.attachment ?? WaiverAttachmentMode.OFF,
  attachment_retention_days:
    typeof policy.attachment_retention_days === 'number' ? policy.attachment_retention_days : 365,
});

const normalizeEligibility = (answer: AttendanceWaiverEligibility): AttendanceWaiverEligibility => ({
  ...answer,
  categories: asArray(answer.categories),
  attachment: answer.attachment ?? WaiverAttachmentMode.OFF,
});

const normalizePage = (page: AttendanceWaiverRequestPage): AttendanceWaiverRequestPage => ({
  ...page,
  items: asArray(page.items).map(normalizeRequest),
  total: typeof page.total === 'number' ? page.total : 0,
});

export const attendanceWaiverService = {
  async getPolicy(): Promise<AttendanceWaiverPolicy> {
    const response = await api.get<AttendanceWaiverPolicy>(`${BASE}/policy`);
    return normalizePolicy(response.data);
  },

  async savePolicy(policy: AttendanceWaiverPolicy): Promise<AttendanceWaiverPolicy> {
    const response = await api.put<AttendanceWaiverPolicy>(`${BASE}/policy`, policy);
    return normalizePolicy(response.data);
  },

  /** Who may be named to decide the Chief's or President's own request (training.manage). */
  async getAlternateOptions(): Promise<AttendanceWaiverAlternateOptions> {
    const response = await api.get<AttendanceWaiverAlternateOptions>(`${BASE}/policy/alternate`);
    return {
      members: asArray(response.data.members),
      alternate: response.data.alternate ?? null,
    };
  },

  async getEligibility(eventId: string): Promise<AttendanceWaiverEligibility> {
    const response = await api.get<AttendanceWaiverEligibility>(`${BASE}/eligibility`, {
      params: { event_id: eventId },
    });
    return normalizeEligibility(response.data);
  },

  async submit(data: AttendanceWaiverSubmit): Promise<AttendanceWaiverRequest> {
    const response = await api.post<AttendanceWaiverRequest>(BASE, data);
    return normalizeRequest(response.data);
  },

  /** Ask to be excused with documents: the request and its files are saved together or not at all. */
  async submitWithAttachments(data: AttendanceWaiverSubmit, files: readonly File[]): Promise<AttendanceWaiverRequest> {
    return normalizeRequest(await waiverAttachmentService.submitWithAttachments<AttendanceWaiverRequest>(data, files));
  },

  /** File more documents with the caller's own pending request. */
  async addAttachments(requestId: string, files: readonly File[]): Promise<AttendanceWaiverRequest> {
    return normalizeRequest(await waiverAttachmentService.addAttachments<AttendanceWaiverRequest>(requestId, files));
  },

  async listMine(): Promise<AttendanceWaiverRequest[]> {
    const response = await api.get<AttendanceWaiverRequest[]>(`${BASE}/mine`);
    return asArray(response.data).map(normalizeRequest);
  },

  /** The requests the caller may decide or has decided. */
  async list(
    params: { status?: AttendanceWaiverStatus | undefined; skip?: number; limit?: number } = {}
  ): Promise<AttendanceWaiverRequestPage> {
    const response = await api.get<AttendanceWaiverRequestPage>(BASE, { params });
    return normalizePage(response.data);
  },

  async get(requestId: string): Promise<AttendanceWaiverRequest> {
    const response = await api.get<AttendanceWaiverRequest>(`${BASE}/${encodeURIComponent(requestId)}`);
    return normalizeRequest(response.data);
  },

  async withdraw(requestId: string): Promise<AttendanceWaiverRequest> {
    const response = await api.post<AttendanceWaiverRequest>(`${BASE}/${encodeURIComponent(requestId)}/withdraw`);
    return normalizeRequest(response.data);
  },

  async approve(requestId: string, note?: string): Promise<AttendanceWaiverRequest> {
    const response = await api.post<AttendanceWaiverRequest>(`${BASE}/${encodeURIComponent(requestId)}/approve`, {
      note,
    });
    return normalizeRequest(response.data);
  },

  async deny(requestId: string, note: string): Promise<AttendanceWaiverRequest> {
    const response = await api.post<AttendanceWaiverRequest>(`${BASE}/${encodeURIComponent(requestId)}/deny`, {
      note,
    });
    return normalizeRequest(response.data);
  },

  async override(requestId: string, note: string): Promise<AttendanceWaiverRequest> {
    const response = await api.post<AttendanceWaiverRequest>(`${BASE}/${encodeURIComponent(requestId)}/override`, {
      note,
    });
    return normalizeRequest(response.data);
  },
};
