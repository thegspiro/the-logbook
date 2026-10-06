/**
 * Security Alerts Admin Page
 *
 * The working surface for what the security monitor detects: brute-force
 * sign-in attempts, session hijacking, privilege escalation and large data
 * exports. An officer acknowledges an alert ("somebody is looking at this")
 * and resolves it with a note of what was found; both are attributed and
 * written to the audit log by the backend. A second tab lists every completed
 * data export — who, which route, how much, when — without its content.
 *
 * Reading needs `audit.view`. Acknowledging and resolving need `audit.export`
 * on the backend, so the buttons are offered only to holders of it rather than
 * shown to read-only auditors as controls that would 403.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { BellRing, CheckCircle2, Download, RefreshCw, ShieldAlert } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  securityAlertsService,
  type MonitoredExport,
  type SecurityAlertRecord as SecurityAlert,
  type SecurityAlertCounts,
  type SecurityAlertState,
  type SecurityThreatLevel,
} from '../services/securityAlertsService';
import { useAuthStore } from '../stores/authStore';
import { useTimezone } from '../hooks/useTimezone';
import { formatDateTime, formatNumber } from '../utils/dateFormatting';
import { getErrorMessage } from '../utils/errorHandling';
import { EmptyState, PromptDialog } from '../components/ux';

type Tab = 'alerts' | 'exports';

// Severity is carried by the label and the border, with body-colour text: a
// tinted badge in a palette shade clears AA but not the AAA the mobile pass
// ratchets, and no shade does in dark mode (see CLAUDE.md, contrast is AAA).
const THREAT_BADGE: Record<SecurityThreatLevel, string> = {
  low: 'border-slate-500/60 bg-slate-500/10',
  medium: 'border-blue-600/60 bg-blue-500/10',
  high: 'border-amber-600/70 bg-amber-500/10',
  critical: 'border-red-700/70 bg-red-500/10',
};

const ALERT_TYPE_LABEL: Record<string, string> = {
  brute_force: 'Brute-force sign-in',
  session_hijack: 'Session hijack',
  data_exfiltration: 'Large data export',
  external_data_transfer: 'External data transfer',
  log_tampering: 'Audit log tampering',
  privilege_escalation: 'Privilege escalation',
  anomaly_detected: 'Anomaly',
  unauthorized_access: 'Unauthorized access',
  suspicious_activity: 'Suspicious activity',
  rate_limit_exceeded: 'Rate limit exceeded',
};

const STATE_OPTIONS: { value: SecurityAlertState; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'unacknowledged', label: 'Unacknowledged' },
  { value: 'acknowledged', label: 'Acknowledged' },
  { value: 'resolved', label: 'Resolved' },
];

const EMPTY_COUNTS: SecurityAlertCounts = { open: 0, unacknowledged: 0, acknowledged: 0, resolved: 0 };

const formatBytes = (bytes: number | null): string => {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes < 1024) return `${formatNumber(bytes)} B`;
  if (bytes < 1024 * 1024) return `${formatNumber(Math.round(bytes / 102.4) / 10)} KB`;
  return `${formatNumber(Math.round(bytes / (1024 * 104.8576)) / 10)} MB`;
};

const describeDetail = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return '—';
  return JSON.stringify(value);
};

const SecurityAlertsPage: React.FC = () => {
  const tz = useTimezone();
  const { checkPermission } = useAuthStore();
  const canAct = checkPermission('audit.export');

  const [tab, setTab] = useState<Tab>('alerts');
  const [state, setState] = useState<SecurityAlertState>('open');
  const [alerts, setAlerts] = useState<SecurityAlert[]>([]);
  const [counts, setCounts] = useState<SecurityAlertCounts>(EMPTY_COUNTS);
  const [exportsList, setExportsList] = useState<MonitoredExport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resolving, setResolving] = useState<SecurityAlert | null>(null);

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await securityAlertsService.getAlerts({ state, limit: 200 });
      // Rejected rather than emptied: an empty list over a broken endpoint
      // would tell an officer there is nothing to look at.
      if (!Array.isArray(data?.alerts) || typeof data.counts !== 'object' || data.counts === null) {
        throw new Error('The security alert service returned an unexpected response.');
      }
      setAlerts(data.alerts);
      setCounts(data.counts);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load security alerts'));
    } finally {
      setLoading(false);
    }
  }, [state]);

  const loadExports = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await securityAlertsService.getDownloadActivity(100);
      if (!Array.isArray(data?.exports)) {
        throw new Error('The export activity service returned an unexpected response.');
      }
      setExportsList(data.exports);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load export activity'));
    } finally {
      setLoading(false);
    }
  }, []);

  const reload = useCallback(() => (tab === 'alerts' ? loadAlerts() : loadExports()), [tab, loadAlerts, loadExports]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const acknowledge = async (alert: SecurityAlert) => {
    setBusyId(alert.id);
    try {
      await securityAlertsService.acknowledgeAlert(alert.id);
      toast.success('Alert acknowledged');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not acknowledge the alert'));
    } finally {
      setBusyId(null);
      void loadAlerts();
    }
  };

  const resolve = async (note: string) => {
    const target = resolving;
    if (!target) return;
    setBusyId(target.id);
    try {
      await securityAlertsService.resolveAlert(target.id, note);
      toast.success('Alert resolved');
      setResolving(null);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not resolve the alert'));
    } finally {
      setBusyId(null);
      void loadAlerts();
    }
  };

  const tabButton = (value: Tab, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === value}
      onClick={() => setTab(value)}
      className={`inline-flex min-h-11 items-center gap-1.5 border-b-2 px-4 text-sm font-medium ${
        tab === value
          ? 'text-theme-text-primary border-red-700'
          : 'text-theme-text-secondary hover:text-theme-text-primary border-transparent'
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="mx-auto min-h-screen max-w-7xl p-4 sm:p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-theme-text-primary flex items-center gap-2 text-2xl font-bold sm:text-3xl">
            <ShieldAlert className="h-7 w-7 text-red-700 dark:text-red-400" aria-hidden="true" />
            Security Alerts
          </h1>
          <p className="text-theme-text-secondary mt-1 text-sm">
            What the security monitor has flagged for your department, and every data export it recorded.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void reload()}
          className="btn-secondary btn-md inline-flex items-center gap-1.5 text-sm"
          aria-label="Refresh security alerts"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </button>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <div className="card p-4">
          <p className="text-theme-text-muted text-xs font-medium uppercase">Open</p>
          <p className="text-theme-text-primary mt-1 text-2xl font-bold sm:text-3xl">{counts.open}</p>
        </div>
        <div className="card p-4">
          <p className="text-theme-text-muted text-xs font-medium uppercase">Unacknowledged</p>
          <p className="text-theme-text-primary mt-1 text-2xl font-bold sm:text-3xl">{counts.unacknowledged}</p>
        </div>
        <div className="card p-4">
          <p className="text-theme-text-muted text-xs font-medium uppercase">Acknowledged</p>
          <p className="text-theme-text-primary mt-1 text-2xl font-bold sm:text-3xl">{counts.acknowledged}</p>
        </div>
        <div className="card p-4">
          <p className="text-theme-text-muted text-xs font-medium uppercase">Resolved</p>
          <p className="text-theme-text-primary mt-1 text-2xl font-bold sm:text-3xl">{counts.resolved}</p>
        </div>
      </div>

      <div className="tab-scroll mb-4" role="tablist" aria-label="Security monitoring views">
        {tabButton('alerts', 'Alerts', <BellRing className="h-4 w-4" aria-hidden="true" />)}
        {tabButton('exports', 'Data exports', <Download className="h-4 w-4" aria-hidden="true" />)}
      </div>

      {tab === 'alerts' && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <label htmlFor="alert-state" className="text-theme-text-secondary text-sm font-medium">
            Show
          </label>
          <select
            id="alert-state"
            value={state}
            onChange={(e) => setState(e.target.value as SecurityAlertState)}
            className="form-input w-auto text-sm"
          >
            {STATE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {!canAct && (
            <p className="text-theme-text-muted text-sm">
              Acknowledging and resolving alerts needs the audit export permission.
            </p>
          )}
        </div>
      )}

      {error ? (
        <div role="alert" className="alert-danger text-sm">
          {error}
        </div>
      ) : loading && (tab === 'alerts' ? alerts.length === 0 : exportsList.length === 0) ? (
        <div className="card text-theme-text-muted p-12 text-center">Loading…</div>
      ) : tab === 'alerts' ? (
        alerts.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={CheckCircle2}
              title={state === 'resolved' ? 'No resolved alerts' : 'Nothing waiting'}
              description={
                state === 'resolved'
                  ? 'Alerts appear here once an officer resolves them.'
                  : 'The security monitor has no alerts in this state for your department.'
              }
            />
          </div>
        ) : (
          <ul className="space-y-3" aria-label="Security alerts">
            {alerts.map((alert) => {
              const details = Object.entries(alert.details ?? {});
              const busy = busyId === alert.id;
              return (
                <li key={alert.id} className="card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-theme-text-primary font-semibold">
                        {ALERT_TYPE_LABEL[alert.alert_type] ?? alert.alert_type}
                      </p>
                      <p className="text-theme-text-secondary mt-1 text-sm break-words">{alert.description}</p>
                    </div>
                    <span
                      className={`text-theme-text-primary inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium uppercase ${
                        THREAT_BADGE[alert.threat_level] ?? THREAT_BADGE.low
                      }`}
                    >
                      {alert.threat_level}
                    </span>
                  </div>
                  <dl className="text-theme-text-secondary mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="inline font-medium">Detected: </dt>
                      <dd className="inline">{alert.timestamp ? formatDateTime(alert.timestamp, tz) : '—'}</dd>
                    </div>
                    <div>
                      <dt className="inline font-medium">Source IP: </dt>
                      <dd className="inline font-mono">{alert.source_ip || '—'}</dd>
                    </div>
                    {details.map(([key, value]) => (
                      <div key={key}>
                        <dt className="inline font-medium">{key.replace(/_/g, ' ')}: </dt>
                        <dd className="inline break-all">{describeDetail(value)}</dd>
                      </div>
                    ))}
                  </dl>
                  {(alert.acknowledged || alert.resolved) && (
                    <div className="text-theme-text-secondary mt-3 space-y-1 border-t pt-3 text-sm">
                      {alert.acknowledged && (
                        <p>
                          Acknowledged by {alert.acknowledged_by || 'unknown'}
                          {alert.acknowledged_at ? ` on ${formatDateTime(alert.acknowledged_at, tz)}` : ''}
                        </p>
                      )}
                      {alert.resolved && (
                        <p>
                          Resolved by {alert.resolved_by || 'unknown'}
                          {alert.resolved_at ? ` on ${formatDateTime(alert.resolved_at, tz)}` : ''}
                          {alert.resolution_note ? ` — ${alert.resolution_note}` : ''}
                        </p>
                      )}
                    </div>
                  )}
                  {canAct && !alert.resolved && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {!alert.acknowledged && (
                        <button
                          type="button"
                          className="btn-secondary btn-md text-sm"
                          disabled={busy}
                          onClick={() => void acknowledge(alert)}
                        >
                          Acknowledge
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn-primary text-sm"
                        disabled={busy}
                        onClick={() => setResolving(alert)}
                      >
                        Resolve
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )
      ) : exportsList.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Download}
            title="No exports recorded"
            description="Every completed data export by a member of your department is listed here."
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
                  Member
                </th>
                <th scope="col" className="px-4 py-3">
                  Export
                </th>
                <th scope="col" className="px-4 py-3">
                  Size
                </th>
                <th scope="col" className="px-4 py-3">
                  IP
                </th>
              </tr>
            </thead>
            <tbody className="divide-theme-surface-border divide-y">
              {exportsList.map((row) => (
                <tr key={row.id}>
                  <td data-label="When" className="text-theme-text-secondary px-4 py-3 text-sm whitespace-nowrap">
                    {row.timestamp ? formatDateTime(row.timestamp, tz) : '—'}
                  </td>
                  <td data-label="Member" className="text-theme-text-primary px-4 py-3 text-sm">
                    {row.username || '—'}
                  </td>
                  <td data-label="Export" className="text-theme-text-secondary px-4 py-3 font-mono text-xs break-all">
                    {row.method ? `${row.method} ` : ''}
                    {row.endpoint || '—'}
                  </td>
                  <td data-label="Size" className="text-theme-text-secondary px-4 py-3 text-sm whitespace-nowrap">
                    {formatBytes(row.bytes)}
                  </td>
                  <td data-label="IP" className="text-theme-text-muted px-4 py-3 font-mono text-sm">
                    {row.ip_address || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PromptDialog
        isOpen={resolving !== null}
        onClose={() => setResolving(null)}
        onSubmit={(value) => void resolve(value)}
        title="Resolve security alert"
        message={
          resolving ? (
            <span>
              {ALERT_TYPE_LABEL[resolving.alert_type] ?? resolving.alert_type}: {resolving.description}
            </span>
          ) : undefined
        }
        label="What did you find?"
        placeholder="e.g. A member mistyped their password; confirmed by phone."
        required={false}
        multiline
        hint="Kept on the alert and in the audit log. Up to 1,000 characters."
        confirmLabel="Resolve alert"
        cancelLabel="Keep it open"
        loading={resolving !== null && busyId === resolving.id}
      />
    </div>
  );
};

export default SecurityAlertsPage;
