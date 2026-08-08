/**
 * The board groups applicants into stage columns client-side, so it needs the
 * whole set. Paging it to DEFAULT_PAGE_SIZE meant a department with more than
 * 25 active applicants saw a board built from a fraction of them, with nothing
 * on screen saying so.
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
import { KANBAN_PAGE_SIZE } from '../constants';

const emptyPage = { items: [], total: 0, page: 1, total_pages: 1 };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetApplicants.mockResolvedValue(emptyPage);
  useProspectiveMembersStore.setState({
    viewMode: 'kanban',
    currentPage: 1,
    pageSize: 25,
    filters: {},
  });
});

describe('applicant paging by view mode', () => {
  it('requests the whole set for the board', async () => {
    await useProspectiveMembersStore.getState().fetchApplicants(1);

    expect(mockGetApplicants).toHaveBeenCalledWith({
      filters: {},
      page: 1,
      pageSize: KANBAN_PAGE_SIZE,
    });
  });

  it('keeps normal paging for the table', async () => {
    useProspectiveMembersStore.setState({ viewMode: 'table' });

    await useProspectiveMembersStore.getState().fetchApplicants(2);

    expect(mockGetApplicants).toHaveBeenCalledWith({
      filters: {},
      page: 2,
      pageSize: 25,
    });
  });

  it('refetches when switching views, so the board never inherits a table page', async () => {
    useProspectiveMembersStore.setState({ viewMode: 'table', currentPage: 3 });

    useProspectiveMembersStore.getState().setViewMode('kanban');
    await vi.waitFor(() => expect(mockGetApplicants).toHaveBeenCalledTimes(1));

    expect(mockGetApplicants).toHaveBeenCalledWith({
      filters: {},
      page: 1,
      pageSize: KANBAN_PAGE_SIZE,
    });
  });

  it('does not refetch when the view mode is unchanged', () => {
    useProspectiveMembersStore.getState().setViewMode('kanban');

    expect(mockGetApplicants).not.toHaveBeenCalled();
  });
});
