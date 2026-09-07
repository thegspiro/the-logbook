/**
 * `/members/admin/settings?tab=…` → the section's own route.
 *
 * Same contract as scheduling's redirect, and the same reason: the sections are
 * routes, so the bare path names none of them, and the app's catch-all would
 * send it to the dashboard — a redirect to somewhere plausible is the worst kind
 * of broken link, because nothing looks wrong.
 *
 * `replace` rather than a push: the parameter form is not a page anybody should
 * be able to go "back" to.
 */

import React from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { MEMBERS_SETTINGS_SECTIONS, membersSettingsPathFor, type MembersSettingsTab } from './membersSettingsSections';

const isTab = (value: string | null): value is MembersSettingsTab =>
  value !== null && MEMBERS_SETTINGS_SECTIONS.some((section) => section.key === value);

const MembersSettingsRedirect: React.FC = () => {
  const [searchParams] = useSearchParams();
  const tab = searchParams.get('tab');

  // An unknown or absent section lands on Contact Visibility rather than
  // nowhere, so a link written against a section that no longer exists still
  // arrives at the settings screen.
  return <Navigate to={membersSettingsPathFor(isTab(tab) ? tab : 'visibility')} replace />;
};

export default MembersSettingsRedirect;
