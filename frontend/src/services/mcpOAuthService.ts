/**
 * The Claude (MCP) OAuth server: registered clients, member connections and
 * the consent screen.
 *
 * A module of its own rather than more of `adminServices.ts`: two of its
 * three consumers are member-facing pages, and every call goes through the
 * shared axios instance (`apiClient`), so cookies and the CSRF header are the
 * app's own. Wire casing is snake_case — these endpoints carry no alias
 * generator (CLAUDE.md pitfall 5).
 */

import api from './apiClient';
import { asArray } from '../utils/asArray';

export interface McpOAuthScope {
  scope: string;
  description: string;
}

export interface McpOAuthStatus {
  server_enabled: boolean;
  department_enabled: boolean;
  issuer: string | null;
  resource: string | null;
  authorization_endpoint: string | null;
  token_endpoint: string | null;
  scopes: McpOAuthScope[];
}

export interface McpOAuthClient {
  id: string;
  client_id: string;
  name: string;
  redirect_uris: string[];
  confidential: boolean;
  created_at: string | null;
  created_by: string | null;
  revoked_at: string | null;
  is_active: boolean;
}

export interface McpOAuthClientCreateResult {
  client: McpOAuthClient;
  /** Present only for a confidential client, and only in this response. */
  client_secret: string | null;
}

export interface McpOAuthConnection {
  id: string;
  client_name: string;
  client_id: string;
  scopes: string[];
  created_at: string | null;
  last_used_at: string | null;
  expires_at: string | null;
  member_name?: string | null | undefined;
}

export interface McpOAuthConsentScope {
  scope: string;
  description: string;
  required: boolean;
  /** How many tools the scope would reach for this member right now. */
  tool_count: number;
}

export interface McpOAuthConsentRequest {
  id: string;
  client: {
    name: string;
    client_id: string;
    redirect_uri: string;
    redirect_host: string;
  };
  department_allows: boolean;
  scopes: McpOAuthConsentScope[];
  expires_at: string | null;
}

export interface McpOAuthDecisionResult {
  redirect_to: string;
  approved: boolean;
}

/** Administration: needs integrations.manage to read, integrations.mcp_keys to change. */
export const mcpOAuthAdminService = {
  async getStatus(): Promise<McpOAuthStatus> {
    const response = await api.get<McpOAuthStatus>('/integrations/claude-mcp/oauth/status');
    return response.data;
  },

  async listClients(): Promise<McpOAuthClient[]> {
    const response = await api.get<{ clients: McpOAuthClient[] }>('/integrations/claude-mcp/oauth/clients');
    return asArray(response.data.clients);
  },

  async registerClient(
    name: string,
    redirectUris: string[],
    confidential: boolean
  ): Promise<McpOAuthClientCreateResult> {
    const response = await api.post<McpOAuthClientCreateResult>('/integrations/claude-mcp/oauth/clients', {
      name,
      redirect_uris: redirectUris,
      confidential,
    });
    return response.data;
  },

  async revokeClient(clientPk: string): Promise<{ connections_ended: number }> {
    const response = await api.delete<{ connections_ended: number }>(
      `/integrations/claude-mcp/oauth/clients/${encodeURIComponent(clientPk)}`
    );
    return response.data;
  },

  async listGrants(): Promise<McpOAuthConnection[]> {
    const response = await api.get<{ grants: McpOAuthConnection[] }>('/integrations/claude-mcp/oauth/grants');
    return asArray(response.data.grants);
  },

  async revokeGrant(grantId: string): Promise<void> {
    await api.delete(`/integrations/claude-mcp/oauth/grants/${encodeURIComponent(grantId)}`);
  },
};

/** A member's own side: open to any signed-in member. */
export const mcpConnectionsService = {
  async getConsentRequest(requestId: string): Promise<McpOAuthConsentRequest> {
    const response = await api.get<McpOAuthConsentRequest>(`/mcp-oauth/requests/${encodeURIComponent(requestId)}`);
    return response.data;
  },

  async decideConsentRequest(requestId: string, approve: boolean, scopes?: string[]): Promise<McpOAuthDecisionResult> {
    const response = await api.post<McpOAuthDecisionResult>(
      `/mcp-oauth/requests/${encodeURIComponent(requestId)}/decision`,
      scopes === undefined ? { approve } : { approve, scopes }
    );
    return response.data;
  },

  async listMyConnections(): Promise<McpOAuthConnection[]> {
    const response = await api.get<{ connections: McpOAuthConnection[] }>('/mcp-oauth/connections');
    return asArray(response.data.connections);
  },

  async revokeMyConnection(grantId: string): Promise<void> {
    await api.delete(`/mcp-oauth/connections/${encodeURIComponent(grantId)}`);
  },
};
