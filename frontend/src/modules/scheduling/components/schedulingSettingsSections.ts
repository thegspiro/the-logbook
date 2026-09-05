/**
 * Section definitions for the scheduling settings screen.
 *
 * Separate from ShiftSettingsPanel so both the page (which renders the nav and
 * owns the URL) and the panel (which renders one section's body) can read them
 * without the panel exporting non-components alongside itself.
 *
 * Each section is its own route under the Scheduling Administration hub rather
 * than a `?tab=` on one page: a settings screen an officer is sent to — from a
 * hub card, from a link in another module, from their own bookmarks — has to be
 * addressable, and a query parameter that only a client-side `useState` reads
 * is not. `path` is the single place those URLs are written down, so the routes,
 * the hub cards and the nav cannot drift into three spellings.
 */

import { Truck, Bell, LayoutTemplate, Shield, FileBarChart, Users } from 'lucide-react';
import type { SettingsSection } from '../../../components/settings/SettingsLayout';

export type SettingsTab = 'general' | 'apparatus' | 'platoons' | 'notifications' | 'eligibility' | 'shift-reports';

export interface SchedulingSettingsSection extends SettingsSection<SettingsTab> {
  /** The route this section is reached at. */
  path: string;
}

export const SCHEDULING_SETTINGS_SECTIONS: SchedulingSettingsSection[] = [
  {
    key: 'general',
    label: 'General',
    icon: LayoutTemplate,
    description: 'Shift defaults, overtime, and close-out',
    path: '/scheduling/admin/settings/general',
  },
  {
    key: 'apparatus',
    label: 'Apparatus',
    icon: Truck,
    description: 'Apparatus and resource type defaults',
    path: '/scheduling/admin/settings/apparatus',
  },
  {
    key: 'platoons',
    label: 'Platoons',
    icon: Users,
    description: 'Platoon rosters and assignments',
    path: '/scheduling/admin/settings/platoons',
  },
  {
    key: 'eligibility',
    label: 'Eligibility',
    icon: Shield,
    description: 'Who may sign up for a shift',
    path: '/scheduling/admin/settings/eligibility',
  },
  {
    key: 'notifications',
    label: 'Notifications',
    icon: Bell,
    description: 'Shift reminders and alerts',
    path: '/scheduling/admin/settings/notifications',
  },
  {
    key: 'shift-reports',
    label: 'Shift Reports',
    icon: FileBarChart,
    description: 'End-of-shift reporting options',
    path: '/scheduling/admin/settings/shift-reports',
  },
];

/**
 * Where a section is reached. Falls back to General for a key that no longer
 * has a section — a stale link should land on the settings screen rather than
 * on nothing.
 */
export const settingsPathFor = (tab: SettingsTab): string =>
  SCHEDULING_SETTINGS_SECTIONS.find((section) => section.key === tab)?.path ?? '/scheduling/admin/settings/general';

/**
 * Sections whose values live in the panel's local `settings` object and are
 * written by its footer Save button. Every other section owns its own save
 * control, so showing the footer there claimed to save work it never touched.
 */
export const LOCALLY_SAVED_SECTIONS: SettingsTab[] = ['general', 'apparatus'];
