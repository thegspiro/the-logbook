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

const DB_NAME = 'logbook-offline';
const DB_VERSION = 1;
const STORE_CHECKS = 'pendingChecks';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_CHECKS)) {
        db.createObjectStore(STORE_CHECKS, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

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
