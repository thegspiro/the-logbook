/**
 * A correction to a closed election's result is marked on the Results tab
 * (W50-9): "Revised <when> by <who>: <what>", the same lines the certified
 * PDF prints. A result never revised shows no mark.
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

const election = (overrides: Partial<Election> = {}): Election =>
  ({
    id: 'e1',
    title: 'Officer Election',
    status: 'closed',
    voting_method: 'simple_majority',
    victory_condition: 'most_votes',
    quorum_type: 'none',
    quorum_value: null,
    ...overrides,
  }) as unknown as Election;

const results = {
  election_id: 'e1',
  election_title: 'Officer Election',
  status: 'closed',
  total_votes: 3,
  total_eligible_voters: 10,
  voter_turnout_percentage: 30,
  results_by_position: [],
  overall_results: [],
  quorum_met: null,
  quorum_detail: null,
  tie_policy: 'co_winners',
};

describe('ElectionResults revision mark (W50-9)', () => {
  beforeEach(() => {
    mockGetResults.mockReset();
    mockGetResults.mockResolvedValue(results);
  });

  it('names when, who and what for each revision', async () => {
    render(
      <ElectionResults
        electionId="e1"
        election={election({
          results_revisions: [
            {
              at: '2026-10-05T18:30:00Z',
              by: 'u-1',
              by_name: 'Sam Ortiz',
              action: 'vote_voided',
              detail: 'cast by a resigned member',
            },
          ],
        })}
      />
    );

    expect(await screen.findByText('These results were revised after the election closed')).toBeInTheDocument();
    expect(screen.getByText(/by Sam Ortiz: a vote was voided \(cast by a resigned member\)$/)).toBeInTheDocument();
  });

  it('shows no mark on a result that was never revised', async () => {
    render(<ElectionResults electionId="e1" election={election()} />);

    expect(await screen.findByText('Election Summary')).toBeInTheDocument();
    expect(screen.queryByText(/revised after the election closed/)).not.toBeInTheDocument();
  });
});
