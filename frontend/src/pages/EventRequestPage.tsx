/**
 * One outreach request on a page of its own, at /events/admin/requests/:requestId.
 *
 * Owner decision, 2026-11-21: a request opens as a page rather than a side
 * panel over the board, so it can be linked from a coordinator's email,
 * bookmarked, refreshed into and left with the back button. The board and the
 * page are one component (EventRequestsTab) so the two cannot drift apart.
 *
 * Owner decision, 2026-11-26: the page keeps the Events Administration header
 * — the Events strip, the admin title and the Community Outreach page row with
 * Outreach Requests selected — but not the hub's metrics, attention queue or
 * area cards. With those, the request itself started below the first screen on
 * a phone.
 */

import React, { useState } from 'react';
import { useParams } from 'react-router';
import EventRequestsTab from './EventRequestsTab';
import AdminPageHeader from '../components/admin/AdminPageHeader';
import { EventsSectionStrip } from '../components/events/EventsPageHeader';
import { SectionStrip } from '../components/layout/SectionPageHeader';
import type { SectionNavItem } from '../components/layout/sectionNavigation';
import { EVENTS_ADMIN_AREAS } from './eventsAdminTabs';

const HUB_PATH = '/events/admin';
const BOARD_PATH = `${HUB_PATH}?tab=requests`;

/**
 * The Community Outreach area's pages, as links into the hub. Derived from the
 * hub's own list so a page added to the area appears here too.
 */
const OUTREACH_PAGES: SectionNavItem[] = (
  EVENTS_ADMIN_AREAS.find((area) => area.id === 'outreach')?.destinations ?? []
).map((destination) => ({
  label: destination.label,
  path: `${HUB_PATH}?tab=${destination.id}`,
  icon: destination.icon,
}));

const EventRequestPage: React.FC = () => {
  const { requestId } = useParams<{ requestId: string }>();
  const [requestTitle, setRequestTitle] = useState<string | null>(null);

  // Explicit, because the URL cannot describe this trail: `/events/admin/requests`
  // is not a route, so a generated crumb for it would be plain text rather than
  // the way back to the board.
  const trail = [
    { label: 'Events', path: '/events' },
    { label: 'Events Administration', path: HUB_PATH },
    { label: 'Outreach Requests', path: BOARD_PATH },
    { label: requestTitle || 'Request' },
  ];

  return (
    <div className="mx-auto max-w-7xl pt-6 sm:pt-8">
      <AdminPageHeader
        title="Events Administration"
        description="Create and manage events, view analytics"
        breadcrumbs={trail}
        belowTrail={<EventsSectionStrip />}
      />
      <div className="mt-5">
        <SectionStrip sections={OUTREACH_PAGES} stripLabel="Community Outreach pages" activePath={BOARD_PATH} />
      </div>
      <EventRequestsTab requestId={requestId} onRequestTitle={setRequestTitle} />
    </div>
  );
};

export default EventRequestPage;
