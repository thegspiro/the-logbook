import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
  STORE_PENDING_CHECKS,
  STORE_PENDING_SHIFT_REPORTS,
  openIndexedDb,
  upgradeOfflineDb,
} from './offlineDb';

/**
 * Minimal stand-in for an IDBOpenDBRequest. jsdom ships no IndexedDB, and the
 * behaviour under test is the event wiring itself, so a fake request lets us
 * fire `blocked` — which a real browser only produces under a race we cannot
 * stage deterministically.
 */
function fakeOpenRequest() {
  return {
    result: { close: vi.fn(), onversionchange: null } as unknown as IDBDatabase,
    error: null as DOMException | null,
    onsuccess: null as (() => void) | null,
    onerror: null as (() => void) | null,
    onblocked: null as (() => void) | null,
    onupgradeneeded: null as (() => void) | null,
  };
}

function stubIndexedDb(request: ReturnType<typeof fakeOpenRequest>) {
  vi.stubGlobal('indexedDB', { open: vi.fn(() => request) });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('offline database versioning', () => {
  it('creates both shared stores in a single upgrade', () => {
    const created: string[] = [];
    const db = {
      objectStoreNames: { contains: () => false },
      createObjectStore: (name: string) => created.push(name),
    } as unknown as IDBDatabase;

    upgradeOfflineDb(db);

    // The equipment-check queue and the shift-report queue share one database.
    // If an upgrade created only one store, the other queue would throw
    // NotFoundError on every transaction.
    expect(created).toContain(STORE_PENDING_CHECKS);
    expect(created).toContain(STORE_PENDING_SHIFT_REPORTS);
  });

  it('is skipped when the stores already exist', () => {
    const createObjectStore = vi.fn();
    const db = {
      objectStoreNames: { contains: () => true },
      createObjectStore,
    } as unknown as IDBDatabase;

    upgradeOfflineDb(db);

    expect(createObjectStore).not.toHaveBeenCalled();
  });

  it('exposes one name and version for every consumer to share', () => {
    // Regression guard: offlineQueue.ts opened this database at version 1
    // while shiftReportOfflineQueue.ts opened it at version 2. IndexedDB
    // rejects an open below the stored version, so queueing a shift report
    // permanently broke equipment-check queueing on that browser profile.
    // Neither module may declare its own version again.
    expect(OFFLINE_DB_NAME).toBe('logbook-offline');
    expect(OFFLINE_DB_VERSION).toBeGreaterThanOrEqual(2);
  });
});

describe('openIndexedDb', () => {
  it('resolves with the database and lets other tabs upgrade', async () => {
    const request = fakeOpenRequest();
    stubIndexedDb(request);

    const promise = openIndexedDb('db', 1, () => {});
    request.onsuccess?.();
    const db = await promise;

    expect(db).toBe(request.result);
    // Without this, a tab left open on an old version blocks every other tab's
    // upgrade indefinitely.
    expect(db.onversionchange).toBeTypeOf('function');
  });

  it('rejects instead of hanging when the upgrade is blocked', async () => {
    const request = fakeOpenRequest();
    stubIndexedDb(request);

    const promise = openIndexedDb('db', 2, () => {});
    request.onblocked?.();

    await expect(promise).rejects.toThrow(/blocked/i);
  });

  it('rejects when the open request never settles', async () => {
    vi.useFakeTimers();
    const request = fakeOpenRequest();
    stubIndexedDb(request);

    const promise = openIndexedDb('db', 1, () => {});
    const assertion = expect(promise).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(10_000);

    await assertion;
  });

  it('closes a connection that arrives after the timeout', async () => {
    vi.useFakeTimers();
    const request = fakeOpenRequest();
    stubIndexedDb(request);

    const promise = openIndexedDb('db', 1, () => {});
    const assertion = expect(promise).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;

    request.onsuccess?.();

    // The caller has moved on; leaving the handle open would leak it and block
    // the next tab's upgrade.
    expect(request.result.close).toHaveBeenCalledWith();
  });

  it('rejects when IndexedDB throws synchronously', async () => {
    vi.stubGlobal('indexedDB', {
      open: () => {
        // Safari private browsing does this.
        throw new Error('access denied');
      },
    });

    await expect(openIndexedDb('db', 1, () => {})).rejects.toThrow('access denied');
  });
});
