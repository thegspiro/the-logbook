/**
 * Shift Report Offline Queue
 *
 * IndexedDB-backed queue for shift report submissions when offline.
 * Reports are persisted locally and automatically synced when
 * connectivity returns. Follows the same pattern as offlineQueue.ts
 * for equipment checks.
 */

import type { BatchShiftReportCreate } from '@/types/training';
import { isOwnedByCurrentMember, requireQueueOwner } from './offlineQueueOwner';
import { STORE_REPORTS, listPendingReports, openDB, type QueuedShiftReport } from './shiftReportOfflineStore';
import { requestBackgroundSync } from './backgroundSyncRegistration';

export {
  claimUntaggedReport,
  clearAllQueuedReports,
  dequeueShiftReport,
  listPendingReports,
  markReportRetry,
} from './shiftReportOfflineStore';
export type { QueuedShiftReport } from './shiftReportOfflineStore';

export async function enqueueShiftReport(payload: BatchShiftReportCreate): Promise<string> {
  const ownerId = requireQueueOwner();
  const db = await openDB();
  const id = `sr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const entry: QueuedShiftReport = {
    id,
    ownerId,
    payload,
    queuedAt: Date.now(),
    retries: 0,
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_REPORTS, 'readwrite');
    tx.objectStore(STORE_REPORTS).add(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to enqueue shift report'));
  });
  void requestBackgroundSync();
  return id;
}

/** The reports the signed-in member queued, which are the only ones to send. */
export async function listOwnPendingReports(): Promise<QueuedShiftReport[]> {
  return (await listPendingReports()).filter((entry) => isOwnedByCurrentMember(entry));
}

/**
 * The number of the signed-in member's reports waiting to send — not another
 * member's, and not held ones, since neither will sync under this session.
 */
export async function pendingReportCount(): Promise<number> {
  return (await listOwnPendingReports()).length;
}
