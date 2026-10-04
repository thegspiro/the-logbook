/**
 * W50-26 — extending an open election succeeded silently. The page now toasts
 * the new close, in the department's zone, so the officer sees what was
 * written rather than inferring it from a dialog that just went away.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const getElection = vi.fn();
const updateElection = vi.fn();
const toastSuccess = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: { success: (...a: unknown[]) => toastSuccess(...a) as unknown, error: vi.fn() },
}));
vi.mock('../services/api', () => ({
  electionService: {
    getElection: (...a: unknown[]) => getElection(...a) as unknown,
    updateElection: (...a: unknown[]) => updateElection(...a) as unknown,
    getSettings: vi.fn().mockResolvedValue({}),
    getCandidates: vi.fn().mockResolvedValue([]),
    getManualBallotBatches: vi.fn().mockResolvedValue({ batches: [] }),
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
  return { ...actual, useParams: () => ({ electionId: 'e-1' }), useNavigate: () => vi.fn() };
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

const NOW = new Date('2026-09-30T08:00:00Z');

const openElection = {
  id: 'e-1',
  organization_id: 'o-1',
  title: 'Officer Election',
  election_type: 'officer',
  positions: ['Chief'],
  start_date: '2026-09-29T00:00:00Z',
  end_date: '2026-09-30T14:00:00Z',
  status: 'open',
  anonymous_voting: true,
  allow_write_ins: false,
  max_votes_per_position: 1,
  results_visible_immediately: false,
  email_sent: false,
  voting_method: 'simple_majority',
  victory_condition: 'plurality',
};

describe('ElectionDetailPage extend toast (W50-26)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
    getElection.mockReset();
    updateElection.mockReset();
    toastSuccess.mockReset();
    getElection.mockResolvedValue(openElection);
    updateElection.mockImplementation((_id: string, patch: { end_date: string }) =>
      Promise.resolve({ ...openElection, end_date: patch.end_date })
    );
    window.history.replaceState({}, '', '/elections/e-1');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes the later end and toasts the new close time', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithRouter(<ElectionDetailPage />);

    await user.click(await screen.findByRole('button', { name: 'Extend Time' }));
    const dialog = screen.getByRole('dialog', { name: 'Extend Election Time' });
    await user.click(within(dialog).getByRole('button', { name: '+1 Hour' }));
    await user.click(within(dialog).getByRole('button', { name: 'Extend Election' }));

    expect(updateElection).toHaveBeenCalledWith('e-1', { end_date: '2026-09-30T15:00:00.000Z' });
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/^Voting now closes .*3:00 PM/));
    expect(screen.queryByRole('dialog', { name: 'Extend Election Time' })).not.toBeInTheDocument();
  });
});
