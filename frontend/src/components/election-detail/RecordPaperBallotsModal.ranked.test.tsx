/**
 * A ranked-choice race is entered ballot by ballot.
 *
 * Instant runoff needs each ballot's order, which a per-candidate total
 * cannot carry, so the server refuses totals for a ranked race. The form asks
 * for rankings exactly where the server will accept them: per contest, after
 * any Ballot Builder override of the election's method.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecordPaperBallotsModal from './RecordPaperBallotsModal';
import type { BallotItem, Candidate } from '../../types/election';
import { isRankedContest } from '../../utils/electionHelpers';

const makeCandidate = (overrides: Partial<Candidate>): Candidate => ({
  id: 'c1',
  election_id: 'e1',
  name: 'Candidate',
  accepted: true,
  is_write_in: false,
  display_order: 0,
  nomination_date: '2026-07-01T00:00:00Z',
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
  ...overrides,
});

const candidates: Candidate[] = [
  makeCandidate({ id: 'alex', name: 'Alex', position: 'Chief' }),
  makeCandidate({ id: 'blair', name: 'Blair', position: 'Chief' }),
  makeCandidate({ id: 'casey', name: 'Casey', position: 'Chief' }),
  makeCandidate({ id: 'pat', name: 'Pat', position: 'Captain' }),
  makeCandidate({ id: 'approve', name: 'Approve', position: 'budget' }),
];

const motion: BallotItem = {
  id: 'budget',
  type: 'general_vote',
  title: 'Adopt the budget',
  eligible_voter_types: ['all'],
  vote_type: 'approval',
};

const rankedChief: BallotItem = {
  id: 'chief',
  type: 'officer_election',
  title: 'Chief',
  position: 'Chief',
  eligible_voter_types: ['all'],
  vote_type: 'candidate_selection',
  voting_method: 'ranked_choice',
};

const onSubmit = vi.fn();
const onClose = vi.fn();

const renderModal = (props: { votingMethod: string; ballotItems: BallotItem[] }) =>
  render(
    <RecordPaperBallotsModal
      candidates={candidates}
      recording={false}
      error={null}
      onSubmit={onSubmit}
      onClose={onClose}
      {...props}
    />
  );

describe('RecordPaperBallotsModal ranked-choice entry', () => {
  beforeEach(() => {
    onSubmit.mockReset();
    onClose.mockReset();
  });

  it('asks for rankings, not totals, in a ranked race', () => {
    renderModal({ votingMethod: 'ranked_choice', ballotItems: [motion] });

    expect(screen.getByRole('heading', { name: 'Chief — ranked choice' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Alex (Chief)')).not.toBeInTheDocument();
    expect(screen.getByLabelText('1st choice for Chief')).toBeInTheDocument();
    // An Approve/Deny question is never ranked, whatever the election's method.
    expect(screen.getByLabelText('Approve (Adopt the budget)')).toBeInTheDocument();
  });

  it('records identical ballots once with a copy count', async () => {
    const user = userEvent.setup();
    renderModal({ votingMethod: 'ranked_choice', ballotItems: [] });

    await user.selectOptions(screen.getByLabelText('1st choice for Chief'), 'alex');
    await user.selectOptions(screen.getByLabelText('2nd choice for Chief'), 'blair');
    const copies = screen.getByLabelText('Identical ballots for Chief');
    await user.clear(copies);
    await user.type(copies, '3');
    await user.click(screen.getByRole('button', { name: 'Add ballot for Chief' }));

    const list = screen.getByRole('list', { name: 'Ballots entered for Chief' });
    expect(within(list).getByText(/1\. Alex\s+2\. Blair/)).toBeInTheDocument();
    expect(within(list).getByText('× 3')).toBeInTheDocument();
    // The form is ready for the next ballot.
    expect(screen.getByLabelText('1st choice for Chief')).toHaveValue('');

    await user.click(screen.getByRole('button', { name: 'Record 3 Ballots' }));
    expect(onSubmit).toHaveBeenCalledWith([], [{ rankings: ['alex', 'blair'], count: 3 }], '', false, undefined);
  });

  it('keeps choices in order with no gaps', async () => {
    const user = userEvent.setup();
    renderModal({ votingMethod: 'ranked_choice', ballotItems: [] });

    await user.selectOptions(screen.getByLabelText('1st choice for Chief'), 'alex');
    await user.selectOptions(screen.getByLabelText('2nd choice for Chief'), 'blair');
    // A candidate already ranked is not offered again further down.
    expect(within(screen.getByLabelText('2nd choice for Chief')).queryByRole('option', { name: 'Alex' })).toBeNull();
    // Moving Blair up to 1st drops the later duplicate.
    await user.selectOptions(screen.getByLabelText('1st choice for Chief'), 'blair');
    expect(screen.getByLabelText('2nd choice for Chief')).toHaveValue('');
    // Clearing a choice clears the ones after it.
    await user.selectOptions(screen.getByLabelText('2nd choice for Chief'), 'casey');
    await user.selectOptions(screen.getByLabelText('1st choice for Chief'), '');
    expect(screen.queryByLabelText('2nd choice for Chief')).not.toBeInTheDocument();
  });

  it('follows a Ballot Builder override of the election method', () => {
    renderModal({ votingMethod: 'simple_majority', ballotItems: [rankedChief, motion] });

    expect(screen.getByRole('heading', { name: 'Chief — ranked choice' })).toBeInTheDocument();
    expect(screen.getByLabelText('Pat (Captain)')).toBeInTheDocument();
  });

  it('removes a ballot entered by mistake', async () => {
    const user = userEvent.setup();
    renderModal({ votingMethod: 'ranked_choice', ballotItems: [] });

    await user.selectOptions(screen.getByLabelText('1st choice for Chief'), 'casey');
    await user.click(screen.getByRole('button', { name: 'Add ballot for Chief' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    expect(screen.queryByRole('list', { name: 'Ballots entered for Chief' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record 0 Ballots' })).toBeDisabled();
  });
});

describe('isRankedContest', () => {
  it('reads the election method when no item claims the position', () => {
    expect(isRankedContest('Chief', [], 'ranked_choice')).toBe(true);
    expect(isRankedContest('Chief', [], 'simple_majority')).toBe(false);
  });

  it('lets an item override the method, matched by position, else title or id', () => {
    expect(isRankedContest('Chief', [rankedChief], 'simple_majority')).toBe(true);
    const legacy: BallotItem = { ...rankedChief, position: undefined, id: 'chief-item', title: 'Chief' };
    expect(isRankedContest('Chief', [legacy], 'simple_majority')).toBe(true);
    expect(isRankedContest('chief-item', [legacy], 'simple_majority')).toBe(true);
  });

  it('never ranks an Approve/Deny question', () => {
    expect(isRankedContest('budget', [motion], 'ranked_choice')).toBe(false);
  });

  it('is false for a candidate with no position', () => {
    expect(isRankedContest(undefined, [], 'ranked_choice')).toBe(false);
  });
});
