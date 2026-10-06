/**
 * The in-app ballot is shown only where it is the whole ballot (W50-10).
 *
 * `ElectionBallot` renders `election.positions` as pick-one races. An
 * election with ballot items, or a cap above one per race, is voted from the
 * emailed link instead, and the tab says so rather than offering a partial
 * ballot that would block the race on the complete one.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Election } from '../../types/election';

vi.mock('../ElectionBallot', () => ({
  ElectionBallot: () => <div data-testid="in-app-ballot" />,
}));

import { CastVoteTab } from './CastVoteTab';
import { inAppBallotIsIncomplete } from '../../utils/electionHelpers';

const election = (overrides: Partial<Election> = {}): Election =>
  ({
    id: 'e-1',
    title: 'Officer Election',
    status: 'open',
    positions: ['Chief'],
    ballot_items: [],
    max_votes_per_position: 1,
    ...overrides,
  }) as unknown as Election;

const item = {
  id: 'bylaws',
  type: 'general_vote',
  title: 'Amend Article IV',
  eligible_voter_types: ['all'],
  vote_type: 'approval',
};

describe('CastVoteTab (W50-10)', () => {
  it('shows the in-app ballot for a positions-only, pick-one election', () => {
    render(<CastVoteTab electionId="e-1" election={election()} onVoteCast={vi.fn()} />);

    expect(screen.getByTestId('in-app-ballot')).toBeInTheDocument();
    expect(screen.queryByText('Vote from your ballot email')).not.toBeInTheDocument();
  });

  it('points to the ballot email when the election has ballot items', () => {
    render(<CastVoteTab electionId="e-1" election={election({ ballot_items: [item] })} onVoteCast={vi.fn()} />);

    expect(screen.queryByTestId('in-app-ballot')).not.toBeInTheDocument();
    expect(screen.getByText('Vote from your ballot email')).toBeInTheDocument();
    expect(screen.getByText(/has ballot items that the Cast Vote tab cannot show/)).toBeInTheDocument();
  });

  it('points to the ballot email when a voter may choose more than one per race', () => {
    render(<CastVoteTab electionId="e-1" election={election({ max_votes_per_position: 2 })} onVoteCast={vi.fn()} />);

    expect(screen.queryByTestId('in-app-ballot')).not.toBeInTheDocument();
    expect(screen.getByText(/races where you choose more than one/)).toBeInTheDocument();
  });

  it('treats a missing ballot item list as none', () => {
    expect(inAppBallotIsIncomplete(election({ ballot_items: undefined }))).toBe(false);
  });
});
