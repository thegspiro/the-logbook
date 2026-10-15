import { describe, it, expect } from 'vitest';
import { emptyVoteDraft, rollCallEntries, rollTotals, voteDraftPayload } from './voteDraft';

const voters = ['Pat Chief', 'Lee Treasurer', 'Max Early'];

describe('voteDraftPayload', () => {
  it('sends nothing for a motion carried without a count', () => {
    expect(voteDraftPayload(emptyVoteDraft(), voters)).toEqual({
      threshold: undefined,
      votes_for: undefined,
      votes_against: undefined,
      votes_abstain: undefined,
      votes_recused: undefined,
    });
  });

  it('sends the counts that were entered, and not the ones left blank', () => {
    const payload = voteDraftPayload(
      { ...emptyVoteDraft(), votesFor: '7', votesAgainst: '0', votesRecused: '1' },
      voters
    );
    expect(payload.votes_for).toBe(7);
    expect(payload.votes_against).toBe(0);
    expect(payload.votes_abstain).toBeUndefined();
    expect(payload.votes_recused).toBe(1);
  });

  it('treats a zero as recorded and an empty box as not', () => {
    const payload = voteDraftPayload({ ...emptyVoteDraft(), votesFor: '3', votesAgainst: '' }, voters);
    expect(payload.votes_against).toBeUndefined();
    expect(voteDraftPayload({ ...emptyVoteDraft(), votesFor: '0' }, voters).votes_for).toBe(0);
  });

  it('ignores a count that is not a whole number', () => {
    const payload = voteDraftPayload({ ...emptyVoteDraft(), votesFor: '2.5', votesAgainst: '-1' }, voters);
    expect(payload.votes_for).toBeUndefined();
    expect(payload.votes_against).toBeUndefined();
  });

  it('sends only a threshold that is not the usual one', () => {
    expect(voteDraftPayload(emptyVoteDraft(), voters).threshold).toBeUndefined();
    expect(voteDraftPayload({ ...emptyVoteDraft(), threshold: 'two_thirds' }, voters).threshold).toBe('two_thirds');
  });

  it('sends the roll call and no totals in roll-call mode, so the server counts it', () => {
    const payload = voteDraftPayload(
      {
        ...emptyVoteDraft(),
        mode: 'roll',
        votesFor: '99',
        roll: { 'Pat Chief': 'yes', 'Max Early': 'recuse' },
      },
      voters
    );
    expect(payload.roll_call).toEqual([
      { name: 'Pat Chief', vote: 'yes' },
      { name: 'Max Early', vote: 'recuse' },
    ]);
    expect(payload.votes_for).toBeUndefined();
  });

  it('sends no roll call when no one has voted', () => {
    expect(voteDraftPayload({ ...emptyVoteDraft(), mode: 'roll' }, voters).roll_call).toBeUndefined();
  });
});

describe('rollCallEntries and rollTotals', () => {
  it('lists those who voted in the order of the roll', () => {
    const draft = {
      ...emptyVoteDraft(),
      roll: { 'Max Early': 'no' as const, 'Pat Chief': 'yes' as const, 'Lee Treasurer': '' as const },
    };
    expect(rollCallEntries(draft, voters).map((e) => e.name)).toEqual(['Pat Chief', 'Max Early']);
  });

  it('ignores a vote from someone no longer on the roll', () => {
    const draft = { ...emptyVoteDraft(), roll: { 'Gone Member': 'yes' as const } };
    expect(rollCallEntries(draft, voters)).toEqual([]);
  });

  it('adds the votes up', () => {
    expect(
      rollTotals([
        { name: 'a', vote: 'yes' },
        { name: 'b', vote: 'yes' },
        { name: 'c', vote: 'no' },
        { name: 'd', vote: 'abstain' },
        { name: 'e', vote: 'recuse' },
      ])
    ).toEqual({ yes: 2, no: 1, abstain: 1, recuse: 1 });
  });
});
