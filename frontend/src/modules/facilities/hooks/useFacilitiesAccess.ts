import { useAuthStore } from '../../../stores/authStore';

/** Keep Facilities mutation affordances aligned with backend permissions. */
export function useFacilitiesAccess() {
  const checkPermission = useAuthStore((state) => state.checkPermission);
  const canManage = checkPermission('facilities.manage');

  return {
    canManage,
    canCreate: canManage || checkPermission('facilities.create'),
    // Sensitive facility data (access keys/codes, utility accounts, capital
    // projects, insurance, occupants) is restricted — the baseline member
    // grant is facilities.view, and door codes or account numbers must not be
    // visible to every member. facilities.view_sensitive grants read-only
    // access for organization-wide roles that need facility knowledge without
    // write access. Mirrors backend gating.
    canViewSensitive: canManage || checkPermission('facilities.edit') || checkPermission('facilities.view_sensitive'),
  };
}
