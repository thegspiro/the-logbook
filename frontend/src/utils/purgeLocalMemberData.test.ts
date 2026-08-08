import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockClearAllDrafts = vi.fn();
const mockClearAllQueuedChecks = vi.fn();
const mockClearAllQueuedReports = vi.fn();
const mockClearAllGenericQueued = vi.fn();

vi.mock('./shiftReportDrafts', () => ({
  clearAllDrafts: () => mockClearAllDrafts() as number,
}));
vi.mock('./offlineQueue', () => ({
  clearAllQueuedChecks: () => mockClearAllQueuedChecks() as Promise<number>,
}));
vi.mock('./shiftReportOfflineQueue', () => ({
  clearAllQueuedReports: () => mockClearAllQueuedReports() as Promise<number>,
}));
vi.mock('./genericOfflineQueue', () => ({
  clearAllGenericQueued: () => mockClearAllGenericQueued() as Promise<number>,
}));

import { purgeLocalMemberData } from './purgeLocalMemberData';

describe('purgeLocalMemberData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClearAllDrafts.mockReturnValue(0);
    mockClearAllQueuedChecks.mockResolvedValue(0);
    mockClearAllQueuedReports.mockResolvedValue(0);
    mockClearAllGenericQueued.mockResolvedValue(0);
  });

  it('clears every device-local store that can hold member PII', async () => {
    await purgeLocalMemberData();

    // These clear functions genuinely take no arguments, so the zero-arg
    // form of toHaveBeenCalledWith is the accurate assertion here (see the
    // Pitfall #13 note in CLAUDE.md — this is the narrow case it allows).
    expect(mockClearAllDrafts).toHaveBeenCalledWith();
    expect(mockClearAllQueuedChecks).toHaveBeenCalledWith();
    expect(mockClearAllQueuedReports).toHaveBeenCalledWith();
    expect(mockClearAllGenericQueued).toHaveBeenCalledWith();
  });

  it('reports how much unsent work was discarded', async () => {
    mockClearAllDrafts.mockReturnValue(3);
    mockClearAllQueuedChecks.mockResolvedValue(2);
    mockClearAllQueuedReports.mockResolvedValue(5);
    mockClearAllGenericQueued.mockResolvedValue(1);

    const result = await purgeLocalMemberData();

    expect(result.drafts).toBe(3);
    expect(result.queuedChecks).toBe(2);
    expect(result.queuedReports).toBe(5);
    expect(result.queuedGeneric).toBe(1);
    // Drafts are local-only work-in-progress; only the queues held items
    // that were meant to reach the server.
    expect(result.unsyncedDiscarded).toBe(8);
  });

  it('still clears the other stores when one throws', async () => {
    mockClearAllDrafts.mockImplementation(() => {
      throw new Error('localStorage unavailable (private browsing)');
    });
    mockClearAllQueuedChecks.mockResolvedValue(4);

    const result = await purgeLocalMemberData();

    expect(mockClearAllQueuedChecks).toHaveBeenCalledWith();
    expect(mockClearAllQueuedReports).toHaveBeenCalledWith();
    expect(mockClearAllGenericQueued).toHaveBeenCalledWith();
    expect(result.drafts).toBe(0);
    expect(result.queuedChecks).toBe(4);
  });

  it('never rejects — a purge failure must not be able to block logout', async () => {
    mockClearAllDrafts.mockImplementation(() => {
      throw new Error('boom');
    });
    mockClearAllQueuedChecks.mockRejectedValue(new Error('idb gone'));
    mockClearAllQueuedReports.mockRejectedValue(new Error('idb gone'));
    mockClearAllGenericQueued.mockRejectedValue(new Error('idb gone'));

    await expect(purgeLocalMemberData()).resolves.toEqual({
      drafts: 0,
      queuedChecks: 0,
      queuedReports: 0,
      queuedGeneric: 0,
      unsyncedDiscarded: 0,
    });
  });

  it('still settles when a store never resolves, and clears the rest', async () => {
    // A blocked IndexedDB upgrade leaves its promise pending forever. Logout
    // awaits this purge, so an unbounded wait would strand a member signed in
    // on a shared terminal — the exact risk the purge exists to remove.
    vi.useFakeTimers();
    try {
      mockClearAllQueuedChecks.mockReturnValue(new Promise(() => {}));
      mockClearAllGenericQueued.mockResolvedValue(2);

      const pending = purgeLocalMemberData();
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await pending;

      expect(result.queuedChecks).toBe(0);
      // The stuck store must not prevent the others from being cleared.
      expect(mockClearAllGenericQueued).toHaveBeenCalledWith();
      expect(result.queuedGeneric).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('clearAllDrafts', () => {
  const REAL_KEY_PREFIX = 'shift-report-draft-';
  const INDEX_KEY = 'shift-report-draft-index';

  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });
  afterEach(() => localStorage.clear());

  it('removes indexed drafts and any orphaned draft keys', async () => {
    vi.doUnmock('./shiftReportDrafts');
    const { clearAllDrafts } = await vi.importActual<typeof import('./shiftReportDrafts')>('./shiftReportDrafts');

    localStorage.setItem(`${REAL_KEY_PREFIX}shift-1`, JSON.stringify({ a: 1 }));
    localStorage.setItem(`${REAL_KEY_PREFIX}shift-2`, JSON.stringify({ a: 2 }));
    localStorage.setItem(INDEX_KEY, JSON.stringify(['shift-1']));
    // A draft the index lost track of must still be purged — it holds the
    // same PII either way.
    localStorage.setItem('unrelated-key', 'keep me');

    const removed = clearAllDrafts();

    expect(localStorage.getItem(`${REAL_KEY_PREFIX}shift-1`)).toBeNull();
    expect(localStorage.getItem(`${REAL_KEY_PREFIX}shift-2`)).toBeNull();
    expect(localStorage.getItem(INDEX_KEY)).toBeNull();
    expect(localStorage.getItem('unrelated-key')).toBe('keep me');
    expect(removed).toBeGreaterThan(0);
  });
});
