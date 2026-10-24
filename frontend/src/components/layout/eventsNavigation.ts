import { BarChart3, Calendar, FileText, Hand } from 'lucide-react';
import type { SectionNavItem } from './sectionNavigation';

/**
 * The Events sections, drawn as the strip at the top of every Events page.
 * See `SectionNavItem` for the rule every gate here must keep.
 *
 * Attendance Requests carries no gate on purpose: the server scopes it to the
 * events the viewer organizes, so a permission would lock out the organizers
 * who hold no events.manage. Templates and Attendance Trends mirror their
 * routes' gates exactly.
 */
export const EVENTS_NAV_ITEMS: SectionNavItem[] = [
  { label: 'Events', path: '/events', icon: Calendar },
  { label: 'Attendance Requests', path: '/events/attendance-requests', icon: Hand },
  { label: 'Event Templates', path: '/events/templates', icon: FileText, permission: 'events.manage' },
  { label: 'Attendance Trends', path: '/events/analytics', icon: BarChart3, permission: 'analytics.view' },
];
