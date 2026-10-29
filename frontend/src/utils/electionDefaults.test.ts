import { describe, it, expect } from 'vitest';
import { BUILT_IN_ELECTION_DEFAULTS, describeQuorum, electionDefaultsFrom } from './electionDefaults';

describe('electionDefaultsFrom', () => {
  it('is the built-in starting values when nothing is saved', () => {
    expect(electionDefaultsFrom({})).toEqual(BUILT_IN_ELECTION_DEFAULTS);
  });

  it('takes a winner rule the form offers', () => {
    const d = electionDefaultsFrom({ default_voting_method: 'ranked_choice', default_victory_condition: 'majority' });
    expect([d.voting_method, d.victory_condition]).toEqual(['ranked_choice', 'majority']);
  });

  // The form submits whatever it starts with, so a pair it cannot show would
  // be sent unseen.
  it('falls back for a method and condition the form does not offer together', () => {
    const d = electionDefaultsFrom({ default_voting_method: 'approval', default_victory_condition: 'threshold' });
    expect([d.voting_method, d.victory_condition]).toEqual(['simple_majority', 'most_votes']);
  });

  it('keeps a percentage only for a rule that asks for one', () => {
    expect(
      electionDefaultsFrom({
        default_voting_method: 'simple_majority',
        default_victory_condition: 'threshold',
        default_victory_percentage: 60,
      }).victory_percentage
    ).toBe(60);
    expect(
      electionDefaultsFrom({
        default_voting_method: 'simple_majority',
        default_victory_condition: 'majority',
        default_victory_percentage: 60,
      }).victory_percentage
    ).toBeUndefined();
  });

  it('drops a quorum the create schema would refuse', () => {
    expect(electionDefaultsFrom({ default_quorum_type: 'percentage', default_quorum_value: null }).quorum_type).toBe(
      'none'
    );
    expect(electionDefaultsFrom({ default_quorum_type: 'percentage', default_quorum_value: 150 }).quorum_type).toBe(
      'none'
    );
    expect(electionDefaultsFrom({ default_quorum_type: 'count', default_quorum_value: 150 })).toMatchObject({
      quorum_type: 'count',
      quorum_value: 150,
    });
  });
});

describe('describeQuorum', () => {
  it('names the quorum, or nothing when there is none', () => {
    expect(describeQuorum({ quorum_type: 'percentage', quorum_value: 51 })).toBe('51% of eligible voters must vote');
    expect(describeQuorum({ quorum_type: 'count', quorum_value: 1 })).toBe('1 voter must vote');
    expect(describeQuorum({ quorum_type: 'none', quorum_value: undefined })).toBeNull();
  });
});
