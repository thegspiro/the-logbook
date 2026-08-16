/** Permissions that make at least one item in the Administration section visible. */
export const ADMIN_NAVIGATION_PERMISSIONS = [
  // users.view alone opens the section: the member ID scanner lives here,
  // and validating a scanned card only needs users.view (see /members/scan).
  'users.view',
  'members.manage',
  'prospective_members.manage',
  'events.manage',
  'training.manage',
  'inventory.manage',
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
