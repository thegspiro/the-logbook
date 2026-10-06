/**
 * Integration health — the detail page's reads and its Retry Sync.
 *
 * Kept apart from `integrationsService` in `adminServices.ts`: only the
 * integration detail page reads it, and the shared service barrel is imported
 * by nearly every page. Responses are snake_case, like the rest of
 * `/integrations`.
 */

import api from './apiClient';

/** `unknown` = never run; `degraded` = the last run(s) failed; `failing` = 3+ in a row. */
export type IntegrationHealth = 'healthy' | 'degraded' | 'failing' | 'unknown';

/** `GET /integrations/{id}` with the health fields the list card does not show. */
export interface IntegrationDetail {
  id: string;
  organization_id: string;
  integration_type: string;
  name: string;
  description?: string | null;
  category?: string | null;
  status: 'available' | 'connected' | 'error' | 'coming_soon';
  config: Record<string, unknown>;
  enabled: boolean;
  contains_phi?: boolean;
  last_sync_at: string | null;
  last_success_at: string | null;
  /** Sanitized server-side: no URLs, tokens or email addresses. */
  last_error: string | null;
  last_error_at: string | null;
  consecutive_error_count: number;
  health: IntegrationHealth;
  /** True when Retry Sync re-runs a data sync; otherwise it re-checks the connection. */
  supports_sync: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface IntegrationSyncRun {
  id: string;
  operation: string;
  trigger: string;
  status: 'running' | 'success' | 'failure';
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  /** Integer counts only — never the records that moved. */
  summary: Record<string, number>;
  error_message: string | null;
  triggered_by: string | null;
}

export interface RetrySyncResult {
  success: boolean;
  message: string;
  integration: IntegrationDetail;
}

export const integrationHealthService = {
  async getIntegration(integrationId: string): Promise<IntegrationDetail> {
    const response = await api.get<IntegrationDetail>(`/integrations/${encodeURIComponent(integrationId)}`);
    return response.data;
  },

  async getSyncHistory(integrationId: string): Promise<{ runs: IntegrationSyncRun[] }> {
    const response = await api.get<{ runs: IntegrationSyncRun[] }>(
      `/integrations/${encodeURIComponent(integrationId)}/sync-history`
    );
    return response.data;
  },

  async retrySync(integrationId: string): Promise<RetrySyncResult> {
    const response = await api.post<RetrySyncResult>(`/integrations/${encodeURIComponent(integrationId)}/retry-sync`);
    return response.data;
  },
};
