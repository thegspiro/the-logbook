/**
 * pendingSyncStore — global count of pending-write items across all
 * offline queues. Read by the navigation pill and by the sync engine
 * to advertise progress to the user.
 *
 * Aggregates counts from:
 *   - genericOfflineQueue (training submission, RSVP)
 *   - offlineQueue (equipment checks)
 *   - shiftReportOfflineQueue (shift reports)
 */
import { create } from 'zustand';
import { genericPendingCount } from '../utils/genericOfflineQueue';
import { pendingCount as equipmentPendingCount } from '../utils/offlineQueue';
import { pendingReportCount } from '../utils/shiftReportOfflineQueue';

export type SyncStatus = 'idle' | 'syncing' | 'error';

interface PendingSyncState {
  count: number;
  status: SyncStatus;
  lastError: string | null;
  refresh: () => Promise<void>;
  setStatus: (status: SyncStatus, lastError?: string | null) => void;
}

export const usePendingSyncStore = create<PendingSyncState>((set) => ({
  count: 0,
  status: 'idle',
  lastError: null,
  refresh: async () => {
    try {
      const [generic, equipment, reports] = await Promise.all([
        genericPendingCount().catch(() => 0),
        equipmentPendingCount().catch(() => 0),
        pendingReportCount().catch(() => 0),
      ]);
      set({ count: generic + equipment + reports });
    } catch {
      // Counts are best-effort.
    }
  },
  setStatus: (status, lastError = null) => set({ status, lastError }),
}));
