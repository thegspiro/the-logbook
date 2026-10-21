/**
 * The Print Blank Ballots button follows what the server will print.
 *
 * `build_printable_ballot_pdf` accepts plain positions or Ballot Builder
 * items, but the button checked positions alone, so a ballot made only of
 * motions or membership votes could never be printed from the page.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter, mockNavigate } from '../test/utils';

const getElection = vi.fn();
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../services/api', () => ({
  // Read by the Governance section strip in the page header.
  organizationService: {
    getEnabledModules: vi.fn().mockResolvedValue({ configured: false, enabled_modules: [] }),
  },
  electionService: {
    getElection: (...a: unknown[]) => getElection(...a) as unknown,
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

const draft = {
  id: 'e-1',
  organization_id: 'o-1',
  title: 'Special Meeting',
  election_type: 'general',
  positions: [] as string[],
  ballot_items: [] as unknown[],
  start_date: '2026-11-01T00:00:00Z',
  end_date: '2026-11-02T00:00:00Z',
  status: 'draft',
  anonymous_voting: true,
  allow_write_ins: false,
  max_votes_per_position: 1,
  results_visible_immediately: false,
  email_sent: false,
  voting_method: 'simple_majority',
  victory_condition: 'most_votes',
};

const motion = {
  id: 'budget',
  title: 'Approve the 2027 budget',
  type: 'general_vote',
  vote_type: 'approval',
  eligible_voter_types: ['all'],
};

describe('Print Blank Ballots button', () => {
  beforeEach(() => {
    getElection.mockReset();
    mockNavigate.mockReset();
    window.history.replaceState({}, '', '/elections/e-1');
  });

  it('is offered for a ballot built only from Ballot Builder items', async () => {
    getElection.mockResolvedValue({ ...draft, ballot_items: [motion] });
    renderWithRouter(<ElectionDetailPage />);

    expect(await screen.findByRole('button', { name: 'Print Blank Ballots' })).toBeInTheDocument();
  });

  it('is still offered for a ballot of plain positions', async () => {
    getElection.mockResolvedValue({ ...draft, positions: ['Chief'] });
    renderWithRouter(<ElectionDetailPage />);

    expect(await screen.findByRole('button', { name: 'Print Blank Ballots' })).toBeInTheDocument();
  });

  it('is not offered when the ballot has nothing on it yet', async () => {
    getElection.mockResolvedValue(draft);
    renderWithRouter(<ElectionDetailPage />);

    await screen.findByRole('heading', { name: 'Special Meeting' });
    expect(screen.queryByRole('button', { name: 'Print Blank Ballots' })).not.toBeInTheDocument();
  });
});
