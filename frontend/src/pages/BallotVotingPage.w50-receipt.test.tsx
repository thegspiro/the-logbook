/**
 * BallotVotingPage — the verify-receipt form sits in the ballot page footer
 * and on the submitted card, and calls the endpoint for this election
 * (W50-53).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockLookupBallot = vi.fn();
const mockSubmitBallot = vi.fn();
const mockVerifyReceipt = vi.fn();
vi.mock('../services/api', () => ({
  electionService: {
    lookupBallot: (...args: unknown[]) => mockLookupBallot(...args) as unknown,
    submitBallot: (...args: unknown[]) => mockSubmitBallot(...args) as unknown,
    verifyReceipt: (...args: unknown[]) => mockVerifyReceipt(...args) as unknown,
  },
}));

import { BallotVotingPage } from './BallotVotingPage';

const CANDIDATES = [{ id: 'c1', name: 'Alice Anderson', position: 'Board', is_write_in: false }];

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

describe('BallotVotingPage receipt verification (W50-53)', () => {
  beforeEach(() => {
    mockLookupBallot.mockReset();
    mockSubmitBallot.mockReset();
    mockVerifyReceipt.mockReset();
    mockLookupBallot.mockResolvedValue({ election: election(), candidates: CANDIDATES });
    mockSubmitBallot.mockResolvedValue({
      success: true,
      message: 'Ballot submitted successfully. 1 vote(s) cast, 0 abstention(s).',
      votes_cast: 1,
      abstentions: 0,
      receipt_hashes: ['abc123'],
    });
    mockVerifyReceipt.mockResolvedValue({
      verified: true,
      counted: true,
      message: 'Your vote has been recorded and is counted',
    });
    window.history.replaceState(null, '', '/ballot#token=tok');
  });

  it('verifies a receipt from the ballot page footer against this election', async () => {
    const user = userEvent.setup();
    render(<BallotVotingPage />);
    await screen.findByRole('checkbox', { name: /Alice Anderson/ });

    await user.type(screen.getByLabelText('Receipt'), 'abc123');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(mockVerifyReceipt).toHaveBeenCalledWith('el1', 'abc123');
    expect(await screen.findByRole('status')).toHaveTextContent('Vote counted');
  });

  it('offers the form on the submitted card next to the receipt it just showed', async () => {
    const user = userEvent.setup();
    render(<BallotVotingPage />);
    await user.click(await screen.findByRole('checkbox', { name: /Alice Anderson/ }));
    await user.click(screen.getByRole('button', { name: 'Submit Ballot' }));
    await user.click(screen.getByRole('button', { name: 'Cast Ballot' }));

    await screen.findByRole('heading', { name: 'Ballot Submitted' });
    expect(screen.getByText('abc123')).toBeInTheDocument();
    const form = screen.getByRole('region', { name: 'Verify a vote receipt' });
    await user.type(within(form).getByLabelText('Receipt'), 'abc123');
    await user.click(within(form).getByRole('button', { name: 'Verify' }));

    expect(mockVerifyReceipt).toHaveBeenCalledWith('el1', 'abc123');
  });
});
