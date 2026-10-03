/**
 * A ballot-item contest is keyed by the item's id, so `results_by_position`
 * carries a `label` with the item's title (backend/app/schemas/election.py,
 * `PositionResults.label`). The results panel must show that label, never
 * the id, as the contest name — including in the tie alert. A positional
 * contest has no label and keeps showing its position.
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

const ITEM_ID = '5b1a7c2e-0f3d-4e8a-9c6b-1d2e3f4a5b6c';

const election = {
  id: 'e1',
  title: 'Bylaw Amendments',
  status: 'closed',
  voting_method: 'single_choice',
  victory_condition: 'plurality',
  quorum_type: 'none',
  quorum_value: null,
} as unknown as Election;

const candidate = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  candidate_id: id,
  candidate_name: name,
  vote_count: 4,
  percentage: 50,
  is_winner: false,
  ...extra,
});

const baseResults = {
  election_id: 'e1',
  election_title: 'Bylaw Amendments',
  status: 'closed',
  total_votes: 8,
  total_eligible_voters: 10,
  voter_turnout_percentage: 80,
  overall_results: [],
  quorum_met: true,
  quorum_detail: null,
  tie_policy: 'runoff',
};

describe('ElectionResults ballot-item labels (W50 S05)', () => {
  beforeEach(() => {
    mockGetResults.mockReset();
  });

  it('names an item contest by its label, not its id', async () => {
    mockGetResults.mockResolvedValue({
      ...baseResults,
      results_by_position: [
        {
          position: ITEM_ID,
          label: 'Amend Article IV',
          total_votes: 8,
          candidates: [candidate('c1', 'Approve', { is_winner: true, vote_count: 6, percentage: 75 })],
        },
      ],
    });
    render(<ElectionResults electionId="e1" election={election} />);
    expect(await screen.findByRole('heading', { name: 'Amend Article IV' })).toBeInTheDocument();
    expect(screen.queryByText(ITEM_ID)).not.toBeInTheDocument();
  });

  it('uses the label in the tie alert', async () => {
    mockGetResults.mockResolvedValue({
      ...baseResults,
      results_by_position: [
        {
          position: ITEM_ID,
          label: 'Amend Article IV',
          total_votes: 8,
          is_tie: true,
          candidates: [candidate('c1', 'Approve', { is_tied: true }), candidate('c2', 'Deny', { is_tied: true })],
        },
      ],
    });
    render(<ElectionResults electionId="e1" election={election} />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Unresolved tie for Amend Article IV');
    expect(alert).not.toHaveTextContent(ITEM_ID);
  });

  it('falls back to the position when there is no label', async () => {
    mockGetResults.mockResolvedValue({
      ...baseResults,
      results_by_position: [
        {
          position: 'Chief',
          label: null,
          total_votes: 8,
          candidates: [candidate('c1', 'Jane Doe', { is_winner: true })],
        },
      ],
    });
    render(<ElectionResults electionId="e1" election={election} />);
    expect(await screen.findByRole('heading', { name: 'Chief' })).toBeInTheDocument();
  });

  it('still shows the overall results when there are no per-position entries', async () => {
    mockGetResults.mockResolvedValue({
      ...baseResults,
      results_by_position: [],
      overall_results: [candidate('c1', 'Jane Doe', { is_winner: true })],
    });
    render(<ElectionResults electionId="e1" election={election} />);
    expect(await screen.findByRole('heading', { name: 'Results' })).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.queryByText('Results by Position')).not.toBeInTheDocument();
  });
});
