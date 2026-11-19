/**
 * The detail page's Linked Meeting picker offers the same upcoming events the
 * create dialog does. It used to ask for only the next ten events of every
 * type, so a department with a busy training calendar never saw a business
 * meeting a few weeks out, and could not link the election to it from here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const getElection = vi.fn();
const updateElection = vi.fn();
const getMeetings = vi.fn();
const getEvents = vi.fn();
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
  eventService: { getEvents: (...a: unknown[]) => getEvents(...a) as unknown },
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

// Fourteen trainings, then the business meeting, then more trainings: the
// order the events endpoint returns them in (soonest first).
const calendar = Array.from({ length: 30 }, (_, i) => {
  const day = String(i + 1).padStart(2, '0');
  const isMeeting = i === 14;
  return {
    id: isMeeting ? 'ev-meeting' : `ev-${i}`,
    title: isMeeting ? 'December Business Meeting' : `Training ${i + 1}`,
    event_type: isMeeting ? 'business_meeting' : 'training',
    start_datetime: `2099-12-${day}T19:00:00Z`,
    end_datetime: `2099-12-${day}T21:00:00Z`,
  };
});

describe('ElectionDetailPage, linked meeting picker', () => {
  beforeEach(() => {
    getElection.mockReset();
    getElection.mockResolvedValue(
      election({ status: 'draft', start_date: '2099-10-16T21:00:00Z', end_date: '2099-10-16T22:00:00Z' })
    );
    updateElection.mockReset();
    getMeetings.mockReset();
    getMeetings.mockResolvedValue({ meetings: [] });
    getEvents.mockReset();
    // Honour the page's own limit, as the endpoint does.
    getEvents.mockImplementation((params?: { limit?: number }) =>
      Promise.resolve(calendar.slice(0, params?.limit ?? 100))
    );
  });

  it('offers an upcoming business meeting behind more than ten other events', async () => {
    window.history.replaceState({}, '', '/elections/e-1');
    renderWithRouter(<ElectionDetailPage />);
    await screen.findByRole('heading', { name: 'Officer Election', level: 1 });
    await userEvent.click(screen.getByRole('button', { name: 'Link a meeting' }));

    const picker = await screen.findByRole('combobox', { name: 'Linked meeting or event' });
    await waitFor(() =>
      expect(within(picker).getByRole('option', { name: /December Business Meeting/ })).toHaveValue('event:ev-meeting')
    );
  });
});
