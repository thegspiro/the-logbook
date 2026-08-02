/**
 * Offline Queue — IndexedDB-backed queue for equipment check submissions.
 *
 * Engine bays are often far from wireless access points. This module
 * persists pending check submissions (including photo blobs) to IndexedDB
 * so nothing is lost when connectivity drops. When the device comes back
 * online the queue drains automatically.
 */

import type {
  ShiftEquipmentCheckCreate,
} from '@/modules/scheduling/types/equipmentCheck';
import { openOfflineDb, STORE_PENDING_CHECKS } from './offlineDb';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QueuedPhoto {
  itemId: string;
  blob: Blob;
  fileName: string;
}

export interface QueuedCheck {
  id: string;
  shiftId: string;
  payload: ShiftEquipmentCheckCreate;
  photos: QueuedPhoto[];
  queuedAt: number;
  retries: number;
}

export type SyncStatus = 'idle' | 'syncing' | 'error';

// ---------------------------------------------------------------------------
// IndexedDB helpers
// ---------------------------------------------------------------------------

// The database name, version and upgrade path are shared with the shift-report
// queue — see offlineDb.ts for why they must not be redeclared here.
const STORE_CHECKS = STORE_PENDING_CHECKS;

const openDB = openOfflineDb;

function txStore(
  db: IDBDatabase,
  mode: IDBTransactionMode,
): IDBObjectStore {
  return db.transaction(STORE_CHECKS, mode).objectStore(STORE_CHECKS);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Generate a simple unique ID for queued items */
function queueId(): string {
  return `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Enqueue a check submission for later sync. */
export async function enqueueCheck(
  shiftId: string,
  payload: ShiftEquipmentCheckCreate,
  photoItems: { itemId: string; files: File[] }[],
): Promise<string> {
  const photos: QueuedPhoto[] = [];
  for (const group of photoItems) {
    for (const file of group.files) {
      photos.push({
        itemId: group.itemId,
        blob: file,
        fileName: file.name,
      });
    }
  }

  const entry: QueuedCheck = {
    id: queueId(),
    shiftId,
    payload,
    photos,
    queuedAt: Date.now(),
    retries: 0,
  };

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const store = txStore(db, 'readwrite');
    const req = store.put(entry);
    req.onsuccess = () => resolve(entry.id);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

/** List all pending checks in the queue. */
export async function listPendingChecks(): Promise<QueuedCheck[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const store = txStore(db, 'readonly');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result as QueuedCheck[]);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

/** Remove a successfully synced check from the queue. */
export async function dequeueCheck(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const store = txStore(db, 'readwrite');
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

/** Increment retry count for a failed sync attempt. */
export async function markRetry(id: string): Promise<void> {
  const db = await openDB();
  const entry = await new Promise<QueuedCheck | undefined>((resolve, reject) => {
    const store = txStore(db, 'readonly');
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result as QueuedCheck | undefined);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });

  if (!entry) return;
  entry.retries += 1;

  return new Promise((resolve, reject) => {
    const store = txStore(db, 'readwrite');
    const req = store.put(entry);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

/** Return the number of items waiting in the queue. */
export async function pendingCount(): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const store = txStore(db, 'readonly');
    const req = store.count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

/**
 * Discard every queued equipment check on this device.
 *
 * SEC (FE-7): queued checks carry member PII and photo blobs in IndexedDB,
 * which is shared across every user of the browser profile. On a shared
 * station computer the next member must not inherit the previous member's
 * unsent submissions. Returns the number discarded so the caller can report
 * the loss instead of destroying work silently.
 */
export async function clearAllQueuedChecks(): Promise<number> {
  const db = await openDB();
  const count = await new Promise<number>((resolve) => {
    const store = txStore(db, 'readonly');
    const req = store.count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(0);
  });
  await new Promise<void>((resolve) => {
    const store = txStore(db, 'readwrite');
    const req = store.clear();
    req.onsuccess = () => resolve();
    // Never let a purge failure block logout.
    req.onerror = () => resolve();
  });
  return count;
}
