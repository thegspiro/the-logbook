/**
 * The state `InventoryAdminLayout` shares with the page drawn inside it.
 *
 * Its own module so the layout file exports only components, which is what
 * keeps React fast refresh working on it.
 */

import { createContext, useContext } from 'react';
import type { InventoryHubCard } from '../pages/inventoryHubCards';
import type { InventoryAdminData } from '../hooks/useInventoryAdminData';

/** The grants the hub's own route accepts (`/inventory/admin` in routes.tsx). */
export const INVENTORY_ADMIN_HUB_PERMISSIONS = ['inventory.manage', 'inventory.check_manage', 'storefront.manage'];

export interface InventoryAdminShell {
  data: InventoryAdminData;
  /** The hub cards this viewer may open, already filtered by grant and module. */
  visibleCards: InventoryHubCard[];
  modulesLoading: boolean;
  canManage: boolean;
  /** Makes the header refetch its metrics, after the metrics settings save. */
  refreshFrame: () => void;
}

export const InventoryAdminShellContext = createContext<InventoryAdminShell | null>(null);

/**
 * The header's state, for a page drawn inside it; null outside it.
 *
 * A page shared with routes outside the hub (the items list also serves
 * `/inventory`) reads this to drop the chrome the header already supplies.
 */
export const useInventoryAdminShell = (): InventoryAdminShell | null => useContext(InventoryAdminShellContext);
