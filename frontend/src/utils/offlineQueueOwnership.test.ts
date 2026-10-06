/**
 * FE3-34-5: an offline queue entry is sent only under the session of the
 * member who queued it.
 *
 * Runs against fake-indexeddb, like the queues' own tests, because what is
 * being tested is what survives in the store — a purge that failed, an entry
 * written before owners were recorded — and a mocked queue would only answer
 * whatever it was told to.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import type { ShiftEquipmentCheckCreate } from '@/modules/inventory/types/equipmentCheck';
import type { BatchShiftReportCreate } from '@/types/training';

interface AuthSnapshot {
  isAuthenticated: boolean;
  user: { id: string } | null;
}

const { auth, mockPost } = vi.hoisted(() => {
  const state: AuthSnapshot = { isAuthenticated: true, user: { id: 'member-a' } };
  return { auth: { state }, mockPost: vi.fn() };
});

vi.mock('../stores/authStore', () => ({
  useAuthStore: { getState: () => auth.state },
}));
vi.mock('../services/apiClient', () => ({
  default: { post: (...a: unknown[]) => mockPost(...a) as unknown },
}));
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import { enqueueCheck, listOwnPendingChecks, listPendingChecks, pendingCount } from './offlineQueue';
import {
  enqueueShiftReport,
  listOwnPendingReports,
  listPendingReports,
  pendingReportCount,
} from './shiftReportOfflineQueue';
import {
  enqueueGeneric,
  flushOne,
  genericPendingCount,
  getGenericItem,
  listGenericPending,
  putGenericItem,
  type GenericQueuedItem,
} from './genericOfflineQueue';
import { OfflineQueueOwnerError } from './offlineQueueOwner';
import { discardHeldItems, listHeldOfflineItems, sendHeldItemsAsMe } from './offlineQueueQuarantine';
import { openIndexedDb, openOfflineDb, STORE_PENDING_CHECKS, STORE_PENDING_SHIFT_REPORTS } from './offlineDb';
import { purgeLocalMemberData } from './purgeLocalMemberData';
import { triggerOfflineDrain } from '../hooks/useOfflineSyncEngine';
import type { AxiosInstance } from 'axios';

const checkPayload = { notes: 'bay 2' } as unknown as ShiftEquipmentCheckCreate;
const reportPayload = { shift_id: 'shift-1' } as unknown as BatchShiftReportCreate;

function signInAs(id: string | null): void {
  auth.state = id ? { isAuthenticated: true, user: { id } } : { isAuthenticated: false, user: null };
}

/**
 * Rewrite a stored entry without its owner — what every entry queued before
 * FE3-34-5 looks like, since the field did not exist.
 */
async function stripOwner(store: string, id: string, generic = false): Promise<void> {
  const db = generic
    ? await openIndexedDb('logbook-offline-generic', 1, (d) => {
        if (!d.objectStoreNames.contains('pendingMutations'))
          d.createObjectStore('pendingMutations', { keyPath: 'id' });
      })
    : await openOfflineDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    const read = os.get(id);
    read.onsuccess = () => {
      const legacy = { ...(read.result as { ownerId?: string }) };
      delete legacy.ownerId;
      os.put(legacy);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('strip failed'));
  });
  db.close();
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  signInAs('member-a');
  mockPost.mockReset();
  mockPost.mockResolvedValue({ data: {} });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('tagging on enqueue', () => {
  it('stamps each queue entry with the member who queued it', async () => {
    await enqueueCheck('shift-1', checkPayload, []);
    await enqueueShiftReport(reportPayload);
    await enqueueGeneric('event-rsvp', '/events/1/rsvp', {}, 'RSVP');

    expect((await listPendingChecks())[0]?.ownerId).toBe('member-a');
    expect((await listPendingReports())[0]?.ownerId).toBe('member-a');
    expect((await listGenericPending())[0]?.ownerId).toBe('member-a');
  });

  it('stamps a held NFC session with the signed-in member, not whatever the screen passed', async () => {
    const session: GenericQueuedItem = {
      id: 'putaway-1',
      kind: 'nfc-put-away',
      url: '/inventory/nfc/put-away/replay',
      body: { taps: [] },
      label: 'Put away',
      queuedAt: 1,
      retries: 0,
      ownerId: 'someone-else',
    };

    await putGenericItem(session);

    expect((await getGenericItem('putaway-1'))?.ownerId).toBe('member-a');
  });

  it('refuses to queue anything with nobody signed in, rather than leave an unowned entry', async () => {
    signInAs(null);

    await expect(enqueueCheck('shift-1', checkPayload, [])).rejects.toBeInstanceOf(OfflineQueueOwnerError);
    await expect(enqueueShiftReport(reportPayload)).rejects.toBeInstanceOf(OfflineQueueOwnerError);
    await expect(enqueueGeneric('event-rsvp', '/events/1/rsvp', {}, 'RSVP')).rejects.toBeInstanceOf(
      OfflineQueueOwnerError
    );

    expect(await listPendingChecks()).toEqual([]);
    expect(await listPendingReports()).toEqual([]);
    expect(await listGenericPending()).toEqual([]);
  });

  it('never rewrites an entry another member queued under the same id', async () => {
    const item = await enqueueGeneric('nfc-put-away', '/inventory/nfc/put-away/replay', { taps: [1] }, 'Put away');
    signInAs('member-b');

    await expect(putGenericItem({ ...item, body: { taps: [] } })).rejects.toThrow('another session');

    const stored = await getGenericItem(item.id);
    expect(stored?.ownerId).toBe('member-a');
    expect(stored?.body).toEqual({ taps: [1] });
  });
});

describe('sync sends only the signed-in member’s own entries', () => {
  it('leaves another member’s and untagged entries in place and still drains the member’s own', async () => {
    const legacy = await enqueueGeneric('training-submission', '/training/submissions', { n: 'legacy' }, 'Old');
    await stripOwner('pendingMutations', legacy.id, true);
    await enqueueGeneric('event-rsvp', '/events/a/rsvp', { n: 'a' }, 'RSVP');
    signInAs('member-b');
    const own = await enqueueGeneric('event-rsvp', '/events/b/rsvp', { n: 'b' }, 'RSVP');

    await triggerOfflineDrain();

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith('/events/b/rsvp', { n: 'b' });
    expect(await getGenericItem(own.id)).toBeNull();
    const left = await listGenericPending();
    expect(left.map((i) => i.body)).toHaveLength(2);
    expect(left.map((i) => i.body)).toEqual(expect.arrayContaining([{ n: 'legacy' }, { n: 'a' }]));
  });

  it('lists and counts only the member’s own checks and reports for the page drains', async () => {
    const otherCheck = await enqueueCheck('shift-1', checkPayload, []);
    const otherReport = await enqueueShiftReport(reportPayload);
    signInAs('member-b');
    const ownCheck = await enqueueCheck('shift-2', checkPayload, []);
    const ownReport = await enqueueShiftReport(reportPayload);

    expect((await listOwnPendingChecks()).map((e) => e.id)).toEqual([ownCheck]);
    expect((await listOwnPendingReports()).map((e) => e.id)).toEqual([ownReport]);
    expect(await pendingCount()).toBe(1);
    expect(await pendingReportCount()).toBe(1);
    expect((await listPendingChecks()).map((e) => e.id)).toContain(otherCheck);
    expect((await listPendingReports()).map((e) => e.id)).toContain(otherReport);
  });

  it('does not send an item whose owner is no longer the one signed in', async () => {
    const item = await enqueueGeneric('event-rsvp', '/events/1/rsvp', {}, 'RSVP');
    signInAs('member-b');
    const post = vi.fn().mockResolvedValue({ data: {} });

    expect(await flushOne(item, { post } as unknown as AxiosInstance)).toBe(false);
    expect(post).not.toHaveBeenCalled();
    expect(await getGenericItem(item.id)).not.toBeNull();
  });

  it('does not count held or another member’s items as pending for this member', async () => {
    await enqueueGeneric('event-rsvp', '/events/1/rsvp', {}, 'RSVP');
    signInAs('member-b');

    expect(await genericPendingCount()).toBe(0);
  });
});

describe('a sign-in purge that silently fails', () => {
  it('leaves the previous member’s entries on the device, and none of them is sent as the next member', async () => {
    await enqueueCheck('shift-1', checkPayload, []);
    await enqueueShiftReport(reportPayload);
    await enqueueGeneric('training-submission', '/training/submissions', { by: 'a' }, 'Drill');

    // IndexedDB refusing the clears: the purge must still settle without
    // throwing, so sign-in is never blocked, and the entries survive it.
    vi.spyOn(IDBObjectStore.prototype, 'clear').mockImplementation(() => {
      throw new DOMException('blocked', 'InvalidStateError');
    });
    await expect(purgeLocalMemberData()).resolves.toBeDefined();
    expect(await listPendingChecks()).toHaveLength(1);
    expect(await listPendingReports()).toHaveLength(1);
    expect(await listGenericPending()).toHaveLength(1);

    signInAs('member-b');
    await triggerOfflineDrain();

    expect(mockPost).not.toHaveBeenCalled();
    expect(await listOwnPendingChecks()).toEqual([]);
    expect(await listOwnPendingReports()).toEqual([]);
    // Another member's entries are not offered for review either: they have
    // an owner, who may sign back in on this device and send them.
    expect(await listHeldOfflineItems()).toEqual([]);
  });
});

describe('legacy untagged entries', () => {
  async function seedLegacy() {
    const check = await enqueueCheck('shift-1', checkPayload, []);
    const report = await enqueueShiftReport(reportPayload);
    const generic = await enqueueGeneric('event-rsvp', '/events/1/rsvp', { legacy: true }, 'RSVP');
    await stripOwner(STORE_PENDING_CHECKS, check);
    await stripOwner(STORE_PENDING_SHIFT_REPORTS, report);
    await stripOwner('pendingMutations', generic.id, true);
    return { check, report, generic: generic.id };
  }

  it('are held for review and never sent automatically', async () => {
    const ids = await seedLegacy();

    await triggerOfflineDrain();

    expect(mockPost).not.toHaveBeenCalled();
    expect(await listOwnPendingChecks()).toEqual([]);
    expect(await listOwnPendingReports()).toEqual([]);
    const held = await listHeldOfflineItems();
    expect(held.map((h) => [h.queue, h.id, h.kind])).toEqual(
      expect.arrayContaining([
        ['check', ids.check, 'equipment-check'],
        ['report', ids.report, 'shift-report'],
        ['generic', ids.generic, 'event-rsvp'],
      ])
    );
    expect(held).toHaveLength(3);
  });

  it('send as the signed-in member once claimed, and are then drained', async () => {
    await seedLegacy();
    signInAs('member-b');

    const claimed = await sendHeldItemsAsMe(await listHeldOfflineItems());
    await triggerOfflineDrain();

    expect(claimed).toBe(3);
    expect(await listHeldOfflineItems()).toEqual([]);
    expect((await listOwnPendingChecks())[0]?.ownerId).toBe('member-b');
    expect((await listOwnPendingReports())[0]?.ownerId).toBe('member-b');
    expect(mockPost).toHaveBeenCalledWith('/events/1/rsvp', { legacy: true });
  });

  it('cannot be claimed with nobody signed in', async () => {
    await seedLegacy();
    const held = await listHeldOfflineItems();
    signInAs(null);

    await expect(sendHeldItemsAsMe(held)).rejects.toBeInstanceOf(OfflineQueueOwnerError);
    expect(await listHeldOfflineItems()).toHaveLength(3);
  });

  it('never reassigns an entry that already has an owner', async () => {
    const id = await enqueueCheck('shift-1', checkPayload, []);
    signInAs('member-b');

    const claimed = await sendHeldItemsAsMe([{ queue: 'check', id, kind: 'equipment-check', queuedAt: 0 }]);

    expect(claimed).toBe(0);
    expect((await listPendingChecks())[0]?.ownerId).toBe('member-a');
  });

  it('are deleted by discard without being sent', async () => {
    await seedLegacy();

    await discardHeldItems(await listHeldOfflineItems());

    expect(await listHeldOfflineItems()).toEqual([]);
    expect(await listPendingChecks()).toEqual([]);
    expect(await listPendingReports()).toEqual([]);
    expect(await listGenericPending()).toEqual([]);
    expect(mockPost).not.toHaveBeenCalled();
  });
});
