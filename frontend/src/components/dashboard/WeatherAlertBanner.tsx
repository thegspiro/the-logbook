/**
 * Severe-weather banner for the dashboard.
 *
 * Shows the department's active Severe and Extreme NWS alerts while they are
 * in effect, when the department turned the banner on for its NWS Weather
 * Alerts integration (owner decision 2026-10-29). The server decides all of
 * that; this only draws what it returns, and draws nothing when the read
 * fails, so a weather outage never costs a member their dashboard.
 *
 * Re-read every five minutes: the server polls the zone every fifteen, and a
 * dashboard left open on a station screen should pick up a new warning without
 * a reload.
 */

import React, { useEffect, useState } from 'react';
import { CloudLightning } from 'lucide-react';
import { integrationsService } from '../../services/api';
import type { ActiveWeatherAlert } from '../../services/api';
import { useTimezone } from '../../hooks/useTimezone';
import { useEnabledModules } from '../../hooks/useEnabledModules';
import { formatDateTime } from '../../utils/dateFormatting';

const REFRESH_MS = 5 * 60 * 1000;

export const WeatherAlertBanner: React.FC = () => {
  const tz = useTimezone();
  const [alerts, setAlerts] = useState<ActiveWeatherAlert[]>([]);
  // The alerts belong to the Integrations module, and the server refuses the
  // read while it is off, so every dashboard of a department that never turned
  // it on drew a 403 every five minutes.
  const { isModuleOn, isLoading: modulesLoading } = useEnabledModules();
  const integrationsOn = !modulesLoading && isModuleOn('integrations');

  useEffect(() => {
    if (!integrationsOn) {
      setAlerts([]);
      return undefined;
    }
    let active = true;
    const load = () => {
      integrationsService
        .getActiveWeatherAlerts()
        .then((next) => {
          if (active) setAlerts(next);
        })
        .catch(() => {
          if (active) setAlerts([]);
        });
    };
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [integrationsOn]);

  if (alerts.length === 0) return null;

  return (
    <section aria-label="Severe weather alerts" className="mb-4 space-y-2">
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className={`${alert.severity === 'Extreme' ? 'alert-danger' : 'alert-warning'} flex items-start gap-3`}
        >
          <CloudLightning className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 text-sm">
            <p className="font-semibold">
              {alert.event} <span className="font-normal">· {alert.severity}</span>
            </p>
            {alert.headline && <p>{alert.headline}</p>}
            {alert.expires && <p className="text-xs">Until {formatDateTime(alert.expires, tz)}</p>}
            {alert.instruction && (
              <details className="mt-1">
                <summary className="cursor-pointer text-xs font-medium">What to do</summary>
                <p className="mt-1 text-xs whitespace-pre-line">{alert.instruction}</p>
              </details>
            )}
            <p className="mt-1 text-xs opacity-80">From the National Weather Service.</p>
          </div>
        </div>
      ))}
    </section>
  );
};

export default WeatherAlertBanner;
