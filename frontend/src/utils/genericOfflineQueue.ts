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
import { isNetworkError, isNonRetryableHttpError } from './errorHandling';
import { isOwnedByCurrentMember, requireQueueOwner } from './offlineQueueOwner';
import {
  GENERIC_QUEUE_MAX_RETRIES as MAX_RETRIES,
  dequeueGeneric,
  genericStore as txStore,
  listGenericPending,
  markGenericRetry,
  openGenericDb as openDB,
  type GenericQueueKind,
  type GenericQueuedItem,
} from './genericOfflineStore';

export {
  GENERIC_HELD_STALE_MS,
  GENERIC_QUEUE_MAX_RETRIES,
  claimUntaggedGeneric,
  clearAllGenericQueued,
  dequeueGeneric,
  getGenericItem,
  isGenericSendable,
  listGenericPending,
  markGenericRetry,
} from './genericOfflineStore';
export type { GenericQueueKind, GenericQueuedItem } from './genericOfflineStore';

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
    ownerId: requireQueueOwner(),
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

/**
 * Write an entry as the signed-in member's, replacing their own entry with the
 * same id.
 *
 * The owner is stamped here rather than trusted from `item`, and an existing
 * entry that is not the member's own — another member's, or one held for
 * review — is never overwritten: rewriting it would hand it to this member
 * without the review the hold exists for (FE3-34-5).
 */
export async function putGenericItem(item: GenericQueuedItem): Promise<void> {
  const ownerId = requireQueueOwner();
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const store = txStore(db, 'readwrite');
    const read = store.get(item.id);
    read.onerror = () => reject(read.error ?? new Error('IndexedDB request failed'));
    read.onsuccess = () => {
      const existing = read.result as GenericQueuedItem | undefined;
      if (existing && existing.ownerId !== ownerId) {
        reject(new Error('This queued item belongs to another session and was not changed'));
        return;
      }
      const req = store.put({ ...item, ownerId });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
    };
  });
}

/** The signed-in member's queued items, oldest first — the only ones to send. */
export async function listOwnGenericPending(): Promise<GenericQueuedItem[]> {
  return (await listGenericPending()).filter((item) => isOwnedByCurrentMember(item));
}

/**
 * The number of the signed-in member's items waiting to send — not another
 * member's, and not held ones, since neither will sync under this session.
 */
export async function genericPendingCount(): Promise<number> {
  return (await listOwnGenericPending()).length;
}

/**
 * Try to flush a single queued item. Returns true on success, false on
 * failure (the caller should leave it in the queue for the next attempt).
 * Drops items past `MAX_RETRIES` so a permanently-rejected request
 * (e.g. 4xx validation error after a schema change) doesn't block the
 * queue forever.
 *
 * A send that never reached the server is not one of those attempts, and
 * neither is an answer that says nothing about the request (5xx, 408, 429). The
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
  // The drain already sends only the member's own items; this is checked again
  // at the moment of sending because the member can change between the list
  // and the send, and the request goes out with whoever's cookies are live.
  if (!isOwnedByCurrentMember(item)) return false;
  try {
    const response = await axios.post<unknown>(item.url, item.body);
    await dequeueGeneric(item.id);
    onSynced?.(response.data);
    return true;
  } catch (err) {
    // Only an explicit, permanent rejection is a strike. A 5xx during a deploy,
    // a 429 or a 408 says nothing about the payload, and counting them deleted
    // the only copy after five drains of an outage — the rule offline queues
    // follow, set out on isNonRetryableHttpError and used by equipment checks.
    if (isNetworkError(err) || !isNonRetryableHttpError(err)) return false;
    const message = err instanceof Error ? err.message : 'Sync failed';
    if (item.retries + 1 >= MAX_RETRIES) {
      await dequeueGeneric(item.id);
      return false;
    }
    await markGenericRetry(item.id, message);
    return false;
  }
}
