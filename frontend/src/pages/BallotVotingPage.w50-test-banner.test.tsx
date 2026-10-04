/**
 * BallotVotingPage — TEST BALLOT banner from the lookup's is_test (W50-18).
 *
 * A token minted by send-test-ballot used to render exactly like a real one,
 * and the submitted card told the officer their vote "was counted".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

const CANDIDATES = [
  { id: 'c1', name: 'Alice Anderson', position: 'Board', is_write_in: false },
  { id: 'c2', name: 'Bob Baker', position: 'Board', is_write_in: false },
];

const election = () => ({
  id: 'el1',
  title: 'Board Election',
  election_type: 'officer',
  start_date: '2026-07-01T00:00:00Z',
  end_date: '2026-08-01T00:00:00Z',
  status: 'open',
  allow_write_ins: false,
  voting_method: 'approval',
  max_votes_per_position: 1,
  ballot_items: [
    {
      id: 'board',
      type: 'officer_election',
      title: 'Board Seats',
      position: 'Board',
      eligible_voter_types: ['all'],
      vote_type: 'candidate_selection',
    },
  ],
});

const submission = {
  success: true,
  message: 'Ballot submitted successfully. 1 vote(s) cast, 0 abstention(s).',
  votes_cast: 1,
  abstentions: 0,
  receipt_hashes: ['abc123'],
};

const castBallot = async () => {
  const user = userEvent.setup();
  render(<BallotVotingPage />);
  await user.click(await screen.findByRole('checkbox', { name: /Alice Anderson/ }));
  await user.click(screen.getByRole('button', { name: 'Submit Ballot' }));
  await user.click(screen.getByRole('button', { name: 'Cast Ballot' }));
};

describe('BallotVotingPage test-ballot banner (W50-18)', () => {
  beforeEach(() => {
    mockLookupBallot.mockReset();
    mockSubmitBallot.mockReset();
    mockSubmitBallot.mockResolvedValue(submission);
    window.history.replaceState(null, '', '/ballot#token=tok');
  });

  it('shows the TEST BALLOT banner on the voting form when the lookup says is_test', async () => {
    mockLookupBallot.mockResolvedValue({ election: election(), candidates: CANDIDATES, is_test: true });

    render(<BallotVotingPage />);

    const banner = await screen.findByRole('status', { name: 'Test ballot notice' });
    expect(banner).toHaveTextContent('TEST BALLOT');
    expect(banner).toHaveTextContent(/not counted/);
    expect(screen.getByText('Votes cast on this test ballot are not counted.')).toBeInTheDocument();
    expect(screen.queryByText('Your vote is securely recorded.')).not.toBeInTheDocument();
  });

  it('keeps the banner on the submitted card and drops the "counted" receipt copy', async () => {
    mockLookupBallot.mockResolvedValue({ election: election(), candidates: CANDIDATES, is_test: true });

    await castBallot();

    expect(await screen.findByRole('heading', { name: 'Test Ballot Submitted' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Test ballot notice' })).toHaveTextContent(/not counted/);
    expect(screen.getByText(/recorded for preview only and is not counted/)).toBeInTheDocument();
    expect(screen.queryByText('Your ballot has been securely recorded.')).not.toBeInTheDocument();
    expect(screen.queryByText(/verify your vote was counted/)).not.toBeInTheDocument();
    expect(screen.getByText(/verifies the test vote was recorded, not counted/)).toBeInTheDocument();
  });

  it('renders no banner and the real-ballot copy when is_test is false or absent', async () => {
    mockLookupBallot.mockResolvedValue({ election: election(), candidates: CANDIDATES });

    await castBallot();

    expect(await screen.findByRole('heading', { name: 'Ballot Submitted' })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Test ballot notice' })).not.toBeInTheDocument();
    expect(screen.queryByText('TEST BALLOT')).not.toBeInTheDocument();
    expect(screen.getByText('Your ballot has been securely recorded.')).toBeInTheDocument();
  });
});
