/**
 * On a phone, an election's Overview is the meeting-night dashboard for
 * whoever runs it: the tally, the time left and the step that moves the
 * election on, with every section and the full Overview under More. A member
 * keeps the plain page, and a section's own address keeps its header.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

// A phone: the page reads (max-width: 767px) and nothing else here.
vi.mock('../hooks/useMediaQuery', () => ({ useMediaQuery: () => true, default: () => true }));
vi.mock('../services/electionService', () => ({
  electionService: {
    getStats: vi
      .fn()
      .mockResolvedValue({ total_voters: 48, total_eligible_voters: 62, voter_turnout_percentage: 77.4 }),
  },
}));

const getElection = vi.fn();
vi.mock('../services/api', () => ({
  // Read by the Governance section strip in the page header.
  organizationService: {
    getEnabledModules: vi.fn().mockResolvedValue({ configured: false, enabled_modules: [] }),
  },
  electionService: {
    getElection: (...a: unknown[]) => getElection(...a) as unknown,
    getSettings: vi.fn().mockResolvedValue({}),
    getCandidates: vi.fn().mockResolvedValue([]),
    getStats: vi
      .fn()
      .mockResolvedValue({ total_voters: 48, total_eligible_voters: 62, voter_turnout_percentage: 77.4 }),
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
  // Read off the address the way the `/elections/:electionId/*` route would,
  // so the page sees its own redirect land.
  return {
    ...actual,
    useParams: () => ({ electionId: 'e-1', '*': window.location.pathname.split('/').slice(3).join('/') }),
  };
});
let mockCanManage = true;
vi.mock('../stores/authStore', () => {
  const state = { checkPermission: () => mockCanManage, user: { id: 'u-1' } };
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

const openElection = {
  id: 'e-1',
  organization_id: 'o-1',
  title: 'Officer Election',
  election_type: 'officer',
  positions: ['Chief'],
  start_date: '2026-09-01T00:00:00Z',
  end_date: '2999-09-02T00:00:00Z',
  status: 'open',
  anonymous_voting: true,
  allow_write_ins: false,
  max_votes_per_position: 1,
  results_visible_immediately: false,
  email_sent: false,
  voting_method: 'simple_majority',
  victory_condition: 'plurality',
};

describe('ElectionDetailPage on a phone', () => {
  beforeEach(() => {
    getElection.mockReset();
    getElection.mockResolvedValue(openElection);
    mockCanManage = true;
    window.history.replaceState({}, '', '/elections/e-1');
  });

  it('gives whoever runs the election the meeting-night dashboard, with the step to take once', async () => {
    renderWithRouter(<ElectionDetailPage />);

    expect(await screen.findByTestId('dashboard-voted')).toHaveTextContent('48 / 62');
    expect(screen.getAllByRole('button', { name: 'Close Election' })).toHaveLength(1);
    expect(screen.queryByRole('list', { name: 'Election progress' })).not.toBeInTheDocument();
    // The full Overview waits under More.
    expect(screen.queryByText('Voting Method')).not.toBeInTheDocument();
  });

  it('opens the full Overview, every control included, from More', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ElectionDetailPage />);

    await user.click(await screen.findByRole('button', { name: 'More' }));
    await user.click(screen.getByRole('button', { name: 'Details and all controls' }));

    expect(screen.getByText('Voting Method')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clone Election' })).toBeInTheDocument();
  });

  it("keeps a section's own header on its own address", async () => {
    window.history.replaceState({}, '', '/elections/e-1/eligibility');
    renderWithRouter(<ElectionDetailPage />);

    expect(await screen.findByRole('navigation', { name: 'Election sections' })).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-voted')).not.toBeInTheDocument();
  });

  it('leaves a member the plain page', async () => {
    mockCanManage = false;
    renderWithRouter(<ElectionDetailPage />);

    expect(await screen.findByText('Voting Method')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-voted')).not.toBeInTheDocument();
  });
});
