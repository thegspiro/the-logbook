/**
 * Shift Report Offline Queue
 *
 * IndexedDB-backed queue for shift report submissions when offline.
 * Reports are persisted locally and automatically synced when
 * connectivity returns. Follows the same pattern as offlineQueue.ts
 * for equipment checks.
 */

import type { BatchShiftReportCreate } from '@/types/training';

export interface QueuedShiftReport {
  id: string;
  payload: BatchShiftReportCreate;
  queuedAt: number;
  retries: number;
}

const DB_NAME = 'logbook-offline';
const DB_VERSION = 2;
const STORE_CHECKS = 'pendingChecks';
const STORE_REPORTS = 'pendingShiftReports';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_CHECKS)) {
        db.createObjectStore(STORE_CHECKS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_REPORTS)) {
        db.createObjectStore(STORE_REPORTS, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open database'));
  });
}

export async function enqueueShiftReport(
  payload: BatchShiftReportCreate,
): Promise<string> {
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

export async function pendingReportCount(): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_REPORTS, 'readonly');
    const request = tx.objectStore(STORE_REPORTS).count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to count pending reports'));
  });
}
