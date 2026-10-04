/**
 * BallotVotingPage — public error states and tap targets (W50-44, W50-52).
 *
 * The lookup's backend `detail` used to be rendered with the "(Error code:
 * LB-API-400)" suffix, which broke the equality that picks the friendly
 * "already submitted" sentence; a dead token after close or reopen and a
 * superseded link now carry their own sentences from the service, and the
 * "contact your secretary" footer is wrong under them. A fragment-only
 * navigation onto /ballot was ignored and left the token in the URL.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockLookupBallot = vi.fn();
const mockSubmitBallot = vi.fn();
vi.mock('../services/api', () => ({
  electionService: {
    lookupBallot: (...args: unknown[]) => mockLookupBallot(...args) as unknown,
    submitBallot: (...args: unknown[]) => mockSubmitBallot(...args) as unknown,
  },
}));

import { BallotVotingPage } from './BallotVotingPage';

const apiError = (detail: string, code = 'LB-API-400') => ({
  response: { status: 400, statusText: 'Bad Request', data: { detail, code } },
});

const election = () => ({
  id: 'el1',
  title: 'Board Election',
  election_type: 'officer',
  start_date: '2026-07-01T00:00:00Z',
  end_date: '2026-08-01T00:00:00Z',
  status: 'open',
  allow_write_ins: true,
  voting_method: 'simple_majority',
  max_votes_per_position: 1,
  ballot_items: [
    {
      id: 'bylaw',
      type: 'bylaw_change',
      title: 'Adopt the new bylaws',
      eligible_voter_types: ['all'],
      vote_type: 'approval',
    },
  ],
});

const SECRETARY_HINT = /contact your organization's secretary/;

describe('BallotVotingPage public error states (W50-44, W50-52)', () => {
  beforeEach(() => {
    mockLookupBallot.mockReset();
    mockSubmitBallot.mockReset();
    window.history.replaceState(null, '', '/ballot#token=tok');
  });

  it('renders the friendly "already submitted" sentence even though the API error carries a code', async () => {
    mockLookupBallot.mockRejectedValue(apiError('This ballot has already been fully submitted'));

    render(<BallotVotingPage />);

    await screen.findByText('This ballot has already been submitted. Each voting link can only be used once.');
    expect(screen.queryByText(/Error code/)).not.toBeInTheDocument();
    expect(screen.getByText(SECRETARY_HINT)).toBeInTheDocument();
  });

  it('says voting has closed, with a results hint and no "mistake" footer', async () => {
    mockLookupBallot.mockRejectedValue(apiError('Voting has closed'));

    render(<BallotVotingPage />);

    await screen.findByText('Voting has closed for this election.');
    expect(screen.getByText('Results will be shared by your organization.')).toBeInTheDocument();
    expect(screen.queryByText(SECRETARY_HINT)).not.toBeInTheDocument();
    expect(screen.queryByText(/Error code/)).not.toBeInTheDocument();
  });

  it('explains a link invalidated by a close-and-reopen without the "mistake" footer', async () => {
    mockLookupBallot.mockRejectedValue(
      apiError(
        'This election was closed and reopened, so this ballot link is no longer valid. Ask your secretary for a new ballot link.'
      )
    );

    render(<BallotVotingPage />);

    await screen.findByText(/closed and reopened, so this ballot link no longer works/);
    expect(screen.getByText(/Ask your secretary for a new ballot link/)).toBeInTheDocument();
    expect(screen.queryByText(SECRETARY_HINT)).not.toBeInTheDocument();
  });

  it('points a superseded link at the newer ballot email', async () => {
    mockLookupBallot.mockRejectedValue(apiError('This link was replaced by a newer ballot email'));

    render(<BallotVotingPage />);

    await screen.findByText(/replaced by a newer ballot email/);
    expect(screen.getByText(/use the link there/)).toBeInTheDocument();
    expect(screen.queryByText(SECRETARY_HINT)).not.toBeInTheDocument();
    expect(screen.queryByText(/Error code/)).not.toBeInTheDocument();
  });

  it('shows an unrecognised detail verbatim, without the code suffix, and keeps the secretary footer', async () => {
    mockLookupBallot.mockRejectedValue(apiError('Voting token has expired'));

    render(<BallotVotingPage />);

    await screen.findByText('Voting token has expired');
    expect(screen.queryByText(/Error code/)).not.toBeInTheDocument();
    expect(screen.getByText(SECRETARY_HINT)).toBeInTheDocument();
  });

  it('looks up a token that arrives by a fragment-only navigation and scrubs it from the URL', async () => {
    window.history.replaceState(null, '', '/ballot');
    mockLookupBallot.mockResolvedValue({ election: election(), candidates: [], is_test: false });

    render(<BallotVotingPage />);
    await screen.findByText(/This link has no voting token/);
    expect(mockLookupBallot).not.toHaveBeenCalled();

    await act(async () => {
      window.location.hash = '#token=late-token';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    await waitFor(() => expect(mockLookupBallot).toHaveBeenCalledWith('late-token'));
    await screen.findByText('Adopt the new bylaws');
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain('late-token');
  });

  it('makes the bordered write-in card the label and gives the confirm buttons a 44px target', async () => {
    mockLookupBallot.mockResolvedValue({ election: election(), candidates: [], is_test: false });
    const user = userEvent.setup();

    render(<BallotVotingPage />);

    await screen.findByRole('radio', { name: 'Write-in' });
    const label = screen.getByText((_, el) => el?.tagName === 'LABEL' && el.textContent === 'Write-in');
    expect(label.className).toContain('border');
    expect(label.className).toContain('mobile-touch-row');

    await user.click(screen.getByRole('radio', { name: 'Approve' }));
    await user.click(screen.getByRole('button', { name: 'Submit Ballot' }));

    expect(screen.getByRole('button', { name: 'Change Ballot' }).className).toContain('mobile-touch-target');
    expect(screen.getByRole('button', { name: 'Cast Ballot' }).className).toContain('mobile-touch-target');
  });
});
