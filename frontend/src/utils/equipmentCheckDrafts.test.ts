import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OFFLINE_DB_NAME } from './offlineDb';
import {
  clearAllEquipmentCheckDrafts,
  EQUIPMENT_CHECK_DRAFT_RETENTION_MS,
  loadEquipmentCheckDraft,
  saveEquipmentCheckDraft,
  type EquipmentCheckDraftIdentity,
} from './equipmentCheckDrafts';

const base: EquipmentCheckDraftIdentity = {
  organizationId: 'org-a',
  userId: 'user-a',
  shiftId: 'shift-a',
  templateId: 'template-a',
  templateRevision: 'revision-a',
};

describe('equipment-check drafts', () => {
  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(OFFLINE_DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    });
  });

  it('restores a current draft for the same user and organization', async () => {
    await saveEquipmentCheckDraft(base, { answer: 'pass' }, 1_000);

    const draft = await loadEquipmentCheckDraft<{ answer: string }>(base, 2_000);

    expect(draft?.contents).toEqual({ answer: 'pass' });
    expect(draft).toMatchObject({ ...base, createdAt: 1_000, updatedAt: 1_000 });
  });

  it.each([
    ['account switching', { ...base, userId: 'user-b' }],
    ['organization switching', { ...base, organizationId: 'org-b' }],
  ])('purges rather than exposes a draft after %s', async (_name, otherIdentity) => {
    await saveEquipmentCheckDraft(base, { privateAnswer: 'failed' }, 1_000);

    expect(await loadEquipmentCheckDraft(otherIdentity, 2_000)).toBeNull();
    expect(await loadEquipmentCheckDraft(base, 2_000)).toBeNull();
  });

  it('purges expired drafts without returning their contents', async () => {
    await saveEquipmentCheckDraft(base, { privateAnswer: 'failed' }, 1_000);

    expect(await loadEquipmentCheckDraft(base, 1_000 + EQUIPMENT_CHECK_DRAFT_RETENTION_MS)).toBeNull();
    expect(await clearAllEquipmentCheckDrafts()).toBe(0);
  });

  it('rejects when durable storage fails so the form can warn the member', async () => {
    vi.stubGlobal('indexedDB', {
      open: vi.fn(() => {
        throw new Error('storage disabled');
      }),
    });

    await expect(saveEquipmentCheckDraft(base, { answer: 'pass' })).rejects.toThrow('storage disabled');
  });

  it('clears every draft during logout cleanup', async () => {
    await saveEquipmentCheckDraft(base, { answer: 'pass' });
    await saveEquipmentCheckDraft({ ...base, shiftId: 'shift-b' }, { answer: 'fail' });

    expect(await clearAllEquipmentCheckDrafts()).toBe(2);
    expect(await loadEquipmentCheckDraft(base)).toBeNull();
  });
});
