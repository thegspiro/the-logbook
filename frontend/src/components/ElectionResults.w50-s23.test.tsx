/**
 * An election configured with no quorum must not be certified as having
 * met one.
 *
 * `GET /elections/{id}/results` serialises `quorum_met` from a schema default
 * of `True` (backend/app/schemas/election.py, `ElectionResults.quorum_met`),
 * and `calculate_results` only overrides it for `percentage` / `count`. The
 * results panel used to gate its banner on `quorum_met !== undefined`, which
 * is always true, so a `quorum_type: 'none'` election showed a green "Quorum
 * Met" banner it never earned. The backend now sends `quorum_met: null` for
 * an election with no quorum rule, and the panel reports what it decided
 * (CLAUDE.md #29): a neutral "No quorum requirement" line, never "met".
 * This test pins that.
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

const baseResults = {
  election_id: 'e1',
  election_title: 'Officer Election',
  status: 'closed',
  total_votes: 12,
  total_eligible_voters: 20,
  voter_turnout_percentage: 60,
  results_by_position: [],
  overall_results: [],
  quorum_met: true,
  quorum_detail: null,
  tie_policy: 'co_winners',
};

const electionWith = (quorum_type: string, quorum_value: number | null) =>
  ({
    id: 'e1',
    title: 'Officer Election',
    status: 'closed',
    voting_method: 'single_choice',
    victory_condition: 'plurality',
    quorum_type,
    quorum_value,
  }) as unknown as Election;

describe('ElectionResults quorum banner (S23)', () => {
  beforeEach(() => {
    mockGetResults.mockReset();
  });

  it('does not announce a quorum for an election that has none', async () => {
    mockGetResults.mockResolvedValue({ ...baseResults, quorum_met: null });
    render(<ElectionResults electionId="e1" election={electionWith('none', null)} />);
    expect(await screen.findByText('Election Summary')).toBeInTheDocument();
    expect(screen.getByText('No quorum requirement')).toBeInTheDocument();
    expect(screen.queryByText('Quorum Met')).not.toBeInTheDocument();
    expect(screen.queryByText('Quorum Not Met')).not.toBeInTheDocument();
  });

  it('still reports a met quorum when one is configured', async () => {
    mockGetResults.mockResolvedValue({
      ...baseResults,
      quorum_detail: 'Quorum requires 50% turnout. Actual: 60% (12/20).',
    });
    render(<ElectionResults electionId="e1" election={electionWith('percentage', 50)} />);
    expect(await screen.findByText('Quorum Met')).toBeInTheDocument();
  });

  it('still reports a missed quorum when one is configured', async () => {
    mockGetResults.mockResolvedValue({
      ...baseResults,
      quorum_met: false,
      quorum_detail: 'Quorum requires 15 voters. Actual: 12. Quorum NOT met — results are advisory only.',
    });
    render(<ElectionResults electionId="e1" election={electionWith('count', 15)} />);
    expect(await screen.findByText('Quorum Not Met')).toBeInTheDocument();
  });
});
