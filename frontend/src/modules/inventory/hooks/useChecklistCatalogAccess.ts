/**
 * What the viewer may search and create when linking checklist positions to
 * the catalog — gear and medical stock separately.
 *
 * Shared by the template builder and the department-wide link report so the
 * two cannot drift. Each half of the catalog is searched only when the viewer
 * can read it — the backend would 403 the other — and medical waits on the
 * module answer so an organization with Medical Supplies switched off is not
 * sent a refused request per keystroke.
 *
 * Returned as plain booleans rather than memoized: the store's checkPermission
 * keeps one identity while the user record it reads changes underneath it, so
 * a memo keyed on it would hold stale grants.
 */

import { useEnabledModules } from '@/hooks/useEnabledModules';
import { useAuthStore } from '@/stores/authStore';
import type { CatalogSearchScope } from '../utils/checklistCatalogSearch';

export interface ChecklistCatalogAccess {
  searchScope: CatalogSearchScope;
  canCreateGear: boolean;
  canCreateMedical: boolean;
}

export function useChecklistCatalogAccess(): ChecklistCatalogAccess {
  const checkPermission = useAuthStore((s) => s.checkPermission);
  const { isModuleOn, isLoading } = useEnabledModules();
  const medicalModuleOn = !isLoading && isModuleOn('medical_supplies');
  return {
    searchScope: {
      gear: checkPermission('inventory.view'),
      medical: medicalModuleOn && (checkPermission('inventory.view_medical') || checkPermission('inventory.view')),
    },
    canCreateGear: checkPermission('inventory.manage'),
    canCreateMedical:
      medicalModuleOn && (checkPermission('inventory.manage_medical') || checkPermission('inventory.manage')),
  };
}
