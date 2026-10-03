import { describe, expect, it } from 'vitest';
import { canViewMemberIdCard } from './memberIdCardAccess';

const grants =
  (...granted: string[]) =>
  (permission: string) =>
    granted.includes(permission);

describe('canViewMemberIdCard', () => {
  it('lets every member open their own card, with no permissions at all', () => {
    expect(canViewMemberIdCard('me', 'me', grants())).toBe(true);
  });

  it('does not let a plain member open a colleague card, even with the directory permission', () => {
    expect(canViewMemberIdCard('me', 'them', grants('members.view'))).toBe(false);
  });

  it('does not treat scanning grants as a licence to view the badge', () => {
    expect(canViewMemberIdCard('me', 'them', grants('users.view', 'members.check_in'))).toBe(false);
  });

  it.each(['members.manage', 'members.manage_id_cards'])('lets a holder of %s open a colleague card', (permission) => {
    expect(canViewMemberIdCard('me', 'them', grants(permission))).toBe(true);
  });

  it('refuses when either id is missing rather than guessing', () => {
    expect(canViewMemberIdCard(undefined, 'them', grants('members.manage'))).toBe(false);
    expect(canViewMemberIdCard('me', undefined, grants('members.manage'))).toBe(false);
  });
});
