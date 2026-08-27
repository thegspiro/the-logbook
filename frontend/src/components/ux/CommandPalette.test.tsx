/**
 * The palette must not offer a module the department switched off.
 *
 * Every module's routes now carry a `requiredModule` gate, so an offer the
 * palette makes for a disabled module is not merely untidy — it navigates the
 * member into the "module is not enabled" refusal, and the palette was the
 * last surface still making those offers after the navigation stopped.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import { CommandPalette } from './CommandPalette';

const enabledModules = { current: null as Set<string> | null };
const permissions = { current: new Set<string>() };

vi.mock('../../stores/authStore', () => ({
  useAuthStore: () => ({ checkPermission: (permission: string) => permissions.current.has(permission) }),
}));

vi.mock('../../hooks/useEnabledModules', () => ({
  useEnabledModules: () => ({
    enabledModules: enabledModules.current,
    isModuleOn: (key: string) => enabledModules.current === null || enabledModules.current.has(key),
    isLoading: false,
  }),
}));

/** Ctrl+K is the only way in. */
const open = () => {
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
};

const ALL = new Set([
  'members',
  'events',
  'documents',
  'training',
  'inventory',
  'storefront',
  'scheduling',
  'facilities',
  'elections',
  'minutes',
  'notifications',
  'reports',
]);

describe('CommandPalette module gating', () => {
  beforeEach(() => {
    enabledModules.current = null;
    permissions.current = new Set([
      'facilities.view',
      'inventory.manage',
      'storefront.view',
      'locations.manage',
      'apparatus.view',
    ]);
    window.history.replaceState({}, '', '/');
  });

  const searchFacilities = async (grants: string[]) => {
    permissions.current = new Set(grants);
    enabledModules.current = ALL;
    const user = userEvent.setup();
    renderWithRouter(<CommandPalette />);
    open();

    await user.type(screen.getByRole('textbox', { name: 'Search commands' }), 'facilities');
    return user;
  };

  it('does not let an ordinary member discover Facilities', async () => {
    await searchFacilities([]);
    expect(screen.queryByText('Facilities')).not.toBeInTheDocument();
    expect(screen.getByText('No results found for "facilities"')).toBeInTheDocument();
  });

  it('lets read-only leadership discover and navigate to Facilities', async () => {
    const user = await searchFacilities(['facilities.view']);
    const entry = screen.getByText('Facilities');
    await user.click(entry);
    expect(window.location.pathname).toBe('/facilities');
  });

  it('lets a facilities manager discover and navigate to Facilities', async () => {
    const user = await searchFacilities(['facilities.manage']);
    const entry = screen.getByText('Facilities');
    await user.click(entry);
    expect(window.location.pathname).toBe('/facilities');
  });

  it('offers a module command when the module is on', () => {
    enabledModules.current = ALL;
    renderWithRouter(<CommandPalette />);
    open();

    expect(screen.getByText('My Training')).toBeInTheDocument();
    expect(screen.getByText('Elections')).toBeInTheDocument();
  });

  it('withholds every command belonging to a disabled module', () => {
    const withoutTraining = new Set(ALL);
    withoutTraining.delete('training');
    enabledModules.current = withoutTraining;
    renderWithRouter(<CommandPalette />);
    open();

    // Both the navigation entry and the action that lands in the same module.
    expect(screen.queryByText('My Training')).not.toBeInTheDocument();
    expect(screen.queryByText('Submit Training')).not.toBeInTheDocument();
    // Other modules are untouched — this is a per-module gate, not a purge.
    expect(screen.getByText('Elections')).toBeInTheDocument();
  });

  it('shows everything while the module config is unknown', () => {
    // null is "still loading, or an organization that never configured
    // modules". A module flag is not an access control, so an unknown answer
    // has to show the command rather than hide it — the same call the
    // navigation makes.
    enabledModules.current = null;
    renderWithRouter(<CommandPalette />);
    open();

    expect(screen.getByText('My Training')).toBeInTheDocument();
    expect(screen.getByText('Meeting Minutes')).toBeInTheDocument();
  });

  it('still supersedes Locations when Facilities owns it', () => {
    // The pre-existing hideWhenModuleOn rule, which runs in the same filter
    // and must not have been displaced by the one added beside it.
    enabledModules.current = ALL;
    renderWithRouter(<CommandPalette />);
    open();

    expect(screen.queryByText('Locations & Rooms')).not.toBeInTheDocument();
    expect(screen.getByText('Facilities')).toBeInTheDocument();
  });
});
