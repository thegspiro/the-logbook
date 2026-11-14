/**
 * Offline Queue — IndexedDB-backed queue for equipment check submissions.
 *
 * Engine bays are often far from wireless access points. This module
 * persists pending check submissions (including photo blobs) to IndexedDB
 * so nothing is lost when connectivity drops. When the device comes back
 * online the queue drains automatically.
 */

import type { ShiftEquipmentCheckCreate } from '@/modules/inventory/types/equipmentCheck';
import { isOwnedByCurrentMember, requireQueueOwner } from './offlineQueueOwner';
import { requestBackgroundSync } from './backgroundSyncRegistration';
import {
  listPendingChecks,
  openCheckDb,
  txStore,
  type QueuedCheck,
  type QueuedPhoto,
} from './equipmentCheckOfflineStore';

export {
  CHECK_QUEUE_MAX_RETRIES,
  claimUntaggedCheck,
  clearAllQueuedChecks,
  dequeueCheck,
  listPendingChecks,
  markCheckSubmitted,
  markPhotosUploaded,
  markRetry,
} from './equipmentCheckOfflineStore';
export type { QueuedCheck, QueuedPhoto, SyncStatus } from './equipmentCheckOfflineStore';

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
  const ownerId = requireQueueOwner();
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
    ownerId,
    shiftId,
    payload: stablePayload,
    photos,
    queuedAt: Date.now(),
    retries: 0,
  };

  const db = await openCheckDb();
  await new Promise<void>((resolve, reject) => {
    const store = txStore(db, 'readwrite');
    const req = store.put(entry);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
  // The form also queues a check it has just submitted online, before
  // uploading its photos; it holds the drain lock while it does, so a sync
  // this fires waits and then finds only what the form could not send.
  void requestBackgroundSync();
  return entry.id;
}

/** The checks the signed-in member queued, which are the only ones to send. */
export async function listOwnPendingChecks(): Promise<QueuedCheck[]> {
  return (await listPendingChecks()).filter((entry) => isOwnedByCurrentMember(entry));
}

/**
 * Return the number of the signed-in member's checks waiting to send.
 *
 * Another member's entries and held ones are left out: this count is shown as
 * work that will sync, and those never will under this session.
 */
export async function pendingCount(): Promise<number> {
  return (await listOwnPendingChecks()).length;
}
