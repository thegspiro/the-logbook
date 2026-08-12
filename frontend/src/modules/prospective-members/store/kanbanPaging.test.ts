/**
 * The board groups applicants into stage columns client-side, so it needs the
 * whole set. Paging it to DEFAULT_PAGE_SIZE meant a department with more than
 * 25 active applicants saw a board built from a fraction of them, with nothing
 * on screen saying so.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetApplicants = vi.fn();
const mockRegressStage = vi.fn();

vi.mock('../services/api', () => ({
  applicantService: {
    getApplicants: (...args: unknown[]) => mockGetApplicants(...args) as unknown,
    regressStage: (...args: unknown[]) => mockRegressStage(...args) as unknown,
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
  localStorage.clear();
  mockGetApplicants.mockResolvedValue(emptyPage);
  mockRegressStage.mockResolvedValue(undefined);
  useProspectiveMembersStore.setState({
    viewMode: 'kanban',
    currentPage: 1,
    pageSize: 25,
    filters: {},
  });
});

describe('applicant action errors', () => {
  it('propagates an API rejection so the action UI cannot report success', async () => {
    const error = new Error('Stage cannot be moved back');
    mockRegressStage.mockRejectedValueOnce(error);

    await expect(useProspectiveMembersStore.getState().regressApplicant('prospect-1')).rejects.toBe(error);
    expect(useProspectiveMembersStore.getState().isRegressing).toBe(false);
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

  it('remembers the selected view for the next visit', async () => {
    useProspectiveMembersStore.getState().setViewMode('table');
    await vi.waitFor(() => expect(mockGetApplicants).toHaveBeenCalledTimes(1));

    expect(localStorage.getItem('prospective-members:view-mode')).toBe('table');
  });
});
