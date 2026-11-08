/**
 * "Import Attendees from Event" must import from the linked event.
 *
 * The button is offered for an election linked to a meeting or to an event,
 * and the backend imports from either, but the handler returned early unless
 * a meeting was linked. On an event-linked draft the button did nothing at
 * all: no request, no toast, no change to the roster (W50 follow-up).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const getElection = vi.fn();
const updateElection = vi.fn();
const getMeetings = vi.fn();
const importMeetingAttendees = vi.fn();
vi.mock('../services/api', () => ({
  // Read by the Governance section strip in the page header.
  organizationService: {
    getEnabledModules: vi.fn().mockResolvedValue({ configured: false, enabled_modules: [] }),
  },
  electionService: {
    getElection: (...a: unknown[]) => getElection(...a) as unknown,
    updateElection: (...a: unknown[]) => updateElection(...a) as unknown,
    importMeetingAttendees: (...a: unknown[]) => importMeetingAttendees(...a) as unknown,
    getSettings: vi.fn().mockResolvedValue({}),
    getCandidates: vi.fn().mockResolvedValue([]),
    getManualBallotBatches: vi.fn().mockResolvedValue({ batches: [] }),
  },
  eventService: { getEvents: vi.fn().mockResolvedValue([]) },
  meetingsService: { getMeetings: (...a: unknown[]) => getMeetings(...a) as unknown },
}));
const toastSuccess = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: { success: (...a: unknown[]) => toastSuccess(...a) as unknown, error: vi.fn() },
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

const draft = (link: Record<string, unknown>) =>
  election({ status: 'draft', start_date: '2099-10-16T21:00:00Z', end_date: '2099-10-16T22:00:00Z', ...link });

const renderPage = async () => {
  window.history.replaceState({}, '', '/elections/e-1');
  renderWithRouter(<ElectionDetailPage />);
  await screen.findByRole('heading', { name: 'Officer Election', level: 1 });
};

describe('ElectionDetailPage, importing attendees', () => {
  beforeEach(() => {
    getElection.mockReset();
    updateElection.mockReset();
    getMeetings.mockReset();
    getMeetings.mockResolvedValue({ meetings: [] });
    importMeetingAttendees.mockReset();
    toastSuccess.mockReset();
    importMeetingAttendees.mockResolvedValue({ success: true, message: 'Imported 3 attendees', imported: 3 });
  });

  it('imports from a linked event', async () => {
    getElection.mockResolvedValue(draft({ event_id: 'ev-1', meeting_id: null }));
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Import Attendees from Event' }));

    expect(importMeetingAttendees).toHaveBeenCalledWith('e-1');
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Imported 3 attendees'));
  });

  it('still imports from a linked meeting', async () => {
    getElection.mockResolvedValue(draft({ meeting_id: 'm-1', event_id: null }));
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Import Attendees from Meeting' }));

    expect(importMeetingAttendees).toHaveBeenCalledWith('e-1');
  });
});
