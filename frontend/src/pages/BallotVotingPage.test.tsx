/**
 * BallotVotingPage — token capture (R-D3) and method-aware ballot UI (R-D5).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
  { id: 'c3', name: 'Carol Clark', position: 'Board', is_write_in: false },
];

const baseElection = (overrides: Record<string, unknown> = {}) => ({
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
  ...overrides,
});

const setUrl = (path: string) => {
  window.history.replaceState(null, '', path);
};

describe('BallotVotingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setUrl('/ballot');
  });

  describe('token capture (R-D3)', () => {
    it('reads the token from the URL fragment and scrubs the address bar', async () => {
      setUrl('/ballot#token=frag-token-123');
      mockLookupBallot.mockResolvedValueOnce({
        election: baseElection(),
        candidates: CANDIDATES,
      });

      render(<BallotVotingPage />);

      await waitFor(() => {
        expect(mockLookupBallot).toHaveBeenCalledWith('frag-token-123');
      });
      // The credential must not linger in the URL (history/copy-paste leak)
      expect(window.location.hash).toBe('');
      expect(window.location.search).toBe('');
    });

    it('falls back to the legacy ?token= query for pre-fragment emails', async () => {
      setUrl('/ballot?token=query-token-456');
      mockLookupBallot.mockResolvedValueOnce({
        election: baseElection(),
        candidates: CANDIDATES,
      });

      render(<BallotVotingPage />);

      await waitFor(() => {
        expect(mockLookupBallot).toHaveBeenCalledWith('query-token-456');
      });
      expect(window.location.search).toBe('');
    });

    it('shows an error when no token is present', async () => {
      render(<BallotVotingPage />);

      expect(await screen.findByText(/No voting token provided/)).toBeInTheDocument();
      expect(mockLookupBallot).not.toHaveBeenCalled();
    });
  });

  describe('approval multi-select (R-D5)', () => {
    it('renders checkboxes and submits candidate_ids', async () => {
      setUrl('/ballot#token=tok');
      mockLookupBallot.mockResolvedValueOnce({
        election: baseElection({ voting_method: 'approval' }),
        candidates: CANDIDATES,
      });
      mockSubmitBallot.mockResolvedValueOnce({
        success: true,
        message: 'Ballot recorded',
        votes_cast: 2,
        abstentions: 0,
        receipt_hashes: ['r1', 'r2'],
      });

      const user = userEvent.setup();
      render(<BallotVotingPage />);

      const aliceBox = await screen.findByRole('checkbox', { name: /Alice Anderson/ });
      await user.click(aliceBox);
      await user.click(screen.getByRole('checkbox', { name: /Bob Baker/ }));

      await user.click(screen.getByRole('button', { name: 'Submit Ballot' }));
      expect(await screen.findByText(/Approved: Alice Anderson, Bob Baker/)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Cast Ballot' }));

      await waitFor(() => {
        expect(mockSubmitBallot).toHaveBeenCalledWith('tok', [
          { ballot_item_id: 'board', candidate_ids: ['c1', 'c2'] },
        ]);
      });
    });

    it('caps selections for multi-vote (non-approval) elections', async () => {
      setUrl('/ballot#token=tok');
      mockLookupBallot.mockResolvedValueOnce({
        election: baseElection({ voting_method: 'simple_majority', max_votes_per_position: 2 }),
        candidates: CANDIDATES,
      });

      const user = userEvent.setup();
      render(<BallotVotingPage />);

      await user.click(await screen.findByRole('checkbox', { name: /Alice Anderson/ }));
      await user.click(screen.getByRole('checkbox', { name: /Bob Baker/ }));

      // Third checkbox is disabled at the 2-selection cap
      expect(screen.getByRole('checkbox', { name: /Carol Clark/ })).toBeDisabled();
    });
  });

  describe('ranked choice (R-D5)', () => {
    it('assigns unique ranks and submits rankings in rank order', async () => {
      setUrl('/ballot#token=tok');
      mockLookupBallot.mockResolvedValueOnce({
        election: baseElection({ voting_method: 'ranked_choice' }),
        candidates: CANDIDATES,
      });
      mockSubmitBallot.mockResolvedValueOnce({
        success: true,
        message: 'Ballot recorded',
        votes_cast: 2,
        abstentions: 0,
        receipt_hashes: ['r1', 'r2'],
      });

      const user = userEvent.setup();
      render(<BallotVotingPage />);

      // Rank Bob first, Alice second
      await user.selectOptions(await screen.findByRole('combobox', { name: 'Rank for Bob Baker' }), '1');
      await user.selectOptions(screen.getByRole('combobox', { name: 'Rank for Alice Anderson' }), '2');

      await user.click(screen.getByRole('button', { name: 'Submit Ballot' }));
      expect(await screen.findByText(/Ranked: 1\. Bob Baker, 2\. Alice Anderson/)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Cast Ballot' }));

      await waitFor(() => {
        expect(mockSubmitBallot).toHaveBeenCalledWith('tok', [{ ballot_item_id: 'board', rankings: ['c2', 'c1'] }]);
      });
    });

    it('frees a rank when it is reassigned to another candidate', async () => {
      setUrl('/ballot#token=tok');
      mockLookupBallot.mockResolvedValueOnce({
        election: baseElection({ voting_method: 'ranked_choice' }),
        candidates: CANDIDATES,
      });

      const user = userEvent.setup();
      render(<BallotVotingPage />);

      const aliceRank = await screen.findByRole('combobox', { name: 'Rank for Alice Anderson' });
      const bobRank = screen.getByRole('combobox', { name: 'Rank for Bob Baker' });

      await user.selectOptions(aliceRank, '1');
      await user.selectOptions(bobRank, '1');

      // Bob now holds rank 1; Alice's selection was cleared
      expect(bobRank).toHaveValue('1');
      expect(aliceRank).toHaveValue('');
    });
  });
});
