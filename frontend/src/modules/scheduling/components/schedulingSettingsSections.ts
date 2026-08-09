/**
 * Section definitions for the scheduling settings screen.
 *
 * Separate from ShiftSettingsPanel so both the page (which renders the nav and
 * owns the URL) and the panel (which renders one section's body) can read them
 * without the panel exporting non-components alongside itself.
 */

import { Truck, ClipboardCheck, Bell, LayoutTemplate, Shield, FileBarChart, Users } from 'lucide-react';
import type { SettingsSection } from '../../../components/settings/SettingsLayout';

export type SettingsTab =
  'general' | 'apparatus' | 'platoons' | 'notifications' | 'equipment' | 'eligibility' | 'shift-reports';

export const SCHEDULING_SETTINGS_SECTIONS: SettingsSection<SettingsTab>[] = [
  { key: 'general', label: 'General', icon: LayoutTemplate, description: 'Shift defaults, overtime, and close-out' },
  { key: 'apparatus', label: 'Apparatus', icon: Truck, description: 'Apparatus and resource type defaults' },
  { key: 'platoons', label: 'Platoons', icon: Users, description: 'Platoon rosters and assignments' },
  { key: 'eligibility', label: 'Eligibility', icon: Shield, description: 'Who may sign up for a shift' },
  { key: 'notifications', label: 'Notifications', icon: Bell, description: 'Shift reminders and alerts' },
  { key: 'equipment', label: 'Equipment', icon: ClipboardCheck, description: 'Check requirements and templates' },
  { key: 'shift-reports', label: 'Shift Reports', icon: FileBarChart, description: 'End-of-shift reporting options' },
];

/**
 * Sections whose values live in the panel's local `settings` object and are
 * written by its footer Save button. Every other section owns its own save
 * control, so showing the footer there claimed to save work it never touched.
 */
export const LOCALLY_SAVED_SECTIONS: SettingsTab[] = ['general', 'apparatus', 'equipment'];
