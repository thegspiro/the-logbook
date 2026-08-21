import { useAuthStore } from '../../../stores/authStore';

/** Keep Facilities mutation affordances aligned with backend permissions. */
export function useFacilitiesAccess() {
  const checkPermission = useAuthStore((state) => state.checkPermission);
  const canManage = checkPermission('facilities.manage');
  const canEdit = canManage || checkPermission('facilities.edit');
  const canCreate = canEdit || checkPermission('facilities.create');

  return {
    canManage,
    canCreate,
    // Backend create/update gates on sub-resources (rooms, systems, utility
    // accounts/readings, access keys, shutoffs, capital projects, insurance,
    // occupants) accept facilities.edit alongside facilities.manage; deletes
    // stay manage-only. Gate mutation UI on canEdit so edit-permission holders
    // see the affordances the API grants them.
    canEdit,
    // Maintenance record create/update/complete additionally accepts the
    // dedicated facilities.maintenance grant (deletes remain manage-only).
    canMaintenance: canEdit || checkPermission('facilities.maintenance'),
    // Sensitive facility data (access keys/codes, utility accounts, capital
    // projects, insurance, occupants) is restricted — the baseline member
    // grant is facilities.view, and door codes or account numbers must not be
    // visible to every member. facilities.view_sensitive grants read-only
    // access for organization-wide roles that need facility knowledge without
    // write access. Mirrors backend gating.
    canViewSensitive: canEdit || checkPermission('facilities.view_sensitive'),
  };
}
