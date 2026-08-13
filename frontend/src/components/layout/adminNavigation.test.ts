import { describe, expect, it } from 'vitest';
import { hasAdministrationAccess } from './adminNavigation';

const checkerFor =
  (...permissions: string[]) =>
  (permission: string) =>
    permissions.includes(permission);

describe('hasAdministrationAccess', () => {
  it('does not treat the regular-member forms.view permission as administrative', () => {
    expect(hasAdministrationAccess(checkerFor('forms.view'))).toBe(false);
  });

  it.each(['forms.manage', 'reports.view', 'settings.manage'])(
    'recognizes %s as administrative access',
    (permission) => {
      expect(hasAdministrationAccess(checkerFor(permission))).toBe(true);
    }
  );
});
