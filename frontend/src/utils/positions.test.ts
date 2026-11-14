import { describe, expect, it } from 'vitest';
import { groupPositionsByKind, isCommittee, mirrorsRank, withoutRankMirrors } from './positions';

describe('positions', () => {
  const member = { id: 'member', mirrors_rank: false };
  const firefighter = { id: 'firefighter', mirrors_rank: true };
  // A fixture, or a response cached before the flag shipped.
  const unflagged = { id: 'secretary', mirrors_rank: undefined };

  it('reads the server flag and nothing else', () => {
    expect(mirrorsRank(member)).toBe(false);
    expect(mirrorsRank(firefighter)).toBe(true);
    expect(mirrorsRank(unflagged)).toBe(false);
  });

  it('keeps every position that is not a rank mirror, in order', () => {
    expect(withoutRankMirrors([firefighter, member, unflagged])).toEqual([member, unflagged]);
  });
});

describe('groupPositionsByKind', () => {
  const position = (slug: string, kind?: 'office' | 'committee' | 'system', mirrors = false) => ({
    slug,
    kind,
    mirrors_rank: mirrors,
  });

  it('splits offices from committees and leaves out the platform positions', () => {
    const { offices, committees } = groupPositionsByKind([
      position('member', 'system'),
      position('captain', 'system', true),
      position('treasurer', 'office'),
      position('history_committee', 'committee'),
      position('quartermaster', 'office'),
    ]);
    expect(offices.map((p) => p.slug)).toEqual(['treasurer', 'quartermaster']);
    expect(committees.map((p) => p.slug)).toEqual(['history_committee']);
  });

  it('treats a position with no kind as an office', () => {
    const { offices, committees } = groupPositionsByKind([position('bingo_crew')]);
    expect(offices.map((p) => p.slug)).toEqual(['bingo_crew']);
    expect(committees).toEqual([]);
  });

  it('isCommittee reads the kind', () => {
    expect(isCommittee(position('x', 'committee'))).toBe(true);
    expect(isCommittee(position('x', 'office'))).toBe(false);
    expect(isCommittee(position('x'))).toBe(false);
  });
});
