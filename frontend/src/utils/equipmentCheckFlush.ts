/**
 * Sends one queued equipment check: the check itself, unless the server has
 * already accepted it, then its photos one item's group at a time.
 *
 * Shared by the check form's drain (EquipmentCheckForm) and the service
 * worker's background sync (src/sw/backgroundSync.ts), so both keep the same
 * checkpoints. Those checkpoints are why this queue was left to its own screen
 * until now: the photo endpoint appends to an item's photo_urls and caps it at
 * three, so a group re-sent after a successful upload files duplicate evidence
 * or trips the cap. Every dependency is passed in, so this runs in either
 * context and the form keeps using the queue functions it imports.
 */

import { CHECK_QUEUE_MAX_RETRIES, type QueuedCheck } from './equipmentCheckOfflineStore';

/** The parts of an accepted check this needs: its id and its items' ids. */
export interface AcceptedCheck {
  id: string;
  items?: Array<{ id: string; templateItemId?: string | null | undefined }> | undefined;
}

export interface QueuedPhotoGroup {
  blob: Blob;
  fileName: string;
}

export interface EquipmentCheckFlushDeps {
  submitCheck: (shiftId: string, payload: QueuedCheck['payload']) => Promise<AcceptedCheck>;
  uploadPhotos: (checkId: string, checkItemId: string, photos: QueuedPhotoGroup[]) => Promise<unknown>;
  markCheckSubmitted: (id: string, checkId: string, itemIds: Record<string, string>) => Promise<unknown>;
  markPhotosUploaded: (id: string, templateItemId: string) => Promise<unknown>;
  markRetry: (id: string) => Promise<QueuedCheck | null>;
  dequeueCheck: (id: string) => Promise<void>;
  /** Whether a failure is the server's explicit, permanent refusal. */
  isRefusal: (error: unknown) => boolean;
}

export type EquipmentCheckFlushOutcome =
  | { kind: 'sent' }
  /** Refused for the last time allowed, and taken off the device. */
  | { kind: 'discarded' }
  /** Still queued: an outage, a lost connection, or a refusal under the cap. */
  | { kind: 'kept'; error: unknown };

export async function flushEquipmentCheck(
  entry: QueuedCheck,
  deps: EquipmentCheckFlushDeps
): Promise<EquipmentCheckFlushOutcome> {
  try {
    let checkId = entry.submittedCheckId;
    let submittedItemIds = entry.submittedItemIds;
    if (!checkId) {
      const record = await deps.submitCheck(entry.shiftId, entry.payload);
      checkId = record.id;
      const accepted: Record<string, string> = {};
      for (const item of record.items ?? []) {
        if (item.templateItemId) accepted[item.templateItemId] = item.id;
      }
      submittedItemIds = accepted;
      // From this point onward this queue entry is a photo-upload retry,
      // not a check-submission retry. Persist that distinction before an
      // upload can fail so the accepted check is never created twice.
      await deps.markCheckSubmitted(entry.id, checkId, submittedItemIds);
    }

    const photosByItem = new Map<string, QueuedPhotoGroup[]>();
    for (const photo of entry.photos) {
      const group = photosByItem.get(photo.itemId) ?? [];
      group.push({ blob: photo.blob, fileName: photo.fileName });
      photosByItem.set(photo.itemId, group);
    }
    for (const [templateItemId, photos] of photosByItem) {
      const checkItemId = submittedItemIds?.[templateItemId];
      if (!checkItemId) {
        throw new Error(`Submitted check item not found for template item ${templateItemId}`);
      }
      await deps.uploadPhotos(checkId, checkItemId, photos);
      // Checkpoint before the next group can fail; see the header.
      await deps.markPhotosUploaded(entry.id, templateItemId);
    }

    await deps.dequeueCheck(entry.id);
    return { kind: 'sent' };
  } catch (error) {
    // Never delete the device's only copy after a transport failure or a
    // retryable server response. Only explicit, permanent 4xx rejections
    // count toward the ceiling that unwedges an invalid submission.
    if (deps.isRefusal(error)) {
      const updated = await deps.markRetry(entry.id);
      if (updated && updated.retries >= CHECK_QUEUE_MAX_RETRIES) {
        await deps.dequeueCheck(entry.id);
        return { kind: 'discarded' };
      }
    }
    return { kind: 'kept', error };
  }
}
