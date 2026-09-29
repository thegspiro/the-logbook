/**
 * IP Security API Service
 *
 * Uses the global shared axios instance (withCredentials + CSRF already configured).
 *
 * The request schemas in backend/app/schemas/ip_security.py are snake_case with
 * no alias generator (only the responses are camelCase), so every request body
 * is mapped to snake_case here. Posting the camelCase types as-is 422s.
 */

import api from '../../../services/apiClient';
import type {
  BlockedAttemptsListResponse,
  CountryBlockRule,
  CountryBlockRuleCreate,
  IPException,
  IPExceptionApprove,
  IPExceptionAuditLog,
  IPExceptionListResponse,
  IPExceptionReject,
  IPExceptionRequestCreate,
  IPExceptionRevoke,
} from '../types';
import { asArray } from '../../../utils/asArray';

const BASE = '/ip-security';

export const ipSecurityService = {
  // User: request an IP exception
  async requestException(data: IPExceptionRequestCreate): Promise<IPException> {
    const res = await api.post<IPException>(`${BASE}/exceptions`, {
      ip_address: data.ipAddress,
      reason: data.reason,
      requested_duration_days: data.requestedDurationDays,
      use_case: data.useCase,
      ...(data.description !== undefined ? { description: data.description } : {}),
    });
    return res.data;
  },

  // User: get my exceptions
  async getMyExceptions(includeExpired = false): Promise<IPException[]> {
    const res = await api.get<IPException[]>(`${BASE}/exceptions/me`, {
      params: { include_expired: includeExpired },
    });
    return asArray(res.data);
  },

  // Admin: get pending exceptions
  async getPendingExceptions(limit = 50, offset = 0): Promise<IPException[]> {
    const res = await api.get<IPException[]>(`${BASE}/exceptions/pending`, {
      params: { limit, offset },
    });
    return asArray(res.data);
  },

  // Admin: get all exceptions
  async getAllExceptions(status?: string, limit = 50, offset = 0): Promise<IPExceptionListResponse> {
    const res = await api.get<IPExceptionListResponse>(`${BASE}/exceptions`, {
      params: { status: status || undefined, limit, offset },
    });
    return res.data;
  },

  // Admin: approve exception
  async approveException(id: string, data: IPExceptionApprove): Promise<IPException> {
    const res = await api.post<IPException>(`${BASE}/exceptions/${id}/approve`, {
      ...(data.approvedDurationDays !== undefined ? { approved_duration_days: data.approvedDurationDays } : {}),
      ...(data.approvalNotes !== undefined ? { approval_notes: data.approvalNotes } : {}),
    });
    return res.data;
  },

  // Admin: reject exception
  async rejectException(id: string, data: IPExceptionReject): Promise<IPException> {
    const res = await api.post<IPException>(`${BASE}/exceptions/${id}/reject`, {
      rejection_reason: data.rejectionReason,
    });
    return res.data;
  },

  // Admin: revoke exception
  async revokeException(id: string, data: IPExceptionRevoke): Promise<IPException> {
    const res = await api.post<IPException>(`${BASE}/exceptions/${id}/revoke`, {
      revoke_reason: data.revokeReason,
    });
    return res.data;
  },

  // Admin: get audit log for an exception
  async getExceptionAuditLog(exceptionId: string): Promise<IPExceptionAuditLog[]> {
    const res = await api.get<IPExceptionAuditLog[]>(`${BASE}/exceptions/${exceptionId}/audit-log`);
    return asArray(res.data);
  },

  // Admin: get blocked access attempts
  async getBlockedAttempts(limit = 50, offset = 0, countryCode?: string): Promise<BlockedAttemptsListResponse> {
    const res = await api.get<BlockedAttemptsListResponse>(`${BASE}/blocked-attempts`, {
      params: { limit, offset, country_code: countryCode || undefined },
    });
    return res.data;
  },

  // Admin: get blocked countries
  async getBlockedCountries(): Promise<CountryBlockRule[]> {
    const res = await api.get<CountryBlockRule[]>(`${BASE}/blocked-countries`);
    return asArray(res.data);
  },

  // Admin: add blocked country
  async addBlockedCountry(data: CountryBlockRuleCreate): Promise<CountryBlockRule> {
    const res = await api.post<CountryBlockRule>(`${BASE}/blocked-countries`, {
      country_code: data.countryCode,
      reason: data.reason,
      risk_level: data.riskLevel,
      ...(data.countryName !== undefined ? { country_name: data.countryName } : {}),
    });
    return res.data;
  },

  // Admin: remove blocked country
  async removeBlockedCountry(countryCode: string): Promise<void> {
    await api.delete(`${BASE}/blocked-countries/${countryCode}`);
  },
};
