/**
 * Durable equipment-check drafts.
 *
 * Drafts are retained for seven days. This is long enough to recover work
 * after an interrupted tour without leaving operational notes indefinitely on
 * a shared station. Ownership and template revision are checked before any
 * payload is returned to the caller.
 */
import { openOfflineDb, STORE_EQUIPMENT_CHECK_DRAFTS } from './offlineDb';

export const EQUIPMENT_CHECK_DRAFT_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

export interface EquipmentCheckDraftIdentity {
  organizationId: string;
  userId: string;
  shiftId: string;
  templateId: string;
  templateRevision: string;
}

export interface EquipmentCheckDraft<T> extends EquipmentCheckDraftIdentity {
  id: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  contents: T;
}

function draftId(identity: EquipmentCheckDraftIdentity): string {
  return [identity.organizationId, identity.userId, identity.shiftId, identity.templateId, identity.templateRevision]
    .map(encodeURIComponent)
    .join('|');
}

function sameChecklist(draft: EquipmentCheckDraft<unknown>, identity: EquipmentCheckDraftIdentity): boolean {
  return draft.shiftId === identity.shiftId && draft.templateId === identity.templateId;
}

/**
 * Whose work this is — the half of the key that carries a privacy consequence.
 *
 * A station tablet is shared. A draft written by another member, or under
 * another organization, must never be surfaced to the person now holding the
 * device, so those are purged on sight. A draft written by *this* member under
 * an older template revision is the opposite case: it is their own in-progress
 * check, and destroying it is the data loss this module exists to prevent.
 */
function sameOwner(draft: EquipmentCheckDraft<unknown>, identity: EquipmentCheckDraftIdentity): boolean {
  return draft.organizationId === identity.organizationId && draft.userId === identity.userId;
}

export async function saveEquipmentCheckDraft<T>(
  identity: EquipmentCheckDraftIdentity,
  contents: T,
  now = Date.now()
): Promise<EquipmentCheckDraft<T>> {
  const db = await openOfflineDb();
  const id = draftId(identity);
  return new Promise((resolve, reject) => {
    const store = db.transaction(STORE_EQUIPMENT_CHECK_DRAFTS, 'readwrite').objectStore(STORE_EQUIPMENT_CHECK_DRAFTS);
    const read = store.get(id);
    read.onerror = () => reject(read.error ?? new Error('Failed to read equipment-check draft'));
    read.onsuccess = () => {
      const prior = read.result as EquipmentCheckDraft<T> | undefined;
      const draft: EquipmentCheckDraft<T> = {
        ...identity,
        id,
        createdAt: prior?.createdAt ?? now,
        updatedAt: now,
        expiresAt: now + EQUIPMENT_CHECK_DRAFT_RETENTION_MS,
        contents,
      };
      const write = store.put(draft);
      write.onsuccess = () => resolve(draft);
      write.onerror = () => reject(write.error ?? new Error('Failed to save equipment-check draft'));
    };
  });
}

export async function loadEquipmentCheckDraft<T>(
  identity: EquipmentCheckDraftIdentity,
  now = Date.now()
): Promise<EquipmentCheckDraft<T> | null> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const store = db.transaction(STORE_EQUIPMENT_CHECK_DRAFTS, 'readwrite').objectStore(STORE_EQUIPMENT_CHECK_DRAFTS);
    const request = store.getAll();
    request.onerror = () => reject(request.error ?? new Error('Failed to load equipment-check drafts'));
    request.onsuccess = () => {
      const drafts = request.result as EquipmentCheckDraft<T>[];
      const wanted = draftId(identity);
      let match: EquipmentCheckDraft<T> | null = null;
      // Same member, same checklist, older template revision. Returned so the
      // caller can reconcile it item by item; it is NOT deleted here, because
      // the caller may not get as far as writing the reconciled draft back.
      let supersededRevision: EquipmentCheckDraft<T> | null = null;
      for (const draft of drafts) {
        if (draft.expiresAt <= now) {
          store.delete(draft.id);
          continue;
        }
        if (!sameChecklist(draft, identity)) continue;
        if (!sameOwner(draft, identity)) {
          store.delete(draft.id);
          continue;
        }
        if (draft.id === wanted) {
          match = draft;
        } else if (!supersededRevision || draft.updatedAt > supersededRevision.updatedAt) {
          supersededRevision = draft;
        }
      }
      // A draft written under the current revision always wins; the older one
      // is only a fallback for the first load after an officer edits the
      // template mid-check.
      resolve(match ?? supersededRevision);
    };
  });
}

/**
 * Discard this member's work on this checklist — every revision of it.
 *
 * Keyed on the exact draft id, this deleted only the revision the caller had
 * open. A draft written before an officer edited the template survived the
 * submission, and `loadEquipmentCheckDraft` hands back exactly that as its
 * superseded-revision fallback when no current-revision draft exists: reopening
 * the checklist after submitting restored answers from the check just filed,
 * and went on doing so for the seven days until it expired.
 */
export async function deleteEquipmentCheckDraft(identity: EquipmentCheckDraftIdentity): Promise<void> {
  const db = await openOfflineDb();
  await new Promise<void>((resolve, reject) => {
    const store = db.transaction(STORE_EQUIPMENT_CHECK_DRAFTS, 'readwrite').objectStore(STORE_EQUIPMENT_CHECK_DRAFTS);
    const request = store.getAll();
    request.onerror = () => reject(request.error ?? new Error('Failed to delete equipment-check draft'));
    request.onsuccess = () => {
      for (const draft of request.result as EquipmentCheckDraft<unknown>[]) {
        // Another member's draft on this station tablet is not ours to delete
        // here — loadEquipmentCheckDraft purges those on sight, and only for
        // the member actually holding the device.
        if (sameChecklist(draft, identity) && sameOwner(draft, identity)) store.delete(draft.id);
      }
      resolve();
    };
  });
}

export async function clearAllEquipmentCheckDrafts(): Promise<number> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const store = db.transaction(STORE_EQUIPMENT_CHECK_DRAFTS, 'readwrite').objectStore(STORE_EQUIPMENT_CHECK_DRAFTS);
    const count = store.count();
    count.onerror = () => reject(count.error ?? new Error('Failed to count equipment-check drafts'));
    count.onsuccess = () => {
      const clear = store.clear();
      clear.onsuccess = () => resolve(count.result);
      clear.onerror = () => reject(clear.error ?? new Error('Failed to clear equipment-check drafts'));
    };
  });
}
