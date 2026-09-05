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
  'storefront.manage',
  'admin_hours.manage',
  'medical_screening.view',
  'positions.manage_permissions',
  'settings.manage',
  'forms.manage',
  'notifications.manage',
  'reports.view',
  'analytics.view',
  'audit.view',
] as const;

export const hasAdministrationAccess = (checkPermission: (permission: string) => boolean): boolean =>
  ADMIN_NAVIGATION_PERMISSIONS.some(checkPermission);

// users.view alone also opens the Administration section: the member ID
// scanner lives there, and validating a scanned card only needs users.view
// (see /members/scan) — but users.view is not itself an administrative grant,
// so it stays out of ADMIN_NAVIGATION_PERMISSIONS.
export const canOpenAdministrationSection = (checkPermission: (permission: string) => boolean): boolean =>
  checkPermission('users.view') || hasAdministrationAccess(checkPermission);
