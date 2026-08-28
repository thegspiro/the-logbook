import { describe, it, expect } from 'vitest';
import { describeGate, evaluatePageAccess } from './pageAccess';

const context = (permissions: string[], modulesOff: string[] = [], roles: string[] = []) => ({
  checkPermission: (permission: string) =>
    permissions.includes('*') ||
    permissions.includes(permission) ||
    permissions.includes(`${permission.split('.')[0] ?? ''}.*`),
  hasRole: (role: string) => roles.includes(role),
  isModuleOn: (module: string) => !modulesOff.includes(module),
});

describe('evaluatePageAccess', () => {
  it('reports an ungated page as open', () => {
    expect(evaluatePageAccess({ path: '/events', label: 'Events' }, context([]))).toEqual({ kind: 'open' });
  });

  it('allows a page whose single permission the account holds', () => {
    const page = { path: '/events/admin', label: 'Events admin', permission: 'events.manage' };
    expect(evaluatePageAccess(page, context(['events.manage']))).toEqual({ kind: 'allowed' });
  });

  it('names the permission a refused page needs', () => {
    const page = { path: '/events/admin', label: 'Events admin', permission: 'events.manage' };
    expect(evaluatePageAccess(page, context(['events.view']))).toEqual({
      kind: 'denied',
      missing: ['events.manage'],
    });
  });

  it('does not read a manage grant as a view grant', () => {
    // checkPermission is exact match plus the module wildcard only.
    const page = { path: '/medical-supplies', label: 'Medical', anyPermission: ['inventory.view_medical'] };
    expect(evaluatePageAccess(page, context(['inventory.manage'])).kind).toBe('denied');
  });

  it('honours the module wildcard', () => {
    const page = { path: '/settings', label: 'Settings', permission: 'settings.manage' };
    expect(evaluatePageAccess(page, context(['settings.*'])).kind).toBe('allowed');
  });

  it('opens everything for the global wildcard', () => {
    const page = { path: '/settings', label: 'Settings', permission: 'settings.manage' };
    expect(evaluatePageAccess(page, context(['*'])).kind).toBe('allowed');
  });

  it('accepts any one of an any-of gate', () => {
    const page = { path: '/apparatus', label: 'Apparatus', anyPermission: ['apparatus.view', 'apparatus.manage'] };
    expect(evaluatePageAccess(page, context(['apparatus.manage'])).kind).toBe('allowed');
  });

  it('separates a switched-off module from a missing grant', () => {
    const page = { path: '/store', label: 'Store', permission: 'storefront.view', module: 'storefront' };
    expect(evaluatePageAccess(page, context(['storefront.view'], ['storefront']))).toEqual({
      kind: 'module-off',
      module: 'storefront',
    });
    // A missing grant is reported first: it refuses before the module gate is
    // ever reached, which is the order ProtectedRoute applies them in.
    expect(evaluatePageAccess(page, context([], ['storefront'])).kind).toBe('denied');
  });

  it('checks the required role', () => {
    const page = { path: '/x', label: 'X', role: 'admin' };
    expect(evaluatePageAccess(page, context([], [], ['admin'])).kind).toBe('allowed');
    expect(evaluatePageAccess(page, context([])).kind).toBe('denied');
  });
});

describe('describeGate', () => {
  it('reads an any-of gate as a choice', () => {
    expect(describeGate({ path: '/x', label: 'X', anyPermission: ['a.view', 'a.manage'] })).toBe('a.view or a.manage');
  });

  it('is empty for an ungated page', () => {
    expect(describeGate({ path: '/x', label: 'X' })).toBe('');
  });
});
