/**
 * Offline Queue — IndexedDB-backed queue for equipment check submissions.
 *
 * Engine bays are often far from wireless access points. This module
 * persists pending check submissions (including photo blobs) to IndexedDB
 * so nothing is lost when connectivity drops. When the device comes back
 * online the queue drains automatically.
 */

import type { ShiftEquipmentCheckCreate } from '@/modules/inventory/types/equipmentCheck';
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
  /**
   * Set as soon as the server accepts the check. Keeping this on the queued
   * record lets photo retries resume without submitting the check a second
   * time.
   */
  submittedCheckId?: string;
  /** Submitted check-item IDs keyed by the template-item IDs in `photos`. */
  submittedItemIds?: Record<string, string>;
}

export type SyncStatus = 'idle' | 'syncing' | 'error';

/**
 * Non-retryable server rejections before a queued check is abandoned.
 *
 * Without a ceiling a permanently-rejected submission (a template deleted, a
 * shift closed, a payload the API no longer accepts) is retried on every
 * reconnect forever: the queue never drains, the pending-count pill never
 * clears, and the member is told "will retry" indefinitely. Mirrors
 * GENERIC_QUEUE_MAX_RETRIES in genericOfflineQueue.ts.
 */
export const CHECK_QUEUE_MAX_RETRIES = 5;

// ---------------------------------------------------------------------------
// IndexedDB helpers
// ---------------------------------------------------------------------------

// The database name, version and upgrade path are shared with the shift-report
// queue — see offlineDb.ts for why they must not be redeclared here.
const STORE_CHECKS = STORE_PENDING_CHECKS;

const openDB = openOfflineDb;

function txStore(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
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
  photoItems: { itemId: string; files: File[] }[]
): Promise<string> {
  // Generate this once, before persisting. Every drain attempt reuses the
  // stored payload, allowing the API to recognize a retry after its response
  // was lost rather than reporting a second completed check.
  const id = queueId();
  const stablePayload = {
    ...payload,
    client_submission_id: payload.client_submission_id ?? id,
  };
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
    id,
    shiftId,
    payload: stablePayload,
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

/**
 * Read-modify-write one queued check inside a single readwrite transaction.
 *
 * SEC (FE-7): a read in one transaction followed by a put in another can
 * resurrect an entry `clearAllQueuedChecks` removed in between. That window is
 * reachable — `authStore.logout` leaves the check form mounted while it awaits
 * the device purge — so a submission completing during logout could re-create
 * the previous member's payload and photo blobs on a shared browser profile.
 * Holding both operations in one transaction makes the purge authoritative:
 * whichever runs second sees the other's result.
 *
 * `mutate` returns the entry to store, or null to leave the record untouched.
 */
async function updateQueuedCheck(
  id: string,
  mutate: (entry: QueuedCheck) => QueuedCheck | null
): Promise<QueuedCheck | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const store = txStore(db, 'readwrite');
    const read = store.get(id);
    read.onerror = () => reject(read.error ?? new Error('IndexedDB request failed'));
    read.onsuccess = () => {
      const entry = read.result as QueuedCheck | undefined;
      if (!entry) {
        resolve(null);
        return;
      }
      const next = mutate(entry);
      if (!next) {
        resolve(null);
        return;
      }
      // Issued from inside the read's success handler, so it joins the same
      // still-active transaction rather than opening a second one.
      const write = store.put(next);
      write.onsuccess = () => resolve(next);
      write.onerror = () => reject(write.error ?? new Error('IndexedDB request failed'));
    };
  });
}

/**
 * Increment the retry count for a failed sync attempt.
 *
 * Returns the updated entry (or null if it is already gone) so the caller can
 * compare `retries` against CHECK_QUEUE_MAX_RETRIES and abandon a submission
 * the server will never accept. Transient failures must not call this helper.
 */
export async function markRetry(id: string): Promise<QueuedCheck | null> {
  return updateQueuedCheck(id, (entry) => ({ ...entry, retries: entry.retries + 1 }));
}

/** Persist an accepted check before attempting any of its queued photo uploads. */
export async function markCheckSubmitted(
  id: string,
  submittedCheckId: string,
  submittedItemIds: Record<string, string>
): Promise<QueuedCheck | null> {
  return updateQueuedCheck(id, (entry) => ({ ...entry, submittedCheckId, submittedItemIds }));
}

/**
 * Drop the photos for one item after the server has accepted them.
 *
 * The upload endpoint appends to `photo_urls` and caps an item at three
 * photos, so a group left in the queue after a successful POST is re-uploaded
 * on the next drain: it either files duplicate evidence for the same item or
 * trips the cap and returns a permanent 400. That 400 counts toward
 * CHECK_QUEUE_MAX_RETRIES, so the entry is eventually discarded along with the
 * groups that never made it. Checkpointing each accepted group keeps a retry
 * scoped to the photos still missing.
 */
export async function markPhotosUploaded(id: string, itemId: string): Promise<QueuedCheck | null> {
  return updateQueuedCheck(id, (entry) => ({
    ...entry,
    photos: entry.photos.filter((photo) => photo.itemId !== itemId),
  }));
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
