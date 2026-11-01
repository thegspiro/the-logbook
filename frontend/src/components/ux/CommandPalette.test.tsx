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

const practicalSkillsMethod = { current: null as 'skills_testing' | 'shift_signoffs' | null };
const practicalSkillsAsked = vi.fn();
vi.mock('../../stores/practicalSkillsStore', () => ({
  usePracticalSkillsMethod: (...args: unknown[]) => {
    practicalSkillsAsked(...args);
    return practicalSkillsMethod.current;
  },
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

    await user.type(screen.getByRole('combobox', { name: 'Search commands' }), 'facilities');
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

describe('CommandPalette hub destinations', () => {
  beforeEach(() => {
    practicalSkillsMethod.current = null;
    enabledModules.current = ALL;
    permissions.current = new Set(['training.manage', 'events.manage', 'members.manage', 'storefront.manage']);
    window.history.replaceState({}, '', '/');
  });

  const search = async (text: string) => {
    const user = userEvent.setup();
    renderWithRouter(<CommandPalette />);
    open();
    await user.type(screen.getByRole('combobox', { name: 'Search commands' }), text);
    return user;
  };

  // Some fifty of them; listed up front they would bury the pages the empty
  // palette is for.
  it('keeps them out of the palette until something is typed', () => {
    renderWithRouter(<CommandPalette />);
    open();

    expect(screen.queryByText('Training Admin')).not.toBeInTheDocument();
    expect(screen.queryByText('Submissions to Review')).not.toBeInTheDocument();
  });

  it('finds a training destination by name and opens it in its area', async () => {
    const user = await search('submissions');

    await user.click(screen.getByRole('option', { name: /Submissions to Review/ }));

    expect(window.location.pathname).toBe('/training/admin');
    expect(window.location.search).toBe('?page=records&tab=submissions');
  });

  it('finds a destination by what it holds, not only by its name', async () => {
    permissions.current.add('users.create');
    await search('csv file');

    expect(screen.getByRole('option', { name: /Import Members/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Import Qualifications/ })).toBeInTheDocument();
  });

  // Three hubs have a "Settings": the section heading and the line under
  // each say which is which.
  it('tells same-named sections apart by hub and description', async () => {
    await search('settings');

    expect(screen.getByText('Events Admin')).toBeInTheDocument();
    expect(screen.getByText('Members Admin')).toBeInTheDocument();
    expect(screen.getByText('Store Admin')).toBeInTheDocument();
    expect(screen.getByText('Payment methods, pricing and notices')).toBeInTheDocument();
  });

  it('opens the store console at the chosen tab', async () => {
    const user = await search('payments that need');

    await user.click(screen.getByRole('option', { name: /Payments/ }));

    expect(window.location.pathname).toBe('/inventory/admin/store');
    expect(window.location.search).toBe('?tab=payments');
  });

  it('offers nothing in a hub the member cannot open', async () => {
    permissions.current = new Set(['events.manage']);
    await search('submissions');

    expect(screen.getByText('No results found for "submissions"')).toBeInTheDocument();
  });

  it('withholds a members tab that needs a grant of its own', async () => {
    permissions.current = new Set(['members.manage']);
    await search('import');

    expect(screen.getByRole('option', { name: /Import Qualifications/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Import Members/ })).not.toBeInTheDocument();
  });

  it('withholds a hub whose module is off', async () => {
    const withoutStore = new Set(ALL);
    withoutStore.delete('storefront');
    enabledModules.current = withoutStore;
    await search('catalog');

    expect(screen.queryByText('Store Admin')).not.toBeInTheDocument();
  });

  // Create Event and Add Member are already actions; the hub does not add a
  // second copy of either.
  it('offers a destination that is already an action once', async () => {
    permissions.current = new Set(['events.manage', 'members.manage', 'users.create']);
    await search('create event');
    expect(screen.getAllByRole('option', { name: /Create Event/ })).toHaveLength(1);
  });

  // The department runs one practical-skills system; the other's screens are
  // hidden in the hub, so the palette must not offer a way round that.
  it('leaves out the skills-test screens for a shift sign-off department', async () => {
    practicalSkillsMethod.current = 'shift_signoffs';
    await search('skills test');

    expect(screen.queryByRole('option', { name: /Skills Test Records/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Skills Test Templates/ })).not.toBeInTheDocument();
  });

  it('leaves out the sign-off catalog for a Skills Testing department', async () => {
    practicalSkillsMethod.current = 'skills_testing';
    await search('skill');

    expect(screen.getByRole('option', { name: /Skills Test Records/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Skill Evaluations/ })).not.toBeInTheDocument();
  });
});

// The palette is on every page; asking for the Training module's setting while
// that module is off drew a refused request on each one.
describe('CommandPalette practical-skills lookup', () => {
  beforeEach(() => {
    practicalSkillsAsked.mockReset();
    practicalSkillsMethod.current = null;
  });

  it('does not ask for the setting while Training is off', () => {
    enabledModules.current = new Set(['members', 'events']);
    renderWithRouter(<CommandPalette />);

    expect(practicalSkillsAsked).toHaveBeenCalled();
    expect(practicalSkillsAsked.mock.calls.every(([enabled]) => enabled === false)).toBe(true);
  });

  it('asks while Training is on', () => {
    enabledModules.current = new Set(['members', 'training']);
    renderWithRouter(<CommandPalette />);

    expect(practicalSkillsAsked).toHaveBeenLastCalledWith(true);
  });
});
