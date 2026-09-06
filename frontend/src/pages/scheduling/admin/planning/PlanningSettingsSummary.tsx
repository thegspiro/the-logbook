/**
 * The settings a planned shift starts from — shown here, edited in one place.
 *
 * An officer working the gaps list is the person who notices that the default
 * crew is wrong, so the values belong on this screen. Editing them does not:
 * General and Apparatus are written by one footer Save that PUTs the whole
 * `ShiftSettings` object, so a second screen writing them means whichever saved
 * last silently reverts the other. That is the failure that moved checklist
 * timing to a single home in Inventory, and this is the same shape of trap.
 *
 * Read-only, with a link to the screen that owns them.
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Settings2 } from 'lucide-react';
import {
  ensureShiftSettingsLoaded,
  getCachedShiftSettings,
} from '../../../../modules/scheduling/services/shiftSettingsApi';
import type { ShiftSettings } from '../../../../modules/scheduling/types/shiftSettings';
import { schedulingService } from '../../../../modules/scheduling/services/api';
import type { SchedulingFeatureSettings } from '../../../../modules/scheduling/services/api';

interface Row {
  label: string;
  value: string;
  /** Where this value is actually edited. */
  href: string;
}

const PlanningSettingsSummary: React.FC = () => {
  const [settings, setSettings] = useState<ShiftSettings>(() => getCachedShiftSettings());
  const [feature, setFeature] = useState<SchedulingFeatureSettings | null>(null);
  // Whether anything below is actually this department's answer.
  //
  // `getCachedShiftSettings()` falls back through localStorage to
  // `DEFAULT_SETTINGS`, so a failed load on a fresh browser renders the built-in
  // numbers — "8 hours", "4 people" — in a card whose whole claim is "what a
  // planned shift starts from". A value nobody read presented as the
  // department's own configuration is worse than no card at all, and this screen
  // links each row to the page that edits it, so an officer following one would
  // find a value that does not match what they were just shown.
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let anyFailed = false;
      try {
        const loaded = await ensureShiftSettingsLoaded();
        if (!cancelled) setSettings(loaded);
      } catch {
        anyFailed = true;
      }
      try {
        const loaded = await schedulingService.getFeatureSettings();
        if (!cancelled) setFeature(loaded);
      } catch {
        anyFailed = true;
      }
      if (!cancelled) setFailed(anyFailed);
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const general = '/scheduling/admin/settings/general';
  const apparatus = '/scheduling/admin/settings/apparatus';

  const rows: Row[] = [
    { label: 'Default shift length', value: `${settings.defaultDurationHours} hours`, href: general },
    { label: 'Default minimum staffing', value: `${settings.defaultMinStaffing} people`, href: general },
    {
      label: 'Overtime threshold',
      value: `${settings.overtimeThresholdHoursPerWeek} hours/week`,
      href: general,
    },
    {
      label: 'Apparatus type defaults',
      value: `${Object.keys(settings.apparatusTypeDefaults ?? {}).length} configured`,
      href: apparatus,
    },
    {
      label: 'Automatic generation',
      value: feature
        ? feature.auto_generate_enabled
          ? `On · ${feature.auto_generate_weeks} weeks ahead`
          : 'Off'
        : '—',
      href: general,
    },
  ];

  return (
    <section className="card p-4">
      <div className="flex items-center gap-2">
        <Settings2 className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
        <h3 className="text-theme-text-primary text-sm font-semibold">What a planned shift starts from</h3>
      </div>
      <p className="text-theme-text-muted mt-1 text-xs">
        Shown here, changed in Scheduling settings — one editing home, so two screens cannot overwrite each other.
      </p>
      {failed && (
        <div className="alert-warning mt-3 flex flex-wrap items-center gap-2 text-sm" role="alert">
          <span className="min-w-0 flex-1">
            These settings did not load, so the values below may be the built-in defaults rather than your
            department&rsquo;s.
          </span>
          <button
            type="button"
            className="mobile-touch-target px-2 font-semibold underline"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Retry
          </button>
        </div>
      )}
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3">
            <dt className="text-theme-text-muted text-xs">{row.label}</dt>
            <dd className="text-theme-text-primary text-xs font-medium">
              {/* `mobile-touch-target` for the same reason the close-out mirror
                  carries it: a 14px-tall link is a real control at 47x14, and a
                  thumb misses it. The ratchet could not see these until the
                  route declared its permissions — before that it was measuring
                  Access Denied. */}
              <Link to={row.href} className="mobile-touch-target px-1 hover:underline">
                {row.value}
              </Link>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
};

export default PlanningSettingsSummary;
