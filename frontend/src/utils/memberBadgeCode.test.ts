import { describe, it, expect } from 'vitest';
import { matchesMemberBadgeCode, memberShortId } from './memberBadgeCode';

const member = { id: '1996d34a-56fe-42b1-9848-c1404ae55992', membership_number: null };

describe('matchesMemberBadgeCode (workflow review W14)', () => {
  it('builds the short id the way the badge printer does', () => {
    // label_service._short_id: dashes removed, first twelve, upper-case.
    expect(memberShortId(member.id)).toBe('1996D34A56FE');
  });

  // A badge printed for a member with no membership number carries the short
  // id, and both scanners answered "No member found" for it.
  it('resolves a badge printed without a membership number', () => {
    expect(matchesMemberBadgeCode('1996D34A56FE', member)).toBe(true);
    expect(matchesMemberBadgeCode(' 1996d34a56fe\n', member)).toBe(true);
  });

  it('still resolves a membership number, case-insensitively', () => {
    expect(matchesMemberBadgeCode('rv-0150', { ...member, membership_number: 'RV-0150' })).toBe(true);
  });

  it('does not match a shorter prefix or an unrelated code', () => {
    expect(matchesMemberBadgeCode('1996D34A', member)).toBe(false);
    expect(matchesMemberBadgeCode('FFFFFFFFFFFF', member)).toBe(false);
    expect(matchesMemberBadgeCode('', member)).toBe(false);
  });
});
