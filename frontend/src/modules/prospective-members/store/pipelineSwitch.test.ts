/**
 * Selecting another pipeline sets `filters.pipeline_id` and nothing else --
 * `applicants` was left holding the previous pipeline's rows until the new
 * fetch resolved, and `fetchApplicants`'s catch only records the error, so a
 * failed fetch left them there for good. The board then drew one pipeline's
 * applicants under another's stage columns, and every one of them landed in
 * the Unassigned column, where opening a card and pressing Advance moved that
 * applicant along a workflow the coordinator was not looking at.
 *
 * The board now filters that column by pipeline, so those rows are hidden
 * rather than actionable. This is the other half: they should not be in the
 * store at all.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetApplicants = vi.fn();

vi.mock('../services/api', () => ({
  applicantService: {
    getApplicants: (...args: unknown[]) => mockGetApplicants(...args) as unknown,
  },
  pipelineService: {},
  interviewService: {},
}));

// Import the store after the mock is registered.
import { useProspectiveMembersStore } from './prospectiveMembersStore';
import type { ApplicantListItem } from '../types';

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
  total_pages: 1,
});

const store = () => useProspectiveMembersStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useProspectiveMembersStore.setState({
    viewMode: 'kanban',
    currentPage: 1,
    pageSize: 25,
    filters: {},
    applicants: [],
    applicantsPipelineId: null,
    totalApplicants: 0,
    error: null,
  });
});

describe('switching pipeline', () => {
  it('does not leave the previous pipeline’s applicants on the board', async () => {
    mockGetApplicants.mockResolvedValueOnce(pageOf([applicantOf('pipe-1', 'a1')]));
    useProspectiveMembersStore.setState({ filters: { pipeline_id: 'pipe-1' } });
    await store().fetchApplicants();

    expect(store().applicants).toHaveLength(1);
    expect(store().applicantsPipelineId).toBe('pipe-1');

    // Switch pipeline, then inspect the store while the new fetch is still in
    // flight -- the moment the stale rows used to be on screen.
    let resolveSecond: ((value: unknown) => void) | undefined;
    mockGetApplicants.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSecond = resolve;
      })
    );
    useProspectiveMembersStore.setState({ filters: { pipeline_id: 'pipe-2' } });
    const inFlight = store().fetchApplicants();

    expect(store().applicants).toEqual([]);
    expect(store().totalApplicants).toBe(0);

    resolveSecond?.(pageOf([applicantOf('pipe-2', 'b1')]));
    await inFlight;

    expect(store().applicants.map((a) => a.pipeline_id)).toEqual(['pipe-2']);
    expect(store().applicantsPipelineId).toBe('pipe-2');
  });

  it('leaves nothing behind when the new pipeline’s fetch fails', async () => {
    mockGetApplicants.mockResolvedValueOnce(pageOf([applicantOf('pipe-1', 'a1')]));
    useProspectiveMembersStore.setState({ filters: { pipeline_id: 'pipe-1' } });
    await store().fetchApplicants();

    mockGetApplicants.mockRejectedValueOnce(new Error('network'));
    useProspectiveMembersStore.setState({ filters: { pipeline_id: 'pipe-2' } });
    await store().fetchApplicants();

    expect(store().applicants).toEqual([]);
    expect(store().applicantsPipelineId).toBeNull();
    expect(store().error).toBeTypeOf('string');
  });

  // Search and status changes come through setFilters as well. Blanking the
  // list for those would flash an empty board over a perfectly good one on
  // every keystroke.
  it('keeps the list while a fetch for the same pipeline is in flight', async () => {
    mockGetApplicants.mockResolvedValueOnce(pageOf([applicantOf('pipe-1', 'a1')]));
    useProspectiveMembersStore.setState({ filters: { pipeline_id: 'pipe-1' } });
    await store().fetchApplicants();

    let resolveSecond: ((value: unknown) => void) | undefined;
    mockGetApplicants.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSecond = resolve;
      })
    );
    useProspectiveMembersStore.setState({
      filters: { pipeline_id: 'pipe-1', search: 'ril' },
    });
    const inFlight = store().fetchApplicants();

    expect(store().applicants).toHaveLength(1);

    resolveSecond?.(pageOf([applicantOf('pipe-1', 'a1')]));
    await inFlight;
  });
});
