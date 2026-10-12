/**
 * W50-25: the emailed ballot no longer pre-selects Abstain. An untouched
 * Submit → Cast used to burn the single-use link on a ballot of abstentions;
 * now nothing is selected on load and Submit stays disabled until every item
 * has a choice or an explicit Abstain (owner decision: no default).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

const election = {
  id: 'el1',
  title: 'Spring Meeting',
  election_type: 'general',
  start_date: '2026-07-01T00:00:00Z',
  end_date: '2026-08-01T00:00:00Z',
  status: 'open',
  allow_write_ins: false,
  voting_method: 'simple_majority',
  max_votes_per_position: 1,
  ballot_items: [
    {
      id: 'budget',
      type: 'general_vote',
      title: 'Approve the budget',
      vote_type: 'approval',
      eligible_voter_types: ['all'],
    },
    {
      id: 'chief',
      type: 'officer_election',
      title: 'Chief',
      position: 'Chief',
      eligible_voter_types: ['all'],
      vote_type: 'candidate_selection',
    },
  ],
};
const candidates = [{ id: 'c1', name: 'Alice Anderson', position: 'Chief', is_write_in: false }];

describe('BallotVotingPage — no default selection (W50-25)', () => {
  beforeEach(() => {
    mockLookupBallot.mockReset();
    mockSubmitBallot.mockReset();
    mockLookupBallot.mockResolvedValue({ election, candidates });
    mockSubmitBallot.mockResolvedValue({ success: true, votes_cast: 1, abstentions: 1, message: 'Ballot submitted.' });
    window.history.replaceState(null, '', '/ballot#token=tok');
  });

  it('selects nothing on load and holds Submit until every item is answered', async () => {
    const user = userEvent.setup();
    render(<BallotVotingPage />);

    const submit = await screen.findByRole('button', { name: 'Submit Ballot' });
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).not.toBeChecked();
    }
    expect(submit).toBeDisabled();
    expect(screen.getByText(/2 items still need a selection or Abstain/)).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Approve' }));
    expect(submit).toBeDisabled();
    expect(screen.getByText(/1 item still needs a selection or Abstain: Chief/)).toBeInTheDocument();

    await user.click(
      within(screen.getByRole('group', { name: 'Voting options for Chief' })).getByRole('radio', { name: /Abstain/ })
    );
    expect(submit).toBeEnabled();

    await user.click(submit);
    await user.click(screen.getByRole('button', { name: 'Cast Ballot' }));
    expect(mockSubmitBallot).toHaveBeenCalledWith('tok', [
      { ballot_item_id: 'budget', choice: 'approve', write_in_name: undefined },
      { ballot_item_id: 'chief', choice: 'abstain', write_in_name: undefined },
    ]);
  });
});
