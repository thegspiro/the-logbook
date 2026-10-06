/**
 * W50-56 / W50-57 — Open Election and Open Nominations ask first, and name
 * what happens: opening voting moves a still-future start to now and locks
 * the ballot (ballots are a separate send); opening nominations emails every
 * active member. The open toast names the start the server moved.
 *
 * Rendered rather than source-asserted: the behaviour is the handlers, the
 * shared confirm dialog and the toast together.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter, mockNavigate } from '../test/utils';

const getElection = vi.fn();
const openElection = vi.fn();
const openNominations = vi.fn();
const toastSuccess = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: { success: (...a: unknown[]) => toastSuccess(...a) as unknown, error: vi.fn() },
}));
vi.mock('../services/api', () => ({
  electionService: {
    getElection: (...a: unknown[]) => getElection(...a) as unknown,
    openElection: (...a: unknown[]) => openElection(...a) as unknown,
    openNominations: (...a: unknown[]) => openNominations(...a) as unknown,
    getSettings: vi.fn().mockResolvedValue({ nominations_enabled: true }),
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
  const state = { checkPermission: () => true, user: { id: 'u-1', timezone: 'UTC' } };
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

const FUTURE_START = '2099-06-01T09:00:00Z';
const PAST_START = '2020-06-01T09:00:00Z';

const draftElection = {
  id: 'e-1',
  organization_id: 'o-1',
  title: 'Officer Election',
  election_type: 'officer',
  positions: ['Chief'],
  start_date: FUTURE_START,
  end_date: '2099-06-02T09:00:00Z',
  status: 'draft',
  anonymous_voting: true,
  allow_write_ins: false,
  max_votes_per_position: 1,
  results_visible_immediately: false,
  email_sent: false,
  voting_method: 'simple_majority',
  victory_condition: 'plurality',
};

describe('ElectionDetailPage open confirmations (W50-56, W50-57)', () => {
  beforeEach(() => {
    getElection.mockReset();
    openElection.mockReset();
    openNominations.mockReset();
    toastSuccess.mockReset();
    mockNavigate.mockReset();
    getElection.mockResolvedValue(draftElection);
    openElection.mockResolvedValue({ ...draftElection, status: 'open', start_date: '2026-09-30T02:27:00Z' });
    openNominations.mockResolvedValue({ ...draftElection, status: 'nominations' });
    window.history.replaceState({}, '', '/elections/e-1?tab=ballot');
  });

  it('asks before opening, names the moved start, and toasts the adjustment', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ElectionDetailPage />);

    await user.click(await screen.findByRole('button', { name: 'Open Election' }));
    const dialog = await screen.findByRole('dialog', { name: 'Open election' });
    expect(within(dialog).getByText(/The scheduled start \(.+\) moves to now/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Ballot emails are not sent by this step/)).toBeInTheDocument();
    expect(openElection).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Open election' }));
    expect(openElection).toHaveBeenCalledWith('e-1');
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/^Election opened — start moved from .+ to now$/));
  });

  it('does not open when the officer keeps the draft', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ElectionDetailPage />);

    await user.click(await screen.findByRole('button', { name: 'Open Election' }));
    const dialog = await screen.findByRole('dialog', { name: 'Open election' });
    await user.click(within(dialog).getByRole('button', { name: 'Keep as draft' }));
    expect(openElection).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('omits the moved-start wording when the start is already past and the server left it alone', async () => {
    getElection.mockResolvedValue({ ...draftElection, start_date: PAST_START });
    openElection.mockResolvedValue({ ...draftElection, status: 'open', start_date: PAST_START });
    const user = userEvent.setup();
    renderWithRouter(<ElectionDetailPage />);

    await user.click(await screen.findByRole('button', { name: 'Open Election' }));
    const dialog = await screen.findByRole('dialog', { name: 'Open election' });
    expect(within(dialog).queryByText(/moves to now/)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Open election' }));
    expect(toastSuccess).toHaveBeenCalledWith('Election opened');
  });

  it('warns that opening nominations emails every active member, then opens on confirm', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ElectionDetailPage />);

    await user.click(await screen.findByRole('button', { name: 'Open Nominations' }));
    const dialog = await screen.findByRole('dialog', { name: 'Open nominations' });
    expect(within(dialog).getByText(/Every active member is emailed/)).toBeInTheDocument();
    expect(openNominations).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Open nominations and email members' }));
    expect(openNominations).toHaveBeenCalledWith('e-1');
    expect(toastSuccess).toHaveBeenCalledWith('Nominations opened');
  });

  it('does not open nominations when the officer cancels', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ElectionDetailPage />);

    await user.click(await screen.findByRole('button', { name: 'Open Nominations' }));
    const dialog = await screen.findByRole('dialog', { name: 'Open nominations' });
    await user.click(within(dialog).getByRole('button', { name: 'Keep as draft' }));
    expect(openNominations).not.toHaveBeenCalled();
  });

  it('warns that an election with no race at all cannot email ballots once open (W50-11)', async () => {
    getElection.mockResolvedValue({ ...draftElection, positions: [], ballot_items: [] });
    const user = userEvent.setup();
    renderWithRouter(<ElectionDetailPage />);

    await user.click(await screen.findByRole('button', { name: 'Open Election' }));
    const dialog = await screen.findByRole('dialog', { name: 'Open election' });
    expect(
      within(dialog).getByText(/no ballot items or positions, so ballot emails cannot be sent once it opens/)
    ).toBeInTheDocument();
  });

  it('does not warn for a positions-only election, whose positions are on the emailed ballot', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ElectionDetailPage />);

    await user.click(await screen.findByRole('button', { name: 'Open Election' }));
    const dialog = await screen.findByRole('dialog', { name: 'Open election' });
    expect(within(dialog).queryByText(/ballot emails cannot be sent/)).not.toBeInTheDocument();
  });

  it('does not warn when the election has ballot items to email', async () => {
    getElection.mockResolvedValue({
      ...draftElection,
      ballot_items: [
        {
          id: 'chief',
          type: 'officer_election',
          title: 'Chief',
          position: 'Chief',
          eligible_voter_types: ['all'],
          vote_type: 'candidate_selection',
        },
      ],
    });
    const user = userEvent.setup();
    renderWithRouter(<ElectionDetailPage />);

    await user.click(await screen.findByRole('button', { name: 'Open Election' }));
    const dialog = await screen.findByRole('dialog', { name: 'Open election' });
    expect(within(dialog).queryByText(/ballot emails cannot be sent/)).not.toBeInTheDocument();
  });
});
