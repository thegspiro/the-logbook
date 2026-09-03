/**
 * Service-key panel for the Claude (MCP) integration.
 *
 * One department, one active key. Issuing a key shows its plaintext exactly
 * once — the backend stores a digest and cannot repeat it — so the panel
 * keeps the value on screen until the administrator dismisses it, with the
 * endpoint URL beside it, which is everything an MCP client needs.
 *
 * Issuing and revoking need `integrations.mcp_keys`; the rest of the panel
 * is readable by anyone who can open the Integrations screen.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Check, Copy, KeyRound, Loader2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../stores/authStore';
import { integrationsService } from '../../services/api';
import type { McpKeyCreateResult, McpStatus } from '../../services/adminServices';
import { getErrorMessage } from '../../utils/errorHandling';
import { formatDateTime } from '../../utils/dateFormatting';
import { useTimezone } from '../../hooks/useTimezone';
import { useConfirm } from '../../contexts/ConfirmContext';

interface McpServiceKeyPanelProps {
  onClose: () => void;
}

// Value → days. `lifetime` is the explicit no-expiry option the department asked for.
const EXPIRY_OPTIONS: ReadonlyArray<{ value: string; label: string; days: number | null }> = [
  { value: '30', label: '30 days', days: 30 },
  { value: '90', label: '90 days', days: 90 },
  { value: '180', label: '180 days', days: 180 },
  { value: '365', label: '1 year', days: 365 },
  { value: 'lifetime', label: 'Lifetime (never expires)', days: null },
];

const inputClass = 'form-input';
const labelClass = 'form-label';

export const McpServiceKeyPanel: React.FC<McpServiceKeyPanelProps> = ({ onClose }) => {
  const { checkPermission } = useAuthStore();
  const canIssue = checkPermission('integrations.mcp_keys');
  const tz = useTimezone();
  const { confirm } = useConfirm();

  const [status, setStatus] = useState<McpStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [keyName, setKeyName] = useState('Claude');
  const [expiry, setExpiry] = useState('90');
  const [issuing, setIssuing] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [issued, setIssued] = useState<McpKeyCreateResult | null>(null);
  const [copied, setCopied] = useState<'key' | 'url' | null>(null);

  const endpointUrl = `${window.location.origin}${status?.endpoint_path ?? '/api/mcp'}`;

  const load = useCallback(async () => {
    try {
      setStatus(await integrationsService.getMcpStatus());
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load the Claude (MCP) status'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleIssue = async () => {
    const option = EXPIRY_OPTIONS.find((o) => o.value === expiry) ?? EXPIRY_OPTIONS[1];
    if (!option) return;
    if (status?.active_key) {
      const ok = await confirm({
        title: 'Replace the current service key?',
        message:
          `The key ${status.active_key.key_prefix}… stops working the moment a new one is issued. ` +
          'Every MCP client configured with it will need the new key.',
        confirmLabel: 'Issue new key',
        cancelLabel: 'Keep current key',
        variant: 'warning',
      });
      if (!ok) return;
    }
    setIssuing(true);
    try {
      const result = await integrationsService.createMcpKey(keyName.trim() || 'Claude', option.days);
      setIssued(result);
      setCopied(null);
      toast.success('Service key issued — copy it now, it will not be shown again');
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to issue a service key'));
    } finally {
      setIssuing(false);
    }
  };

  const handleRevoke = async () => {
    const active = status?.active_key;
    if (!active) return;
    const ok = await confirm({
      title: 'Revoke this service key?',
      message: `Clients using ${active.key_prefix}… will be refused immediately. This cannot be undone.`,
      confirmLabel: 'Revoke key',
      cancelLabel: 'Keep it',
      variant: 'danger',
    });
    if (!ok) return;
    setRevoking(true);
    try {
      await integrationsService.revokeMcpKey(active.id);
      setIssued(null);
      toast.success('Service key revoked');
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to revoke the service key'));
    } finally {
      setRevoking(false);
    }
  };

  const copy = async (what: 'key' | 'url', value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
    } catch {
      toast.error('Copy failed — select the text and copy it by hand');
    }
  };

  return (
    <div className="card mt-6 p-6" data-testid="mcp-key-panel">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="rounded-lg bg-orange-500/10 p-2 text-orange-700 dark:text-orange-400">
            <KeyRound className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-theme-text-primary font-semibold">Claude (MCP) service key</h3>
            <p className="text-theme-text-muted text-xs">
              One key for the department. Paste it into an MCP client as a bearer token.
            </p>
          </div>
        </div>
        <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text-primary" aria-label="Close">
          <X className="h-5 w-5" />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
          <span className="sr-only">Loading…</span>
        </div>
      ) : (
        <div className="space-y-5">
          <div>
            <p className={labelClass}>Endpoint URL</p>
            <div className="flex items-center gap-2">
              <code className="bg-theme-surface-secondary text-theme-text-secondary block flex-1 rounded px-2 py-1 text-xs break-all">
                {endpointUrl}
              </code>
              <button
                type="button"
                onClick={() => {
                  void copy('url', endpointUrl);
                }}
                className="btn-icon text-theme-text-muted hover:text-theme-text-primary"
                aria-label="Copy endpoint URL"
              >
                {copied === 'url' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            {status && (
              <p className="text-theme-text-muted mt-1 text-xs">
                {status.access_mode === 'read_write' ? 'Read and write' : 'Read-only'}
                {status.expose_finance ? ' · finance totals shared' : ''}
                {status.expose_medical_screening ? ' · medical screening status shared' : ''}
              </p>
            )}
          </div>

          {issued && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3" data-testid="mcp-issued-key">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
                <div className="min-w-0 flex-1">
                  <p className="text-theme-text-primary text-sm font-medium">
                    Copy this key now. It is shown once and cannot be recovered.
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="bg-theme-surface text-theme-text-primary block flex-1 rounded px-2 py-1 font-mono text-xs break-all">
                      {issued.plaintext}
                    </code>
                    <button
                      type="button"
                      onClick={() => {
                        void copy('key', issued.plaintext);
                      }}
                      className="btn-icon text-theme-text-muted hover:text-theme-text-primary"
                      aria-label="Copy service key"
                    >
                      {copied === 'key' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                  {issued.revoked.length > 0 && (
                    <p className="text-theme-text-muted mt-2 text-xs">
                      The previous key ({issued.revoked.map((k) => `${k.key_prefix}…`).join(', ')}) has been revoked.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => setIssued(null)}
                    className="text-theme-text-secondary hover:text-theme-text-primary mt-2 text-xs underline"
                  >
                    I have copied it
                  </button>
                </div>
              </div>
            </div>
          )}

          <div>
            <p className={labelClass}>Current key</p>
            {status?.active_key ? (
              <div className="bg-theme-surface-secondary flex flex-wrap items-center justify-between gap-3 rounded-lg p-3">
                <div className="min-w-0">
                  <p className="text-theme-text-primary text-sm font-medium">
                    {status.active_key.name}{' '}
                    <span className="text-theme-text-muted font-mono text-xs">{status.active_key.key_prefix}…</span>
                  </p>
                  <p className="text-theme-text-muted text-xs">
                    Issued {status.active_key.created_at ? formatDateTime(status.active_key.created_at, tz) : '—'}
                    {' · '}
                    {status.active_key.expires_at
                      ? `expires ${formatDateTime(status.active_key.expires_at, tz)}`
                      : 'never expires'}
                    {' · '}
                    {status.active_key.last_used_at
                      ? `last used ${formatDateTime(status.active_key.last_used_at, tz)}`
                      : 'not used yet'}
                  </p>
                </div>
                {canIssue && (
                  <button
                    type="button"
                    onClick={() => {
                      void handleRevoke();
                    }}
                    disabled={revoking}
                    className="rounded-lg bg-red-800/10 px-3 py-1.5 text-sm text-red-800 transition-colors hover:bg-red-800/20 disabled:opacity-50 dark:text-red-300"
                  >
                    {revoking ? 'Revoking…' : 'Revoke'}
                  </button>
                )}
              </div>
            ) : (
              <p className="text-theme-text-secondary text-sm">
                No active key. Claude cannot connect until one is issued.
              </p>
            )}
          </div>

          {canIssue ? (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void handleIssue();
              }}
            >
              <p className={labelClass}>{status?.active_key ? 'Replace the key' : 'Issue a key'}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="mcp-key-name" className={labelClass}>
                    Name
                  </label>
                  <input
                    id="mcp-key-name"
                    type="text"
                    maxLength={100}
                    value={keyName}
                    onChange={(e) => setKeyName(e.target.value)}
                    placeholder="e.g. Claude Code on the chief's laptop"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="mcp-key-expiry" className={labelClass}>
                    Expires
                  </label>
                  <select
                    id="mcp-key-expiry"
                    value={expiry}
                    onChange={(e) => setExpiry(e.target.value)}
                    className={inputClass}
                  >
                    {EXPIRY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <button type="submit" disabled={issuing} className="btn-primary" data-testid="mcp-issue-key">
                {issuing ? 'Issuing…' : status?.active_key ? 'Issue new key' : 'Issue key'}
              </button>
            </form>
          ) : (
            <p className="text-theme-text-muted text-xs">
              Only a member with the <strong>Issue and revoke Claude MCP service keys</strong> permission — the IT
              administrator by default — can issue or revoke the key.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default McpServiceKeyPanel;
