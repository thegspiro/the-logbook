/**
 * Storage for the shift-report offline queue, with nothing that needs to know
 * who is signed in.
 *
 * Split from shiftReportOfflineQueue.ts for the same reason as
 * genericOfflineStore.ts: the service worker's background sync reads and
 * updates this queue, and cannot load the auth store the owner checks need.
 * shiftReportOfflineQueue.ts re-exports all of it.
 */

import type { BatchShiftReportCreate } from '@/types/training';
import { openOfflineDb, STORE_PENDING_SHIFT_REPORTS } from './offlineDb';
import type { OwnedQueueEntry } from './offlineQueueOwner';

export interface QueuedShiftReport extends OwnedQueueEntry {
  id: string;
  payload: BatchShiftReportCreate;
  queuedAt: number;
  /** Times the server has refused this report outright (a 4xx, not an outage). */
  retries: number;
  /** What the server said the last time it refused the report. */
  lastError?: string;
}

// Shares the `logbook-offline` database with the equipment-check queue; the
// name, version and upgrade path live in offlineDb.ts so the two modules can
// never disagree about the version (which previously broke check queueing).
export const STORE_REPORTS = STORE_PENDING_SHIFT_REPORTS;

/**
 * Refusals before a queued report is named to the officer, by the page drain
 * (shiftReportSync.ts) and the worker's (sw/backgroundSync.ts) alike.
 */
export const SHIFT_REPORT_REFUSALS_BEFORE_NOTICE = 3;

export const openDB = openOfflineDb;

/**
 * List every report on this device, whoever queued it.
 *
 * Not for draining: use listOwnPendingReports, which leaves out entries the
 * signed-in member must not send (FE3-34-5).
 */
export async function listPendingReports(): Promise<QueuedShiftReport[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_REPORTS, 'readonly');
    const request = tx.objectStore(STORE_REPORTS).getAll();
    request.onsuccess = () => resolve(request.result as QueuedShiftReport[]);
    request.onerror = () => reject(request.error ?? new Error('Failed to list pending reports'));
  });
}

export async function dequeueShiftReport(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_REPORTS, 'readwrite');
    tx.objectStore(STORE_REPORTS).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to dequeue shift report'));
  });
}

/**
 * Record that the server refused a report, and why. Returns how many times it
 * has now been refused, or 0 when the report is no longer queued.
 */
export async function markReportRetry(id: string, lastError?: string): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_REPORTS, 'readwrite');
    const store = tx.objectStore(STORE_REPORTS);
    const getReq = store.get(id);
    let retries = 0;
    getReq.onsuccess = () => {
      const entry = getReq.result as QueuedShiftReport | undefined;
      if (entry) {
        entry.retries += 1;
        if (lastError !== undefined) entry.lastError = lastError;
        retries = entry.retries;
        store.put(entry);
      }
    };
    tx.oncomplete = () => resolve(retries);
    tx.onerror = () => reject(tx.error ?? new Error('Failed to mark report retry'));
  });
}

/**
 * Discard every queued shift report on this device.
 *
 * SEC (FE-7): queued reports carry the densest PII of any offline store —
 * crew rosters, trainee evaluations and free-text narratives — and IndexedDB
 * is scoped to the browser profile, not the signed-in member. On a shared
 * station computer the next member must not inherit them. Returns the number
 * discarded so the caller can report the loss rather than destroy work
 * silently.
 */
export async function clearAllQueuedReports(): Promise<number> {
  const db = await openDB();
  const count = await new Promise<number>((resolve) => {
    const tx = db.transaction(STORE_REPORTS, 'readonly');
    const request = tx.objectStore(STORE_REPORTS).count();
    request.onsuccess = () => resolve(request.result);
    // Never let a purge failure block logout.
    request.onerror = () => resolve(0);
  });
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE_REPORTS, 'readwrite');
    tx.objectStore(STORE_REPORTS).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  return count;
}

/**
 * Give a report queued before owners were recorded to `ownerId`, so it sends.
 * Read and write share one transaction, and a report that already has an
 * owner is never reassigned. Returns whether the report was claimed.
 */
export async function claimUntaggedReport(id: string, ownerId: string): Promise<boolean> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_REPORTS, 'readwrite');
    const store = tx.objectStore(STORE_REPORTS);
    let claimed = false;
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const entry = getReq.result as QueuedShiftReport | undefined;
      if (entry && !entry.ownerId) {
        store.put({ ...entry, ownerId });
        claimed = true;
      }
    };
    tx.oncomplete = () => resolve(claimed);
    tx.onerror = () => reject(tx.error ?? new Error('Failed to claim shift report'));
  });
}
