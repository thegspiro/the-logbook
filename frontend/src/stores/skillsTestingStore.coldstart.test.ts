import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import type { SkillTemplate } from '../types/skillsTesting';

const createTest = vi.fn();

vi.mock('../services/api', () => ({
  skillsTestingService: {
    createTest: (...a: unknown[]) => createTest(...a) as unknown,
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

import { useSkillsTestingStore } from './skillsTestingStore';
import {
  cacheSkillTemplates,
  getCachedSkillTest,
  getOwnSkillsPending,
  listRecentCandidates,
} from '../utils/skillsTestOffline';

const networkError = () => Object.assign(new Error('Network Error'), { isAxiosError: true, request: {} });

const template: SkillTemplate = {
  id: 'tpl',
  organization_id: 'o1',
  name: 'SCBA Donning',
  version: 3,
  status: 'published',
  visibility: 'all_members',
  sections: [{ id: 's1', name: 'Donning', sort_order: 0, criteria: [] }],
  require_all_critical: true,
  created_at: '',
  updated_at: '',
};

describe('skillsTestingStore cold start (client-minted ids)', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    createTest.mockReset();
    useSkillsTestingStore.setState({ currentTest: null, offlineState: null, error: null });
  });

  it('mints the id on every create, online too, and remembers the candidate', async () => {
    createTest.mockImplementation((data: { id: string }) =>
      Promise.resolve({
        id: data.id,
        candidate_id: 'c1',
        candidate_name: 'Casey',
        examiner_id: 'examiner-1',
        status: 'draft',
      })
    );
    const created = await useSkillsTestingStore.getState().createTest({ template_id: 'tpl', candidate_id: 'c1' });
    const sent = createTest.mock.calls[0]?.[0] as { id: string };
    expect(sent.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.id).toBe(sent.id);
    await vi.waitFor(async () => expect(await listRecentCandidates()).toEqual([{ id: 'c1', name: 'Casey' }]));
  });

  it('starts a test with no signal from a kept sheet, under the same id it will be created with', async () => {
    await cacheSkillTemplates([template]);
    createTest.mockRejectedValueOnce(networkError());

    const local = await useSkillsTestingStore
      .getState()
      .createTest({ template_id: 'tpl', candidate_id: 'c1', is_practice: false }, { candidateName: 'Casey' });

    const sentId = (createTest.mock.calls[0]?.[0] as { id: string }).id;
    expect(local.id).toBe(sentId);
    expect(local.status).toBe('draft');
    expect(local.template_sections).toEqual(template.sections);
    expect(local.candidate_name).toBe('Casey');
    const entry = await getOwnSkillsPending(sentId);
    expect(entry?.create).toMatchObject({ id: sentId, expected_template_version: 3, candidate_id: 'c1' });
    // Reopening it offline finds it.
    expect((await getCachedSkillTest(sentId))?.id).toBe(sentId);
    expect(useSkillsTestingStore.getState().offlineState).toMatchObject({ queued: true });
  });

  it('cannot start offline from a sheet the device never kept', async () => {
    createTest.mockRejectedValueOnce(networkError());
    await expect(
      useSkillsTestingStore
        .getState()
        .createTest({ template_id: 'tpl', candidate_id: 'c1' }, { candidateName: 'Casey' })
    ).rejects.toThrow(/not saved on this device/);
  });

  it('does not queue a create the server refused', async () => {
    createTest.mockRejectedValueOnce(
      Object.assign(new Error('An official evaluation needs a different examiner'), {
        isAxiosError: true,
        response: { status: 400, data: {} },
      })
    );
    await expect(
      useSkillsTestingStore.getState().createTest({ template_id: 'tpl', candidate_id: 'examiner-1' })
    ).rejects.toThrow();
    expect(useSkillsTestingStore.getState().currentTest).toBeNull();
  });
});
