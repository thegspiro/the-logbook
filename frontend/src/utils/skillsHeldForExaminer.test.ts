import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import type { AxiosInstance } from 'axios';
import type { SkillTest } from '../types/skillsTesting';

/**
 * Owner decision 2026-11-01, "keep until same examiner returns": an automatic
 * sign-out (idle timeout, expired session, someone else signing in) keeps the
 * examiner's unsent skills evaluations on the device, bound to that examiner.
 * Only they see or send them when they sign back in; anyone else signing in
 * sees none. An explicit sign-out still deletes the examiner's own after the
 * warning they confirmed. Held evaluations are kept for a bounded time.
 *
 * Against fake-indexeddb and the real purge, like the other offline queues.
 */

let signedIn: string | null = 'examiner-1';
vi.mock('../stores/authStore', () => ({
  useAuthStore: {
    getState: () => ({ isAuthenticated: signedIn !== null, user: signedIn ? { id: signedIn } : null }),
  },
}));

import {
  cacheSkillTemplates,
  cacheSkillTest,
  drainSkillsQueue,
  enqueueSkillsUpdate,
  getCachedSkillTest,
  listCachedSkillTemplates,
  listOwnSkillsPending,
  listRecentCandidates,
  rememberCandidate,
  skillsPendingCount,
} from './skillsTestOffline';
import { STORE_PENDING, allRows, putRow, type SkillsPendingEntry } from './skillsTestOfflineStore';
import { purgeLocalMemberData, releaseHeldWorkFor } from './purgeLocalMemberData';

const DAY_MS = 24 * 60 * 60 * 1000;

const liveTest = (over: Partial<SkillTest> = {}): SkillTest => ({
  id: 't1',
  organization_id: 'o1',
  template_id: 'tpl',
  template_name: 'SCBA',
  candidate_id: 'c1',
  candidate_name: 'Casey',
  examiner_id: 'examiner-1',
  examiner_name: 'Eve',
  status: 'in_progress',
  result: 'incomplete',
  is_practice: false,
  version: 3,
  section_results: [],
  created_at: '',
  updated_at: '',
  ...over,
});

function recordingAxios() {
  const calls: string[] = [];
  const run = (method: string) => (url: string) => {
    calls.push(`${method} ${url}`);
    return Promise.resolve({ data: liveTest({ version: 4 }) });
  };
  return { axios: { get: run('get'), post: run('post'), put: run('put') } as unknown as AxiosInstance, calls };
}

/** Examiner 1 scores a test with no signal, then the device signs them out. */
async function scoreWhileOffline() {
  signedIn = 'examiner-1';
  await cacheSkillTest(liveTest());
  await enqueueSkillsUpdate({ id: 't1', label: 'SCBA — Casey', version: 3 }, { elapsed_seconds: 90 });
  await cacheSkillTemplates([{ id: 'tpl', name: 'SCBA' } as never]);
  await rememberCandidate({ id: 'c1', name: 'Casey' });
}

/** The idle timeout and an expired session run the purge with no examiner named. */
async function automaticSignOut() {
  const result = await purgeLocalMemberData();
  signedIn = null;
  return result;
}

async function signIn(member: string) {
  signedIn = member;
  await releaseHeldWorkFor(member);
}

describe('unsent skills evaluations held for their examiner', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    localStorage.clear();
    signedIn = 'examiner-1';
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });

  it('an automatic sign-out keeps them, and is not counted as lost', async () => {
    await scoreWhileOffline();

    const result = await automaticSignOut();

    expect(result.queuedSkillsTests).toBe(0);
    expect(result.unsyncedDiscarded).toBe(0);
    expect(result.heldSkillsTests).toBe(1);
    const stored = await allRows<SkillsPendingEntry>(STORE_PENDING);
    expect(stored.map((e) => [e.testId, e.ownerId])).toEqual([['t1', 'examiner-1']]);
  });

  it('the same examiner signing back in sees them and can send them', async () => {
    await scoreWhileOffline();
    await automaticSignOut();

    await signIn('examiner-1');

    expect(await skillsPendingCount()).toBe(1);
    // The copy of the live test is kept with it, so it can be reopened offline.
    expect((await getCachedSkillTest('t1'))?.candidate_name).toBe('Casey');
    const { axios, calls } = recordingAxios();
    const result = await drainSkillsQueue(axios);
    expect(calls).toEqual(['put /training/skills-testing/tests/t1']);
    expect(result.synced.map((s) => s.testId)).toEqual(['t1']);
    expect(await skillsPendingCount()).toBe(0);
  });

  it('another member signing in sees none of them, and cannot send them', async () => {
    await scoreWhileOffline();
    await automaticSignOut();

    await signIn('examiner-2');
    // Someone else signing in purges the device as before; held work survives it.
    await purgeLocalMemberData();

    expect(await skillsPendingCount()).toBe(0);
    expect(await listOwnSkillsPending()).toEqual([]);
    expect(await getCachedSkillTest('t1')).toBeNull();
    const { axios, calls } = recordingAxios();
    await drainSkillsQueue(axios);
    expect(calls).toEqual([]);

    // Their own explicit sign-out deletes their own work, not the examiner's.
    const theirs = await purgeLocalMemberData({ discardSkillsFor: 'examiner-2' });
    expect(theirs.queuedSkillsTests).toBe(0);
    await signIn('examiner-1');
    expect(await skillsPendingCount()).toBe(1);
  });

  it('nothing but the unsent evaluations and their test copies is kept', async () => {
    await scoreWhileOffline();
    await cacheSkillTest(liveTest({ id: 't-other', candidate_name: 'Other' }));
    await automaticSignOut();

    await signIn('examiner-1');

    expect(await listCachedSkillTemplates()).toEqual([]);
    expect(await listRecentCandidates()).toEqual([]);
    expect(await getCachedSkillTest('t-other')).toBeNull();
  });

  it('an explicit sign-out the examiner confirmed still deletes their own', async () => {
    await scoreWhileOffline();

    const result = await purgeLocalMemberData({ discardSkillsFor: 'examiner-1' });

    expect(result.queuedSkillsTests).toBe(1);
    expect(result.unsyncedDiscarded).toBe(1);
    await signIn('examiner-1');
    expect(await skillsPendingCount()).toBe(0);
  });

  it('an entry with no recorded examiner cannot be held for anyone', async () => {
    await putRow(STORE_PENDING, {
      testId: 'legacy',
      label: 'Old',
      queuedAt: 1,
      updatedAt: 1,
      rev: 1,
      complete: false,
      retries: 0,
    } satisfies SkillsPendingEntry);

    const result = await automaticSignOut();

    expect(result.queuedSkillsTests).toBe(1);
    expect(await allRows(STORE_PENDING)).toEqual([]);
  });

  describe('retention', () => {
    it('drops evaluations held longer than seven days, at the next sign-in', async () => {
      const now = vi.spyOn(Date, 'now');
      try {
        await scoreWhileOffline();
        now.mockReturnValue(1_000 * DAY_MS);
        await automaticSignOut();

        now.mockReturnValue(1_000 * DAY_MS + 7 * DAY_MS + 1);
        await signIn('examiner-1');

        expect(await skillsPendingCount()).toBe(0);
        expect(await getCachedSkillTest('t1')).toBeNull();
      } finally {
        now.mockRestore();
      }
    });

    it('keeps them within seven days, and stops the clock once the examiner is back', async () => {
      const now = vi.spyOn(Date, 'now');
      try {
        await scoreWhileOffline();
        now.mockReturnValue(1_000 * DAY_MS);
        await automaticSignOut();

        now.mockReturnValue(1_000 * DAY_MS + 6 * DAY_MS);
        await signIn('examiner-1');
        expect(await skillsPendingCount()).toBe(1);

        // Signed in and still without signal on day 10: it is theirs again,
        // not held, so no retention applies to it.
        now.mockReturnValue(1_000 * DAY_MS + 10 * DAY_MS);
        await releaseHeldWorkFor('examiner-1');
        expect(await skillsPendingCount()).toBe(1);
      } finally {
        now.mockRestore();
      }
    });
  });
});
