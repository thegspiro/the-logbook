/**
 * The no-package state used to promise the package "will be auto-generated
 * when the applicant reaches this stage" — shown to applicants who had
 * already reached it, by a route (bulk advance, Skip, Back) that never
 * generated one, with nothing to do about it. The server now creates the
 * package on stage entry; this state is left for applicants who arrived
 * before that, and it offers the one thing they need.
 *
 * Runs the real store over a mocked service layer, so the test covers the
 * whole path from the button to the package the section renders.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { Applicant, ElectionPackage } from '../types';

const mocks = vi.hoisted(() => ({
  createElectionPackage: vi.fn(),
  getElectionPackage: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('../services/api', () => ({
  applicantService: {
    createElectionPackage: (...a: unknown[]) => mocks.createElectionPackage(...a) as unknown,
    getElectionPackage: (...a: unknown[]) => mocks.getElectionPackage(...a) as unknown,
  },
  pipelineService: {},
  interviewService: {},
  eventLinkService: {},
}));

vi.mock('../../../services/electionService', () => ({
  electionService: { getElections: vi.fn() },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    error: (...a: unknown[]) => mocks.toastError(...a) as unknown,
    success: (...a: unknown[]) => mocks.toastSuccess(...a) as unknown,
  },
}));

// Imported after the mocks so the store binds to the mocked service.
import { useProspectiveMembersStore } from '../store/prospectiveMembersStore';
import ElectionPackageSection from './ElectionPackageSection';

const applicant = {
  id: 'app-1',
  pipeline_id: 'pipe-1',
  first_name: 'Riley',
  last_name: 'Bishop',
  email: 'riley@example.com',
  status: 'active',
  current_stage_id: 'vote',
  current_stage_type: 'election_vote',
} as unknown as Applicant;

const draft = {
  id: 'pkg-1',
  applicant_id: 'app-1',
  pipeline_id: 'pipe-1',
  stage_id: 'vote',
  status: 'draft',
  applicant_name: 'Riley Bishop',
  target_membership_type: 'regular',
  coordinator_notes: null,
  supporting_statement: null,
  documents: [],
} as unknown as ElectionPackage;

const renderSection = () => renderWithRouter(<ElectionPackageSection applicant={applicant} tz="UTC" />);

describe('ElectionPackageSection with no package', () => {
  beforeEach(() => {
    for (const m of Object.values(mocks)) m.mockReset();
    // No package until one is created; the read after the create returns it.
    mocks.getElectionPackage.mockResolvedValue(null);
    mocks.createElectionPackage.mockResolvedValue(draft);
    useProspectiveMembersStore.setState({
      currentElectionPackage: null,
      isLoadingElectionPackage: false,
      error: null,
    });
  });

  it('no longer promises a package that nothing will create', async () => {
    renderSection();

    expect(await screen.findByRole('button', { name: /create package/i })).toBeInTheDocument();
    expect(screen.queryByText(/auto-generated/i)).not.toBeInTheDocument();
    expect(screen.getByText(/cannot be put on a ballot or advanced past this stage yet/i)).toBeInTheDocument();
  });

  it('creates the package for the stage the applicant is on and shows it', async () => {
    const user = userEvent.setup();
    renderSection();
    const button = await screen.findByRole('button', { name: /create package/i });

    mocks.getElectionPackage.mockResolvedValue(draft);
    await user.click(button);

    expect(mocks.createElectionPackage).toHaveBeenCalledWith('app-1', {
      applicant_id: 'app-1',
      pipeline_id: 'pipe-1',
      stage_id: 'vote',
    });
    expect(await screen.findByRole('button', { name: /mark ready for ballot/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create package/i })).not.toBeInTheDocument();
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Election package created');
  });

  it("reports the server's refusal and keeps the create action", async () => {
    const user = userEvent.setup();
    mocks.createElectionPackage.mockRejectedValueOnce(
      new Error('This applicant is rejected and cannot be put forward for election.')
    );
    renderSection();

    await user.click(await screen.findByRole('button', { name: /create package/i }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        'This applicant is rejected and cannot be put forward for election.'
      )
    );
    expect(screen.getByRole('button', { name: /create package/i })).toBeEnabled();
  });
});
