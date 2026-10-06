/**
 * Member sign-in for the Claude (MCP) integration: registered OAuth clients
 * and the department's live member connections.
 *
 * A member connects a client (the claude.ai connector, Claude Desktop,
 * Claude Code) by signing in and approving it; the connection then reaches
 * only what that member can see in The Logbook. This panel is where an IT
 * administrator registers those clients — there is no self-registration —
 * and can end any connection.
 *
 * Registering and revoking need `integrations.mcp_keys`, like the service
 * key; reading is open to anyone who can open the Integrations screen.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Check, Copy, Loader2, UserCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../stores/authStore';
import { mcpOAuthAdminService } from '../../services/mcpOAuthService';
import type {
  McpOAuthClient,
  McpOAuthClientCreateResult,
  McpOAuthConnection,
  McpOAuthStatus,
} from '../../services/mcpOAuthService';
import { getErrorMessage } from '../../utils/errorHandling';
import { formatDateTime } from '../../utils/dateFormatting';
import { useTimezone } from '../../hooks/useTimezone';
import { useConfirm } from '../../contexts/ConfirmContext';

interface McpOAuthPanelProps {
  /** Reports whether a request whose response must be rendered is in flight
   *  (a new client's secret is shown once), so the parent can hold the
   *  control that would unmount this panel. */
  onBusyChange?: ((busy: boolean) => void) | undefined;
}

const labelClass = 'form-label';

const CLAUDE_AI_CALLBACK = 'https://claude.ai/api/mcp/auth_callback';

export const McpOAuthPanel: React.FC<McpOAuthPanelProps> = ({ onBusyChange }) => {
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('integrations.mcp_keys');
  const tz = useTimezone();
  const { confirm } = useConfirm();

  const [status, setStatus] = useState<McpOAuthStatus | null>(null);
  const [clients, setClients] = useState<McpOAuthClient[]>([]);
  const [grants, setGrants] = useState<McpOAuthConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('claude.ai');
  const [redirectUris, setRedirectUris] = useState(CLAUDE_AI_CALLBACK);
  const [confidential, setConfidential] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [created, setCreated] = useState<McpOAuthClientCreateResult | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, c, g] = await Promise.all([
        mcpOAuthAdminService.getStatus(),
        mcpOAuthAdminService.listClients(),
        mcpOAuthAdminService.listGrants(),
      ]);
      setStatus(s);
      setClients(c);
      setGrants(g);
      setLoadError(null);
    } catch (err: unknown) {
      setLoadError(getErrorMessage(err, 'Failed to load member sign-in settings'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    onBusyChange?.(registering);
    return () => onBusyChange?.(false);
  }, [registering, onBusyChange]);

  const copy = async (what: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
    } catch {
      toast.error('Copy failed — select the text and copy it by hand');
    }
  };

  const handleRegister = async () => {
    const uris = redirectUris
      .split(/\s+/)
      .map((u) => u.trim())
      .filter((u) => u.length > 0);
    if (!name.trim() || uris.length === 0) {
      toast.error('Give the client a name and at least one redirect URI');
      return;
    }
    setRegistering(true);
    try {
      const result = await mcpOAuthAdminService.registerClient(name.trim(), uris, confidential);
      setCreated(result);
      setCopied(null);
      toast.success(
        result.client_secret
          ? 'Client registered — copy the secret now, it will not be shown again'
          : 'Client registered'
      );
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to register the client'));
    } finally {
      setRegistering(false);
    }
  };

  const handleRevokeClient = async (client: McpOAuthClient) => {
    const ok = await confirm({
      title: `Revoke ${client.name}?`,
      message:
        'Every member connected through this client is disconnected immediately, and the client cannot be ' +
        'used again. This cannot be undone.',
      confirmLabel: 'Revoke client',
      cancelLabel: 'Keep it',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const result = await mcpOAuthAdminService.revokeClient(client.id);
      toast.success(
        result.connections_ended === 1
          ? 'Client revoked; 1 connection ended'
          : `Client revoked; ${result.connections_ended} connections ended`
      );
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to revoke the client'));
    }
  };

  const handleRevokeGrant = async (grant: McpOAuthConnection) => {
    const ok = await confirm({
      title: 'End this connection?',
      message: `${grant.member_name ?? 'The member'} will need to connect ${grant.client_name} again to use it.`,
      confirmLabel: 'End connection',
      cancelLabel: 'Keep it',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await mcpOAuthAdminService.revokeGrant(grant.id);
      toast.success('Connection ended');
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to end the connection'));
    }
  };

  const activeClients = clients.filter((c) => c.is_active);

  return (
    <div className="card mt-6 p-6" data-testid="mcp-oauth-panel">
      <div className="mb-4 flex items-center space-x-3">
        <div className="rounded-lg bg-orange-500/10 p-2 text-orange-700 dark:text-orange-400">
          <UserCheck className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-theme-text-primary font-semibold">Member sign-in (OAuth)</h3>
          <p className="text-theme-text-muted text-xs">
            Members connect a client with their own account. Each connection reaches only what that member can see.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
          <span className="sr-only">Loading…</span>
        </div>
      ) : loadError ? (
        <div className="alert-danger flex items-start gap-2" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm">{loadError}</p>
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                void load();
              }}
              className="mt-2 text-xs underline"
            >
              Try again
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {status && !status.server_enabled && (
            <div className="alert-warning text-xs" data-testid="mcp-oauth-server-off">
              Member sign-in is off on this server. The operator turns it on with MCP_OAUTH_ENABLED=true and
              MCP_OAUTH_ISSUER_URL set to the site&apos;s public https:// address.
            </div>
          )}
          {status?.server_enabled && !status.department_enabled && (
            <div className="alert-info text-xs" data-testid="mcp-oauth-department-off">
              Turn on <strong>Let members connect with their own account</strong> in this integration&apos;s settings
              before members can connect.
            </div>
          )}

          {status?.issuer && (
            <div>
              <p className={labelClass}>Authorization server</p>
              <code className="bg-theme-surface-secondary text-theme-text-secondary block rounded px-2 py-1 text-xs break-all">
                {status.issuer}
              </code>
              <p className="text-theme-text-muted mt-1 text-xs">
                Clients discover it from the MCP endpoint; most need only the endpoint URL, the client ID and, for a
                confidential client, the secret.
              </p>
            </div>
          )}

          {created && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3" data-testid="mcp-oauth-created">
              <p className="text-theme-text-primary text-sm font-medium">
                {created.client_secret
                  ? 'Copy the client secret now. It is shown once and cannot be recovered.'
                  : 'Client registered.'}
              </p>
              <dl className="mt-2 space-y-2 text-xs">
                <div>
                  <dt className="text-theme-text-muted">Client ID</dt>
                  <dd className="flex items-center gap-2">
                    <code className="bg-theme-surface text-theme-text-primary block flex-1 rounded px-2 py-1 font-mono break-all">
                      {created.client.client_id}
                    </code>
                    <button
                      type="button"
                      onClick={() => {
                        void copy('id', created.client.client_id);
                      }}
                      className="btn-icon text-theme-text-muted hover:text-theme-text-primary"
                      aria-label="Copy client ID"
                    >
                      {copied === 'id' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </dd>
                </div>
                {created.client_secret && (
                  <div>
                    <dt className="text-theme-text-muted">Client secret</dt>
                    <dd className="flex items-center gap-2">
                      <code className="bg-theme-surface text-theme-text-primary block flex-1 rounded px-2 py-1 font-mono break-all">
                        {created.client_secret}
                      </code>
                      <button
                        type="button"
                        onClick={() => {
                          void copy('secret', created.client_secret ?? '');
                        }}
                        className="btn-icon text-theme-text-muted hover:text-theme-text-primary"
                        aria-label="Copy client secret"
                      >
                        {copied === 'secret' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      </button>
                    </dd>
                  </div>
                )}
              </dl>
              <button
                type="button"
                onClick={() => setCreated(null)}
                className="text-theme-text-secondary hover:text-theme-text-primary mt-2 text-xs underline"
              >
                I have copied it
              </button>
            </div>
          )}

          <div>
            <p className={labelClass}>Registered clients</p>
            {activeClients.length === 0 ? (
              <p className="text-theme-text-secondary text-sm">No clients registered. Members cannot connect yet.</p>
            ) : (
              <ul className="space-y-2" data-testid="mcp-oauth-clients">
                {activeClients.map((client) => (
                  <li
                    key={client.id}
                    className="bg-theme-surface-secondary flex flex-wrap items-center justify-between gap-3 rounded-lg p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-theme-text-primary text-sm font-medium">
                        {client.name}{' '}
                        <span className="text-theme-text-muted font-mono text-xs break-all">{client.client_id}</span>
                      </p>
                      <p className="text-theme-text-muted text-xs break-all">
                        {client.confidential ? 'Confidential' : 'Public (PKCE only)'} ·{' '}
                        {client.redirect_uris.join(', ')}
                      </p>
                    </div>
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => {
                          void handleRevokeClient(client);
                        }}
                        className="rounded-lg bg-red-800/10 px-3 py-1.5 text-sm text-red-800 transition-colors hover:bg-red-800/20 dark:text-red-300"
                      >
                        Revoke
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className={labelClass}>Member connections</p>
            {grants.length === 0 ? (
              <p className="text-theme-text-secondary text-sm">No member is connected.</p>
            ) : (
              <ul className="space-y-2" data-testid="mcp-oauth-grants">
                {grants.map((grant) => (
                  <li
                    key={grant.id}
                    className="bg-theme-surface-secondary flex flex-wrap items-center justify-between gap-3 rounded-lg p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-theme-text-primary text-sm font-medium">
                        {grant.member_name ?? 'Member'} · {grant.client_name}
                      </p>
                      <p className="text-theme-text-muted text-xs">
                        {grant.scopes.join(' ')} · connected{' '}
                        {grant.created_at ? formatDateTime(grant.created_at, tz) : '—'} ·{' '}
                        {grant.last_used_at ? `last used ${formatDateTime(grant.last_used_at, tz)}` : 'not used yet'}
                      </p>
                    </div>
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => {
                          void handleRevokeGrant(grant);
                        }}
                        className="rounded-lg bg-red-800/10 px-3 py-1.5 text-sm text-red-800 transition-colors hover:bg-red-800/20 dark:text-red-300"
                      >
                        End
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {canManage ? (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void handleRegister();
              }}
            >
              <p className={labelClass}>Register a client</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="mcp-oauth-name" className={labelClass}>
                    Name
                  </label>
                  <input
                    id="mcp-oauth-name"
                    type="text"
                    maxLength={100}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="form-input"
                  />
                </div>
                <label className="flex items-start gap-2 sm:mt-7">
                  <input
                    type="checkbox"
                    className="form-checkbox mt-0.5"
                    checked={confidential}
                    onChange={(e) => setConfidential(e.target.checked)}
                  />
                  <span className="text-theme-text-primary text-sm">
                    Issue a client secret
                    <span className="text-theme-text-muted block text-xs">
                      For a client that can keep one, such as claude.ai. Leave off for a desktop client.
                    </span>
                  </span>
                </label>
              </div>
              <div>
                <label htmlFor="mcp-oauth-redirects" className={labelClass}>
                  Redirect URIs (one per line)
                </label>
                <textarea
                  id="mcp-oauth-redirects"
                  rows={3}
                  value={redirectUris}
                  onChange={(e) => setRedirectUris(e.target.value)}
                  className="form-input font-mono text-xs"
                />
                <p className="text-theme-text-muted mt-1 text-xs">
                  Matched exactly. claude.ai uses {CLAUDE_AI_CALLBACK}. A desktop client needs a fixed callback port,
                  e.g. http://localhost:33418/callback.
                </p>
              </div>
              <button type="submit" disabled={registering} className="btn-primary" data-testid="mcp-oauth-register">
                {registering ? 'Registering…' : 'Register client'}
              </button>
            </form>
          ) : (
            <p className="text-theme-text-muted text-xs">
              Only a member holding <strong>Issue and revoke Claude MCP service keys</strong> can register or revoke
              clients and end connections.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default McpOAuthPanel;
