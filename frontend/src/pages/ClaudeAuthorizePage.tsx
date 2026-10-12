/**
 * The consent screen for connecting Claude (MCP) with the member's own account.
 *
 * The backend's /api/oauth/authorize validates the client's request and sends
 * the browser here with `?request=<id>`; ProtectedRoute has already put the
 * member through sign-in. Approving returns the browser to the client's
 * registered redirect URI with a one-time code — the backend builds that URL,
 * never this page, so nothing a link carries can choose where the member is
 * sent.
 *
 * Each scope shows how many tools it would reach for this member right now,
 * because the honest answer to "what am I allowing" depends on the member's
 * own permissions and the department's switches, not on the scope's name.
 */

import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
import { mcpConnectionsService } from '../services/mcpOAuthService';
import type { McpOAuthConsentRequest } from '../services/mcpOAuthService';
import { getErrorMessage } from '../utils/errorHandling';
import { formatDateTime } from '../utils/dateFormatting';
import { useTimezone } from '../hooks/useTimezone';
import { leaveApp, safeRedirect } from '../utils/browserNavigation';

const ClaudeAuthorizePage: React.FC = () => {
  const [params] = useSearchParams();
  const requestId = params.get('request') ?? '';
  const tz = useTimezone();

  const [request, setRequest] = useState<McpOAuthConsentRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!requestId) {
      setError('This link is missing its request. Start connecting again from your client.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const loaded = await mcpConnectionsService.getConsentRequest(requestId);
        if (cancelled) return;
        setRequest(loaded);
        setSelected(new Set(loaded.scopes.map((s) => s.scope)));
      } catch (err: unknown) {
        if (!cancelled) {
          setError(getErrorMessage(err, 'This connection request could not be loaded'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  const decide = async (approve: boolean) => {
    if (!request) return;
    setSubmitting(true);
    try {
      const result = await mcpConnectionsService.decideConsentRequest(
        request.id,
        approve,
        approve ? Array.from(selected) : undefined
      );
      const target = safeRedirect(result.redirect_to);
      if (!target) {
        setError('The client’s return address is not a web address, so the connection was not completed.');
        return;
      }
      setLeaving(true);
      leaveApp(target);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Your answer could not be recorded'));
    } finally {
      setSubmitting(false);
    }
  };

  const toggle = (scope: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  };

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <div className="card p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-lg bg-orange-500/10 p-2 text-orange-700 dark:text-orange-400">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h1 className="text-theme-text-primary text-lg font-semibold">Connect Claude to your account</h1>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8" role="status" aria-live="polite">
            <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
            <span className="sr-only">Loading…</span>
          </div>
        ) : error || !request ? (
          <div className="alert-danger flex items-start gap-2" role="alert" data-testid="claude-consent-error">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="text-sm">{error ?? 'This connection request could not be loaded'}</p>
          </div>
        ) : (
          <div className="space-y-5">
            <p className="text-theme-text-secondary text-sm">
              <strong className="text-theme-text-primary">{request.client.name}</strong> is asking to use The Logbook as
              you. It will be able to do only what you can do here yourself, and only within what your department shares
              with Claude.
            </p>

            <fieldset className="space-y-3">
              <legend className="form-label">It is asking to</legend>
              {request.scopes.map((scope) => {
                const reachesNothing = scope.tool_count === 0;
                return (
                  <label key={scope.scope} className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="form-checkbox mt-0.5"
                      checked={scope.required || selected.has(scope.scope)}
                      disabled={scope.required || submitting}
                      onChange={() => toggle(scope.scope)}
                    />
                    <span>
                      <span className="text-theme-text-primary text-sm">{scope.description}</span>
                      <span className="text-theme-text-muted block text-xs">
                        {reachesNothing
                          ? 'Would not reach anything for you: your department does not share it, or your account does not have access.'
                          : `${scope.tool_count} ${scope.tool_count === 1 ? 'tool' : 'tools'} available to you`}
                        {scope.required ? ' · always included' : ''}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>

            <div className="text-theme-text-muted space-y-1 text-xs">
              <p>
                Approving sends you back to{' '}
                <strong className="text-theme-text-secondary">{request.client.redirect_host}</strong>. Personal
                information such as phone numbers, addresses and medical results is never shared.
              </p>
              {request.expires_at && <p>This request expires {formatDateTime(request.expires_at, tz)}.</p>}
              <p>
                You can disconnect at any time from{' '}
                <Link to="/claude/connections" className="underline">
                  your Claude connections
                </Link>
                .
              </p>
            </div>

            <div className="flex flex-wrap justify-end gap-3">
              <button
                type="button"
                className="btn-secondary"
                disabled={submitting || leaving}
                onClick={() => {
                  void decide(false);
                }}
              >
                Don&apos;t allow
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={submitting || leaving}
                data-testid="claude-consent-approve"
                onClick={() => {
                  void decide(true);
                }}
              >
                {submitting || leaving ? 'Connecting…' : 'Allow'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ClaudeAuthorizePage;
