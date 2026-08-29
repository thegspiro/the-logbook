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
      let match: EquipmentCheckDraft<T> | null = null;
      for (const draft of drafts) {
        if (draft.expiresAt <= now || (sameChecklist(draft, identity) && draft.id !== draftId(identity))) {
          store.delete(draft.id);
        } else if (draft.id === draftId(identity)) {
          match = draft;
        }
      }
      resolve(match);
    };
  });
}

export async function deleteEquipmentCheckDraft(identity: EquipmentCheckDraftIdentity): Promise<void> {
  const db = await openOfflineDb();
  await new Promise<void>((resolve, reject) => {
    const request = db
      .transaction(STORE_EQUIPMENT_CHECK_DRAFTS, 'readwrite')
      .objectStore(STORE_EQUIPMENT_CHECK_DRAFTS)
      .delete(draftId(identity));
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Failed to delete equipment-check draft'));
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
