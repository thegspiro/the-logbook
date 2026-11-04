import { useAuthStore } from '../../../stores/authStore';
import { NARRATIVE_PERMISSIONS } from '../types';

/**
 * Whether the signed-in member may read a screening record's clinical
 * narrative — provider, result summary, notes (MS-14). Mirrors
 * `can_view_narrative` in the medical screening endpoints, which return those
 * fields null otherwise.
 */
export function useCanViewNarrative(): boolean {
  const checkPermission = useAuthStore((state) => state.checkPermission);
  return NARRATIVE_PERMISSIONS.some((permission) => checkPermission(permission));
}
