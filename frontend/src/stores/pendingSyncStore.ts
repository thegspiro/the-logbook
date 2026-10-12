/**
 * pendingSyncStore — global count of pending-write items across all
 * offline queues. Read by the navigation pill and by the sync engine
 * to advertise progress to the user.
 *
 * Aggregates counts from:
 *   - genericOfflineQueue (training submission, RSVP)
 *   - offlineQueue (equipment checks)
 *   - shiftReportOfflineQueue (shift reports)
 *   - skillsTestOffline (skills-test scoring, one entry per test)
 *
 * `count` is the signed-in member's own items — the ones that will sync.
 * Items queued before owners were recorded are counted separately in
 * `heldCount`, because they never sync on their own (FE3-34-5).
 */
import { create } from 'zustand';
import { genericPendingCount } from '../utils/genericOfflineQueue';
import { pendingCount as equipmentPendingCount } from '../utils/offlineQueue';
import { pendingReportCount } from '../utils/shiftReportOfflineQueue';
import { listHeldOfflineItems } from '../utils/offlineQueueQuarantine';
import { skillsPendingCount } from '../utils/skillsTestOffline';

export type SyncStatus = 'idle' | 'syncing' | 'error';

interface PendingSyncState {
  count: number;
  /** Items held for the member's review instead of syncing. */
  heldCount: number;
  status: SyncStatus;
  lastError: string | null;
  refresh: () => Promise<void>;
  setStatus: (status: SyncStatus, lastError?: string | null) => void;
}

export const usePendingSyncStore = create<PendingSyncState>((set) => ({
  count: 0,
  heldCount: 0,
  status: 'idle',
  lastError: null,
  refresh: async () => {
    try {
      const [generic, equipment, reports, skills, held] = await Promise.all([
        genericPendingCount().catch(() => 0),
        equipmentPendingCount().catch(() => 0),
        pendingReportCount().catch(() => 0),
        skillsPendingCount().catch(() => 0),
        listHeldOfflineItems().catch(() => []),
      ]);
      set({ count: generic + equipment + reports + skills, heldCount: held.length });
    } catch {
      // Counts are best-effort.
    }
  },
  setStatus: (status, lastError = null) => set({ status, lastError }),
}));
