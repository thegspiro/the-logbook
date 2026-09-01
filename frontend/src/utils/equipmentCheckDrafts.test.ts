import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OFFLINE_DB_NAME } from './offlineDb';
import {
  clearAllEquipmentCheckDrafts,
  deleteEquipmentCheckDraft,
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

  // Purging is about WHOSE work it is. Another member — or another org — on a
  // shared station tablet must never see this draft, so it is destroyed on
  // sight rather than merely withheld.
  it.each([
    ['account switching', { ...base, userId: 'user-b' }],
    ['organization switching', { ...base, organizationId: 'org-b' }],
  ])('purges rather than exposes a draft after %s', async (_name, otherIdentity) => {
    await saveEquipmentCheckDraft(base, { privateAnswer: 'failed' }, 1_000);

    expect(await loadEquipmentCheckDraft(otherIdentity, 2_000)).toBeNull();
    expect(await loadEquipmentCheckDraft(base, 2_000)).toBeNull();
  });

  // A revision change is the same member's own in-progress check, not someone
  // else's. Purging it discards a truck check a crew is part-way through, and
  // leaves EquipmentCheckForm's item-by-item reconciliation unreachable.
  it('returns a draft written under an older template revision so it can be reconciled', async () => {
    await saveEquipmentCheckDraft(base, { answer: 'pass' }, 1_000);

    const nextRevision = { ...base, templateRevision: 'revision-b' };
    const draft = await loadEquipmentCheckDraft<{ answer: string }>(nextRevision, 2_000);

    expect(draft?.contents).toEqual({ answer: 'pass' });
    // Left in place: the caller may never get as far as writing the reconciled
    // draft back, and losing it at that point is the same data loss.
    expect(await loadEquipmentCheckDraft(base, 2_000)).not.toBeNull();
  });

  it('prefers a draft saved under the current revision over a superseded one', async () => {
    await saveEquipmentCheckDraft(base, { answer: 'stale' }, 1_000);
    const nextRevision = { ...base, templateRevision: 'revision-b' };
    await saveEquipmentCheckDraft(nextRevision, { answer: 'current' }, 1_500);

    const draft = await loadEquipmentCheckDraft<{ answer: string }>(nextRevision, 2_000);

    expect(draft?.contents).toEqual({ answer: 'current' });
  });

  it('discards every revision of this checklist once it is submitted', async () => {
    // Keyed on the exact draft id, the delete missed the older revision — and
    // loadEquipmentCheckDraft hands that back as its fallback when no
    // current-revision draft exists. Reopening the checklist after submitting
    // restored the answers from the check just filed, for seven days.
    await saveEquipmentCheckDraft(base, { answer: 'stale' }, 1_000);
    const nextRevision = { ...base, templateRevision: 'revision-b' };
    await saveEquipmentCheckDraft(nextRevision, { answer: 'current' }, 1_500);

    await deleteEquipmentCheckDraft(nextRevision);

    expect(await loadEquipmentCheckDraft(nextRevision, 2_000)).toBeNull();
    expect(await clearAllEquipmentCheckDrafts()).toBe(0);
  });

  it('leaves another member’s draft for the same checklist alone', async () => {
    // Purging somebody else's work is loadEquipmentCheckDraft's job, and only
    // for the member actually holding the device.
    await saveEquipmentCheckDraft(base, { answer: 'mine' }, 1_000);
    await saveEquipmentCheckDraft({ ...base, userId: 'user-b' }, { answer: 'theirs' }, 1_000);

    await deleteEquipmentCheckDraft(base);

    expect(await clearAllEquipmentCheckDrafts()).toBe(1);
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
