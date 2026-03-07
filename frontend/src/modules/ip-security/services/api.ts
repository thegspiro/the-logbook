/**
 * IP Security API Service
 *
 * Uses the global shared axios instance (withCredentials + CSRF already configured).
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

const BASE = '/ip-security';

export const ipSecurityService = {
  // User: request an IP exception
  async requestException(data: IPExceptionRequestCreate): Promise<IPException> {
    const res = await api.post<IPException>(`${BASE}/exceptions`, data);
    return res.data;
  },

  // User: get my exceptions
  async getMyExceptions(includeExpired = false): Promise<IPException[]> {
    const res = await api.get<IPException[]>(`${BASE}/exceptions/me`, {
      params: { include_expired: includeExpired },
    });
    return res.data;
  },

  // Admin: get pending exceptions
  async getPendingExceptions(limit = 50, offset = 0): Promise<IPException[]> {
    const res = await api.get<IPException[]>(`${BASE}/exceptions/pending`, {
      params: { limit, offset },
    });
    return res.data;
  },

  // Admin: get all exceptions
  async getAllExceptions(
    status?: string,
    limit = 50,
    offset = 0,
  ): Promise<IPExceptionListResponse> {
    const res = await api.get<IPExceptionListResponse>(`${BASE}/exceptions`, {
      params: { status: status || undefined, limit, offset },
    });
    return res.data;
  },

  // Admin: approve exception
  async approveException(id: string, data: IPExceptionApprove): Promise<IPException> {
    const res = await api.post<IPException>(`${BASE}/exceptions/${id}/approve`, data);
    return res.data;
  },

  // Admin: reject exception
  async rejectException(id: string, data: IPExceptionReject): Promise<IPException> {
    const res = await api.post<IPException>(`${BASE}/exceptions/${id}/reject`, data);
    return res.data;
  },

  // Admin: revoke exception
  async revokeException(id: string, data: IPExceptionRevoke): Promise<IPException> {
    const res = await api.post<IPException>(`${BASE}/exceptions/${id}/revoke`, data);
    return res.data;
  },

  // Admin: get audit log for an exception
  async getExceptionAuditLog(exceptionId: string): Promise<IPExceptionAuditLog[]> {
    const res = await api.get<IPExceptionAuditLog[]>(
      `${BASE}/exceptions/${exceptionId}/audit-log`,
    );
    return res.data;
  },

  // Admin: get blocked access attempts
  async getBlockedAttempts(
    limit = 50,
    offset = 0,
    countryCode?: string,
  ): Promise<BlockedAttemptsListResponse> {
    const res = await api.get<BlockedAttemptsListResponse>(`${BASE}/blocked-attempts`, {
      params: { limit, offset, country_code: countryCode || undefined },
    });
    return res.data;
  },

  // Admin: get blocked countries
  async getBlockedCountries(): Promise<CountryBlockRule[]> {
    const res = await api.get<CountryBlockRule[]>(`${BASE}/blocked-countries`);
    return res.data;
  },

  // Admin: add blocked country
  async addBlockedCountry(data: CountryBlockRuleCreate): Promise<CountryBlockRule> {
    const res = await api.post<CountryBlockRule>(`${BASE}/blocked-countries`, data);
    return res.data;
  },

  // Admin: remove blocked country
  async removeBlockedCountry(countryCode: string): Promise<void> {
    await api.delete(`${BASE}/blocked-countries/${countryCode}`);
  },
};
