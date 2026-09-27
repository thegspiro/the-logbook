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
import { openIndexedDb } from './offlineDb';
import { isNetworkError } from './errorHandling';

export type GenericQueueKind = 'training-submission' | 'event-rsvp' | 'nfc-put-away' | 'nfc-shelf-audit';

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
function openDB(): Promise<IDBDatabase> {
  return openIndexedDb(DB_NAME, DB_VERSION, (db) => {
    if (!db.objectStoreNames.contains(STORE)) {
      db.createObjectStore(STORE, { keyPath: 'id' });
    }
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
  label: string
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

/** Write an entry as given, replacing any with the same id. */
export async function putGenericItem(item: GenericQueuedItem): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const req = txStore(db, 'readwrite').put(item);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

export async function getGenericItem(id: string): Promise<GenericQueuedItem | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = txStore(db, 'readonly').get(id);
    req.onsuccess = () => resolve((req.result as GenericQueuedItem | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

/** Whether an entry may be sent now: not held, or held but abandoned. */
export function isGenericSendable(item: GenericQueuedItem, now: number = Date.now()): boolean {
  if (!item.held) return true;
  return now - (item.updatedAt ?? item.queuedAt) >= GENERIC_HELD_STALE_MS;
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
 *
 * A send that never reached the server is not one of those attempts. The
 * queue exists for weak signal, and counting a dropped connection as a
 * rejection discarded an item after five flaky reconnects without the server
 * ever having seen it.
 *
 * `onSynced` receives the server's answer, for queues whose result is worth
 * telling the member about (what an offline put-away actually moved).
 */
export async function flushOne(
  item: GenericQueuedItem,
  axios: AxiosInstance,
  onSynced?: (data: unknown) => void
): Promise<boolean> {
  try {
    const response = await axios.post<unknown>(item.url, item.body);
    await dequeueGeneric(item.id);
    onSynced?.(response.data);
    return true;
  } catch (err) {
    if (isNetworkError(err)) return false;
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

/**
 * Discard every queued generic item (training submissions, event RSVPs).
 *
 * SEC (FE-7): see clearAllQueuedChecks in offlineQueue.ts — same shared-device
 * reasoning. Returns the number discarded.
 */
export async function clearAllGenericQueued(): Promise<number> {
  const db = await openDB();
  const count = await new Promise<number>((resolve) => {
    const req = txStore(db, 'readonly').count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(0);
  });
  await new Promise<void>((resolve) => {
    const req = txStore(db, 'readwrite').clear();
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
  });
  return count;
}
