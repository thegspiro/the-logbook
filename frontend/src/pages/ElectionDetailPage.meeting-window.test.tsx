/**
 * Linking a draft election to a meeting moves the voting window to the
 * meeting's own start and end — the vote is held at that meeting. Only while
 * the dates can still change, and only to a start still ahead.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const getElection = vi.fn();
const updateElection = vi.fn();
const getMeetings = vi.fn();
vi.mock('../services/api', () => ({
  // Read by the Governance section strip in the page header.
  organizationService: {
    getEnabledModules: vi.fn().mockResolvedValue({ configured: false, enabled_modules: [] }),
  },
  electionService: {
    getElection: (...a: unknown[]) => getElection(...a) as unknown,
    updateElection: (...a: unknown[]) => updateElection(...a) as unknown,
    getSettings: vi.fn().mockResolvedValue({}),
    getCandidates: vi.fn().mockResolvedValue([]),
    getManualBallotBatches: vi.fn().mockResolvedValue({ batches: [] }),
  },
  eventService: { getEvents: vi.fn().mockResolvedValue([]) },
  meetingsService: { getMeetings: (...a: unknown[]) => getMeetings(...a) as unknown },
}));
vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
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

const meeting = (over: Record<string, unknown> = {}) => ({
  id: 'm-1',
  title: 'Annual Meeting',
  meeting_date: '2099-12-10',
  start_time: '19:00:00',
  end_time: '21:30:00',
  ...over,
});

const linkMeeting = async () => {
  window.history.replaceState({}, '', '/elections/e-1');
  renderWithRouter(<ElectionDetailPage />);
  // The title is the page's h1 now, drawn by the shared Governance header.
  await screen.findByRole('heading', { name: 'Officer Election', level: 1 });
  await userEvent.click(screen.getByRole('button', { name: 'Link a meeting' }));
  await userEvent.selectOptions(
    await screen.findByRole('combobox', { name: 'Linked meeting or event' }),
    'meeting:m-1'
  );
};

describe('ElectionDetailPage, linking a meeting', () => {
  beforeEach(() => {
    getElection.mockReset();
    getElection.mockResolvedValue(
      election({ status: 'draft', start_date: '2099-10-16T21:00:00Z', end_date: '2099-10-16T22:00:00Z' })
    );
    updateElection.mockReset();
    updateElection.mockImplementation((_id: string, data: Record<string, unknown>) =>
      Promise.resolve(election({ status: 'draft', ...data }))
    );
    getMeetings.mockReset();
    getMeetings.mockResolvedValue({ meetings: [meeting()] });
  });

  it("sets the voting window to the meeting's start and end", async () => {
    await linkMeeting();

    expect(updateElection).toHaveBeenCalledWith('e-1', {
      meeting_id: 'm-1',
      event_id: null,
      meeting_date: '2099-12-10',
      start_date: '2099-12-10T19:00:00.000Z',
      end_date: '2099-12-10T21:30:00.000Z',
    });
  });

  it('keeps the current length when the meeting has no end time', async () => {
    getMeetings.mockResolvedValue({ meetings: [meeting({ end_time: undefined })] });
    await linkMeeting();

    expect(updateElection).toHaveBeenCalledWith(
      'e-1',
      expect.objectContaining({ start_date: '2099-12-10T19:00:00.000Z', end_date: '2099-12-10T20:00:00.000Z' })
    );
  });

  it('links a past meeting without touching the dates', async () => {
    getMeetings.mockResolvedValue({ meetings: [meeting({ meeting_date: '2020-01-01' })] });
    await linkMeeting();

    const sent = updateElection.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(sent).toMatchObject({ meeting_id: 'm-1' });
    expect(sent).not.toHaveProperty('start_date');
    expect(sent).not.toHaveProperty('end_date');
  });
});
