/** Permissions that make at least one item in the Administration section visible. */
export const ADMIN_NAVIGATION_PERMISSIONS = [
  'members.manage',
  'prospective_members.manage',
  'events.manage',
  'training.manage',
  'inventory.manage',
  // The equipment-check console is administered from inside the Inventory
  // Administration hub and this is the grant that runs it. Without it here the
  // section never renders, so the officer's row inside it is never built --
  // a child gate cannot admit anyone its parent has already turned away.
  'inventory.check_manage',
  // Scheduling Administration's own grant. Without it a scheduling officer who
  // holds nothing else administrative never sees the section open, so the row
  // inside it is never built -- the same failure the line above documents.
  'scheduling.manage',
  'storefront.manage',
  'admin_hours.manage',
  'medical_screening.view',
  'positions.manage_permissions',
  'settings.manage',
  'forms.manage',
  'notifications.manage',
  'suggestions.manage',
  'reports.view',
  // Member evaluation setup is delegated on its own grants, without
  // reports.view, and its rows live in this section.
  'evaluations.configure',
  'evaluations.manage',
  'analytics.view',
  'audit.view',
] as const;

export const hasAdministrationAccess = (checkPermission: (permission: string) => boolean): boolean =>
  ADMIN_NAVIGATION_PERMISSIONS.some(checkPermission);

interface AdministrationSectionOptions {
  /** Whether the NFC ID-cards integration is connected, which is what puts the Check-In Station row in the section. */
  checkInStationOn?: boolean;
}

// users.view alone also opens the Administration section: the member ID
// scanner lives there, and validating a scanned card only needs users.view
// (see /members/scan) — but users.view is not itself an administrative grant,
// so it stays out of ADMIN_NAVIGATION_PERMISSIONS.
//
// members.check_in opens it for the same reason, but only while the
// Check-In Station row exists: that row is built only when the department has
// connected NFC ID cards, and opening the section for a holder with nothing
// inside it is an empty heading rather than a way to their page.
export const canOpenAdministrationSection = (
  checkPermission: (permission: string) => boolean,
  { checkInStationOn = false }: AdministrationSectionOptions = {}
): boolean =>
  checkPermission('users.view') ||
  (checkInStationOn && checkPermission('members.check_in')) ||
  hasAdministrationAccess(checkPermission);
