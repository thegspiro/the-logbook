/**
 * W50-91: an election with no ballot items must not offer a Submit button over
 * an empty list.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockLookupBallot = vi.fn();
vi.mock('../services/api', () => ({
  electionService: {
    lookupBallot: (...args: unknown[]) => mockLookupBallot(...args) as unknown,
    submitBallot: vi.fn(),
  },
}));

import { BallotVotingPage } from './BallotVotingPage';

const election = {
  id: 'el1',
  title: 'Officer Election',
  election_type: 'general',
  start_date: '2026-07-01T00:00:00Z',
  end_date: '2026-08-01T00:00:00Z',
  status: 'open',
  allow_write_ins: false,
  voting_method: 'simple_majority',
  max_votes_per_position: 1,
  ballot_items: [],
};

describe('BallotVotingPage — no ballot items (W50-91)', () => {
  beforeEach(() => {
    mockLookupBallot.mockReset();
    mockLookupBallot.mockResolvedValue({ election, candidates: [] });
    window.history.replaceState(null, '', '/ballot#token=tok');
  });

  it('disables Submit and explains why', async () => {
    render(<BallotVotingPage />);

    expect(await screen.findByRole('button', { name: 'Submit Ballot' })).toBeDisabled();
    expect(screen.getByText(/no items to vote on/)).toBeInTheDocument();
    expect(screen.queryByText(/Make a selection for each item/)).not.toBeInTheDocument();
  });
});
