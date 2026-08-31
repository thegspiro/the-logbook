import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import type { ShiftEquipmentCheckCreate } from '@/modules/inventory/types/equipmentCheck';
import {
  enqueueCheck,
  listPendingChecks,
  dequeueCheck,
  markRetry,
  markCheckSubmitted,
  markPhotosUploaded,
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
    // Restored here rather than at the end of a test body: a spy left in place
    // by a failing assertion keeps counting into the next case, turning one
    // real failure into a cascade of misleading ones.
    vi.restoreAllMocks();
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

    /**
     * authStore.logout leaves the check form mounted while it awaits the device
     * purge, so a submission completing during logout races it. A read in one
     * transaction followed by a put in another lets the loser re-create the
     * record it had already read — payload, photo blobs and all — after the
     * purge emptied the store.
     *
     * The interleaving that does it cannot be provoked from a test: both calls
     * await their own `openOfflineDb`, and which transaction gets created first
     * is not something the caller controls. What *is* controllable, and what
     * actually closes the window, is that each read-modify-write occupies a
     * single transaction — IndexedDB then serializes it against the purge
     * whichever order they arrive in. So that is what these assert.
     */
    it.each([
      ['markCheckSubmitted', (id: string) => markCheckSubmitted(id, 'check-1', { i: 'check-item-1' })],
      ['markRetry', (id: string) => markRetry(id)],
      ['markPhotosUploaded', (id: string) => markPhotosUploaded(id, 'i')],
    ])('reads and writes in one transaction, so %s cannot straddle the purge', async (_name, mutate) => {
      const id = await enqueueCheck('shift-1', payload, [{ itemId: 'i', files: [photoFile()] }]);
      const openTransaction = vi.spyOn(IDBDatabase.prototype, 'transaction');

      await mutate(id);

      expect(openTransaction).toHaveBeenCalledTimes(1);
      expect(openTransaction.mock.calls[0]?.[1]).toBe('readwrite');
    });
  });

  /**
   * The upload endpoint appends to an item's photo_urls and caps it at three,
   * so a group still queued after a successful POST is uploaded a second time
   * on the next drain — filing duplicate evidence, or tripping the cap and
   * returning a permanent 400 that counts toward CHECK_QUEUE_MAX_RETRIES and
   * eventually discards the photos that never made it.
   */
  describe('photo upload checkpointing', () => {
    it('drops only the photos for the item the server accepted', async () => {
      const id = await enqueueCheck('shift-1', payload, [
        { itemId: 'nozzle', files: [photoFile('nozzle.jpg')] },
        { itemId: 'hose', files: [photoFile('hose.jpg')] },
      ]);

      await markPhotosUploaded(id, 'nozzle');

      const [entry] = await listPendingChecks();
      expect(entry?.photos.map((photo) => photo.itemId)).toEqual(['hose']);
    });

    it('drops every photo taken for the same item together', async () => {
      const id = await enqueueCheck('shift-1', payload, [
        { itemId: 'nozzle', files: [photoFile('a.jpg'), photoFile('b.jpg')] },
      ]);

      await markPhotosUploaded(id, 'nozzle');

      const [entry] = await listPendingChecks();
      expect(entry?.photos).toEqual([]);
    });

    it('keeps the entry and its submitted-check ID so the rest can still resume', async () => {
      const id = await enqueueCheck('shift-1', payload, [
        { itemId: 'nozzle', files: [photoFile()] },
        { itemId: 'hose', files: [photoFile()] },
      ]);
      await markCheckSubmitted(id, 'check-1', { nozzle: 'ci-1', hose: 'ci-2' });

      await markPhotosUploaded(id, 'nozzle');

      const [entry] = await listPendingChecks();
      expect(entry?.submittedCheckId).toBe('check-1');
      expect(entry?.submittedItemIds).toEqual({ nozzle: 'ci-1', hose: 'ci-2' });
    });

    it('returns null for an entry the purge already removed', async () => {
      await expect(markPhotosUploaded('never-existed', 'nozzle')).resolves.toBeNull();
    });
  });
});
