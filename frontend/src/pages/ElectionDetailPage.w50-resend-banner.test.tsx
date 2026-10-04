/**
 * W50-36 — after a CLOSED -> OPEN rollback the page says the ballot links
 * are dead and ballots must be resent.
 *
 * `ElectionService.rollback_election` regenerates the anonymity salt and
 * expires every issued voting token when it reopens a closed election with no
 * recorded votes. The page kept showing "Resend Ballot Emails · Ballots sent
 * <stamp>" as if the ballots were still good. Neither the rollback response
 * nor the detail GET carries `ballots_must_be_resent`, so the page derives it
 * from the facts the backend decides on: the election was closed with zero
 * votes, came back open, and had ballots sent. The banner clears once
 * ballots go out again.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter, mockNavigate } from '../test/utils';

const getElection = vi.fn();
const rollbackElection = vi.fn();
const sendBallotEmail = vi.fn();
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../services/api', () => ({
  electionService: {
    getElection: (...a: unknown[]) => getElection(...a) as unknown,
    rollbackElection: (...a: unknown[]) => rollbackElection(...a) as unknown,
    sendBallotEmail: (...a: unknown[]) => sendBallotEmail(...a) as unknown,
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
  return { ...actual, useParams: () => ({ electionId: 'e-1' }), useNavigate: () => mockNavigate };
});
vi.mock('../stores/authStore', () => {
  const state = { checkPermission: () => true, user: { id: 'u-1' } };
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
// The send form is not under test; a one-button stand-in submits an empty payload.
vi.mock('../components/election-detail/SendBallotEmailsModal', () => ({
  default: ({
    onSubmit,
  }: {
    onSubmit: (p: { subject: string; message: string; sendEligibilitySummary: boolean }) => void;
  }) => (
    <div role="dialog" aria-label="Send Ballot Emails">
      <button type="button" onClick={() => onSubmit({ subject: '', message: '', sendEligibilitySummary: false })}>
        Send now
      </button>
    </div>
  ),
}));

import ElectionDetailPage from './ElectionDetailPage';

const closedElection = {
  id: 'e-1',
  organization_id: 'o-1',
  title: 'Officer Election',
  election_type: 'officer',
  positions: ['Chief'],
  ballot_items: [{ id: 'bi-1', title: 'Chief', item_type: 'candidate_selection' }],
  start_date: '2026-09-01T00:00:00Z',
  end_date: '2026-09-02T00:00:00Z',
  status: 'closed',
  anonymous_voting: true,
  total_votes: 0,
  allow_write_ins: false,
  max_votes_per_position: 1,
  results_visible_immediately: false,
  email_sent: true,
  email_sent_at: '2026-09-01T06:31:00Z',
  voting_method: 'simple_majority',
  victory_condition: 'plurality',
};
const reopenedElection = { ...closedElection, status: 'open' };

const BANNER = /Every ballot link already sent was invalidated by the rollback/;

async function rollBack(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Roll Back' }));
  const dialog = await screen.findByRole('dialog', { name: 'Roll Back Election' });
  await user.type(within(dialog).getByLabelText(/Reason for Rollback/), 'Counting error found; recount needed');
  await user.click(within(dialog).getByRole('button', { name: 'Roll Back Election' }));
  await waitFor(() => expect(rollbackElection).toHaveBeenCalledWith('e-1', 'Counting error found; recount needed'));
}

describe('ElectionDetailPage rollback resend banner (W50-36)', () => {
  beforeEach(() => {
    getElection.mockReset();
    rollbackElection.mockReset();
    sendBallotEmail.mockReset();
    mockNavigate.mockReset();
    window.history.replaceState({}, '', '/elections/e-1');
  });

  it('shows no banner before the rollback', async () => {
    getElection.mockResolvedValue(closedElection);
    renderWithRouter(<ElectionDetailPage />);

    await screen.findByRole('button', { name: 'Roll Back' });
    expect(screen.queryByText(BANNER)).not.toBeInTheDocument();
  });

  it('says the sent ballot links are dead after a zero-vote CLOSED -> OPEN rollback', async () => {
    getElection.mockResolvedValue(closedElection);
    rollbackElection.mockResolvedValue({
      success: true,
      election: reopenedElection,
      message: 'Election rolled back successfully. 2 leadership members notified.',
      notifications_sent: 2,
    });
    renderWithRouter(<ElectionDetailPage />);

    const user = userEvent.setup();
    await rollBack(user);

    const banner = await screen.findByRole('alert');
    expect(within(banner).getByText(BANNER)).toBeInTheDocument();
    expect(within(banner).getByText(/Resend ballots so members can vote/)).toBeInTheDocument();
    // The stamp beside the Resend button still shows, so the banner names it as the dead send.
    expect(screen.getByText(/Ballots sent/)).toBeInTheDocument();
  });

  it("the banner's Resend button opens the send dialog, and a successful send clears the banner", async () => {
    getElection.mockResolvedValue(closedElection);
    rollbackElection.mockResolvedValue({
      success: true,
      election: reopenedElection,
      message: 'ok',
      notifications_sent: 0,
    });
    sendBallotEmail.mockResolvedValue({
      success: true,
      recipients_count: 21,
      failed_count: 0,
      skipped_count: 0,
      skipped_details: [],
      message: 'sent',
    });
    renderWithRouter(<ElectionDetailPage />);

    const user = userEvent.setup();
    await rollBack(user);
    const banner = await screen.findByRole('alert');
    getElection.mockResolvedValue({ ...reopenedElection, email_sent_at: '2026-09-03T10:00:00Z' });

    await user.click(within(banner).getByRole('button', { name: 'Resend Ballot Emails' }));
    const dialog = await screen.findByRole('dialog', { name: 'Send Ballot Emails' });
    await user.click(within(dialog).getByRole('button', { name: 'Send now' }));

    await waitFor(() => expect(sendBallotEmail).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText(BANNER)).not.toBeInTheDocument());
  });

  it('keeps the banner when the resend fails, since the links are still dead', async () => {
    getElection.mockResolvedValue(closedElection);
    rollbackElection.mockResolvedValue({
      success: true,
      election: reopenedElection,
      message: 'ok',
      notifications_sent: 0,
    });
    sendBallotEmail.mockResolvedValue({
      success: false,
      recipients_count: 0,
      failed_count: 0,
      skipped_count: 0,
      skipped_details: [],
      message: 'No eligible voters',
    });
    renderWithRouter(<ElectionDetailPage />);

    const user = userEvent.setup();
    await rollBack(user);
    const banner = await screen.findByRole('alert');
    // The page refetches after a send; the election is open by then.
    getElection.mockResolvedValue(reopenedElection);
    await user.click(within(banner).getByRole('button', { name: 'Resend Ballot Emails' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Send Ballot Emails' })).getByRole('button', {
        name: 'Send now',
      })
    );

    await waitFor(() => expect(sendBallotEmail).toHaveBeenCalled());
    expect(screen.getByText(BANNER)).toBeInTheDocument();
  });

  it.each([
    // With votes the backend leaves the salt (and the issued links) alone.
    ['closed non-anonymous election with votes', { anonymous_voting: false, total_votes: 3 }],
    // No ballots were ever sent, so there is nothing to resend.
    ['closed election whose ballots were never sent', { email_sent: false, email_sent_at: undefined }],
  ])('shows no banner after rolling back a %s', async (_label, overrides) => {
    const before = { ...closedElection, ...overrides };
    getElection.mockResolvedValue(before);
    rollbackElection.mockResolvedValue({
      success: true,
      election: { ...before, status: 'open' },
      message: 'ok',
      notifications_sent: 0,
    });
    renderWithRouter(<ElectionDetailPage />);

    const user = userEvent.setup();
    await rollBack(user);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Roll Back Election' })).not.toBeInTheDocument());
    expect(screen.queryByText(BANNER)).not.toBeInTheDocument();
  });

  it('shows no banner after an OPEN -> DRAFT rollback, which invalidates nothing', async () => {
    const openElection = { ...closedElection, status: 'open', total_votes: 0 };
    getElection.mockResolvedValue(openElection);
    rollbackElection.mockResolvedValue({
      success: true,
      election: { ...openElection, status: 'draft' },
      message: 'ok',
      notifications_sent: 0,
    });
    renderWithRouter(<ElectionDetailPage />);

    const user = userEvent.setup();
    await rollBack(user);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Roll Back Election' })).not.toBeInTheDocument());
    expect(screen.queryByText(BANNER)).not.toBeInTheDocument();
  });
});
