import { describe, expect, it } from 'vitest';
import { mirrorsRank, withoutRankMirrors } from './positions';

describe('positions', () => {
  const member = { id: 'member', mirrors_rank: false };
  const firefighter = { id: 'firefighter', mirrors_rank: true };
  // A fixture, or a response cached before the flag shipped.
  const unflagged = { id: 'secretary' };

  it('reads the server flag and nothing else', () => {
    expect(mirrorsRank(member)).toBe(false);
    expect(mirrorsRank(firefighter)).toBe(true);
    expect(mirrorsRank(unflagged)).toBe(false);
  });

  it('keeps every position that is not a rank mirror, in order', () => {
    expect(withoutRankMirrors([firefighter, member, unflagged])).toEqual([member, unflagged]);
  });
});
