/**
 * Google Calendar card body
 *
 * Connecting is a Google sign-in: "Connect with Google" sends the browser to
 * Google's consent screen, and the backend's callback creates the
 * department's calendar and returns to /integrations with a query flag that
 * IntegrationsPage turns into a toast. Once connected this shows which
 * account and calendar events are published to, how publishing is going,
 * the description switch, and Disconnect.
 */

import React, { useState } from 'react';
import { AlertCircle, CalendarCheck, Loader2, LogIn, Unplug } from 'lucide-react';
import toast from 'react-hot-toast';
import { integrationsService, type IntegrationConfig } from '../../services/api';
import { getErrorMessage } from '../../utils/errorHandling';
import { formatDateTime } from '../../utils/dateFormatting';
import { useTimezone } from '../../hooks/useTimezone';
import { useConfirm } from '../../contexts/ConfirmContext';

interface GoogleCalendarPanelProps {
  integration: IntegrationConfig;
  onUpdated: (updated: IntegrationConfig) => void;
  onDisconnected: () => void;
}

const configString = (config: Record<string, unknown>, key: string): string | null => {
  const value = config[key];
  return typeof value === 'string' && value ? value : null;
};

export const GoogleCalendarPanel: React.FC<GoogleCalendarPanelProps> = ({ integration, onUpdated, onDisconnected }) => {
  const { confirm } = useConfirm();
  const tz = useTimezone();
  const [starting, setStarting] = useState(false);
  const [savingDescriptions, setSavingDescriptions] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const config = integration.config;
  const accountEmail = configString(config, 'account_email');
  const calendarName = configString(config, 'calendar_name');
  const syncDescriptions = config['sync_descriptions'] === true;
  const isConnected = integration.status === 'connected';
  const needsReconnect = integration.status === 'error';
  const errorCount = integration.consecutive_error_count ?? 0;

  const handleConnect = async () => {
    setStarting(true);
    try {
      const url = await integrationsService.startGoogleCalendarConnect();
      window.location.href = url;
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not start the Google sign-in'));
      setStarting(false);
    }
  };

  const handleToggleDescriptions = async () => {
    setSavingDescriptions(true);
    try {
      const updated = await integrationsService.updateIntegration(integration.id, {
        sync_descriptions: !syncDescriptions,
      });
      onUpdated(updated);
      toast.success(syncDescriptions ? 'Event descriptions will be left out' : 'Event descriptions will be published');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save the setting'));
    } finally {
      setSavingDescriptions(false);
    }
  };

  const handleDisconnect = async () => {
    const confirmed = await confirm({
      title: 'Disconnect Google Calendar?',
      message:
        'Events stop being published and The Logbook gives up its access to the Google account. The calendar itself stays in Google with the events already on it — delete it there if the department no longer wants it. Connecting again creates a new calendar.',
      confirmLabel: 'Disconnect',
      cancelLabel: 'Stay connected',
      variant: 'warning',
    });
    if (!confirmed) return;
    setDisconnecting(true);
    try {
      await integrationsService.disconnectIntegration(integration.id);
      toast.success('Google Calendar disconnected');
      onDisconnected();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not disconnect Google Calendar'));
    } finally {
      setDisconnecting(false);
    }
  };

  const connectButton = (
    <button
      type="button"
      data-integration-connect={integration.id}
      onClick={() => {
        void handleConnect();
      }}
      disabled={starting}
      className="touch:min-h-11 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600/20 px-4 py-1.5 text-sm text-indigo-700 transition-colors hover:bg-indigo-600/30 disabled:cursor-not-allowed disabled:opacity-60 dark:text-indigo-300"
    >
      {starting ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      ) : (
        <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      <span>{starting ? 'Redirecting…' : needsReconnect ? 'Reconnect with Google' : 'Connect with Google'}</span>
    </button>
  );

  const disconnectButton = (
    <button
      type="button"
      onClick={() => {
        void handleDisconnect();
      }}
      disabled={disconnecting}
      className="bg-theme-surface-secondary text-theme-text-secondary hover:bg-theme-surface-hover touch:min-h-11 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60"
    >
      {disconnecting ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      ) : (
        <Unplug className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      <span>Disconnect</span>
    </button>
  );

  if (!isConnected && !needsReconnect) {
    return (
      <div className="mb-4 space-y-2" data-testid="google-calendar-panel">
        <p className="text-theme-text-muted text-xs">
          Sign in with the Google account that should own the department calendar. The Logbook creates a new calendar
          there and can reach only the calendars it creates.
        </p>
        <div className="flex justify-end">{connectButton}</div>
      </div>
    );
  }

  return (
    <div className="mb-4 space-y-3" data-testid="google-calendar-panel">
      {needsReconnect && (
        <div className="alert-warning text-sm" role="alert">
          <p className="flex items-center gap-1.5 font-medium">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            Reconnect required
          </p>
          {integration.last_error && <p className="mt-1 text-xs">{integration.last_error}</p>}
        </div>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {accountEmail && (
          <>
            <dt className="text-theme-text-muted">Account</dt>
            <dd className="text-theme-text-primary break-all">{accountEmail}</dd>
          </>
        )}
        {calendarName && (
          <>
            <dt className="text-theme-text-muted">Calendar</dt>
            <dd className="text-theme-text-primary flex items-center gap-1">
              <CalendarCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {calendarName}
            </dd>
          </>
        )}
        {isConnected && (
          <>
            <dt className="text-theme-text-muted">Last published</dt>
            <dd className="text-theme-text-primary">
              {integration.last_sync_at ? formatDateTime(integration.last_sync_at, tz) : 'Not yet'}
            </dd>
          </>
        )}
        {isConnected && errorCount > 0 && integration.last_error && (
          <>
            <dt className="text-theme-text-muted">Last error</dt>
            <dd className="text-theme-text-primary">
              {integration.last_error}
              {integration.last_error_at && (
                <span className="text-theme-text-muted"> ({formatDateTime(integration.last_error_at, tz)})</span>
              )}
              <span className="text-theme-text-muted">
                {' '}
                — {errorCount === 1 ? '1 failed run in a row' : `${errorCount} failed runs in a row`}
              </span>
            </dd>
          </>
        )}
      </dl>

      {isConnected && (
        <div className="flex items-center justify-between gap-3">
          <div>
            <p id={`gcal-descriptions-${integration.id}`} className="text-theme-text-primary text-sm">
              Sync event descriptions
            </p>
            <p className="text-theme-text-muted text-xs">
              Off by default: descriptions can hold notes meant only for members.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={syncDescriptions}
            aria-labelledby={`gcal-descriptions-${integration.id}`}
            disabled={savingDescriptions}
            onClick={() => {
              void handleToggleDescriptions();
            }}
            className="mobile-touch-target flex shrink-0 items-center justify-center"
          >
            <span className={`toggle-track-sm ${syncDescriptions ? 'bg-indigo-600' : 'bg-theme-surface-border'}`}>
              <span className={`toggle-knob-sm ${syncDescriptions ? 'translate-x-6' : 'translate-x-1'}`} />
            </span>
          </button>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {needsReconnect && connectButton}
        {disconnectButton}
      </div>
    </div>
  );
};
