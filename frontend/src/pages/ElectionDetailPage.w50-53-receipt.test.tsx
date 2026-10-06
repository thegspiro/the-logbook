/**
 * An in-app vote receipt survives the page's own refetch (W50-53).
 *
 * The on-screen re-drive found the receipt never painted: `onVoteCast`
 * refetches the election, the refetch raised the page's loading skeleton,
 * and the skeleton replaced the whole page — unmounting ElectionBallot and
 * the receipt state it had just recorded. The skeleton now shows only until
 * the election has loaded once, so a refetch updates in place.
 *
 * ElectionBallot is rendered for real here; its own test covers the receipt
 * markup but cannot see what the page does around it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const getElection = vi.fn();
const checkEligibility = vi.fn();
const castVote = vi.fn();
vi.mock('../services/api', () => ({
  electionService: {
    getElection: (...a: unknown[]) => getElection(...a) as unknown,
    checkEligibility: (...a: unknown[]) => checkEligibility(...a) as unknown,
    castVote: (...a: unknown[]) => castVote(...a) as unknown,
    getSettings: vi.fn().mockResolvedValue({}),
    getCandidates: vi
      .fn()
      .mockResolvedValue([
        { id: 'c-1', election_id: 'e-1', user_id: 'u-9', position: 'Captain', accepted: true, name: 'Pat Lee' },
      ]),
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
  const state = { checkPermission: () => false, user: { id: 'u-1' } };
  return { useAuthStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state) };
});

const { stub } = vi.hoisted(() => ({
  stub: (name: string) => ({ [name]: () => null, default: () => null }),
}));
vi.mock('../components/ElectionResults', () => stub('ElectionResults'));
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
  total_votes: 0,
  created_at: '2026-09-30T00:00:00Z',
  updated_at: '2026-09-30T00:00:00Z',
  ...over,
});

const eligible = {
  is_eligible: true,
  has_voted: false,
  positions_voted: [],
  positions_remaining: ['Captain'],
  reason: null,
};
const voted = {
  is_eligible: false,
  has_voted: true,
  positions_voted: ['Captain'],
  positions_remaining: [],
  reason: null,
};
const HASH = 'a3f1c0de9b7e4d2c8f6a1b0e5d4c3b2a9f8e7d6c5b4a39281706f5e4d3c2b1a0';

describe('ElectionDetailPage in-app vote receipt (W50-53)', () => {
  beforeEach(() => {
    getElection.mockReset();
    checkEligibility.mockReset();
    castVote.mockReset();
    getElection.mockResolvedValueOnce(election()).mockResolvedValue(election({ total_votes: 1 }));
    checkEligibility.mockResolvedValueOnce(eligible).mockResolvedValue(voted);
    castVote.mockResolvedValue({ id: 'v-1', receipt_hash: HASH });
  });

  it('keeps the receipt on screen through the refetch that follows a vote', async () => {
    window.history.replaceState({}, '', '/elections/e-1?tab=voting');
    renderWithRouter(<ElectionDetailPage />);
    await screen.findByRole('heading', { name: 'Officer Election', level: 2 });

    await userEvent.click(await screen.findByRole('button', { name: 'Select Pat Lee' }));
    await userEvent.click(screen.getByRole('button', { name: /Submit Vote/ }));

    expect(await screen.findByText('Vote Receipt')).toBeInTheDocument();
    expect(screen.getByText(HASH)).toBeInTheDocument();
    await waitFor(() => expect(getElection).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Loading election...')).not.toBeInTheDocument();
    expect(screen.getByText(HASH)).toBeInTheDocument();
  });

  it('still shows the skeleton for the first load', () => {
    getElection.mockReset();
    getElection.mockReturnValue(new Promise(() => undefined));
    window.history.replaceState({}, '', '/elections/e-1');
    renderWithRouter(<ElectionDetailPage />);
    expect(screen.getByText('Loading election...')).toBeInTheDocument();
  });
});
