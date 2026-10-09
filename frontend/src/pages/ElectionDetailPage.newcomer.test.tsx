/**
 * A first election stalls in two places nothing on the page explained:
 * open_election refuses a draft with no accepted candidate or ballot item, and
 * opening never emails ballots, so an open election can sit with no member
 * told that voting has started. The "Ballots sent" stamp only ever appeared
 * after a send. The Danger Zone heading also measured 3.8:1 (red-500), under
 * the 4.5:1 AA floor.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter, mockNavigate } from '../test/utils';

const getElection = vi.fn();
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../services/api', () => ({
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

const base = {
  id: 'e-1',
  organization_id: 'o-1',
  title: 'Officer Election',
  election_type: 'officer',
  positions: ['Chief'],
  ballot_items: [],
  start_date: '2026-11-01T00:00:00Z',
  end_date: '2026-11-02T00:00:00Z',
  status: 'draft',
  anonymous_voting: true,
  total_votes: 0,
  allow_write_ins: false,
  max_votes_per_position: 1,
  results_visible_immediately: false,
  email_sent: false,
  voting_method: 'simple_majority',
  victory_condition: 'plurality',
};

const NEXT = /Next: add at least one candidate on the Candidates tab/;
const NOT_EMAILED = /Ballots have not been emailed yet/;

describe('ElectionDetailPage first-election guidance', () => {
  beforeEach(() => {
    getElection.mockReset();
    mockNavigate.mockReset();
    window.history.replaceState({}, '', '/elections/e-1');
  });

  it('tells the secretary what a draft needs before it can open', async () => {
    getElection.mockResolvedValue(base);
    renderWithRouter(<ElectionDetailPage />);
    expect(await screen.findByText(NEXT)).toBeInTheDocument();
    expect(screen.getByText(/Opening does not email ballots/)).toBeInTheDocument();
  });

  it('says ballots are not emailed yet on an open election that has not sent them', async () => {
    getElection.mockResolvedValue({ ...base, status: 'open' });
    renderWithRouter(<ElectionDetailPage />);
    expect(await screen.findByText(NOT_EMAILED)).toBeInTheDocument();
    expect(screen.queryByText(NEXT)).not.toBeInTheDocument();
  });

  it('drops the reminder once ballots have been sent', async () => {
    getElection.mockResolvedValue({ ...base, status: 'open', email_sent: true, email_sent_at: '2026-11-01T01:00:00Z' });
    renderWithRouter(<ElectionDetailPage />);
    expect(await screen.findByText(/Ballots sent/)).toBeInTheDocument();
    expect(screen.queryByText(NOT_EMAILED)).not.toBeInTheDocument();
  });

  it('draws the Danger Zone heading in an AA-safe red', async () => {
    getElection.mockResolvedValue(base);
    renderWithRouter(<ElectionDetailPage />);
    const heading = await screen.findByRole('heading', { name: 'Danger Zone' });
    expect(heading).toHaveClass('text-red-800');
    expect(heading).not.toHaveClass('text-red-500');
  });
});
