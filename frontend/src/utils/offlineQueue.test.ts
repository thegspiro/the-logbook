import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * jsdom ships no IndexedDB, so the object store is stood up in a Map and the
 * request objects are faked. Only the store semantics matter here — the
 * database plumbing itself is covered by offlineDb.test.ts.
 */
const store = new Map<string, unknown>();

function fakeRequest<T>(getValue: () => T) {
  const req = {
    result: undefined as T | undefined,
    error: null as DOMException | null,
    onsuccess: null as (() => void) | null,
    onerror: null as (() => void) | null,
  };
  queueMicrotask(() => {
    req.result = getValue();
    req.onsuccess?.();
  });
  return req;
}

vi.mock('./offlineDb', () => ({
  STORE_PENDING_CHECKS: 'pendingChecks',
  openOfflineDb: () =>
    Promise.resolve({
      transaction: () => ({
        objectStore: () => ({
          get: (id: string) => fakeRequest(() => store.get(id)),
          put: (entry: { id: string }) =>
            fakeRequest(() => {
              store.set(entry.id, entry);
              return entry.id;
            }),
          delete: (id: string) =>
            fakeRequest(() => {
              store.delete(id);
              return undefined;
            }),
          getAll: () => fakeRequest(() => [...store.values()]),
          count: () => fakeRequest(() => store.size),
        }),
      }),
    }),
}));

import { markRetry, dequeueCheck, CHECK_QUEUE_MAX_RETRIES, type QueuedCheck } from './offlineQueue';

function queuedCheck(overrides: Partial<QueuedCheck> = {}): QueuedCheck {
  return {
    id: 'q-1',
    shiftId: 'shift-1',
    payload: { template_id: 't-1', check_timing: 'start', items: [] },
    photos: [],
    queuedAt: 0,
    retries: 0,
    ...overrides,
  };
}

describe('offlineQueue', () => {
  beforeEach(() => {
    store.clear();
  });

  describe('markRetry', () => {
    it('returns the updated entry so the caller can see the retry count', async () => {
      store.set('q-1', queuedCheck());

      const updated = await markRetry('q-1');

      expect(updated?.retries).toBe(1);
      expect((store.get('q-1') as QueuedCheck).retries).toBe(1);
    });

    it('returns null when the entry is already gone', async () => {
      expect(await markRetry('missing')).toBeNull();
    });

    it('reaches the retry ceiling so a rejected check can be abandoned', async () => {
      store.set('q-1', queuedCheck({ retries: CHECK_QUEUE_MAX_RETRIES - 1 }));

      const updated = await markRetry('q-1');

      // The drain loop compares against this and dequeues rather than
      // re-sending a body the server has refused every time.
      expect(updated?.retries).toBeGreaterThanOrEqual(CHECK_QUEUE_MAX_RETRIES);
      await dequeueCheck('q-1');
      expect(store.has('q-1')).toBe(false);
    });
  });
});
