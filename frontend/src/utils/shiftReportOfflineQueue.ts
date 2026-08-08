/**
 * Shift Report Offline Queue
 *
 * IndexedDB-backed queue for shift report submissions when offline.
 * Reports are persisted locally and automatically synced when
 * connectivity returns. Follows the same pattern as offlineQueue.ts
 * for equipment checks.
 */

import type { BatchShiftReportCreate } from '@/types/training';
import { openOfflineDb, STORE_PENDING_SHIFT_REPORTS } from './offlineDb';

export interface QueuedShiftReport {
  id: string;
  payload: BatchShiftReportCreate;
  queuedAt: number;
  retries: number;
}

// Shares the `logbook-offline` database with the equipment-check queue; the
// name, version and upgrade path live in offlineDb.ts so the two modules can
// never disagree about the version (which previously broke check queueing).
const STORE_REPORTS = STORE_PENDING_SHIFT_REPORTS;

const openDB = openOfflineDb;

export async function enqueueShiftReport(payload: BatchShiftReportCreate): Promise<string> {
  const db = await openDB();
  const id = `sr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const entry: QueuedShiftReport = {
    id,
    payload,
    queuedAt: Date.now(),
    retries: 0,
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_REPORTS, 'readwrite');
    tx.objectStore(STORE_REPORTS).add(entry);
    tx.oncomplete = () => resolve(id);
    tx.onerror = () => reject(tx.error ?? new Error('Failed to enqueue shift report'));
  });
}

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

export async function markReportRetry(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_REPORTS, 'readwrite');
    const store = tx.objectStore(STORE_REPORTS);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const entry = getReq.result as QueuedShiftReport | undefined;
      if (entry) {
        entry.retries += 1;
        store.put(entry);
      }
    };
    tx.oncomplete = () => resolve();
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

export async function pendingReportCount(): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_REPORTS, 'readonly');
    const request = tx.objectStore(STORE_REPORTS).count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to count pending reports'));
  });
}
