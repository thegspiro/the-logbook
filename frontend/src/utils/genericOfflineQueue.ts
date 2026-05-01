/**
 * Generic offline queue for JSON POST requests (no blob payloads).
 *
 * The existing `offlineQueue.ts` and `shiftReportOfflineQueue.ts` cover
 * equipment checks and shift reports because those carry photo blobs and
 * have bespoke shapes. This file covers the simpler case of plain JSON
 * mutations like training submissions and event RSVPs — the everyday
 * "log a drill" / "say I'm coming" actions a volunteer takes from the
 * apparatus bay where wifi is unreliable.
 *
 * When the device is offline the request is enqueued; the sync engine
 * (`useOfflineSyncEngine`) drains the queue when connectivity returns.
 */
import type { AxiosInstance } from 'axios';

export type GenericQueueKind = 'training-submission' | 'event-rsvp';

export interface GenericQueuedItem {
  id: string;
  kind: GenericQueueKind;
  url: string;
  body: unknown;
  // Human-readable label used in toast notifications when the item finally syncs.
  label: string;
  queuedAt: number;
  retries: number;
  lastError?: string;
}

const DB_NAME = 'logbook-offline-generic';
const DB_VERSION = 1;
const STORE = 'pendingMutations';
const MAX_RETRIES = 5;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function txStore(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function queueId(): string {
  return `g-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function enqueueGeneric(
  kind: GenericQueueKind,
  url: string,
  body: unknown,
  label: string,
): Promise<GenericQueuedItem> {
  const entry: GenericQueuedItem = {
    id: queueId(),
    kind,
    url,
    body,
    label,
    queuedAt: Date.now(),
    retries: 0,
  };
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const req = txStore(db, 'readwrite').put(entry);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
  return entry;
}

export async function listGenericPending(): Promise<GenericQueuedItem[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = txStore(db, 'readonly').getAll();
    req.onsuccess = () => resolve((req.result as GenericQueuedItem[]).sort((a, b) => a.queuedAt - b.queuedAt));
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

export async function dequeueGeneric(id: string): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const req = txStore(db, 'readwrite').delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

export async function markGenericRetry(id: string, errorMessage: string): Promise<GenericQueuedItem | null> {
  const db = await openDB();
  const existing = await new Promise<GenericQueuedItem | undefined>((resolve, reject) => {
    const req = txStore(db, 'readonly').get(id);
    req.onsuccess = () => resolve(req.result as GenericQueuedItem | undefined);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
  if (!existing) return null;
  existing.retries += 1;
  existing.lastError = errorMessage;
  await new Promise<void>((resolve, reject) => {
    const req = txStore(db, 'readwrite').put(existing);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
  return existing;
}

export async function genericPendingCount(): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = txStore(db, 'readonly').count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

/**
 * Try to flush a single queued item. Returns true on success, false on
 * failure (the caller should leave it in the queue for the next attempt).
 * Drops items past `MAX_RETRIES` so a permanently-rejected request
 * (e.g. 4xx validation error after a schema change) doesn't block the
 * queue forever.
 */
export async function flushOne(item: GenericQueuedItem, axios: AxiosInstance): Promise<boolean> {
  try {
    await axios.post(item.url, item.body);
    await dequeueGeneric(item.id);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sync failed';
    if (item.retries + 1 >= MAX_RETRIES) {
      await dequeueGeneric(item.id);
      return false;
    }
    await markGenericRetry(item.id, message);
    return false;
  }
}

export const GENERIC_QUEUE_MAX_RETRIES = MAX_RETRIES;
