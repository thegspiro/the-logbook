/**
 * BallotVotingPage — one token, one lookup (W50-43).
 *
 * Under StrictMode the mount effect runs twice, and each run sent
 * `POST /elections/ballot/lookup`: two calls per page load against a public
 * endpoint capped at 10/min for every voter behind the same address. The
 * effect is now guarded by a ref keyed on the token, so a re-run for the same
 * token is a no-op while a new token (pasted fragment) still gets its own.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

const mockLookupBallot = vi.fn();
const mockSubmitBallot = vi.fn();
vi.mock('../services/api', () => ({
  electionService: {
    lookupBallot: (...args: unknown[]) => mockLookupBallot(...args) as unknown,
    submitBallot: (...args: unknown[]) => mockSubmitBallot(...args) as unknown,
  },
}));

import { BallotVotingPage } from './BallotVotingPage';

const ballot = (title: string) => ({
  election: {
    id: 'el1',
    title,
    election_type: 'officer',
    start_date: '2026-07-01T00:00:00Z',
    end_date: '2026-08-01T00:00:00Z',
    status: 'open',
    allow_write_ins: false,
    voting_method: 'simple_majority',
    max_votes_per_position: 1,
    ballot_items: [],
  },
  candidates: [],
  is_test: false,
});

describe('BallotVotingPage single lookup per token (W50-43)', () => {
  beforeEach(() => {
    mockLookupBallot.mockReset();
    mockSubmitBallot.mockReset();
    mockLookupBallot.mockResolvedValue(ballot('Board Election'));
    window.history.replaceState(null, '', '/ballot#token=tok');
  });

  it('sends exactly one lookup for the token even when StrictMode double-fires the effect', async () => {
    render(
      <React.StrictMode>
        <BallotVotingPage />
      </React.StrictMode>
    );

    await screen.findByText('Board Election');
    expect(mockLookupBallot).toHaveBeenCalledTimes(1);
    expect(mockLookupBallot).toHaveBeenCalledWith('tok');
  });

  it('still looks up a new token arriving by hashchange, once', async () => {
    render(
      <React.StrictMode>
        <BallotVotingPage />
      </React.StrictMode>
    );
    await screen.findByText('Board Election');
    mockLookupBallot.mockResolvedValue(ballot('Bylaw Vote'));

    act(() => {
      window.location.hash = '#token=late-token';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    await screen.findByText('Bylaw Vote');
    expect(mockLookupBallot).toHaveBeenCalledTimes(2);
    expect(mockLookupBallot).toHaveBeenLastCalledWith('late-token');
  });
});
