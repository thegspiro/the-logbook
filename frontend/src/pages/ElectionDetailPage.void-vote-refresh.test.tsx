/**
 * ELEC2-16: voiding a single vote refreshed nothing but the forensics report.
 * A void after close stamps a results revision on the election (owner
 * decision 2026-10-05), and the page's revised-results banner reads that
 * stamp from the election — so the banner stayed stale until a reload. The
 * batch void already re-fetched the election; the vote void now does too.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const getElection = vi.fn();
const softDeleteVote = vi.fn();
vi.mock('../services/api', () => ({
  organizationService: {
    getEnabledModules: vi.fn().mockResolvedValue({ configured: false, enabled_modules: [] }),
  },
  electionService: {
    getElection: (...a: unknown[]) => getElection(...a) as unknown,
    getSettings: vi.fn().mockResolvedValue({}),
    getCandidates: vi.fn().mockResolvedValue([]),
    getManualBallotBatches: vi.fn().mockResolvedValue({ batches: [] }),
    // Left pending: the report's own rendering is not what is under test.
    getForensics: vi.fn(() => new Promise(() => undefined)),
    softDeleteVote: (...a: unknown[]) => softDeleteVote(...a) as unknown,
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
  return { ...actual, useParams: () => ({ electionId: 'e-1', '*': 'integrity' }) };
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

const election = {
  id: 'e-1',
  organization_id: 'org-1',
  title: 'Officer Election',
  election_type: 'general',
  status: 'closed',
  start_date: '2026-09-30T14:00:00Z',
  end_date: '2026-10-08T02:00:00Z',
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
};

describe('ElectionDetailPage voiding a vote', () => {
  beforeEach(() => {
    getElection.mockReset();
    getElection.mockResolvedValue(election);
    softDeleteVote.mockReset();
    softDeleteVote.mockResolvedValue({ message: 'Vote voided' });
  });

  it('re-reads the election, so a results revision shows without a reload', async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', '/elections/e-1/integrity');
    renderWithRouter(<ElectionDetailPage />);
    await screen.findByRole('heading', { name: 'Officer Election', level: 1 });
    const readsBefore = getElection.mock.calls.length;

    await user.type(screen.getByRole('textbox', { name: 'Vote ID (UUID)' }), 'v-9');
    await user.type(screen.getByRole('textbox', { name: 'Reason for voiding' }), 'Duplicate entry');
    await user.click(screen.getByRole('button', { name: 'Void Vote' }));

    expect(softDeleteVote).toHaveBeenCalledWith('e-1', 'v-9', 'Duplicate entry');
    await waitFor(() => expect(getElection.mock.calls.length).toBeGreaterThan(readsBefore));
  });
});
