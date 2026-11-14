import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import type { SkillTest } from '../types/skillsTesting';

const getTest = vi.fn();
const updateTest = vi.fn();
const completeTest = vi.fn();

vi.mock('../services/api', () => ({
  skillsTestingService: {
    getTest: (...a: unknown[]) => getTest(...a) as unknown,
    updateTest: (...a: unknown[]) => updateTest(...a) as unknown,
    completeTest: (...a: unknown[]) => completeTest(...a) as unknown,
  },
}));

vi.mock('./authStore', () => ({
  useAuthStore: {
    getState: () => ({
      isAuthenticated: true,
      user: { id: 'examiner-1', first_name: 'Eve', last_name: 'Examiner' },
    }),
  },
}));

// Import the store AFTER mocks are in place.
import { useSkillsTestingStore } from './skillsTestingStore';
import { cacheSkillTest, getCachedSkillTest, getOwnSkillsPending } from '../utils/skillsTestOffline';
import { recordDrainedVersion } from '../utils/skillsTestOfflineStore';

const networkError = () => Object.assign(new Error('Network Error'), { isAxiosError: true, request: {} });

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
  version: 4,
  section_results: [],
  created_at: '',
  updated_at: '',
  ...over,
});

const scored = [{ section_id: 's1', criteria_results: [{ criterion_id: 'c1', passed: true }] }];

describe('skillsTestingStore offline', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    getTest.mockReset();
    updateTest.mockReset();
    completeTest.mockReset();
    useSkillsTestingStore.setState({ currentTest: null, offlineState: null, error: null });
  });

  it('caches a live test it loads, and opens it from the cache with no signal', async () => {
    getTest.mockResolvedValueOnce(liveTest());
    await useSkillsTestingStore.getState().loadTest('t1');
    expect((await getCachedSkillTest('t1'))?.id).toBe('t1');

    useSkillsTestingStore.setState({ currentTest: null });
    getTest.mockRejectedValueOnce(networkError());
    await useSkillsTestingStore.getState().loadTest('t1');

    expect(useSkillsTestingStore.getState().currentTest?.id).toBe('t1');
    expect(useSkillsTestingStore.getState().error).toBeNull();
  });

  it('says so when offline with no copy on the device', async () => {
    getTest.mockRejectedValueOnce(networkError());
    await useSkillsTestingStore.getState().loadTest('t1');
    expect(useSkillsTestingStore.getState().currentTest).toBeNull();
    expect(useSkillsTestingStore.getState().error).toMatch(/not been opened on this device/);
  });

  it('queues a save that cannot reach the server and keeps the scoring on screen', async () => {
    useSkillsTestingStore.setState({ currentTest: liveTest() });
    updateTest.mockRejectedValueOnce(networkError());

    const shown = await useSkillsTestingStore
      .getState()
      .updateTest('t1', { section_results: scored, elapsed_seconds: 60, expected_version: 4 });

    expect(shown.section_results).toEqual(scored);
    expect(useSkillsTestingStore.getState().offlineState).toMatchObject({ queued: true, completionQueued: false });
    expect((await getOwnSkillsPending('t1'))?.update?.elapsed_seconds).toBe(60);
  });

  it('queues later saves behind a waiting one, even with signal back', async () => {
    useSkillsTestingStore.setState({ currentTest: liveTest() });
    updateTest.mockRejectedValueOnce(networkError());
    await useSkillsTestingStore.getState().updateTest('t1', { elapsed_seconds: 60 });

    await useSkillsTestingStore.getState().updateTest('t1', { elapsed_seconds: 90 });

    expect(updateTest).toHaveBeenCalledTimes(1);
    expect((await getOwnSkillsPending('t1'))?.update?.elapsed_seconds).toBe(90);
  });

  it('queues completion instead of scoring on the device', async () => {
    useSkillsTestingStore.setState({ currentTest: liveTest() });
    completeTest.mockRejectedValueOnce(networkError());

    const shown = await useSkillsTestingStore.getState().completeTest('t1');

    expect(shown.result).toBe('incomplete');
    expect(useSkillsTestingStore.getState().offlineState).toMatchObject({ completionQueued: true });
    expect((await getOwnSkillsPending('t1'))?.complete).toBe(true);
  });

  it('a refusal from the server is not queued', async () => {
    useSkillsTestingStore.setState({ currentTest: liveTest() });
    updateTest.mockRejectedValueOnce(
      Object.assign(new Error('conflict'), { isAxiosError: true, response: { status: 409, data: {} } })
    );
    await expect(useSkillsTestingStore.getState().updateTest('t1', { elapsed_seconds: 1 })).rejects.toThrow();
    expect(await getOwnSkillsPending('t1')).toBeNull();
  });

  it('adopts the server copy once a queued completion has synced', async () => {
    useSkillsTestingStore.setState({ currentTest: liveTest() });
    await useSkillsTestingStore
      .getState()
      .handleSynced('t1', liveTest({ status: 'completed', result: 'pass', version: 6 }), true);
    expect(useSkillsTestingStore.getState().currentTest?.status).toBe('completed');
    expect(useSkillsTestingStore.getState().offlineState).toBeNull();
  });

  describe('a queued save sent elsewhere just before the screen saves', () => {
    // A drain — this page's or the service worker's — sends the test's last
    // queued save, producing version 5, and the screen autosaves before the
    // drain's result reaches it. The screen still holds version 4.

    it('saves against the version the queued save produced', async () => {
      useSkillsTestingStore.setState({ currentTest: liveTest({ version: 4 }) });
      await recordDrainedVersion('examiner-1', liveTest({ version: 5 }));
      updateTest.mockResolvedValueOnce(liveTest({ version: 6 }));

      await useSkillsTestingStore.getState().updateTest('t1', { elapsed_seconds: 90, expected_version: 4 });

      expect(updateTest).toHaveBeenCalledWith('t1', { elapsed_seconds: 90, expected_version: 5 });
      expect(useSkillsTestingStore.getState().currentTest?.version).toBe(6);
    });

    it('does not adopt a newer version that only a reload saw', async () => {
      // A copy cached by loading the test can carry another examiner's write;
      // saving against it would overwrite what this screen never saw.
      useSkillsTestingStore.setState({ currentTest: liveTest({ version: 4 }) });
      await cacheSkillTest(liveTest({ version: 7 }));
      updateTest.mockResolvedValueOnce(liveTest({ version: 8 }));

      await useSkillsTestingStore.getState().updateTest('t1', { elapsed_seconds: 90, expected_version: 4 });

      expect(updateTest).toHaveBeenCalledWith('t1', { elapsed_seconds: 90, expected_version: 4 });
    });

    it('never moves the version back when the drain’s report arrives late', async () => {
      useSkillsTestingStore.setState({ currentTest: liveTest({ version: 6 }) });

      await useSkillsTestingStore.getState().handleSynced('t1', liveTest({ version: 5 }), false);

      expect(useSkillsTestingStore.getState().currentTest?.version).toBe(6);
    });
  });
});
