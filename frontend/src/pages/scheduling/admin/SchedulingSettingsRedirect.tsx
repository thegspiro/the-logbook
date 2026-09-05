/**
 * `/scheduling/admin/settings?tab=…` → the section's own route.
 *
 * Scheduling's settings sections are routes rather than a `?tab=` on one page,
 * because a section reached from a hub card, from another module, or from
 * somebody's bookmarks has to be addressable. That leaves every link written
 * against the older contract pointing at a path with no section on it, and the
 * app's catch-all would send those to the dashboard — a redirect to somewhere
 * plausible is the worst kind of broken link, because nothing looks wrong.
 *
 * So the bare path keeps working and forwards to the section it names. `replace`
 * rather than a push: the parameter form is not a page anybody should be able to
 * go "back" to.
 */

import React from 'react';
import { Navigate, useSearchParams } from 'react-router';
import {
  SCHEDULING_SETTINGS_SECTIONS,
  settingsPathFor,
  type SettingsTab,
} from '../../../modules/scheduling/components/schedulingSettingsSections';

const isSettingsTab = (value: string | null): value is SettingsTab =>
  value !== null && SCHEDULING_SETTINGS_SECTIONS.some((section) => section.key === value);

const SchedulingSettingsRedirect: React.FC = () => {
  const [searchParams] = useSearchParams();
  const tab = searchParams.get('tab');

  // An unknown or absent section lands on General rather than nowhere — the
  // Equipment section, for one, no longer exists, and a link to it should still
  // arrive at the settings screen.
  return <Navigate to={settingsPathFor(isSettingsTab(tab) ? tab : 'general')} replace />;
};

export default SchedulingSettingsRedirect;
