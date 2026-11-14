/**
 * Google Calendar / Microsoft Outlook card body
 *
 * Connecting is a provider sign-in: "Connect with Google" or "Connect with
 * Microsoft" sends the browser to the provider, and the backend's callback
 * creates the department's calendar and returns to /integrations with a
 * query flag that IntegrationsPage turns into a toast. Once connected this
 * shows which account and calendar events are published to, how publishing
 * is going, the description switch, the range and event types published, and
 * Disconnect.
 */

import React, { useState } from 'react';
import { AlertCircle, CalendarCheck, Loader2, LogIn, Unplug } from 'lucide-react';
import toast from 'react-hot-toast';
import { integrationsService, type IntegrationConfig } from '../../services/api';
import { getErrorMessage } from '../../utils/errorHandling';
import { formatDateTime } from '../../utils/dateFormatting';
import { useTimezone } from '../../hooks/useTimezone';
import { useConfirm } from '../../contexts/ConfirmContext';
import { EventType } from '../../constants/enums';
import { getEventTypeLabel } from '../../utils/eventHelpers';
import type { CalendarProvider } from './calendarProviders';

// The publishing pass's own bounds and default (calendar_sync_service
// DEFAULT_DAYS_AHEAD / MAX_DAYS_AHEAD / PAST_WINDOW); the backend refuses a
// range outside them, so the form says so before it is sent.
const CALENDAR_DEFAULT_DAYS_AHEAD = 180;
const CALENDAR_MAX_DAYS_AHEAD = 730;
const CALENDAR_PAST_DAYS = 30;

/** Event types the pass can be limited to (backend EventType). */
const CALENDAR_EVENT_TYPE_OPTIONS: readonly EventType[] = Object.values(EventType);
const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set(CALENDAR_EVENT_TYPE_OPTIONS);

interface CalendarPublishPanelProps {
  provider: CalendarProvider;
  integration: IntegrationConfig;
  onUpdated: (updated: IntegrationConfig) => void;
  onDisconnected: () => void;
}

const configString = (config: Record<string, unknown>, key: string): string | null => {
  const value = config[key];
  return typeof value === 'string' && value ? value : null;
};

/** The range the pass reads today: a stored whole number, else the default. */
const storedDaysAhead = (config: Record<string, unknown>): number => {
  const value = config['days_ahead'];
  return typeof value === 'number' && Number.isInteger(value) ? value : CALENDAR_DEFAULT_DAYS_AHEAD;
};

const storedEventTypes = (config: Record<string, unknown>): string[] => {
  const value = config['event_types_to_sync'];
  return Array.isArray(value) ? value.filter((t): t is string => typeof t === 'string') : [];
};

/** A whole number of days within the pass's bounds, or null. */
const parseDaysAhead = (raw: string): number | null => {
  if (!/^\d+$/.test(raw.trim())) return null;
  const days = Number(raw.trim());
  return days >= 1 && days <= CALENDAR_MAX_DAYS_AHEAD ? days : null;
};

export const CalendarPublishPanel: React.FC<CalendarPublishPanelProps> = ({
  provider,
  integration,
  onUpdated,
  onDisconnected,
}) => {
  const { confirm } = useConfirm();
  const tz = useTimezone();
  const [starting, setStarting] = useState(false);
  const [savingDescriptions, setSavingDescriptions] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [savingScope, setSavingScope] = useState(false);

  const config = integration.config;
  const savedDays = storedDaysAhead(config);
  const savedTypes = storedEventTypes(config);
  const knownSavedTypes = savedTypes.filter((t) => KNOWN_EVENT_TYPES.has(t));
  const [daysAhead, setDaysAhead] = useState(String(savedDays));
  const [eventTypes, setEventTypes] = useState<string[]>(knownSavedTypes);
  // Re-seed the form when the saved settings change underneath it (a save, a
  // reload), adjusting state during render rather than in an effect.
  const savedScopeKey = `${savedDays}|${savedTypes.join(',')}`;
  const [seededScopeKey, setSeededScopeKey] = useState(savedScopeKey);
  if (seededScopeKey !== savedScopeKey) {
    setSeededScopeKey(savedScopeKey);
    setDaysAhead(String(savedDays));
    setEventTypes(knownSavedTypes);
  }
  // A filter saved through the API before the card validated it can name a
  // type no event has; the pass then publishes none of those events.
  const unknownSavedTypes = savedTypes.filter((t) => !KNOWN_EVENT_TYPES.has(t));
  const parsedDays = parseDaysAhead(daysAhead);
  const daysInputId = `calendar-days-ahead-${integration.id}`;
  const daysErrorId = `${daysInputId}-error`;
  const accountEmail = configString(config, 'account_email');
  const calendarName = configString(config, 'calendar_name');
  const syncDescriptions = config['sync_descriptions'] === true;
  const isConnected = integration.status === 'connected';
  const needsReconnect = integration.status === 'error';
  const errorCount = integration.consecutive_error_count ?? 0;
  const descriptionsLabelId = `calendar-descriptions-${integration.id}`;

  const handleConnect = async () => {
    setStarting(true);
    try {
      const url = await provider.start();
      window.location.href = url;
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, `Could not start the ${provider.signInWith} sign-in`));
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

  const handleSaveScope = async () => {
    if (parsedDays === null) return;
    setSavingScope(true);
    try {
      const updated = await integrationsService.updateIntegration(integration.id, {
        days_ahead: parsedDays,
        event_types_to_sync: eventTypes,
      });
      onUpdated(updated);
      toast.success('Publishing settings saved');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save the publishing settings'));
    } finally {
      setSavingScope(false);
    }
  };

  const handleDisconnect = async () => {
    const confirmed = await confirm({
      title: `Disconnect ${provider.name}?`,
      message: provider.disconnectMessage,
      confirmLabel: 'Disconnect',
      cancelLabel: 'Stay connected',
      variant: 'warning',
    });
    if (!confirmed) return;
    setDisconnecting(true);
    try {
      await integrationsService.disconnectIntegration(integration.id);
      toast.success(`${provider.name} disconnected`);
      onDisconnected();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, `Could not disconnect ${provider.name}`));
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
      <span>
        {starting ? 'Redirecting…' : `${needsReconnect ? 'Reconnect' : 'Connect'} with ${provider.signInWith}`}
      </span>
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
      <div className="mb-4 space-y-2" data-testid={`${provider.integrationType}-panel`}>
        <p className="text-theme-text-muted text-xs">{provider.intro}</p>
        <div className="flex justify-end">{connectButton}</div>
      </div>
    );
  }

  return (
    <div className="mb-4 space-y-3" data-testid={`${provider.integrationType}-panel`}>
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
            <p id={descriptionsLabelId} className="text-theme-text-primary text-sm">
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
            aria-labelledby={descriptionsLabelId}
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

      {isConnected && (
        <fieldset className="space-y-3" data-testid={`${provider.integrationType}-publish-scope`}>
          <legend className="text-theme-text-primary text-sm">What is published</legend>
          <div>
            <label htmlFor={daysInputId} className="form-label">
              Days ahead
            </label>
            <input
              id={daysInputId}
              type="number"
              inputMode="numeric"
              min={1}
              max={CALENDAR_MAX_DAYS_AHEAD}
              step={1}
              value={daysAhead}
              onChange={(e) => setDaysAhead(e.target.value)}
              aria-invalid={parsedDays === null}
              aria-describedby={parsedDays === null ? daysErrorId : undefined}
              className="form-input w-28"
            />
            {parsedDays === null ? (
              <p id={daysErrorId} className="mt-1 text-xs text-red-700 dark:text-red-300" role="alert">
                Enter a whole number of days from 1 to {CALENDAR_MAX_DAYS_AHEAD}.
              </p>
            ) : (
              <p className="text-theme-text-muted mt-1 text-xs">
                Events from {CALENDAR_PAST_DAYS} days ago to this many days ahead. Default {CALENDAR_DEFAULT_DAYS_AHEAD}
                .
              </p>
            )}
          </div>
          <div>
            <p className="form-label">Event types</p>
            <div className="mt-1 space-y-1">
              {CALENDAR_EVENT_TYPE_OPTIONS.map((value) => (
                <label key={value} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="form-checkbox"
                    checked={eventTypes.includes(value)}
                    onChange={(e) =>
                      setEventTypes((current) =>
                        e.target.checked ? [...current, value] : current.filter((t) => t !== value)
                      )
                    }
                  />
                  <span className="text-theme-text-primary">{getEventTypeLabel(value)}</span>
                </label>
              ))}
            </div>
            <p className="text-theme-text-muted mt-1 text-xs">
              Leave all unticked to publish every type. Drafts and cancelled events are never published.
            </p>
            {unknownSavedTypes.length > 0 && (
              <p className="alert-warning mt-2 text-xs" role="status">
                The saved filter also names {unknownSavedTypes.join(', ')}, which no event can have, so events of those
                types are not published. Saving replaces the filter with the types ticked above.
              </p>
            )}
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => {
                void handleSaveScope();
              }}
              disabled={savingScope || parsedDays === null}
              className="btn-primary touch:min-h-11 inline-flex items-center gap-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              {savingScope && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              <span>Save publishing settings</span>
            </button>
          </div>
        </fieldset>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {needsReconnect && connectButton}
        {disconnectButton}
      </div>
    </div>
  );
};
