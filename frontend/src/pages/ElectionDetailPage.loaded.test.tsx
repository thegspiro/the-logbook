/**
 * The loaded election detail page (workflow review W50).
 *
 * The panels under each tab are stubbed: what is asserted here is the page's
 * own summary, stepper, tab panel and ballot-email control.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithRouter } from '../test/utils';

const getElection = vi.fn();
vi.mock('../services/api', () => ({
  electionService: {
    getElection: (...a: unknown[]) => getElection(...a) as unknown,
    getSettings: vi.fn().mockResolvedValue({}),
    getCandidates: vi.fn().mockResolvedValue([]),
    getManualBallotBatches: vi.fn().mockResolvedValue({ batches: [] }),
  },
  eventService: { getEvents: vi.fn().mockResolvedValue([]) },
  meetingsService: { getMeetings: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../modules/prospective-members/services/api', () => ({
  electionPackageService: {
    getPackages: vi.fn().mockResolvedValue([]),
    getPendingPackages: vi.fn().mockResolvedValue([]),
  },
  applicantService: { getApplicants: vi.fn().mockResolvedValue([]) },
}));
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useParams: () => ({ electionId: 'e-1' }) };
});
vi.mock('../stores/authStore', () => {
  const state = { checkPermission: () => true, user: { id: 'u-1' } };
  return { useAuthStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state) };
});

const { stub } = vi.hoisted(() => ({
  stub: (name: string) => ({ [name]: () => null, default: () => null }),
}));
vi.mock('../components/ElectionResults', () => stub('ElectionResults'));
vi.mock('../components/ElectionBallot', () => stub('ElectionBallot'));
vi.mock('../components/CandidateManagement', () => stub('CandidateManagement'));
vi.mock('../components/BallotBuilder', () => stub('BallotBuilder'));
vi.mock('../components/MeetingAttendance', () => stub('MeetingAttendance'));
vi.mock('../components/VoterOverrideManagement', () => stub('VoterOverrideManagement'));
vi.mock('../components/ProxyVotingManagement', () => stub('ProxyVotingManagement'));
vi.mock('../modules/elections/components/EligibilityRoster', () => stub('EligibilityRoster'));
vi.mock('../modules/elections/components/RunoffChain', () => stub('RunoffChain'));
vi.mock('../modules/elections/components/PublishResultsPanel', () => stub('PublishResultsPanel'));
vi.mock('../components/election-detail/NominationsPanel', () => stub('NominationsPanel'));
vi.mock('../components/election-detail/LiveTurnoutPanel', () => stub('LiveTurnoutPanel'));
vi.mock('../components/election-detail/PaperBallotBatchesPanel', () => stub('PaperBallotBatchesPanel'));

import ElectionDetailPage from './ElectionDetailPage';

const election = (over: Record<string, unknown> = {}) => ({
  id: 'e-1',
  organization_id: 'org-1',
  title: 'Officer Election',
  election_type: 'general',
  status: 'open',
  start_date: '2026-09-30T14:00:00Z',
  end_date: '2099-10-08T02:00:00Z',
  positions: ['Captain'],
  ballot_items: [],
  anonymous_voting: true,
  allow_write_ins: false,
  max_votes_per_position: 1,
  results_visible_immediately: false,
  email_sent: false,
  voting_method: 'simple_majority',
  victory_condition: 'most_votes',
  enable_runoffs: false,
  runoff_type: 'top_two',
  max_runoff_rounds: 3,
  is_runoff: false,
  runoff_round: 0,
  created_at: '2026-09-30T00:00:00Z',
  updated_at: '2026-09-30T00:00:00Z',
  ...over,
});

const renderPage = async () => {
  window.history.replaceState({}, '', '/elections/e-1');
  renderWithRouter(<ElectionDetailPage />);
  await screen.findByRole('heading', { name: 'Officer Election', level: 2 });
};

describe('ElectionDetailPage, loaded', () => {
  beforeEach(() => {
    getElection.mockReset();
    getElection.mockResolvedValue(election());
  });

  // A plurality election read "Voting Method: Simple Majority", because the
  // create form stores every one-choice rule as simple_majority.
  it('states how the winner is decided, not only how a ballot is marked', async () => {
    await renderPage();
    expect(screen.getByText('One choice per voter')).toBeInTheDocument();
    expect(screen.getByText('Most Votes (Plurality)')).toBeInTheDocument();
    expect(screen.queryByText('Simple Majority')).not.toBeInTheDocument();
  });

  it('marks the current step of the lifecycle', async () => {
    await renderPage();
    const progress = screen.getByRole('list', { name: 'Election progress' });
    expect(within(progress).getByRole('listitem', { current: 'step' })).toHaveTextContent('Voting Open');
  });

  // aria-controls pointed at panels that did not exist.
  it('renders the selected tab in a panel the tab controls', async () => {
    await renderPage();
    const panel = screen.getByRole('tabpanel');
    const tab = screen.getByRole('tab', { selected: true });
    expect(tab).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('aria-labelledby', tab.id);
  });

  // The reason was a hover title on a disabled button.
  // A plain position is on the emailed ballot since the 2026-10-05 ballot
  // convergence, so a positions-only election can mail ballots.
  it('lets a positions-only election send ballot emails', async () => {
    await renderPage();
    const send = screen.getByRole('button', { name: 'Send Ballot Emails' });
    expect(send).toBeEnabled();
    expect(screen.queryByText(/Ballot emails need ballot items/)).not.toBeInTheDocument();
  });
});
