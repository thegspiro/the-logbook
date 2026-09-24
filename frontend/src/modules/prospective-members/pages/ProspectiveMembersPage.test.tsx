import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { ApplicantListItem, BulkActionResult, Pipeline } from '../types';

const mockBulkSetStatus = vi.fn();
const mockBulkAdvance = vi.fn();
const mockRefreshPipelineView = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock('../services/api', () => ({
  applicantService: {
    bulkSetStatus: (...a: unknown[]) => mockBulkSetStatus(...a) as unknown,
    bulkAdvance: (...a: unknown[]) => mockBulkAdvance(...a) as unknown,
  },
  eventLinkService: { getSourceEvents: () => Promise.resolve([]) },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: (...a: unknown[]) => mockToastSuccess(...a) as unknown,
    error: (...a: unknown[]) => mockToastError(...a) as unknown,
  },
}));

// Neither is open in these tests, and each reads store fields of its own.
vi.mock('../components/ApplicantDetailDrawer', () => ({ ApplicantDetailDrawer: () => null }));
vi.mock('../components/ConversionModal', () => ({ ConversionModal: () => null }));

const row = (id: string, first: string, last: string): ApplicantListItem => ({
  id,
  pipeline_id: 'pipe-1',
  first_name: first,
  last_name: last,
  email: `${first.toLowerCase()}@example.com`,
  current_stage_id: 's1',
  current_stage_name: 'Application',
  stage_entered_at: '2026-09-01T00:00:00Z',
  target_membership_type: 'regular',
  status: 'active',
  days_in_stage: 3,
  days_in_pipeline: 3,
  last_activity_at: '2026-09-01T00:00:00Z',
  days_since_activity: 3,
  inactivity_alert_level: 'normal',
  created_at: '2026-09-01T00:00:00Z',
});

const pipeline = {
  id: 'pipe-1',
  name: 'Volunteer Membership Pipeline',
  is_active: true,
  is_default: true,
  stages: [{ id: 's1', pipeline_id: 'pipe-1', name: 'Application', stage_type: 'manual_approval', sort_order: 0 }],
} as unknown as Pipeline;

const storeState = {
  pipelines: [pipeline],
  currentPipeline: pipeline,
  pipelineStats: null,
  preferredPipelineId: null,
  applicants: [row('a1', 'Riley', 'Bishop'), row('a2', 'Sam', 'Ortega')],
  currentApplicant: null,
  totalApplicants: 2,
  currentPage: 1,
  totalPages: 1,
  filters: { pipeline_id: 'pipe-1' },
  viewMode: 'table',
  activeTab: 'active',
  detailDrawerOpen: false,
  inactiveApplicants: [],
  inactiveTotalApplicants: 0,
  inactiveCurrentPage: 1,
  inactiveTotalPages: 1,
  withdrawnApplicants: [],
  withdrawnTotalApplicants: 0,
  withdrawnCurrentPage: 1,
  withdrawnTotalPages: 1,
  rejectedApplicants: [],
  rejectedTotalApplicants: 0,
  rejectedCurrentPage: 1,
  rejectedTotalPages: 1,
  convertedApplicants: [],
  convertedTotalApplicants: 0,
  convertedCurrentPage: 1,
  convertedTotalPages: 1,
  isLoading: false,
  isLoadingPipelines: false,
  isLoadingPipeline: false,
  isLoadingStats: false,
  isLoadingInactive: false,
  isLoadingWithdrawn: false,
  isLoadingRejected: false,
  isLoadingConverted: false,
  isReactivating: false,
  isPurging: false,
  isRejecting: false,
  isWithdrawing: false,
  error: null,
  fetchPipelines: vi.fn(),
  fetchPipeline: vi.fn(),
  fetchPipelineStats: vi.fn(),
  refreshPipelineView: (...a: unknown[]) => mockRefreshPipelineView(...a) as unknown,
  fetchApplicants: vi.fn(),
  fetchApplicant: vi.fn(),
  fetchInactiveApplicants: vi.fn(),
  fetchWithdrawnApplicants: vi.fn(),
  fetchRejectedApplicants: vi.fn(),
  fetchConvertedApplicants: vi.fn(),
  reactivateApplicant: vi.fn(),
  purgeInactiveApplicants: vi.fn(),
  setFilters: vi.fn(),
  setViewMode: vi.fn(),
  setActiveTab: vi.fn(),
  setDetailDrawerOpen: vi.fn(),
  advanceApplicant: vi.fn(),
  regressApplicant: vi.fn(),
  holdApplicant: vi.fn(),
  rejectApplicant: vi.fn(),
  withdrawApplicant: vi.fn(),
};

vi.mock('../store/prospectiveMembersStore', () => ({
  useProspectiveMembersStore: () => storeState,
}));

import { ProspectiveMembersPage } from './ProspectiveMembersPage';

const heldResult = (ids: string[]): BulkActionResult => ({
  succeeded_count: ids.length,
  failed_count: 0,
  results: ids.map((id) => ({ prospect_id: id, succeeded: true })),
});

const selectBoth = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Select Riley Bishop' }));
  await user.click(screen.getByRole('button', { name: 'Select Sam Ortega' }));
};

describe('ProspectiveMembersPage table-view bulk actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBulkSetStatus.mockReset();
    mockBulkSetStatus.mockResolvedValue(heldResult(['a1', 'a2']));
  });

  it('shows exactly one bulk-action bar for a table selection', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ProspectiveMembersPage />);

    await selectBoth(user);

    expect(screen.getAllByText('2 selected')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Print Badges/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Advance All/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Hold All/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reject All/ })).toBeInTheDocument();
  });

  // Hold used to be offered only by the table's own bar, which ran one request
  // per applicant; it now goes through the bulk endpoint like Reject.
  it('puts the selection on hold in one bulk request and clears it', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ProspectiveMembersPage />);

    await selectBoth(user);
    await user.click(screen.getByRole('button', { name: /Hold All/ }));

    await waitFor(() => expect(mockBulkSetStatus).toHaveBeenCalledWith(['a1', 'a2'], 'on_hold'));
    expect(mockToastSuccess).toHaveBeenCalledWith('Held 2 applicants');
    expect(mockRefreshPipelineView).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('2 selected')).not.toBeInTheDocument());
  });

  it('keeps the selection and reports the error when the hold request fails', async () => {
    mockBulkSetStatus.mockReset();
    mockBulkSetStatus.mockRejectedValue(new Error('Network down'));
    const user = userEvent.setup();
    renderWithRouter(<ProspectiveMembersPage />);

    await selectBoth(user);
    await user.click(screen.getByRole('button', { name: /Hold All/ }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Network down'));
    expect(mockRefreshPipelineView).not.toHaveBeenCalled();
    expect(screen.getByText('2 selected')).toBeInTheDocument();
  });
});
