import { describe, it, expect } from 'vitest';
import { ExistingMemberPolicy } from '@/constants/enums';
import { canSplitForNewMembers, existingMemberPolicyOf, grandfatheringSummary } from './requirementGrandfathering';

describe('existingMemberPolicyOf', () => {
  it('reads no cutoff as applying to everyone', () => {
    expect(existingMemberPolicyOf({})).toBe(ExistingMemberPolicy.APPLY_TO_ALL);
    expect(existingMemberPolicyOf(null)).toBe(ExistingMemberPolicy.APPLY_TO_ALL);
  });

  it('reads a cutoff alone as exempting existing members', () => {
    expect(existingMemberPolicyOf({ new_member_cutoff_date: '2026-07-01' })).toBe(ExistingMemberPolicy.EXEMPT);
  });

  it('reads a cutoff with a deadline as a catch-up period', () => {
    expect(
      existingMemberPolicyOf({ new_member_cutoff_date: '2026-07-01', existing_member_deadline: '2026-12-31' })
    ).toBe(ExistingMemberPolicy.CATCH_UP);
  });
});

describe('grandfatheringSummary', () => {
  it('says nothing for a requirement that grades everyone', () => {
    expect(grandfatheringSummary({})).toBeNull();
  });

  it('names the exempted members', () => {
    expect(grandfatheringSummary({ new_member_cutoff_date: '2026-07-01' })).toBe(
      'Members who joined before Jul 1, 2026 are exempt'
    );
  });

  it('names the catch-up deadline', () => {
    expect(
      grandfatheringSummary({ new_member_cutoff_date: '2026-07-01', existing_member_deadline: '2026-12-31' })
    ).toBe('Members who joined before Jul 1, 2026 have until Dec 31, 2026');
  });

  it('marks the earlier standard of a split', () => {
    expect(grandfatheringSummary({ applies_to_joined_before: '2026-07-01' })).toBe(
      'Earlier standard · members who joined before Jul 1, 2026'
    );
  });
});

describe('canSplitForNewMembers', () => {
  it('allows a requirement that has not been split', () => {
    expect(canSplitForNewMembers({ new_member_cutoff_date: '2026-07-01' })).toBe(true);
  });

  it('refuses the earlier standard of a past split, as the backend does', () => {
    expect(canSplitForNewMembers({ applies_to_joined_before: '2026-07-01' })).toBe(false);
    expect(canSplitForNewMembers(null)).toBe(false);
  });
});
