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
import { useAuthStore } from '../../../../stores/authStore';
import { MEMBERS_SETTINGS_SECTIONS, membersSettingsPathFor, type MembersSettingsTab } from './membersSettingsSections';

const isTab = (value: string | null): value is MembersSettingsTab =>
  value !== null && MEMBERS_SETTINGS_SECTIONS.some((section) => section.key === value);

const MembersSettingsRedirect: React.FC = () => {
  const [searchParams] = useSearchParams();
  const checkPermission = useAuthStore((state) => state.checkPermission);
  const tab = searchParams.get('tab');

  // The default has to be a section this officer can actually open, not simply
  // the first one declared. The bare path admits anyone who can open *any*
  // section, so sending an officer holding only `settings.edit` to Contact
  // Visibility — which wants a settings-manage grant — answered a route that
  // admitted them with an Access Denied one navigation later.
  const firstOpenable = MEMBERS_SETTINGS_SECTIONS.find((section) =>
    section.permissions.some((permission) => checkPermission(permission))
  )?.key;

  // A named section is honoured even when this officer cannot open it: the page
  // itself redirects on to one they can, and it is the page that knows. Falling
  // back here as well would silently rewrite a good link.
  const destination = isTab(tab) ? tab : (firstOpenable ?? 'visibility');

  return <Navigate to={membersSettingsPathFor(destination)} replace />;
};

export default MembersSettingsRedirect;
