/**
 * The ballot-item carve-out: following another kind's rules applies at once;
 * custom rules are saved only with their reason.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BallotItem, ElectionEligibilityRules } from '../../../types/election';
import { BallotItemVoterRules } from './BallotItemVoterRules';

const ELECTION_RULES: ElectionEligibilityRules = {
  version: 2,
  attendance: { mode: 'none' },
  types: {
    regular: { may_vote: true, wait: null, attendance: [{ mode: 'count', min_meetings: 6, of_last_meetings: 12 }] },
    probationary: { may_vote: false, wait: null, attendance: [] },
  },
};

const ITEM: BallotItem = {
  id: 'bylaws-iv',
  type: 'general_vote',
  title: 'Amend Article IV',
  eligible_voter_types: ['all'],
  vote_type: 'approval',
};

const onApply = vi.fn();

const renderRules = (item: BallotItem = ITEM) =>
  render(
    <BallotItemVoterRules
      item={item}
      electionRules={ELECTION_RULES}
      fallbackRules={ELECTION_RULES}
      disabled={false}
      onApply={onApply}
    />
  );

describe('BallotItemVoterRules', () => {
  beforeEach(() => {
    onApply.mockReset();
  });

  it('follows another kind of vote’s rules at once', async () => {
    const user = userEvent.setup();
    renderRules();
    await user.selectOptions(screen.getByLabelText('Voter rules for this item'), 'bylaws');
    expect(onApply).toHaveBeenCalledWith({
      eligibility_kind: 'bylaws',
      eligibility_rules: null,
      eligibility_override_reason: null,
    });
  });

  it('goes back to the election’s rules', async () => {
    const user = userEvent.setup();
    renderRules({ ...ITEM, eligibility_kind: 'bylaws', eligibility_rules: ELECTION_RULES });
    expect(screen.getByLabelText('Voter rules for this item')).toHaveValue('bylaws');
    await user.selectOptions(screen.getByLabelText('Voter rules for this item'), 'same');
    expect(onApply).toHaveBeenCalledWith({
      eligibility_kind: null,
      eligibility_rules: null,
      eligibility_override_reason: null,
    });
  });

  it('saves custom rules only with a reason', async () => {
    const user = userEvent.setup();
    renderRules();
    await user.selectOptions(screen.getByLabelText('Voter rules for this item'), 'custom');
    // Drafted from the election's rules; nothing is saved yet.
    const probationary = screen.getByRole('group', { name: 'Probationary members' });
    await user.selectOptions(within(probationary).getByLabelText('May vote'), 'yes');
    expect(onApply).not.toHaveBeenCalled();

    const save = screen.getByRole('button', { name: 'Save item rules' });
    expect(save).toBeDisabled();
    await user.type(screen.getByLabelText(/Why does this item follow different rules/), 'Bylaws Article XII');
    await user.click(save);

    const [sent] = onApply.mock.calls[0] as [Partial<BallotItem>];
    expect(sent.eligibility_kind).toBeNull();
    expect(sent.eligibility_rules?.types?.probationary).toEqual({ may_vote: true, wait: null, attendance: [] });
    expect(sent.eligibility_override_reason).toBe('Bylaws Article XII');
  });

  it('shows an item’s custom rules and its reason', () => {
    renderRules({
      ...ITEM,
      eligibility_rules: ELECTION_RULES,
      eligibility_override_reason: 'Board only',
    });
    expect(screen.getByLabelText('Voter rules for this item')).toHaveValue('custom');
    const summary = screen.getByTestId('ballot-item-bylaws-iv-voter-rules-summary');
    expect(summary).toHaveTextContent('Probationary members may not vote');
    expect(summary).toHaveTextContent('Reason: Board only');
  });
});
