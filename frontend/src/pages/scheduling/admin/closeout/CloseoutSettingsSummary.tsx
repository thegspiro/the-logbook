/**
 * What close-out asks for — shown here, changed in Scheduling settings.
 *
 * The officer working the queue is the person who notices that close-out is
 * asking for the wrong things, so the values belong on this screen. Editing
 * them does not: they are written from the General and Shift Reports sections,
 * and a second screen writing the same object means whichever saved last
 * silently reverts the other. One editing home, and a link to it — the same
 * rule the planning screen follows.
 *
 * Read-only, with each row linking to the section that owns it.
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Settings2 } from 'lucide-react';
import { schedulingService } from '../../../../modules/scheduling/services/api';
import type { SchedulingFeatureSettings } from '../../../../modules/scheduling/services/api';

interface Row {
  label: string;
  value: string;
  /** Where this value is actually edited. */
  href: string;
  /** Why it matters to somebody closing a shift out. */
  hint?: string;
}

const GENERAL = '/scheduling/admin/settings/general';
const SHIFT_REPORTS = '/scheduling/admin/settings/shift-reports';

const CloseoutSettingsSummary: React.FC = () => {
  const [feature, setFeature] = useState<SchedulingFeatureSettings | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await schedulingService.getFeatureSettings();
        if (!cancelled) setFeature(loaded);
      } catch {
        // Non-critical: the queue above it is the page, and a dash reads as
        // "not loaded" rather than as a value nobody set.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const countOnly = feature?.call_tracking?.mode === 'count_only';

  const rows: Row[] = [
    {
      label: 'End-of-shift equipment checks',
      value: feature ? (feature.require_end_of_shift_checks ? 'Block close-out' : 'Noted, do not block') : '—',
      href: GENERAL,
      hint: 'Whether an outstanding checklist stops the shift being closed',
    },
    {
      label: 'Call volume',
      value: feature ? (countOnly ? 'A count at close-out' : 'Individual call records') : '—',
      href: GENERAL,
      hint: countOnly
        ? 'Close-out asks for the count and credits it to the crew'
        : 'Close-out does not ask for a count',
    },
    {
      label: 'Open-ended shift cushion',
      value: feature?.open_ended_shift_cushion_hours ? `${feature.open_ended_shift_cushion_hours} hours` : '—',
      href: GENERAL,
      hint: 'How long past its start a shift with no recorded end still counts as running',
    },
    {
      label: 'Call types',
      value: feature ? `${feature.call_tracking?.call_types?.length ?? 0} configured` : '—',
      href: GENERAL,
      hint: 'The breakdown the close-out wizard asks for',
    },
    {
      label: 'End-of-shift report',
      value: 'Shift Reports section',
      href: SHIFT_REPORTS,
      hint: 'What the report asks for, and who reviews it',
    },
  ];

  return (
    <section className="card p-4">
      <div className="flex items-center gap-2">
        <Settings2 className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
        <h3 className="text-theme-text-primary text-sm font-semibold">What close-out asks for</h3>
      </div>
      <p className="text-theme-text-muted mt-1 text-xs">
        Shown here, changed in Scheduling settings — one editing home, so two screens cannot overwrite each other.
      </p>
      <dl className="mt-3 space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <dt className="min-w-0">
              <span className="text-theme-text-muted text-xs">{row.label}</span>
              {row.hint && <span className="text-theme-text-muted block text-[11px] opacity-80">{row.hint}</span>}
            </dt>
            <dd className="text-theme-text-primary shrink-0 text-xs font-medium">
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

export default CloseoutSettingsSummary;
