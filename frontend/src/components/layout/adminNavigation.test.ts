import { describe, expect, it } from 'vitest';
import { canOpenAdministrationSection, hasAdministrationAccess } from './adminNavigation';

const checkerFor =
  (...permissions: string[]) =>
  (permission: string) =>
    permissions.includes(permission);

describe('hasAdministrationAccess', () => {
  it('does not treat the regular-member forms.view permission as administrative', () => {
    expect(hasAdministrationAccess(checkerFor('forms.view'))).toBe(false);
  });

  it.each(['forms.manage', 'reports.view', 'settings.manage', 'evaluations.configure', 'evaluations.manage'])(
    'recognizes %s as administrative access',
    (permission) => {
      expect(hasAdministrationAccess(checkerFor(permission))).toBe(true);
    }
  );
});

describe('canOpenAdministrationSection', () => {
  it('opens for users.view alone (the member ID scanner lives in the section)', () => {
    expect(hasAdministrationAccess(checkerFor('users.view'))).toBe(false);
    expect(canOpenAdministrationSection(checkerFor('users.view'))).toBe(true);
  });

  it('opens for any administrative permission', () => {
    expect(canOpenAdministrationSection(checkerFor('settings.manage'))).toBe(true);
  });

  it('opens for the checklist officer, whose console is administered inside it', () => {
    // The equipment-check console is reached only through the Inventory
    // Administration hub. Without this grant here the section never renders,
    // so the hub's own entry -- however it is gated -- is never built, and the
    // officer's only route to their console is a typed URL.
    expect(canOpenAdministrationSection(checkerFor('inventory.check_manage'))).toBe(true);
  });

  it('opens for members.check_in only while the Check-In Station row exists', () => {
    // members.check_in is not administrative, and the station row is built
    // only when NFC ID cards are connected; without it the section would open
    // onto nothing.
    expect(hasAdministrationAccess(checkerFor('members.check_in'))).toBe(false);
    expect(canOpenAdministrationSection(checkerFor('members.check_in'), { checkInStationOn: true })).toBe(true);
    expect(canOpenAdministrationSection(checkerFor('members.check_in'), { checkInStationOn: false })).toBe(false);
    expect(canOpenAdministrationSection(checkerFor('members.check_in'))).toBe(false);
  });

  it('stays closed with no relevant grants', () => {
    expect(canOpenAdministrationSection(checkerFor('forms.view'))).toBe(false);
    expect(canOpenAdministrationSection(checkerFor())).toBe(false);
  });
});
