/**
 * My applicants narrows the counts and the archive tabs, not only the board.
 *
 * The stat header and the Inactive / Rejected / Withdrawn / Converted badges
 * come from one stats response. With My applicants on, the board showed the
 * caller's applicants while the header and badges still counted the whole
 * pipeline, and opening an archive tab listed everyone's. The same held for a
 * source-event filter: the badges counted through it, the archive lists did
 * not.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getApplicants: vi.fn(),
  getPipelineStats: vi.fn(),
  archive: {
    getInactiveApplicants: vi.fn(),
    getRejectedApplicants: vi.fn(),
    getWithdrawnApplicants: vi.fn(),
    getConvertedApplicants: vi.fn(),
  },
}));

vi.mock('../../../stores/authStore', () => {
  const state = { user: { id: 'coordinator-1' }, checkPermission: () => true };
  return {
    useAuthStore: Object.assign((select?: (s: typeof state) => unknown) => (select ? select(state) : state), {
      getState: () => state,
    }),
  };
});

vi.mock('../services/api', () => ({
  applicantService: {
    getApplicants: (...a: unknown[]) => mocks.getApplicants(...a) as unknown,
    getInactiveApplicants: (...a: unknown[]) => mocks.archive.getInactiveApplicants(...a) as unknown,
    getRejectedApplicants: (...a: unknown[]) => mocks.archive.getRejectedApplicants(...a) as unknown,
    getWithdrawnApplicants: (...a: unknown[]) => mocks.archive.getWithdrawnApplicants(...a) as unknown,
    getConvertedApplicants: (...a: unknown[]) => mocks.archive.getConvertedApplicants(...a) as unknown,
  },
  pipelineService: {
    getPipelineStats: (...a: unknown[]) => mocks.getPipelineStats(...a) as unknown,
  },
  interviewService: {},
}));

import { useProspectiveMembersStore } from './prospectiveMembersStore';

const store = () => useProspectiveMembersStore.getState();
const emptyPage = { items: [], total: 0, page: 1, page_size: 25, total_pages: 1 };

beforeEach(() => {
  for (const mock of [mocks.getApplicants, mocks.getPipelineStats, ...Object.values(mocks.archive)]) {
    mock.mockReset();
    mock.mockResolvedValue(emptyPage);
  }
  mocks.getPipelineStats.mockResolvedValue({ pipeline_id: 'pipe-1', total_prospects: 1 });
  localStorage.clear();
  useProspectiveMembersStore.setState({
    filters: { pipeline_id: 'pipe-1' },
    currentPipeline: null,
    pipelineStats: null,
    error: null,
  });
});

describe('My applicants and the counts', () => {
  it('recounts the header and badges through the toggle', async () => {
    store().setFilters({ assigned_to_me: true });
    await vi.waitFor(() => expect(mocks.getPipelineStats).toHaveBeenCalledTimes(1));

    expect(mocks.getPipelineStats.mock.lastCall).toStrictEqual([
      'pipe-1',
      { search: undefined, event_id: undefined, assigned_to_me: true },
    ]);
  });

  it('recounts again when the toggle is switched off', async () => {
    useProspectiveMembersStore.setState({ filters: { pipeline_id: 'pipe-1', assigned_to_me: true } });

    store().setFilters({ assigned_to_me: undefined });
    await vi.waitFor(() => expect(mocks.getPipelineStats).toHaveBeenCalledTimes(1));

    expect(mocks.getPipelineStats.mock.lastCall).toStrictEqual([
      'pipe-1',
      { search: undefined, event_id: undefined, assigned_to_me: undefined },
    ]);
  });

  it.each([
    ['inactive', 'getInactiveApplicants'],
    ['rejected', 'getRejectedApplicants'],
    ['withdrawn', 'getWithdrawnApplicants'],
    ['converted', 'getConvertedApplicants'],
  ] as const)('lists the %s tab through the same filters its badge counts', async (tab, getter) => {
    useProspectiveMembersStore.setState({
      filters: { pipeline_id: 'pipe-1', event_id: 'evt-1', assigned_to_me: true },
    });

    store().setActiveTab(tab);
    await vi.waitFor(() => expect(mocks.archive[getter]).toHaveBeenCalledTimes(1));

    expect(mocks.archive[getter]).toHaveBeenCalledWith(
      expect.objectContaining({ pipeline_id: 'pipe-1', event_id: 'evt-1', assigned_to_me: true })
    );
  });
});
