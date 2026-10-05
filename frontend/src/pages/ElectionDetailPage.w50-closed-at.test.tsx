/**
 * The info card dates a closed election by its actual close and names the
 * officer who closed it (W50-14). Before `closed_at` existed every screen
 * dated an early close to the scheduled end, so a chief reading the card saw
 * an election "closed" two days after the officer had closed it.
 *
 * Rendered rather than source-asserted: what matters is which date the card
 * prints, and that the scheduled end is still shown, relabelled, beside it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../test/utils';

const getElection = vi.fn();
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
  return { ...actual, useParams: () => ({ electionId: 'e-1' }) };
});
vi.mock('../stores/authStore', () => {
  const state = { checkPermission: () => true, user: { id: 'u-1' } };
  return { useAuthStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state) };
});
vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

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

const closedEarly = {
  id: 'e-1',
  organization_id: 'o-1',
  title: 'Officer Election',
  election_type: 'officer',
  positions: ['Chief'],
  start_date: '2026-09-29T00:00:00Z',
  end_date: '2026-10-02T05:45:00Z',
  closed_at: '2026-09-30T07:07:00Z',
  closed_by: 'u-2',
  closed_by_name: 'Jordan Avery',
  status: 'closed',
  anonymous_voting: true,
  allow_write_ins: false,
  max_votes_per_position: 1,
  results_visible_immediately: false,
  email_sent: false,
  voting_method: 'simple_majority',
  victory_condition: 'plurality',
};

const closeStamp = () => screen.findByText(/^Closed .*2026/);

describe('ElectionDetailPage info card close (W50-14)', () => {
  beforeEach(() => {
    getElection.mockReset();
    window.history.replaceState({}, '', '/elections/e-1?tab=overview');
  });

  it('dates the close to closed_at and names the officer, keeping the scheduled end labelled', async () => {
    getElection.mockResolvedValue(closedEarly);
    renderWithRouter(<ElectionDetailPage />);

    const stamp = await closeStamp();
    expect(stamp).toHaveTextContent('September 30, 2026');
    expect(stamp).toHaveTextContent('by Jordan Avery');
    expect(stamp).not.toHaveTextContent('October 2, 2026');

    expect(screen.getByText('Scheduled End')).toBeInTheDocument();
    expect(screen.queryByText('End Date')).not.toBeInTheDocument();
  });

  it('falls back to the scheduled end for a row closed before closed_at was recorded', async () => {
    getElection.mockResolvedValue({ ...closedEarly, closed_at: null, closed_by: null, closed_by_name: null });
    renderWithRouter(<ElectionDetailPage />);

    const stamp = await closeStamp();
    expect(stamp).toHaveTextContent('October 2, 2026');
    expect(stamp).toHaveTextContent('closed automatically at the scheduled end');
  });

  it('shows no close stamp and the plain End Date label while voting is open', async () => {
    getElection.mockResolvedValue({
      ...closedEarly,
      closed_at: null,
      closed_by: null,
      closed_by_name: null,
      status: 'open',
    });
    renderWithRouter(<ElectionDetailPage />);

    expect(await screen.findByText('End Date')).toBeInTheDocument();
    expect(screen.queryByText(/^Closed .*2026/)).not.toBeInTheDocument();
    expect(screen.queryByText('Scheduled End')).not.toBeInTheDocument();
  });
});
