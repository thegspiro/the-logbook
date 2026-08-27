import { useAuthStore } from '../../../stores/authStore';

/** Keep Facilities mutation affordances aligned with backend permissions. */
export function useFacilitiesAccess() {
  const checkPermission = useAuthStore((state) => state.checkPermission);
  const canManage = checkPermission('facilities.manage');
  const canEdit = canManage || checkPermission('facilities.edit');
  const canDelete = canManage || checkPermission('facilities.delete');
  const canCreate = canEdit || checkPermission('facilities.create');

  return {
    canManage,
    canCreate,
    // Granular delete grants destructive controls only; it must not imply
    // create, edit, maintenance, sensitive-read, or general management.
    canDelete,
    // Backend create/update gates on sub-resources (rooms, systems, utility
    // accounts/readings, access keys, shutoffs, capital projects, insurance,
    // occupants) accept facilities.edit alongside facilities.manage. Gate mutation
    // UI on canEdit so edit-permission holders see the affordances the API grants them.
    canEdit,
    // Maintenance record create/update/complete additionally accepts the
    // dedicated facilities.maintenance grant; deletion uses canDelete independently.
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
