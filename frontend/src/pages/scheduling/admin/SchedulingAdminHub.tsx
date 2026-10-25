/**
 * Scheduling Administration
 *
 * Everything an officer administers about the schedule, in the Administration
 * section beside Training Admin and Inventory Admin. Before this existed the
 * settings, templates, patterns, reports, platoons and the position roster were
 * reachable only from a row of cards on the member-facing `/scheduling` page —
 * so an administrator had to open the schedule to find the settings, and the
 * Administration section, which is where the rest of the product puts this,
 * had no scheduling entry at all.
 *
 * One grant runs the whole area: `scheduling.manage`, on this route, on every
 * page behind it, and on the nav rows that offer it.
 *
 * This is the hub's Overview: the setup guide, with Headline Metrics beside it
 * at `?tab=settings`. Everything else is reached through the area cards and
 * page strip `SchedulingAdminLayout` draws above it — the same header the hub's
 * other pages are drawn inside, and the one Training and Inventory
 * Administration draw, so the officer is never sent off to a page that has
 * forgotten where it came from.
 */

import React from 'react';
import { useSearchParams } from 'react-router';
import { AdminMetricsSettings } from '../../../components/admin';
import { SchedulingAdminLayout } from './SchedulingAdminLayout';
import { useSchedulingAdminShell } from './schedulingAdminShell';
import { SchedulingSetupGuide } from './SchedulingSetupGuide';

const SchedulingAdminOverview: React.FC = () => {
  const shell = useSchedulingAdminShell();
  const canManage = shell?.canManage ?? false;
  const [searchParams] = useSearchParams();

  // Settings edits the scheduling headline metrics; both its read and its write
  // require `scheduling.manage`, which this route also requires. Kept guarded
  // rather than simplified away: `?tab=settings` reaches this panel whether or
  // not the strip offers it, so the refusal belongs on the URL and not only on
  // the control — and that stays true however the route's gate moves.
  if (searchParams.get('tab') === 'settings' && canManage) {
    return (
      <div className="py-6">
        <AdminMetricsSettings
          moduleKey="scheduling"
          moduleLabel="Scheduling"
          permission="scheduling.manage"
          onSaved={() => shell?.refreshFrame()}
        />
      </div>
    );
  }

  // The tool cards that used to sit here are the area cards and page strip
  // above now, so the Overview holds only what the header does not: the
  // getting-started steps, which draw nothing once scheduling is set up. What
  // needs a decision today is the frame's own attention queue, above the cards.
  return <div className="py-6 sm:py-8">{canManage && <SchedulingSetupGuide />}</div>;
};

const SchedulingAdminHub: React.FC = () => (
  <SchedulingAdminLayout>
    <SchedulingAdminOverview />
  </SchedulingAdminLayout>
);

export default SchedulingAdminHub;
