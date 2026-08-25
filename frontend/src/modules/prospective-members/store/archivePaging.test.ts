/**
 * Paging off the end of a shrinking archive list.
 *
 * Reactivating the only rejected applicant on page 2 leaves 25 records and a
 * single page, but the refresh asks for page 2 again. The empty response was
 * stored as "page 2 of 1": the empty state rendered, the pagination controls
 * were hidden (they need total_pages > 1), and there was no way back to the
 * 25 records on page 1 short of reloading. Every list on the page pages the
 * same way and had the same dead end.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetApplicants = vi.fn();
const mockGetRejected = vi.fn();

vi.mock('../services/api', () => ({
  applicantService: {
    getApplicants: (...args: unknown[]) => mockGetApplicants(...args) as unknown,
    getRejectedApplicants: (...args: unknown[]) => mockGetRejected(...args) as unknown,
  },
  pipelineService: {},
  interviewService: {},
}));

// Import the store after the mock is registered.
import { useProspectiveMembersStore } from './prospectiveMembersStore';

/** One page of a list that has shrunk to `total` records. */
const page = (items: number, total: number, requested: number, pageSize = 25) => ({
  items: Array.from({ length: items }, (_, i) => ({ id: `a${i}` })),
  total,
  page: requested,
  page_size: pageSize,
  total_pages: Math.max(1, Math.ceil(total / pageSize)),
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useProspectiveMembersStore.setState({
    viewMode: 'table',
    pageSize: 25,
    filters: {},
    rejectedCurrentPage: 2,
    rejectedApplicants: [],
    rejectedTotalPages: 2,
  });
});

describe('archive paging', () => {
  it('backs up to the last page when the requested one has emptied', async () => {
    mockGetRejected
      .mockResolvedValueOnce(page(0, 25, 2)) // page 2 of a list that now has one page
      .mockResolvedValueOnce(page(25, 25, 1));

    await useProspectiveMembersStore.getState().fetchRejectedApplicants();

    const state = useProspectiveMembersStore.getState();
    expect(mockGetRejected).toHaveBeenCalledTimes(2);
    expect(state.rejectedCurrentPage).toBe(1);
    expect(state.rejectedApplicants).toHaveLength(25);
    expect(state.isLoadingRejected).toBe(false);
  });

  it('leaves a genuinely empty list alone rather than looping', async () => {
    mockGetRejected.mockResolvedValue(page(0, 0, 1));
    useProspectiveMembersStore.setState({ rejectedCurrentPage: 1 });

    await useProspectiveMembersStore.getState().fetchRejectedApplicants();

    expect(mockGetRejected).toHaveBeenCalledTimes(1);
    expect(useProspectiveMembersStore.getState().rejectedApplicants).toEqual([]);
    expect(useProspectiveMembersStore.getState().isLoadingRejected).toBe(false);
  });

  it('does not back up while the requested page still has records', async () => {
    mockGetRejected.mockResolvedValue(page(25, 60, 2));

    await useProspectiveMembersStore.getState().fetchRejectedApplicants();

    expect(mockGetRejected).toHaveBeenCalledTimes(1);
    expect(useProspectiveMembersStore.getState().rejectedCurrentPage).toBe(2);
  });

  it('applies to the applicant table too, which shrinks on every rejection', async () => {
    useProspectiveMembersStore.setState({ currentPage: 2, totalPages: 2 });
    mockGetApplicants.mockResolvedValueOnce(page(0, 25, 2)).mockResolvedValueOnce(page(25, 25, 1));

    await useProspectiveMembersStore.getState().fetchApplicants(2);

    expect(mockGetApplicants).toHaveBeenCalledTimes(2);
    expect(useProspectiveMembersStore.getState().currentPage).toBe(1);
    expect(useProspectiveMembersStore.getState().isLoading).toBe(false);
  });
});
