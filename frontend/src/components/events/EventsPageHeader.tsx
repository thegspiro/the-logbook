import React from 'react';
import { EVENTS_NAV_ITEMS } from '../layout/eventsNavigation';
import { SectionPageHeader } from '../layout/SectionPageHeader';
import type { PageHeaderProps } from '../layout/SectionPageHeader';

/**
 * The header every Events page shares — `SectionPageHeader` with the Events
 * sections. An event's own pages (detail, edit, monitoring, analytics, QR
 * code) sit under `/events/…`, so the strip marks Events and the trail starts
 * there.
 */
export const EventsPageHeader: React.FC<PageHeaderProps> = (props) => (
  <SectionPageHeader {...props} sections={EVENTS_NAV_ITEMS} stripLabel="Events sections" />
);

export default EventsPageHeader;
