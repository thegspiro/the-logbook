import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import type { AxiosInstance } from 'axios';
import type { SkillTest } from '../types/skillsTesting';

let signedIn: string | null = 'examiner-1';
vi.mock('../stores/authStore', () => ({
  useAuthStore: {
    getState: () => ({ isAuthenticated: signedIn !== null, user: signedIn ? { id: signedIn } : null }),
  },
}));

import {
  SKILLS_QUEUE_MAX_RETRIES,
  applyPending,
  cacheSkillTest,
  clearAllSkillsOffline,
  discardSkillsPending,
  drainSkillsQueue,
  enqueueSkillsComplete,
  enqueueSkillsCreate,
  enqueueSkillsUpdate,
  getCachedSkillTest,
  getOwnSkillsPending,
  listOwnSkillsPending,
  mergeUpdates,
  mintTestId,
  skillsPendingCount,
} from './skillsTestOffline';

/**
 * Against fake-indexeddb, like the other offline queues: the queue is a thin
 * layer over IndexedDB, and a mock would only test itself.
 */

const test = (over: Partial<SkillTest> = {}): SkillTest => ({
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

const section = (passed: boolean) => [{ section_id: 's1', criteria_results: [{ criterion_id: 'c1', passed }] }];

interface Call {
  method: string;
  url: string;
  body?: unknown;
}

/** An axios stand-in that records calls and answers from a script. */
function fakeAxios(answer: (call: Call) => unknown) {
  const calls: Call[] = [];
  const run = (method: string) => async (url: string, body?: unknown) => {
    const call = { method, url, body };
    calls.push(call);
    const result = await answer(call);
    if (result instanceof Error) throw result;
    return { data: result };
  };
  const axios = { get: run('get'), post: run('post'), put: run('put') } as unknown as AxiosInstance;
  return { axios, calls };
}

const httpError = (status: number, detail: string) =>
  Object.assign(new Error(detail), { isAxiosError: true, response: { status, data: { detail } } });
const networkError = () => Object.assign(new Error('Network Error'), { isAxiosError: true, request: {} });

describe('skillsTestOffline', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    signedIn = 'examiner-1';
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });

  it('coalesces every save for a test into one entry, keeping the first base version', async () => {
    for (let i = 0; i < 120; i++) {
      await enqueueSkillsUpdate(
        { id: 't1', label: 'SCBA — Casey', version: 3 },
        { section_results: section(i % 2 === 0), elapsed_seconds: i, expected_version: 3 }
      );
    }
    const entries = await listOwnSkillsPending();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.update?.elapsed_seconds).toBe(119);
    expect(entries[0]?.baseVersion).toBe(3);
    expect(entries[0]?.update).not.toHaveProperty('expected_version');
  });

  it('keeps a one-shot resumed flag through later saves', () => {
    expect(mergeUpdates({ resumed: true, elapsed_seconds: 1 }, { elapsed_seconds: 2 })).toEqual({
      resumed: true,
      elapsed_seconds: 2,
    });
  });

  it('sends create, then the merged save, then complete — in that order', async () => {
    const id = mintTestId();
    await enqueueSkillsCreate({ id, template_id: 'tpl', candidate_id: 'c1', expected_template_version: 2 }, 'SCBA');
    await enqueueSkillsUpdate({ id, label: 'SCBA', version: 1 }, { section_results: section(true) });
    await enqueueSkillsComplete({ id, label: 'SCBA' });

    const { axios, calls } = fakeAxios((call) => {
      if (call.method === 'post' && call.url.endsWith('/complete'))
        return test({ id, status: 'completed', version: 6 });
      if (call.method === 'post') return test({ id, status: 'draft', version: 1 });
      return test({ id, version: 5 });
    });
    const result = await drainSkillsQueue(axios);

    expect(calls.map((c) => `${c.method} ${c.url.replace(id, 'ID')}`)).toEqual([
      'post /training/skills-testing/tests',
      'put /training/skills-testing/tests/ID',
      'post /training/skills-testing/tests/ID/complete',
    ]);
    expect((calls[0]?.body as { id: string }).id).toBe(id);
    // The save is made against the version the create produced.
    expect((calls[1]?.body as { expected_version: number }).expected_version).toBe(1);
    expect(result.synced).toHaveLength(1);
    expect(result.synced[0]?.testId).toBe(id);
    expect(result.synced[0]?.completed).toBe(true);
    expect(result.synced[0]?.test?.status).toBe('completed');
    expect(await skillsPendingCount()).toBe(0);
  });

  it('never completes before the save has landed', async () => {
    await enqueueSkillsUpdate({ id: 't1', label: 'SCBA', version: 3 }, { section_results: section(true) });
    await enqueueSkillsComplete({ id: 't1', label: 'SCBA' });
    const { axios, calls } = fakeAxios(() => networkError());

    await drainSkillsQueue(axios);

    expect(calls.map((c) => c.method)).toEqual(['put']);
    expect((await getOwnSkillsPending('t1'))?.complete).toBe(true);
  });

  it('keeps a refused evaluation, with the reason, instead of discarding it', async () => {
    await enqueueSkillsUpdate({ id: 't1', label: 'SCBA — Casey', version: 3 }, { section_results: section(true) });
    const { axios } = fakeAxios(() => httpError(400, 'Cannot update a voided test'));

    const result = await drainSkillsQueue(axios);

    expect(result.failed).toEqual([{ testId: 't1', label: 'SCBA — Casey', message: 'Cannot update a voided test' }]);
    const kept = await getOwnSkillsPending('t1');
    expect(kept?.update?.section_results).toEqual(section(true));
    expect(kept?.failed?.status).toBe(400);
    // Failed entries are not retried automatically, and still count.
    const again = fakeAxios(() => test());
    await drainSkillsQueue(again.axios);
    expect(again.calls).toHaveLength(0);
    expect(await skillsPendingCount()).toBe(1);
  });

  it('retries a server error, then holds the entry as failed rather than dropping it', async () => {
    await enqueueSkillsUpdate({ id: 't1', label: 'SCBA', version: 3 }, { elapsed_seconds: 1 });
    const { axios } = fakeAxios(() => httpError(503, 'Unavailable'));
    for (let i = 0; i < SKILLS_QUEUE_MAX_RETRIES; i++) await drainSkillsQueue(axios);
    const kept = await getOwnSkillsPending('t1');
    expect(kept?.failed?.status).toBe(503);
    expect(await skillsPendingCount()).toBe(1);
  });

  it('treats a completion that already landed as done', async () => {
    await enqueueSkillsComplete({ id: 't1', label: 'SCBA' });
    const { axios } = fakeAxios((call) =>
      call.method === 'post' ? httpError(400, 'Test is already completed') : test({ status: 'completed' })
    );
    const result = await drainSkillsQueue(axios);
    expect(result.synced[0]?.completed).toBe(true);
    expect(await skillsPendingCount()).toBe(0);
  });

  it('a save written during the send stays queued against the new version', async () => {
    await enqueueSkillsUpdate({ id: 't1', label: 'SCBA', version: 3 }, { elapsed_seconds: 1 });
    const { axios } = fakeAxios(async () => {
      // While the PUT is in flight the examiner records another mark.
      await enqueueSkillsUpdate({ id: 't1', label: 'SCBA', version: 3 }, { elapsed_seconds: 2 });
      return test({ version: 4 });
    });
    await drainSkillsQueue(axios);
    const kept = await getOwnSkillsPending('t1');
    expect(kept?.update?.elapsed_seconds).toBe(2);
    expect(kept?.baseVersion).toBe(4);
  });

  describe('ownership (FE3-34-5)', () => {
    it("never sends or shows another member's entry or cached test", async () => {
      await enqueueSkillsUpdate({ id: 't1', label: 'SCBA', version: 3 }, { elapsed_seconds: 1 });
      await cacheSkillTest(test());
      signedIn = 'someone-else';

      const { axios, calls } = fakeAxios(() => test());
      await drainSkillsQueue(axios);

      expect(calls).toHaveLength(0);
      expect(await skillsPendingCount()).toBe(0);
      expect(await getCachedSkillTest('t1')).toBeNull();
      await expect(
        enqueueSkillsUpdate({ id: 't1', label: 'SCBA', version: 3 }, { elapsed_seconds: 2 })
      ).rejects.toThrow();
    });

    it('refuses to queue with nobody signed in', async () => {
      signedIn = null;
      await expect(enqueueSkillsComplete({ id: 't1', label: 'SCBA' })).rejects.toThrow(/signed out/);
    });
  });

  describe('read cache', () => {
    it('keeps live tests only', async () => {
      await cacheSkillTest(test());
      expect((await getCachedSkillTest('t1'))?.id).toBe('t1');
      await cacheSkillTest(test({ status: 'completed' }));
      expect(await getCachedSkillTest('t1')).toBeNull();
    });

    it('overlays queued scoring on a copy, at the queued base version', async () => {
      const entry = await enqueueSkillsUpdate(
        { id: 't1', label: 'SCBA', version: 3 },
        { section_results: section(false), resumed: true }
      );
      const shown = applyPending(test({ version: 9 }), entry);
      expect(shown.section_results).toEqual(section(false));
      expect(shown.version).toBe(3);
      expect(shown).not.toHaveProperty('resumed');
    });
  });

  it('discard and purge remove everything', async () => {
    await enqueueSkillsUpdate({ id: 't1', label: 'SCBA', version: 3 }, { elapsed_seconds: 1 });
    await enqueueSkillsUpdate({ id: 't2', label: 'Ladder', version: 1 }, { elapsed_seconds: 1 });
    await cacheSkillTest(test());
    await discardSkillsPending('t1');
    expect(await skillsPendingCount()).toBe(1);
    expect(await getCachedSkillTest('t1')).toBeNull();
    expect(await clearAllSkillsOffline()).toBe(1);
    expect(await skillsPendingCount()).toBe(0);
  });

  it('mints v4 UUIDs', () => {
    expect(mintTestId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
