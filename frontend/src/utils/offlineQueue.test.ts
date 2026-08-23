import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import type { ShiftEquipmentCheckCreate } from '@/modules/scheduling/types/equipmentCheck';
import {
  enqueueCheck,
  listPendingChecks,
  dequeueCheck,
  markRetry,
  pendingCount,
  clearAllQueuedChecks,
  CHECK_QUEUE_MAX_RETRIES,
} from './offlineQueue';

/**
 * These run against fake-indexeddb — a real, spec-compliant IndexedDB — rather
 * than a stubbed `openOfflineDb`. The queue is a thin layer over IDB, so a
 * mocked database would leave the tests asserting against the mock: transaction
 * scoping, key collisions and blob round-tripping are exactly the parts that
 * would go untested.
 */

const payload = { notes: 'bay 2 sweep' } as unknown as ShiftEquipmentCheckCreate;

function photoFile(name = 'nozzle.jpg'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' });
}

describe('offlineQueue', () => {
  beforeEach(() => {
    // A fresh factory per test; IndexedDB is otherwise global and persistent
    // across the file, so one test's queue would leak into the next.
    globalThis.indexedDB = new IDBFactory();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('enqueue and read back', () => {
    it('persists a submission so a dropped connection cannot lose it', async () => {
      const id = await enqueueCheck('shift-1', payload, []);

      const pending = await listPendingChecks();
      expect(pending).toHaveLength(1);
      expect(pending[0]).toEqual(
        expect.objectContaining({
          id,
          shiftId: 'shift-1',
          retries: 0,
        })
      );
      expect(pending[0]?.payload.notes).toBe(payload.notes);
      expect(pending[0]?.payload.client_submission_id).toBe(id);
    });

    it('starts an entry at zero retries and stamps when it was queued', async () => {
      await enqueueCheck('shift-1', payload, []);

      const [entry] = await listPendingChecks();
      expect(entry?.retries).toBe(0);
      expect(entry?.queuedAt).toBeGreaterThan(0);
    });

    it('reports an empty queue rather than throwing when nothing is stored', async () => {
      expect(await listPendingChecks()).toEqual([]);
      expect(await pendingCount()).toBe(0);
    });

    // Photos are the reason this queue lives on IndexedDB rather than
    // localStorage: a blob cannot survive a string store.
    //
    // NOT ASSERTED HERE: that the blob's *bytes* survive the round trip.
    // fake-indexeddb's structured clone does not preserve a jsdom File — it
    // comes back as a plain empty object with no arrayBuffer(). That is a
    // limitation of the test environment, not of the queue; real browsers clone
    // Blobs faithfully. Photo byte fidelity needs a browser-backed test
    // (Playwright) to cover, so treat it as uncovered rather than passing.
    it('keeps each photo attributed to the item it was taken for', async () => {
      await enqueueCheck('shift-1', payload, [{ itemId: 'item-1', files: [photoFile('a.jpg'), photoFile('b.jpg')] }]);

      const [entry] = await listPendingChecks();
      expect(entry?.photos).toHaveLength(2);
      expect(entry?.photos.map((p) => p.itemId)).toEqual(['item-1', 'item-1']);
      expect(entry?.photos.map((p) => p.fileName)).toEqual(['a.jpg', 'b.jpg']);
    });

    it('flattens photos from several items into one list, keeping their owners', async () => {
      await enqueueCheck('shift-1', payload, [
        { itemId: 'item-1', files: [photoFile('a.jpg')] },
        { itemId: 'item-2', files: [photoFile('b.jpg')] },
      ]);

      const [entry] = await listPendingChecks();
      expect(entry?.photos.map((p) => p.itemId)).toEqual(['item-1', 'item-2']);
    });

    it('handles an item that carries no photos', async () => {
      await enqueueCheck('shift-1', payload, [{ itemId: 'item-1', files: [] }]);

      const [entry] = await listPendingChecks();
      expect(entry?.photos).toEqual([]);
    });

    // Two submissions queued in the same millisecond must not collide on the
    // primary key — the second would silently overwrite the first, which is
    // data loss of exactly the kind this queue exists to prevent.
    it('keeps submissions distinct when queued in the same millisecond', async () => {
      // Only Date is faked. fake-indexeddb drives its request callbacks through
      // real timers, so freezing those deadlocks every await in this file.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-08-16T12:00:00Z'));

      const first = await enqueueCheck('shift-1', payload, []);
      const second = await enqueueCheck('shift-2', payload, []);

      expect(first).not.toBe(second);
      expect(await pendingCount()).toBe(2);
    });
  });

  describe('draining the queue', () => {
    it('removes only the submission that synced', async () => {
      const keep = await enqueueCheck('shift-1', payload, []);
      const drop = await enqueueCheck('shift-2', payload, []);

      await dequeueCheck(drop);

      const remaining = await listPendingChecks();
      expect(remaining.map((e) => e.id)).toEqual([keep]);
    });

    it('treats dequeuing an unknown id as a no-op', async () => {
      await enqueueCheck('shift-1', payload, []);

      await expect(dequeueCheck('never-existed')).resolves.toBeUndefined();
      expect(await pendingCount()).toBe(1);
    });

    it('counts what is still waiting', async () => {
      await enqueueCheck('shift-1', payload, []);
      await enqueueCheck('shift-2', payload, []);
      expect(await pendingCount()).toBe(2);

      // `?? ''` rather than a non-null assertion: an empty id dequeues nothing,
      // so an unexpectedly empty queue fails on the count below instead of
      // throwing somewhere less informative.
      const [firstPending] = await listPendingChecks();
      await dequeueCheck(firstPending?.id ?? '');
      expect(await pendingCount()).toBe(1);
    });
  });

  describe('retry accounting', () => {
    it('increments the retry count on a failed attempt', async () => {
      const id = await enqueueCheck('shift-1', payload, []);

      await markRetry(id);
      await markRetry(id);

      const [entry] = await listPendingChecks();
      expect(entry?.retries).toBe(2);
    });

    it('returns the updated entry so the caller can see the retry count', async () => {
      const id = await enqueueCheck('shift-1', payload, []);

      const updated = await markRetry(id);

      expect(updated?.id).toBe(id);
      expect(updated?.retries).toBe(1);
    });

    // The drain loop compares against this ceiling and dequeues rather than
    // re-sending a body the server has refused every time.
    it('reaches the retry ceiling so a rejected check can be abandoned', async () => {
      const id = await enqueueCheck('shift-1', payload, []);

      let updated = null as Awaited<ReturnType<typeof markRetry>>;
      for (let i = 0; i < CHECK_QUEUE_MAX_RETRIES; i++) {
        updated = await markRetry(id);
      }

      expect(updated?.retries).toBeGreaterThanOrEqual(CHECK_QUEUE_MAX_RETRIES);
      await dequeueCheck(id);
      expect(await pendingCount()).toBe(0);
    });

    // A retry must never destroy the submission it is counting — the payload
    // and its photos have to survive every attempt.
    it('preserves the payload and photos across retries', async () => {
      const id = await enqueueCheck('shift-1', payload, [{ itemId: 'item-1', files: [photoFile()] }]);

      await markRetry(id);

      const [entry] = await listPendingChecks();
      expect(entry?.payload).toEqual(expect.objectContaining(payload));
      expect(entry?.payload.client_submission_id).toBe(id);
      expect(entry?.photos).toHaveLength(1);
      expect(entry?.shiftId).toBe('shift-1');
    });

    it('returns null for an entry that is already gone', async () => {
      await expect(markRetry('never-existed')).resolves.toBeNull();
      expect(await pendingCount()).toBe(0);
    });

    it('does not disturb the other entries in the queue', async () => {
      const first = await enqueueCheck('shift-1', payload, []);
      await enqueueCheck('shift-2', payload, []);

      await markRetry(first);

      const entries = await listPendingChecks();
      const other = entries.find((e) => e.id !== first);
      expect(other?.retries).toBe(0);
    });
  });

  // SEC (FE-7): IndexedDB is shared by every user of the browser profile, so on
  // a shared station computer the next member must not inherit the previous
  // member's unsent submissions and photos.
  describe('purge on logout', () => {
    it('discards every queued submission', async () => {
      await enqueueCheck('shift-1', payload, [{ itemId: 'i', files: [photoFile()] }]);
      await enqueueCheck('shift-2', payload, []);

      await clearAllQueuedChecks();

      expect(await listPendingChecks()).toEqual([]);
      expect(await pendingCount()).toBe(0);
    });

    // The count is returned so the caller can tell the member what was lost
    // rather than destroying unsent work silently.
    it('reports how many submissions were destroyed', async () => {
      await enqueueCheck('shift-1', payload, []);
      await enqueueCheck('shift-2', payload, []);

      expect(await clearAllQueuedChecks()).toBe(2);
    });

    it('reports zero for an already-empty queue', async () => {
      expect(await clearAllQueuedChecks()).toBe(0);
    });

    it('is safe to run twice', async () => {
      await enqueueCheck('shift-1', payload, []);

      expect(await clearAllQueuedChecks()).toBe(1);
      expect(await clearAllQueuedChecks()).toBe(0);
    });
  });
});
