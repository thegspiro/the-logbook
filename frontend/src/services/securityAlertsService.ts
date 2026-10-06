/**
 * Security alerts and export activity — the `/security/*` endpoints behind
 * the Security Alerts admin screen. Responses are snake_case, like the rest
 * of that router, and are never cached (`/security/` is in
 * `UNCACHEABLE_PREFIXES`).
 *
 * Kept in its own module rather than on `securityService` in
 * `adminServices.ts`: only the Security Alerts screen reads it, and the
 * shared service barrel is imported by nearly every page.
 */

import api from './apiClient';

export type SecurityThreatLevel = 'low' | 'medium' | 'high' | 'critical';

/** `open` is everything not yet resolved; `unacknowledged` is open and unclaimed. */
export type SecurityAlertState = 'open' | 'unacknowledged' | 'acknowledged' | 'resolved';

export interface SecurityAlertRecord {
  id: string;
  alert_type: string;
  threat_level: SecurityThreatLevel;
  timestamp: string | null;
  description: string;
  source_ip: string | null;
  user_id: string | null;
  details: Record<string, unknown>;
  acknowledged: boolean;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
}

export interface SecurityAlertCounts {
  open: number;
  unacknowledged: number;
  acknowledged: number;
  resolved: number;
}

export interface SecurityAlertList {
  alerts: SecurityAlertRecord[];
  total: number;
  counts: SecurityAlertCounts;
}

/** One completed export, as `SecurityMonitoringMiddleware` recorded it — never its content. */
export interface MonitoredExport {
  id: number;
  timestamp: string | null;
  user_id: string | null;
  username: string | null;
  ip_address: string | null;
  endpoint: string | null;
  method: string | null;
  bytes: number | null;
}

export const securityAlertsService = {
  async getAlerts(params?: {
    limit?: number;
    threat_level?: string;
    alert_type?: string;
    state?: SecurityAlertState;
  }): Promise<SecurityAlertList> {
    const response = await api.get<SecurityAlertList>('/security/alerts', { params });
    return response.data;
  },

  async acknowledgeAlert(alertId: string): Promise<{ status: string; alert_id: string }> {
    const response = await api.post<{ status: string; alert_id: string }>(
      `/security/alerts/${encodeURIComponent(alertId)}/acknowledge`
    );
    return response.data;
  },

  /** `note` is optional; a blank one is omitted, never sent as "". */
  async resolveAlert(alertId: string, note?: string): Promise<{ status: string; alert_id: string }> {
    const trimmed = note?.trim() || undefined;
    const response = await api.post<{ status: string; alert_id: string }>(
      `/security/alerts/${encodeURIComponent(alertId)}/resolve`,
      trimmed ? { note: trimmed } : {}
    );
    return response.data;
  },

  async getDownloadActivity(limit = 50): Promise<{ exports: MonitoredExport[] }> {
    const response = await api.get<{ exports: MonitoredExport[] }>('/security/download-activity', {
      params: { limit },
    });
    return response.data;
  },
};
