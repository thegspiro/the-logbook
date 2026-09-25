import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import type { AxiosInstance } from 'axios';
import {
  GENERIC_HELD_STALE_MS,
  GENERIC_QUEUE_MAX_RETRIES,
  enqueueGeneric,
  flushOne,
  getGenericItem,
  isGenericSendable,
  listGenericPending,
  putGenericItem,
  type GenericQueuedItem,
} from './genericOfflineQueue';

/**
 * Against fake-indexeddb, a real IndexedDB, for the reason offlineQueue.test.ts
 * gives: the queue is a thin layer over it, and a mock would only test itself.
 */

const axiosThat = (post: (url: string, body: unknown) => Promise<unknown>) => ({ post }) as unknown as AxiosInstance;

const held = (over: Partial<GenericQueuedItem> = {}): GenericQueuedItem => ({
  id: 'session-1',
  kind: 'nfc-put-away',
  url: '/inventory/nfc/put-away/replay',
  body: { taps: [] },
  label: 'Put away',
  queuedAt: 1_000,
  retries: 0,
  held: true,
  updatedAt: 1_000,
  ...over,
});

describe('genericOfflineQueue', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    vi.restoreAllMocks();
  });

  describe('held entries', () => {
    it('writes and rewrites an entry under one id', async () => {
      await putGenericItem(held({ body: { taps: [1] } }));
      await putGenericItem(held({ body: { taps: [1, 2] } }));

      const all = await listGenericPending();
      expect(all).toHaveLength(1);
      expect((await getGenericItem('session-1'))?.body).toEqual({ taps: [1, 2] });
    });

    it('is not sendable while being written, and is once released', () => {
      expect(isGenericSendable(held(), 2_000)).toBe(false);
      expect(isGenericSendable(held({ held: false }), 2_000)).toBe(true);
    });

    it('is sent anyway once it has gone quiet, so a closed tab does not strand it', () => {
      expect(isGenericSendable(held(), 1_000 + GENERIC_HELD_STALE_MS - 1)).toBe(false);
      expect(isGenericSendable(held(), 1_000 + GENERIC_HELD_STALE_MS)).toBe(true);
    });

    it('treats an ordinary entry as sendable', async () => {
      const item = await enqueueGeneric('event-rsvp', '/events/1/rsvp', {}, 'RSVP');
      expect(isGenericSendable(item)).toBe(true);
    });
  });

  describe('flushOne', () => {
    it('removes a sent entry and hands the answer on', async () => {
      const item = await enqueueGeneric('nfc-shelf-audit', '/inventory/nfc/audits/replay', { a: 1 }, 'Audit');
      const onSynced = vi.fn();

      const ok = await flushOne(
        item,
        axiosThat(() => Promise.resolve({ data: { audit: null } })),
        onSynced
      );

      expect(ok).toBe(true);
      expect(onSynced).toHaveBeenCalledWith({ audit: null });
      expect(await getGenericItem(item.id)).toBeNull();
    });

    it('does not count a send that never reached the server against the item', async () => {
      const item = await enqueueGeneric('training-submission', '/training/submissions', {}, 'Drill');
      const noSignal = axiosThat(() => Promise.reject(Object.assign(new Error('Network Error'), { request: {} })));

      for (let attempt = 0; attempt < GENERIC_QUEUE_MAX_RETRIES + 2; attempt += 1) {
        expect(await flushOne(item, noSignal)).toBe(false);
      }

      expect((await getGenericItem(item.id))?.retries).toBe(0);
    });

    it('still gives up on a request the server keeps refusing', async () => {
      const item = await enqueueGeneric('training-submission', '/training/submissions', {}, 'Drill');
      const refused = axiosThat(() =>
        Promise.reject(Object.assign(new Error('Request failed'), { response: { status: 422 } }))
      );

      let current: GenericQueuedItem | null = item;
      for (let attempt = 0; attempt < GENERIC_QUEUE_MAX_RETRIES && current; attempt += 1) {
        await flushOne(current, refused);
        current = await getGenericItem(item.id);
      }

      expect(current).toBeNull();
    });
  });
});
