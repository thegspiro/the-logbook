/**
 * The signed-in member's own Claude (MCP) connections, with a way to end each.
 *
 * Every connection here was made by this member approving a client on the
 * consent screen. Ending one stops both of its tokens immediately; the client
 * has to ask again before it can reach anything.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Loader2, Plug } from 'lucide-react';
import toast from 'react-hot-toast';
import { mcpConnectionsService } from '../services/mcpOAuthService';
import type { McpOAuthConnection } from '../services/mcpOAuthService';
import { getErrorMessage } from '../utils/errorHandling';
import { formatDateTime } from '../utils/dateFormatting';
import { useTimezone } from '../hooks/useTimezone';
import { useConfirm } from '../contexts/ConfirmContext';
import { EmptyState } from '../components/ux';

const ClaudeConnectionsPage: React.FC = () => {
  const tz = useTimezone();
  const { confirm } = useConfirm();
  const [connections, setConnections] = useState<McpOAuthConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setConnections(await mcpConnectionsService.listMyConnections());
      setError(null);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Your connections could not be loaded'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRevoke = async (connection: McpOAuthConnection) => {
    const ok = await confirm({
      title: `Disconnect ${connection.client_name}?`,
      message: 'It stops working immediately. You can connect it again later.',
      confirmLabel: 'Disconnect',
      cancelLabel: 'Keep it',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await mcpConnectionsService.revokeMyConnection(connection.id);
      toast.success(`${connection.client_name} disconnected`);
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'The connection could not be ended'));
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-theme-text-primary mb-1 text-xl font-semibold">Claude connections</h1>
      <p className="text-theme-text-muted mb-6 text-sm">
        Clients you have allowed to use The Logbook as you. Each can do only what you can do here.
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-8" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
          <span className="sr-only">Loading…</span>
        </div>
      ) : error ? (
        <div className="alert-danger flex items-start gap-2" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      ) : connections.length === 0 ? (
        <EmptyState icon={Plug} title="No connections" description="You have not connected Claude to your account." />
      ) : (
        <ul className="space-y-3" data-testid="claude-connections">
          {connections.map((connection) => (
            <li key={connection.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-theme-text-primary font-medium">{connection.client_name}</p>
                <p className="text-theme-text-muted text-xs">
                  {connection.scopes.join(' ')} · connected{' '}
                  {connection.created_at ? formatDateTime(connection.created_at, tz) : '—'} ·{' '}
                  {connection.last_used_at
                    ? `last used ${formatDateTime(connection.last_used_at, tz)}`
                    : 'not used yet'}
                </p>
              </div>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  void handleRevoke(connection);
                }}
              >
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default ClaudeConnectionsPage;
