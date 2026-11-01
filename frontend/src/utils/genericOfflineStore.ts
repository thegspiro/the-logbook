/**
 * Storage for the generic offline queue, with nothing that needs to know who
 * is signed in.
 *
 * Split from genericOfflineQueue.ts so the service worker's background sync
 * (src/sw/backgroundSync.ts) can read and update the same queue. That file
 * imports the auth store to stamp and check owners, and the auth store pulls
 * in the whole app, none of which can load in a service worker. Everything
 * here runs in either context; genericOfflineQueue.ts re-exports it, so pages
 * import from there as before.
 */
import { openIndexedDb } from './offlineDb';
import type { OwnedQueueEntry } from './offlineQueueOwner';

export type GenericQueueKind = 'training-submission' | 'event-rsvp' | 'nfc-put-away' | 'nfc-shelf-audit';

export interface GenericQueuedItem extends OwnedQueueEntry {
  id: string;
  kind: GenericQueueKind;
  url: string;
  body: unknown;
  // Human-readable label used in toast notifications when the item finally syncs.
  label: string;
  queuedAt: number;
  retries: number;
  lastError?: string;
  /**
   * Still being written by the screen that queued it, so not to be sent yet.
   * The NFC put-away screen adds each offline tap to one entry, because the
   * taps only mean something in order and together; sending it half-written
   * and then adding to it would lose the taps made in between. The screen
   * clears this when it is done, and a held entry left behind by a closed tab
   * is released once it goes quiet (`GENERIC_HELD_STALE_MS`).
   */
  held?: boolean;
  /** When a held entry was last written. */
  updatedAt?: number;
}

/** How long a held entry may go unwritten before it is sent anyway. */
export const GENERIC_HELD_STALE_MS = 30 * 60 * 1000;

const DB_NAME = 'logbook-offline-generic';
const DB_VERSION = 1;
const STORE = 'pendingMutations';
const MAX_RETRIES = 5;

// This queue owns its own database (`logbook-offline-generic`), separate from
// the shared `logbook-offline` one, but uses the same guarded open helper so a
// blocked upgrade rejects instead of hanging the caller. See offlineDb.ts.
export function openGenericDb(): Promise<IDBDatabase> {
  return openIndexedDb(DB_NAME, DB_VERSION, (db) => {
    if (!db.objectStoreNames.contains(STORE)) {
      db.createObjectStore(STORE, { keyPath: 'id' });
    }
  });
}

export function genericStore(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

export async function getGenericItem(id: string): Promise<GenericQueuedItem | null> {
  const db = await openGenericDb();
  return new Promise((resolve, reject) => {
    const req = genericStore(db, 'readonly').get(id);
    req.onsuccess = () => resolve((req.result as GenericQueuedItem | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

/** Whether an entry may be sent now: not held, or held but abandoned. */
export function isGenericSendable(item: GenericQueuedItem, now: number = Date.now()): boolean {
  if (!item.held) return true;
  return now - (item.updatedAt ?? item.queuedAt) >= GENERIC_HELD_STALE_MS;
}

/**
 * Every queued item on this device, oldest first, whoever queued it.
 *
 * Not for draining: use listOwnGenericPending (FE3-34-5).
 */
export async function listGenericPending(): Promise<GenericQueuedItem[]> {
  const db = await openGenericDb();
  return new Promise((resolve, reject) => {
    const req = genericStore(db, 'readonly').getAll();
    req.onsuccess = () => resolve((req.result as GenericQueuedItem[]).sort((a, b) => a.queuedAt - b.queuedAt));
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

export async function dequeueGeneric(id: string): Promise<void> {
  const db = await openGenericDb();
  await new Promise<void>((resolve, reject) => {
    const req = genericStore(db, 'readwrite').delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

export async function markGenericRetry(id: string, errorMessage: string): Promise<GenericQueuedItem | null> {
  const db = await openGenericDb();
  const existing = await new Promise<GenericQueuedItem | undefined>((resolve, reject) => {
    const req = genericStore(db, 'readonly').get(id);
    req.onsuccess = () => resolve(req.result as GenericQueuedItem | undefined);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
  if (!existing) return null;
  existing.retries += 1;
  existing.lastError = errorMessage;
  await new Promise<void>((resolve, reject) => {
    const req = genericStore(db, 'readwrite').put(existing);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
  return existing;
}

/**
 * Give an item queued before owners were recorded to `ownerId`, so it sends.
 * Read and write share one transaction, and an item that already has an owner
 * is never reassigned. Returns whether the item was claimed.
 */
export async function claimUntaggedGeneric(id: string, ownerId: string): Promise<boolean> {
  const db = await openGenericDb();
  return new Promise((resolve, reject) => {
    const store = genericStore(db, 'readwrite');
    const read = store.get(id);
    read.onerror = () => reject(read.error ?? new Error('IndexedDB request failed'));
    read.onsuccess = () => {
      const existing = read.result as GenericQueuedItem | undefined;
      if (!existing || existing.ownerId) {
        resolve(false);
        return;
      }
      const req = store.put({ ...existing, ownerId });
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
    };
  });
}

export const GENERIC_QUEUE_MAX_RETRIES = MAX_RETRIES;

/**
 * Discard every queued generic item (training submissions, event RSVPs).
 *
 * SEC (FE-7): see clearAllQueuedChecks in offlineQueue.ts — same shared-device
 * reasoning. Returns the number discarded.
 */
export async function clearAllGenericQueued(): Promise<number> {
  const db = await openGenericDb();
  const count = await new Promise<number>((resolve) => {
    const req = genericStore(db, 'readonly').count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(0);
  });
  await new Promise<void>((resolve) => {
    const req = genericStore(db, 'readwrite').clear();
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
  });
  return count;
}
