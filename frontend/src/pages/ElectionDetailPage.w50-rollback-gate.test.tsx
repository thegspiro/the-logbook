/**
 * W50-29 — Roll Back is not offered where the server will refuse it, and the
 * Close dialog says whether the close is final.
 *
 * `ElectionService.rollback_election` refuses CLOSED -> OPEN on an anonymous
 * election with recorded votes (the salt is gone, so prior voters could vote
 * again). The page used to offer the button anyway: the modal promised
 * "Reopen voting" and leadership mail, then showed a 400. It now disables
 * the button with the server's sentence as its description. The Close
 * confirmation, which said "cannot be undone" beside a Roll Back button,
 * now states the anonymous close is final and the non-anonymous one is not.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter, mockNavigate } from '../test/utils';

const getElection = vi.fn();
const closeElection = vi.fn();
const rollbackElection = vi.fn();
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../services/api', () => ({
  electionService: {
    getElection: (...a: unknown[]) => getElection(...a) as unknown,
    closeElection: (...a: unknown[]) => closeElection(...a) as unknown,
    rollbackElection: (...a: unknown[]) => rollbackElection(...a) as unknown,
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

const baseElection = {
  id: 'e-1',
  organization_id: 'o-1',
  title: 'Officer Election',
  election_type: 'officer',
  positions: ['Chief'],
  start_date: '2026-09-01T00:00:00Z',
  end_date: '2026-09-02T00:00:00Z',
  status: 'closed',
  anonymous_voting: true,
  total_votes: 3,
  allow_write_ins: false,
  max_votes_per_position: 1,
  results_visible_immediately: false,
  email_sent: false,
  voting_method: 'simple_majority',
  victory_condition: 'plurality',
};

const BLOCKED_REASON = /cannot be reopened: its anonymity salt was destroyed when it closed/;

describe('ElectionDetailPage rollback gate (W50-29)', () => {
  beforeEach(() => {
    getElection.mockReset();
    closeElection.mockReset();
    rollbackElection.mockReset();
    mockNavigate.mockReset();
    window.history.replaceState({}, '', '/elections/e-1');
  });

  it('disables Roll Back on a closed anonymous election with votes and says why', async () => {
    getElection.mockResolvedValue(baseElection);
    renderWithRouter(<ElectionDetailPage />);

    const button = await screen.findByRole('button', { name: 'Roll Back' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(BLOCKED_REASON);
    expect(screen.getByText(BLOCKED_REASON)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(button);
    expect(screen.queryByRole('dialog', { name: 'Roll Back Election' })).not.toBeInTheDocument();
    expect(rollbackElection).not.toHaveBeenCalled();
  });

  it.each([
    ['closed anonymous election with no votes', { anonymous_voting: true, total_votes: 0 }],
    ['closed non-anonymous election with votes', { anonymous_voting: false, total_votes: 3 }],
    ['open anonymous election with votes', { status: 'open', anonymous_voting: true, total_votes: 3 }],
  ])('keeps Roll Back enabled on a %s', async (_label, overrides) => {
    getElection.mockResolvedValue({ ...baseElection, ...overrides });
    renderWithRouter(<ElectionDetailPage />);

    const button = await screen.findByRole('button', { name: 'Roll Back' });
    expect(button).toBeEnabled();
    expect(screen.queryByText(BLOCKED_REASON)).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(button);
    expect(await screen.findByRole('dialog', { name: 'Roll Back Election' })).toBeInTheDocument();
  });

  it('says the reopen invalidates sent ballot links rather than a bare "Reopen voting"', async () => {
    getElection.mockResolvedValue({ ...baseElection, anonymous_voting: false });
    renderWithRouter(<ElectionDetailPage />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Roll Back' }));
    const dialog = await screen.findByRole('dialog', { name: 'Roll Back Election' });
    expect(
      within(dialog).getByText(/Reopen voting\. Every ballot link already emailed stops working/)
    ).toBeInTheDocument();
  });

  it('tells the officer an anonymous close is final before closing', async () => {
    getElection.mockResolvedValue({ ...baseElection, status: 'open' });
    closeElection.mockResolvedValue({ ...baseElection, status: 'closed' });
    renderWithRouter(<ElectionDetailPage />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Close Election' }));
    const dialog = await screen.findByRole('dialog', { name: 'Close election' });
    expect(within(dialog).getByText(/closing is final: once any vote has been recorded/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/cannot be undone/)).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Close election' }));
    expect(closeElection).toHaveBeenCalledWith('e-1');
  });

  it('tells the officer a non-anonymous close can be rolled back at the cost of sent ballot links', async () => {
    getElection.mockResolvedValue({ ...baseElection, status: 'open', anonymous_voting: false });
    renderWithRouter(<ElectionDetailPage />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Close Election' }));
    const dialog = await screen.findByRole('dialog', { name: 'Close election' });
    expect(within(dialog).getByText(/Reopening it later takes a Roll Back/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/closing is final/)).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Keep it open' }));
    expect(closeElection).not.toHaveBeenCalled();
  });
});
