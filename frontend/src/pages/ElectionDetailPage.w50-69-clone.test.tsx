/**
 * W50-69 — a clone lands on the draft's Ballot tab.
 *
 * `fetchElection` auto-selects Results when the URL names no tab and the
 * election has results to show. The clone is a draft with no ballot yet, so
 * the navigation after `POST /elections/{id}/clone` must name `?tab=ballot`
 * rather than hand the officer a "Quorum Met / 0 votes" Results panel.
 *
 * Rendered rather than source-asserted: the behaviour is the page's clone
 * handler and the modal's submit together.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter, mockNavigate } from '../test/utils';

const getElection = vi.fn();
const cloneElection = vi.fn();
const toastSuccess = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: { success: (...a: unknown[]) => toastSuccess(...a) as unknown, error: vi.fn() },
}));
vi.mock('../services/api', () => ({
  electionService: {
    getElection: (...a: unknown[]) => getElection(...a) as unknown,
    cloneElection: (...a: unknown[]) => cloneElection(...a) as unknown,
    getSettings: vi.fn().mockResolvedValue({}),
    getCandidates: vi.fn().mockResolvedValue([]),
  },
  eventService: { getEvents: vi.fn().mockResolvedValue([]) },
  meetingsService: { getMeetings: vi.fn().mockResolvedValue({ meetings: [] }) },
}));
vi.mock('../modules/prospective-members/services/api', () => ({
  electionPackageService: { getPendingPackages: vi.fn().mockResolvedValue([]) },
  applicantService: { assignToElection: vi.fn() },
}));
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useParams: () => ({ electionId: 'e-1' }), useNavigate: () => mockNavigate };
});
vi.mock('../stores/authStore', () => {
  const state = { checkPermission: () => true, user: { id: 'u-1' } };
  return { useAuthStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state) };
});

// Panels are not under test; stub every one the loaded branch can mount.
vi.mock('../components/ElectionResults', () => ({ ElectionResults: () => null, default: () => null }));
vi.mock('../components/ElectionBallot', () => ({ ElectionBallot: () => null, default: () => null }));
vi.mock('../components/CandidateManagement', () => ({ CandidateManagement: () => null, default: () => null }));
vi.mock('../components/BallotBuilder', () => ({ BallotBuilder: () => null, default: () => null }));
vi.mock('../components/MeetingAttendance', () => ({ MeetingAttendance: () => null, default: () => null }));
vi.mock('../components/VoterOverrideManagement', () => ({ VoterOverrideManagement: () => null, default: () => null }));
vi.mock('../components/ProxyVotingManagement', () => ({ ProxyVotingManagement: () => null, default: () => null }));
vi.mock('../modules/elections/components/EligibilityRoster', () => ({
  EligibilityRoster: () => null,
  default: () => null,
}));
vi.mock('../modules/elections/components/RunoffChain', () => ({ RunoffChain: () => null, default: () => null }));
vi.mock('../modules/elections/components/PublishResultsPanel', () => ({
  PublishResultsPanel: () => null,
  default: () => null,
}));
vi.mock('../components/election-detail/PaperBallotBatchesPanel', () => ({
  PaperBallotBatchesPanel: () => null,
  default: () => null,
}));
vi.mock('../components/election-detail/LiveTurnoutPanel', () => ({
  LiveTurnoutPanel: () => null,
  default: () => null,
}));
vi.mock('../components/election-detail/NominationsPanel', () => ({
  NominationsPanel: () => null,
  default: () => null,
}));

import ElectionDetailPage from './ElectionDetailPage';

const closedElection = {
  id: 'e-1',
  organization_id: 'o-1',
  title: 'Officer Election',
  election_type: 'officer',
  positions: ['Chief'],
  start_date: '2026-09-01T00:00:00Z',
  end_date: '2026-09-02T00:00:00Z',
  status: 'closed',
  anonymous_voting: true,
  allow_write_ins: false,
  max_votes_per_position: 1,
  results_visible_immediately: true,
  email_sent: false,
  voting_method: 'simple_majority',
  victory_condition: 'plurality',
};

describe('ElectionDetailPage clone landing (W50-69)', () => {
  beforeEach(() => {
    getElection.mockReset();
    cloneElection.mockReset();
    toastSuccess.mockReset();
    mockNavigate.mockReset();
    getElection.mockResolvedValue(closedElection);
    cloneElection.mockResolvedValue({
      ...closedElection,
      id: 'e-2',
      status: 'draft',
      results_visible_immediately: false,
    });
    window.history.replaceState({}, '', '/elections/e-1?tab=results');
  });

  it('navigates to the new draft with ?tab=ballot after a successful clone', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ElectionDetailPage />);

    await user.click(await screen.findByRole('button', { name: 'Clone Election' }));
    const dialog = screen.getByRole('dialog', { name: 'Clone Election' });
    await user.type(within(dialog).getByLabelText('Voting opens'), '2026-10-01T09:00');
    await user.type(within(dialog).getByLabelText('Voting closes'), '2026-10-02T09:00');
    await user.click(within(dialog).getByRole('button', { name: 'Create Draft' }));

    expect(cloneElection).toHaveBeenCalledWith('e-1', expect.objectContaining({ title: 'Officer Election (Copy)' }));
    expect(toastSuccess).toHaveBeenCalledWith('Draft election created');
    expect(mockNavigate).toHaveBeenCalledWith('/elections/e-2?tab=ballot');
  });

  it('stays put and shows the error when the clone is refused', async () => {
    cloneElection.mockRejectedValue(
      Object.assign(new Error('boom'), { response: { status: 400, data: { detail: 'Cannot clone' } } })
    );
    const user = userEvent.setup();
    renderWithRouter(<ElectionDetailPage />);

    await user.click(await screen.findByRole('button', { name: 'Clone Election' }));
    const dialog = screen.getByRole('dialog', { name: 'Clone Election' });
    await user.type(within(dialog).getByLabelText('Voting opens'), '2026-10-01T09:00');
    await user.type(within(dialog).getByLabelText('Voting closes'), '2026-10-02T09:00');
    await user.click(within(dialog).getByRole('button', { name: 'Create Draft' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Cannot clone');
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
