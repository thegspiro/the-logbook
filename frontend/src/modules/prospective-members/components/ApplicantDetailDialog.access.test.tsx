/**
 * ApplicantDetailDialog — what a member assigned to the applicant is offered.
 *
 * The dialog shows the actions GET /my-access says the caller may take. A case
 * manager works the applicant (advance, skip, move back) but cannot reject,
 * hold, withdraw or convert them; an interviewer sees the details and nothing
 * to act on; and nobody is offered anything before their access has arrived.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen } from '@testing-library/react';
import { renderWithRouter } from '../../../test/utils';
import { ApplicantDetailDialog } from './ApplicantDetailDialog';
import type { Applicant, ProspectAccess } from '../types';
import { StepProgressStatus } from '../types';

const mocks = vi.hoisted(() => ({
  storeState: {
    isLoadingApplicant: false,
    fetchApplicant: vi.fn(),
    fetchApplicants: vi.fn(),
    fetchElectionPackage: vi.fn(),
    currentElectionPackage: null,
  },
  getMyAccess: vi.fn(),
  getActivity: vi.fn(),
  getLinkedEvents: vi.fn(),
}));

vi.mock('../store/prospectiveMembersStore', () => ({
  useProspectiveMembersStore: Object.assign(() => mocks.storeState, {
    getState: () => mocks.storeState,
  }),
}));

vi.mock('../services/api', () => ({
  applicantService: {
    getDocuments: () => Promise.resolve([]),
    getActivity: (...a: unknown[]) => mocks.getActivity(...a) as unknown,
    getMyAccess: (...a: unknown[]) => mocks.getMyAccess(...a) as unknown,
  },
  assignmentService: { list: () => Promise.resolve([]) },
  eventLinkService: {
    getLinkedEvents: (...a: unknown[]) => mocks.getLinkedEvents(...a) as unknown,
  },
  followUpFormService: { list: () => Promise.resolve([]) },
}));

vi.mock('../../../services/api', () => ({
  roleService: { getRoles: () => Promise.resolve([]) },
  userService: { getUsers: () => Promise.resolve([]) },
}));

const applicant = {
  id: 'app-1',
  first_name: 'Riley',
  last_name: 'Bishop',
  email: 'riley.bishop@example.org',
  status: 'active',
  target_membership_type: 'active',
  created_at: '2026-08-01T14:00:00Z',
  current_stage_id: 'step-b',
  current_stage_name: 'Interview',
  total_stages: 3,
  stage_history: [
    {
      id: 'b',
      stage_id: 'step-b',
      stage_name: 'Interview',
      stage_type: 'manual_approval',
      status: StepProgressStatus.IN_PROGRESS,
      entered_at: '2026-08-01T14:00:00Z',
      artifacts: [],
    },
  ],
} as unknown as Applicant;

const access = (overrides: Partial<ProspectAccess>): ProspectAccess => ({
  roles: [],
  view_all: false,
  can_work: false,
  can_manage: false,
  can_see_full: false,
  can_log_interview: false,
  ...overrides,
});

const renderDialog = (isLastStage = false, overrides: Partial<Applicant> = {}) =>
  renderWithRouter(
    <ApplicantDetailDialog
      applicant={{ ...applicant, ...overrides }}
      isOpen
      onClose={vi.fn()}
      onConvert={vi.fn()}
      isLastStage={isLastStage}
      isFirstStage={false}
    />
  );

/** Lets the access request, resolved or rejected, reach the dialog. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const caseManager = access({
  roles: ['case_manager'],
  can_work: true,
  can_see_full: true,
  can_log_interview: true,
});
const interviewer = access({ roles: ['interviewer'], can_log_interview: true });

describe('ApplicantDetailDialog for an assigned member', () => {
  beforeEach(() => {
    mocks.getMyAccess.mockReset();
    mocks.getActivity.mockReset();
    mocks.getLinkedEvents.mockReset();
    mocks.getActivity.mockResolvedValue([]);
    mocks.getLinkedEvents.mockResolvedValue([]);
  });

  it('asks for the caller’s access to this applicant', async () => {
    mocks.getMyAccess.mockResolvedValue(caseManager);
    renderDialog();

    await screen.findByRole('button', { name: /Advance/ });
    expect(mocks.getMyAccess).toHaveBeenCalledWith('app-1');
  });

  it('lets a case manager advance, skip, move back and withdraw, but not reject or hold', async () => {
    mocks.getMyAccess.mockResolvedValue(caseManager);
    renderDialog();

    expect(await screen.findByRole('button', { name: /Advance/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Skip/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Back/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Withdraw/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reject/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Hold/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Edit/ })).toBeInTheDocument();
  });

  it('lets a case manager withdraw an application on hold, but not resume or reject it', async () => {
    mocks.getMyAccess.mockResolvedValue(caseManager);
    renderDialog(false, { status: 'on_hold' });

    expect(await screen.findByRole('button', { name: /Withdraw/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Resume/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reject/ })).not.toBeInTheDocument();
  });

  it('does not offer a case manager Convert on the last stage', async () => {
    mocks.getMyAccess.mockResolvedValue(caseManager);
    renderDialog(true);

    expect(await screen.findByRole('button', { name: /Back/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Convert/ })).not.toBeInTheDocument();
  });

  it('shows an interviewer the applicant with nothing to act on', async () => {
    mocks.getMyAccess.mockResolvedValue(interviewer);
    renderDialog();

    expect(await screen.findByText('Riley Bishop')).toBeInTheDocument();
    // Let the access land before asserting what it hides.
    await settle();
    expect(screen.queryByRole('button', { name: /Advance/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Activity Log')).not.toBeInTheDocument();
    expect(screen.queryByText('Linked Events')).not.toBeInTheDocument();
    expect(mocks.getLinkedEvents).not.toHaveBeenCalled();
  });

  it('offers nothing while the caller’s access is still loading', () => {
    mocks.getMyAccess.mockReturnValue(new Promise(() => {}));
    renderDialog();

    expect(screen.getByText('Riley Bishop')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Advance/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reject/ })).not.toBeInTheDocument();
  });

  it('offers nothing when the caller’s access cannot be read', async () => {
    mocks.getMyAccess.mockRejectedValue(new Error('Network Error'));
    renderDialog();

    await settle();
    expect(mocks.getMyAccess).toHaveBeenCalledWith('app-1');
    expect(screen.queryByRole('button', { name: /Advance/ })).not.toBeInTheDocument();
  });
});
