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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await ensureShiftSettingsLoaded();
        if (!cancelled) setSettings(loaded);
      } catch {
        // The cached copy is already rendered; a failed refresh leaves it.
      }
      try {
        const loaded = await schedulingService.getFeatureSettings();
        if (!cancelled) setFeature(loaded);
      } catch {
        // Non-critical — the rows below it still render.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3">
            <dt className="text-theme-text-muted text-xs">{row.label}</dt>
            <dd className="text-theme-text-primary text-xs font-medium">
              <Link to={row.href} className="hover:underline">
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
