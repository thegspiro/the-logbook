/**
 * The pipeline screen fires overlapping requests as a matter of course: on
 * mount the pipeline, the status filter and the event filter are each set by
 * their own effect and each starts a fetch, and selecting another pipeline
 * starts one more while the previous is still in flight.
 *
 * Without a request token the last response to *arrive* wins regardless of
 * which request it answers, so a slow reply describing the pipeline the
 * coordinator just left could blank the one they are looking at — leaving the
 * stat header disagreeing with the table until the page was reloaded.
 *
 * The second half covers the other source of that disagreement: a mutation
 * that refreshed the list and not the counts. Converting the last two active
 * applicants left "Total Active: 2" over an empty table with "Converted: 0"
 * beside it, because the conversion path called `fetchApplicants` alone.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetApplicants = vi.fn();
const mockGetPipelineStats = vi.fn();

vi.mock('../services/api', () => ({
  applicantService: {
    getApplicants: (...args: unknown[]) => mockGetApplicants(...args) as unknown,
  },
  pipelineService: {
    getPipelineStats: (...args: unknown[]) => mockGetPipelineStats(...args) as unknown,
  },
  interviewService: {},
  eventLinkService: {},
}));

// Import the store only once the mocks are registered.
import { useProspectiveMembersStore } from './prospectiveMembersStore';
import type { ApplicantListItem, Pipeline, PipelineStats } from '../types';

const store = () => useProspectiveMembersStore.getState();

const applicantOf = (pipelineId: string, id: string) =>
  ({
    id,
    pipeline_id: pipelineId,
    first_name: 'Riley',
    last_name: 'Bishop',
    email: `${id}@example.com`,
    status: 'active',
    current_stage_id: 's1',
  }) as unknown as ApplicantListItem;

const pageOf = (items: ApplicantListItem[]) => ({
  items,
  total: items.length,
  page: 1,
  page_size: 25,
  total_pages: 1,
});

const statsOf = (active: number) =>
  ({
    pipeline_id: 'pipe-1',
    total_applicants: active,
    active_applicants: active,
    converted_count: 0,
    rejected_count: 0,
    withdrawn_count: 0,
    on_hold_count: 0,
    inactive_count: 0,
    warning_count: 0,
    avg_days_to_convert: 0,
    by_stage: [],
    conversion_rate: 0,
  }) as PipelineStats;

const resetStore = () => {
  useProspectiveMembersStore.setState({
    applicants: [],
    applicantsPipelineId: null,
    totalApplicants: 0,
    currentPage: 1,
    totalPages: 1,
    filters: {},
    viewMode: 'table',
    pageSize: 25,
    isLoading: false,
    error: null,
    pipelineStats: null,
    currentPipeline: null,
  });
};

describe('stale response guard', () => {
  beforeEach(() => {
    mockGetApplicants.mockReset();
    mockGetApplicants.mockResolvedValue(pageOf([]));
    mockGetPipelineStats.mockReset();
    mockGetPipelineStats.mockResolvedValue(statsOf(0));
    resetStore();
  });

  it('ignores an earlier fetch that resolves after a later one', async () => {
    let resolveFirst: ((value: unknown) => void) | undefined;
    mockGetApplicants.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve;
      })
    );

    // The request for the pipeline the coordinator is leaving.
    useProspectiveMembersStore.setState({ filters: { pipeline_id: 'pipe-1' } });
    const stale = store().fetchApplicants(1);

    // The request for the pipeline they just selected, which answers first.
    mockGetApplicants.mockResolvedValueOnce(pageOf([applicantOf('pipe-2', 'b1')]));
    useProspectiveMembersStore.setState({ filters: { pipeline_id: 'pipe-2' } });
    await store().fetchApplicants(1);

    expect(store().applicants.map((a) => a.id)).toEqual(['b1']);

    // Now the old one lands. It must not be allowed to blank the new list.
    resolveFirst?.(pageOf([]));
    await stale;

    expect(store().applicants.map((a) => a.id)).toEqual(['b1']);
    expect(store().applicantsPipelineId).toBe('pipe-2');
  });

  it('does not clear the loading flag a newer request still owns', async () => {
    let resolveFirst: ((value: unknown) => void) | undefined;
    mockGetApplicants.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve;
      })
    );
    const stale = store().fetchApplicants(1);

    let resolveSecond: ((value: unknown) => void) | undefined;
    mockGetApplicants.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSecond = resolve;
      })
    );
    const current = store().fetchApplicants(1);

    resolveFirst?.(pageOf([]));
    await stale;
    expect(store().isLoading).toBe(true);

    resolveSecond?.(pageOf([applicantOf('pipe-1', 'a1')]));
    await current;
    expect(store().isLoading).toBe(false);
  });

  it('does not report a stale request’s failure against the current list', async () => {
    let rejectFirst: ((reason: unknown) => void) | undefined;
    mockGetApplicants.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectFirst = reject;
      })
    );
    const stale = store().fetchApplicants(1);

    mockGetApplicants.mockResolvedValueOnce(pageOf([applicantOf('pipe-1', 'a1')]));
    await store().fetchApplicants(1);

    rejectFirst?.(new Error('network'));
    await stale;

    expect(store().error).toBeNull();
    expect(store().applicants.map((a) => a.id)).toEqual(['a1']);
  });
});

describe('header and list refresh together', () => {
  beforeEach(() => {
    mockGetApplicants.mockReset();
    mockGetApplicants.mockResolvedValue(pageOf([]));
    mockGetPipelineStats.mockReset();
    mockGetPipelineStats.mockResolvedValue(statsOf(0));
    resetStore();
  });

  it('refreshPipelineView refetches the counts as well as the rows', async () => {
    useProspectiveMembersStore.setState({
      currentPipeline: { id: 'pipe-1' } as Pipeline,
      filters: { pipeline_id: 'pipe-1' },
    });

    await store().refreshPipelineView();

    expect(mockGetApplicants).toHaveBeenCalledTimes(1);
    expect(mockGetPipelineStats).toHaveBeenCalledWith('pipe-1', {
      search: undefined,
      event_id: undefined,
    });
  });

  it('refreshes the rows even with no pipeline selected', async () => {
    await store().refreshPipelineView();

    expect(mockGetApplicants).toHaveBeenCalledTimes(1);
    expect(mockGetPipelineStats).not.toHaveBeenCalled();
  });

  it('recounts the header when a counted filter moves', async () => {
    useProspectiveMembersStore.setState({ filters: { pipeline_id: 'pipe-1' } });

    store().setFilters({ search: 'dana' });
    await vi.waitFor(() => expect(mockGetPipelineStats).toHaveBeenCalledTimes(1));

    expect(mockGetPipelineStats).toHaveBeenCalledWith('pipe-1', {
      search: 'dana',
      event_id: undefined,
    });
  });

  it('does not recount for a filter the header does not count through', async () => {
    useProspectiveMembersStore.setState({ filters: { pipeline_id: 'pipe-1' } });

    store().setFilters({ status: 'on_hold' });
    await vi.waitFor(() => expect(mockGetApplicants).toHaveBeenCalled());

    expect(mockGetPipelineStats).not.toHaveBeenCalled();
  });
});
