/**
 * Integration Detail Page
 *
 * One integration's health: when it last synced and last succeeded, the last
 * error it reported and how many runs in a row have failed, and a bounded
 * history of its recent runs — syncs, connection checks and chat deliveries.
 * Retry Sync re-runs the integration's sync (Salesforce) or, for an
 * integration with nothing to synchronize, re-checks its connection; the
 * backend rate-limits it per integration.
 *
 * Errors shown here were sanitized server-side before they were stored: no
 * URLs (a webhook URL is its own secret), tokens or email addresses.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Activity, AlertTriangle, ArrowLeft, CheckCircle2, Clock, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  integrationHealthService,
  type IntegrationDetail,
  type IntegrationHealth,
  type IntegrationSyncRun,
} from '../services/integrationHealthService';
import { useTimezone } from '../hooks/useTimezone';
import { formatDateTime, formatNumber } from '../utils/dateFormatting';
import { getErrorMessage } from '../utils/errorHandling';
import { EmptyState } from '../components/ux';

const HEALTH_LABEL: Record<IntegrationHealth, string> = {
  healthy: 'Healthy',
  degraded: 'Recent failure',
  failing: 'Failing',
  unknown: 'Not run yet',
};

// Severity is carried by the label, icon and border; text stays body-coloured
// so the badge clears AAA in both themes.
const HEALTH_BADGE: Record<IntegrationHealth, string> = {
  healthy: 'border-green-700/60 bg-green-500/10',
  degraded: 'border-amber-600/70 bg-amber-500/10',
  failing: 'border-red-700/70 bg-red-500/10',
  unknown: 'border-slate-500/60 bg-slate-500/10',
};

const OPERATION_LABEL: Record<string, string> = {
  connection_test: 'Connection check',
  chat_notification: 'Chat notification',
  salesforce_sync: 'Salesforce sync',
  salesforce_push_members: 'Push members',
  salesforce_push_training: 'Push training',
  salesforce_push_events: 'Push events',
  salesforce_pull_contacts: 'Pull contacts',
};

const TRIGGER_LABEL: Record<string, string> = {
  manual: 'Manual',
  retry: 'Retry',
  scheduled: 'Scheduled',
  event: 'Event',
};

const describeSummary = (summary: Record<string, number>): string =>
  Object.entries(summary)
    .map(([key, value]) => `${key.replace(/_/g, ' ')}: ${formatNumber(value)}`)
    .join(', ');

const IntegrationDetailPage: React.FC = () => {
  const { integrationId = '' } = useParams<{ integrationId: string }>();
  const tz = useTimezone();
  const [integration, setIntegration] = useState<IntegrationDetail | null>(null);
  const [history, setHistory] = useState<IntegrationSyncRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [detail, runs] = await Promise.all([
        integrationHealthService.getIntegration(integrationId),
        integrationHealthService.getSyncHistory(integrationId),
      ]);
      if (!detail || typeof detail.id !== 'string' || !Array.isArray(runs?.runs)) {
        throw new Error('The integrations service returned an unexpected response.');
      }
      setIntegration(detail);
      setHistory(runs.runs);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load this integration'));
    } finally {
      setLoading(false);
    }
  }, [integrationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const retry = async () => {
    setRetrying(true);
    try {
      const result = await integrationHealthService.retrySync(integrationId);
      if (result.success) toast.success(result.message || 'Done');
      else toast.error(result.message || 'The retry failed');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not retry'));
    } finally {
      setRetrying(false);
      void load();
    }
  };

  const connected = integration?.status === 'connected' && integration.enabled;
  const health: IntegrationHealth = integration?.health ?? 'unknown';
  const retryLabel = integration?.supports_sync ? 'Retry sync' : 'Retry connection check';

  return (
    <div className="mx-auto min-h-screen max-w-5xl p-4 sm:p-6">
      <Link
        to="/integrations"
        className="text-theme-text-secondary hover:text-theme-text-primary mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        All integrations
      </Link>

      {error ? (
        <div role="alert" className="alert-danger text-sm">
          {error}
        </div>
      ) : loading && !integration ? (
        <div className="card text-theme-text-muted p-12 text-center">Loading…</div>
      ) : integration ? (
        <>
          <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-theme-text-primary flex items-center gap-2 text-2xl font-bold sm:text-3xl">
                <Activity className="h-7 w-7" aria-hidden="true" />
                {integration.name}
              </h1>
              <p className="text-theme-text-secondary mt-1 text-sm">{integration.category}</p>
            </div>
            <span
              className={`text-theme-text-primary inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium ${HEALTH_BADGE[health]}`}
            >
              {health === 'healthy' ? (
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              ) : health === 'unknown' ? (
                <Clock className="h-4 w-4" aria-hidden="true" />
              ) : (
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              )}
              {HEALTH_LABEL[health]}
            </span>
          </div>

          <dl className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="card p-4">
              <dt className="text-theme-text-muted text-xs font-medium uppercase">Last sync</dt>
              <dd className="text-theme-text-primary mt-1 text-sm">
                {integration.last_sync_at ? formatDateTime(integration.last_sync_at, tz) : 'Never'}
              </dd>
            </div>
            <div className="card p-4">
              <dt className="text-theme-text-muted text-xs font-medium uppercase">Last success</dt>
              <dd className="text-theme-text-primary mt-1 text-sm">
                {integration.last_success_at ? formatDateTime(integration.last_success_at, tz) : 'Never'}
              </dd>
            </div>
            <div className="card p-4">
              <dt className="text-theme-text-muted text-xs font-medium uppercase">Failures in a row</dt>
              <dd className="text-theme-text-primary mt-1 text-2xl font-bold">
                {integration.consecutive_error_count ?? 0}
              </dd>
            </div>
            <div className="card p-4">
              <dt className="text-theme-text-muted text-xs font-medium uppercase">Status</dt>
              <dd className="text-theme-text-primary mt-1 text-sm">{connected ? 'Connected' : 'Not connected'}</dd>
            </div>
          </dl>

          {integration.last_error && (
            <div className="alert-warning mb-6 text-sm">
              <p className="text-theme-text-primary font-semibold">Last error</p>
              <p className="text-theme-text-primary mt-1 break-words">{integration.last_error}</p>
              {integration.last_error_at && (
                <p className="text-theme-text-secondary mt-1">{formatDateTime(integration.last_error_at, tz)}</p>
              )}
            </div>
          )}

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-theme-text-primary text-lg font-semibold">Recent runs</h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void load()}
                className="btn-secondary btn-md inline-flex items-center gap-1.5 text-sm"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
                Refresh
              </button>
              {connected && (
                <button
                  type="button"
                  onClick={() => void retry()}
                  disabled={retrying}
                  className="btn-primary inline-flex items-center gap-1.5 text-sm"
                >
                  <RefreshCw className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`} aria-hidden="true" />
                  {retrying ? 'Retrying…' : retryLabel}
                </button>
              )}
            </div>
          </div>

          {history.length === 0 ? (
            <div className="card">
              <EmptyState
                icon={Clock}
                title="No runs recorded"
                description="Syncs, connection checks and chat deliveries appear here as they happen."
              />
            </div>
          ) : (
            <div className="card overflow-x-auto">
              <table className="rwd-table w-full">
                <thead className="bg-theme-surface-secondary text-theme-text-muted text-left text-xs font-medium uppercase">
                  <tr>
                    <th scope="col" className="px-4 py-3">
                      When
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Run
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Result
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Details
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-theme-surface-border divide-y">
                  {history.map((run) => (
                    <tr key={run.id}>
                      <td data-label="When" className="text-theme-text-secondary px-4 py-3 text-sm whitespace-nowrap">
                        {run.started_at ? formatDateTime(run.started_at, tz) : '—'}
                      </td>
                      <td data-label="Run" className="text-theme-text-primary px-4 py-3 text-sm">
                        {OPERATION_LABEL[run.operation] ?? run.operation}
                        <span className="text-theme-text-secondary">
                          {' '}
                          · {TRIGGER_LABEL[run.trigger] ?? run.trigger}
                        </span>
                      </td>
                      <td data-label="Result" className="text-theme-text-primary px-4 py-3 text-sm font-medium">
                        {run.status === 'success' ? 'Succeeded' : run.status === 'failure' ? 'Failed' : 'Running'}
                      </td>
                      <td data-label="Details" className="text-theme-text-secondary px-4 py-3 text-sm break-words">
                        {run.error_message || describeSummary(run.summary ?? {}) || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
};

export default IntegrationDetailPage;
