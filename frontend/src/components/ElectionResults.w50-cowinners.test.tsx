/**
 * Under the co_winners tie policy the backend now flags the tie too
 * (`is_tied` on each tied candidate, `is_tie` on the contest — W50-32), and
 * every tied candidate is also a winner. The panel must say both in one
 * label and not describe the tie as "unresolved" with "no winner declared".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockGetResults = vi.fn();
vi.mock('../services/electionService', () => ({
  electionService: {
    getResults: (...args: unknown[]) => mockGetResults(...args) as unknown,
  },
}));

import { ElectionResults } from './ElectionResults';
import type { Election } from '../types/election';

const election = {
  id: 'e1',
  title: 'Officer Election',
  status: 'closed',
  voting_method: 'single_choice',
  victory_condition: 'plurality',
  quorum_type: 'none',
  quorum_value: null,
} as unknown as Election;

const tiedContest = (tie_policy: string) => ({
  election_id: 'e1',
  election_title: 'Officer Election',
  status: 'closed',
  total_votes: 2,
  total_eligible_voters: 10,
  voter_turnout_percentage: 20,
  overall_results: [],
  quorum_met: null,
  quorum_detail: null,
  tie_policy,
  results_by_position: [
    {
      position: 'Chief',
      total_votes: 2,
      is_tie: true,
      candidates: [
        {
          candidate_id: 'c1',
          candidate_name: 'Blair Carter',
          vote_count: 1,
          percentage: 50,
          is_winner: tie_policy === 'co_winners',
          is_tied: true,
        },
        {
          candidate_id: 'c2',
          candidate_name: 'Devon Reyes',
          vote_count: 1,
          percentage: 50,
          is_winner: tie_policy === 'co_winners',
          is_tied: true,
        },
      ],
    },
  ],
});

describe('ElectionResults co-winner ties (W50-32)', () => {
  beforeEach(() => {
    mockGetResults.mockReset();
  });

  it('labels a tied winner "Co-winner (tie)" and explains the policy', async () => {
    mockGetResults.mockResolvedValue(tiedContest('co_winners'));
    render(<ElectionResults electionId="e1" election={election} />);
    expect(await screen.findAllByText('Co-winner (tie)')).toHaveLength(2);
    expect(screen.queryByText('Winner')).not.toBeInTheDocument();
    expect(screen.queryByText('Tied')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Tie for Chief — the tied candidates are declared co-winners per the election's tie policy."
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent('no winner is declared');
  });

  it('still reports an unresolved tie under a runoff policy', async () => {
    mockGetResults.mockResolvedValue(tiedContest('runoff'));
    render(<ElectionResults electionId="e1" election={election} />);
    expect(await screen.findAllByText('Tied')).toHaveLength(2);
    expect(screen.queryByText('Co-winner (tie)')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Unresolved tie for Chief — no winner is declared.');
    expect(screen.getByRole('alert')).toHaveTextContent('a runoff round decides the seat');
  });
});
