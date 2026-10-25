/**
 * The state `SchedulingAdminLayout` shares with the page drawn inside it.
 *
 * Its own module so the layout file exports only components, which is what
 * keeps React fast refresh working on it.
 */

import { createContext, useContext } from 'react';

export interface SchedulingAdminShell {
  canManage: boolean;
  /** Makes the header refetch its metrics, after the metrics settings save. */
  refreshFrame: () => void;
}

export const SchedulingAdminShellContext = createContext<SchedulingAdminShell | null>(null);

/** The header's state, for a page drawn inside it; null outside it. */
export const useSchedulingAdminShell = (): SchedulingAdminShell | null => useContext(SchedulingAdminShellContext);
