/**
 * The Events administration hub's sections, kept apart from the page so the
 * command palette — part of the always-loaded shell — can offer each one
 * without pulling the hub into the main bundle.
 *
 * The hub draws them two levels deep, the way Training, Inventory and
 * Scheduling Administration do: area cards above a strip of the chosen area's
 * pages. The URL stays `?tab=<page>` — page ids are unique across the hub, so
 * the area is derived from the page, and every existing link (the dashboard
 * widgets, the command palette, the backend's attention queue) resolves
 * unchanged.
 */

import type { LucideIcon } from 'lucide-react';
import { CalendarDays, CalendarPlus, History, Inbox, Megaphone, Nfc, QrCode, ScanLine, Settings } from 'lucide-react';
import type { AdminHubCardTab } from '../components/admin/AdminHubCardTabs';

export type EventsAdminTab =
  'create' | 'past_events' | 'requests' | 'analytics' | 'community' | 'card_checkins' | 'settings';

/**
 * Settings is always last — the frame's rule, on every module. Every tab is
 * described, so the frame draws them as cards that say what each one holds;
 * the card type makes the line and icon required, which the command palette
 * relies on too.
 */
export const EVENTS_ADMIN_TABS: AdminHubCardTab<EventsAdminTab>[] = [
  {
    id: 'create',
    label: 'Create Event',
    description: 'A one-off or recurring event, or one from a template',
    icon: CalendarPlus,
  },
  { id: 'past_events', label: 'Past Events', description: 'Events that have already happened', icon: History },
  { id: 'requests', label: 'Requests', description: 'Community requests for outreach events', icon: Inbox },
  { id: 'analytics', label: 'QR Code Analytics', description: 'Check-ins by QR code, device and error', icon: QrCode },
  {
    id: 'community',
    label: 'Community Engagement',
    description: 'How far public outreach events reach',
    icon: Megaphone,
  },
  {
    id: 'card_checkins',
    label: 'Card Check-ins',
    description: 'Member ID card taps at stations and room kiosks',
    icon: Nfc,
  },
  {
    id: 'settings',
    label: 'Settings',
    description: 'Event types, categories, the request pipeline and metrics',
    icon: Settings,
  },
];

export type EventsAdminAreaId = 'events' | 'outreach' | 'check_ins' | 'settings';

export interface EventsAdminArea {
  id: EventsAdminAreaId;
  label: string;
  description: string;
  icon: LucideIcon;
  /** The area's pages, in strip order. */
  destinations: AdminHubCardTab<EventsAdminTab>[];
}

const tabById = (id: EventsAdminTab): AdminHubCardTab<EventsAdminTab> => {
  const tab = EVENTS_ADMIN_TABS.find((candidate) => candidate.id === id);
  if (!tab) throw new Error(`Unknown events admin tab: ${id}`);
  return tab;
};

/**
 * Grouped by what the coordinator came to do. Every tab belongs to exactly one
 * area — `eventsAdminTabs.test.ts` holds that — so a tab added above without a
 * home here fails a test rather than disappearing from the hub.
 */
export const EVENTS_ADMIN_AREAS: EventsAdminArea[] = [
  {
    id: 'events',
    label: 'Events',
    description: 'Create events, and look back at ones that happened',
    icon: CalendarDays,
    destinations: [tabById('create'), tabById('past_events')],
  },
  {
    id: 'outreach',
    label: 'Community Outreach',
    description: 'Requests from the public, and how far outreach reaches',
    icon: Megaphone,
    destinations: [tabById('requests'), tabById('community')],
  },
  {
    id: 'check_ins',
    label: 'Check-ins',
    description: 'How members and visitors checked in',
    icon: ScanLine,
    destinations: [tabById('analytics'), tabById('card_checkins')],
  },
  {
    id: 'settings',
    label: 'Settings',
    description: 'Event types, categories, the request pipeline and metrics',
    icon: Settings,
    destinations: [tabById('settings')],
  },
];

const DEFAULT_TAB: EventsAdminTab = 'create';

const isEventsAdminTab = (value: string | null): value is EventsAdminTab =>
  value !== null && EVENTS_ADMIN_TABS.some((tab) => tab.id === value);

export interface EventsAdminLocation {
  area: EventsAdminArea;
  tab: EventsAdminTab;
}

/** Resolve `?tab=` to its area and page; a missing or unknown tab opens Create Event. */
export const resolveEventsAdminLocation = (tabParam: string | null): EventsAdminLocation => {
  const tab = isEventsAdminTab(tabParam) ? tabParam : DEFAULT_TAB;
  const area =
    EVENTS_ADMIN_AREAS.find((candidate) => candidate.destinations.some((destination) => destination.id === tab)) ??
    EVENTS_ADMIN_AREAS[0];
  if (!area) throw new Error('Events admin hub has no areas');
  return { area, tab };
};

/** Element ids shared by the nav's tabs and the panels the hub renders for them. */
export const EVENTS_ADMIN_AREA_ID_PREFIX = 'events-admin-area';
export const eventsAdminTabId = (tab: string) => `events-admin-tab-${tab}`;
export const eventsAdminTabPanelId = (tab: string) => `events-admin-tabpanel-${tab}`;
