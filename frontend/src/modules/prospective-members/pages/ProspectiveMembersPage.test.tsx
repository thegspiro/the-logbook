import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { ApplicantListItem, BulkActionResult, Pipeline } from '../types';

const mockBulkSetStatus = vi.fn();
const mockBulkAdvance = vi.fn();
const mockRefreshPipelineView = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
const mockPurge = vi.fn();

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
  currentPipeline: pipeline as Pipeline | null,
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
  inactiveApplicants: [] as ApplicantListItem[],
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
  purgeInactiveApplicants: (...a: unknown[]) => mockPurge(...a) as unknown,
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
    expect(screen.getByRole('button', { name: /Advance Selected/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Hold Selected/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reject Selected/ })).toBeInTheDocument();
  });

  // Hold used to be offered only by the table's own bar, which ran one request
  // per applicant; it now goes through the bulk endpoint like Reject.
  it('puts the selection on hold in one bulk request and clears it', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ProspectiveMembersPage />);

    await selectBoth(user);
    await user.click(screen.getByRole('button', { name: /Hold Selected/ }));

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
    await user.click(screen.getByRole('button', { name: /Hold Selected/ }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Network down'));
    expect(mockRefreshPipelineView).not.toHaveBeenCalled();
    expect(screen.getByText('2 selected')).toBeInTheDocument();
  });
});

describe('ProspectiveMembersPage — purging inactive applications', () => {
  // The Inactive tab's Purge once toasted the size of the selection whatever
  // the server did -- and the server matched a different status, so it deleted
  // nothing. The toast must say what the server actually deleted.
  beforeEach(() => {
    vi.clearAllMocks();
    mockPurge.mockReset();
    storeState.activeTab = 'inactive';
    storeState.inactiveApplicants = [row('i1', 'Riley', 'Bishop'), row('i2', 'Sam', 'Ortega')];
  });
  afterEach(() => {
    storeState.activeTab = 'active';
    storeState.inactiveApplicants = [];
  });

  const purgeBoth = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('checkbox', { name: 'Select Riley Bishop' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Sam Ortega' }));
    await user.click(screen.getByRole('button', { name: /Purge Selected/ }));
    await user.click(screen.getByRole('button', { name: /Permanently Delete/ }));
  };

  it('reports the number the server deleted', async () => {
    mockPurge.mockResolvedValue(2);
    const user = userEvent.setup();
    renderWithRouter(<ProspectiveMembersPage />);

    await purgeBoth(user);

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('Purged 2 application(s)'));
    expect(mockPurge).toHaveBeenCalledWith(['i1', 'i2']);
  });

  it('says so when fewer were deleted than were selected', async () => {
    mockPurge.mockResolvedValue(1);
    const user = userEvent.setup();
    renderWithRouter(<ProspectiveMembersPage />);

    await purgeBoth(user);

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(
        'Purged 1 of 2 application(s). The rest are no longer inactive and were kept.'
      )
    );
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it('reports a failure instead of success', async () => {
    mockPurge.mockRejectedValue(new Error('Could not delete a file'));
    const user = userEvent.setup();
    renderWithRouter(<ProspectiveMembersPage />);

    await purgeBoth(user);

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Could not delete a file'));
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });
});

describe('ProspectiveMembersPage — Add Applicant (workflow review W16)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState.currentPipeline = pipeline;
  });

  // The form was a bare div with unlabelled fields and an unnamed close button.
  it('opens a named dialog whose fields are labelled', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ProspectiveMembersPage />);

    await user.click(screen.getByRole('button', { name: /add applicant/i }));
    const dialog = screen.getByRole('dialog', { name: 'Add Applicant' });

    expect(within(dialog).getByRole('textbox', { name: 'First Name *' })).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Email *' })).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox', { name: 'Membership Type' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  // With no pipeline, "Add to Pipeline" returned without a word, so the
  // coordinator's typing went nowhere and nothing said why.
  it('is not offered until a pipeline exists', () => {
    storeState.currentPipeline = null;
    renderWithRouter(<ProspectiveMembersPage />);

    expect(screen.getByRole('button', { name: /add applicant/i })).toBeDisabled();
    storeState.currentPipeline = pipeline;
  });
});
