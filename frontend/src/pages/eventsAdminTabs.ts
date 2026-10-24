/**
 * The Events administration hub's sections, kept apart from the page so the
 * command palette — part of the always-loaded shell — can offer each one
 * without pulling the hub into the main bundle.
 */

import { CalendarPlus, History, Inbox, Megaphone, Nfc, QrCode, Settings } from 'lucide-react';
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
