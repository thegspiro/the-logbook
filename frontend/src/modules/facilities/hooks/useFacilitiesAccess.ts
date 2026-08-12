import { useAuthStore } from '../../../stores/authStore';

/** Keep Facilities mutation affordances aligned with backend permissions. */
export function useFacilitiesAccess() {
  const checkPermission = useAuthStore((state) => state.checkPermission);
  const canManage = checkPermission('facilities.manage');

  return {
    canManage,
    canCreate: canManage || checkPermission('facilities.create'),
  };
}
