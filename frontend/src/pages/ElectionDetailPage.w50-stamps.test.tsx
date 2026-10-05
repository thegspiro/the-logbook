/**
 * The COMMUNICATION column read a single "Sent …" stamp off `email_sent_at`,
 * and a reminder used to move it (W50-27). The backend no longer touches
 * `email_sent_at` on a reminder and stamps `reminder_sent_at` instead, so the
 * column shows the ballot send and the reminder as two stamps: one beside
 * Resend Ballot Emails, one beside Remind Non-Voters.
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
    getManualBallots: vi.fn().mockResolvedValue([]),
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

const openWithBallotsSent = {
  id: 'e-1',
  organization_id: 'o-1',
  title: 'Officer Election',
  election_type: 'officer',
  positions: ['Chief'],
  ballot_items: [{ id: 'i-1', title: 'Chief', vote_type: 'candidate', position: 'Chief' }],
  start_date: '2026-09-29T00:00:00Z',
  end_date: '2026-10-02T05:45:00Z',
  status: 'open',
  anonymous_voting: true,
  allow_write_ins: false,
  max_votes_per_position: 1,
  results_visible_immediately: false,
  email_sent: true,
  email_sent_at: '2026-09-29T08:15:00Z',
  reminder_sent_at: null,
  voting_method: 'simple_majority',
  victory_condition: 'plurality',
};

describe('ElectionDetailPage communication stamps (W50-27)', () => {
  beforeEach(() => {
    getElection.mockReset();
    window.history.replaceState({}, '', '/elections/e-1?tab=overview');
  });

  it('stamps the ballot send beside Resend Ballot Emails and shows no reminder stamp before one goes out', async () => {
    getElection.mockResolvedValue(openWithBallotsSent);
    renderWithRouter(<ElectionDetailPage />);

    const ballots = await screen.findByText(/^Ballots sent/);
    expect(ballots).toHaveTextContent('September 29, 2026');
    expect(screen.getByRole('button', { name: 'Resend Ballot Emails' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remind Non-Voters' })).toBeInTheDocument();
    expect(screen.queryByText(/^Reminder sent/)).not.toBeInTheDocument();
  });

  it('renders reminder_sent_at as its own stamp and leaves the ballot stamp on email_sent_at', async () => {
    getElection.mockResolvedValue({ ...openWithBallotsSent, reminder_sent_at: '2026-09-30T06:54:00Z' });
    renderWithRouter(<ElectionDetailPage />);

    const reminder = await screen.findByText(/^Reminder sent/);
    expect(reminder).toHaveTextContent('September 30, 2026');
    const ballots = screen.getByText(/^Ballots sent/);
    expect(ballots).toHaveTextContent('September 29, 2026');
    expect(ballots).not.toHaveTextContent('September 30, 2026');
  });
});
