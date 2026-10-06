/**
 * The choice logic both ballots share (2026-10-05 ballot convergence): the
 * emailed ballot and the in-app tab read an item and send a selection the
 * same way, so a race cannot be pick-one in one and "choose up to 2" in the
 * other again.
 */
import { describe, it, expect } from 'vitest';
import type { BallotItem, Candidate } from '../../types/election';
import { candidatesForItem, choiceLabel, choiceToVote, emptyChoice, itemForm, missingWriteIn } from './ballotChoices';

const item = (overrides: Partial<BallotItem> = {}): BallotItem => ({
  id: 'chief',
  type: 'officer_election',
  title: 'Chief',
  position: 'Chief',
  eligible_voter_types: ['all'],
  vote_type: 'candidate_selection',
  ...overrides,
});

const candidate = (id: string, position: string, name = id): Candidate =>
  ({ id, name, position, accepted: true, is_write_in: false }) as unknown as Candidate;

const settings = { allow_write_ins: false, voting_method: 'simple_majority', max_votes_per_position: 1 };

describe('ballotChoices', () => {
  it('reads a race as pick-one, multi-select up to the cap, ranked, or yes/no', () => {
    expect(itemForm(item(), settings)).toMatchObject({ isMultiSelect: false, isRanked: false, selectionCap: 1 });
    expect(itemForm(item(), { ...settings, max_votes_per_position: 2 })).toMatchObject({
      isMultiSelect: true,
      selectionCap: 2,
    });
    expect(itemForm(item({ voting_method: 'ranked_choice' }), settings).isRanked).toBe(true);
    expect(itemForm(item({ voting_method: 'approval' }), settings)).toMatchObject({
      isMultiSelect: true,
      selectionCap: null,
    });
    expect(itemForm(item({ vote_type: 'approval' }), settings).isApprovalType).toBe(true);
  });

  it('matches a legacy item by title or id, and an explicit one by position only', () => {
    const pool = [candidate('a', 'Chief'), candidate('b', 'legacy-id'), candidate('c', 'Legacy Title')];
    expect(candidatesForItem(item(), pool).map((c) => c.id)).toEqual(['a']);
    expect(
      candidatesForItem(item({ id: 'legacy-id', title: 'Legacy Title', position: undefined }), pool).map((c) => c.id)
    ).toEqual(['b', 'c']);
  });

  it('sends each selection form the server accepts', () => {
    expect(choiceToVote('x', { ...emptyChoice(), choice: 'approve' })).toEqual({
      ballot_item_id: 'x',
      choice: 'approve',
      write_in_name: undefined,
    });
    expect(choiceToVote('x', { ...emptyChoice(), choice: '', candidate_ids: ['a', 'b'] })).toEqual({
      ballot_item_id: 'x',
      candidate_ids: ['a', 'b'],
    });
    expect(choiceToVote('x', { ...emptyChoice(), choice: '', ranks: { b: 1, a: 2 } })).toEqual({
      ballot_item_id: 'x',
      rankings: ['b', 'a'],
    });
    expect(choiceToVote('x', { ...emptyChoice(), choice: 'write_in', write_in_name: ' Dana ' })).toEqual({
      ballot_item_id: 'x',
      choice: 'write_in',
      write_in_name: 'Dana',
    });
  });

  it('labels a selection and finds an unnamed write-in', () => {
    const pool = [candidate('a', 'Chief', 'Alice')];
    expect(choiceLabel({ ...emptyChoice(), choice: 'a' }, pool)).toBe('Alice');
    expect(choiceLabel(undefined, pool)).toBe('Abstain (No Vote)');
    expect(missingWriteIn({ chief: { ...emptyChoice(), choice: 'write_in' } }, [item()])?.id).toBe('chief');
    expect(missingWriteIn({ chief: emptyChoice() }, [item()])).toBeUndefined();
  });
});
