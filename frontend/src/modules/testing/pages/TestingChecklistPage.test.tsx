import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

// Mutable so a test can re-run the same screen as a different account, which
// is the whole method the page exists to support.
let currentPermissions = ['events.view'];
const mockAuthState: Record<string, unknown> = {
  user: {
    username: 'ffjones',
    full_name: 'Firefighter Jones',
    positions: ['firefighter'],
    get permissions() {
      return currentPermissions;
    },
  },
  checkPermission: (permission: string) => currentPermissions.includes(permission),
  hasRole: () => false,
};

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: vi.fn((selector?: (state: Record<string, unknown>) => unknown) =>
    selector ? selector(mockAuthState) : mockAuthState
  ),
}));

const modulesOff: string[] = [];
vi.mock('../../../hooks/useEnabledModules', () => ({
  useEnabledModules: () => ({
    enabledModules: new Set<string>(),
    isModuleOn: (key: string) => !modulesOff.includes(key),
    isLoading: false,
  }),
}));

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));

// The run lives on the server; the screen is tested against the service, not
// against a browser store.
const savedEntries: TestingCheckEntry[] = [];
/** Set to make the run load fail the way a switched-off module does. */
let moduleDisabled = false;
const mockSaveEntry = vi.fn();
const mockClearRun = vi.fn();
vi.mock('../services/api', () => ({
  testingChecklistService: {
    getRun: (includeAll?: boolean) =>
      moduleDisabled
        ? Promise.reject({
            response: { status: 403, statusText: 'Forbidden', data: { detail: 'not enabled', code: 'LB-ORG-002' } },
          })
        : Promise.resolve({
            entries: savedEntries,
            includesAllTesters: Boolean(includeAll),
            testerCount: new Set(savedEntries.map((entry) => entry.userId)).size,
          }),
    saveEntry: (payload: unknown) => {
      mockSaveEntry(payload);
      return Promise.resolve({ ...(payload as object), id: 'saved', userId: 'u1', isMine: true });
    },
    clearRun: (scope?: string) => {
      mockClearRun(scope);
      savedEntries.length = 0;
      return Promise.resolve(1);
    },
  },
}));

import type { TestingCheckEntry } from '../services/api';

// Import AFTER mocks
import { TestingChecklistPage } from './TestingChecklistPage';

/** Groups open on demand — the screen carries every route in the app. */
const openGroup = async (user: ReturnType<typeof userEvent.setup>, name: RegExp) => {
  await user.click(screen.getByRole('heading', { name }));
};

/** The box for one page — each card is a group named after the page. */
const cardFor = (label: string): HTMLElement => screen.getByRole('group', { name: label });

describe('TestingChecklistPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    savedEntries.length = 0;
    modulesOff.length = 0;
    moduleDisabled = false;
    currentPermissions = ['events.view'];
  });

  it('opens on the group headings rather than two hundred boxes', () => {
    renderWithRouter(<TestingChecklistPage />);

    expect(screen.getByRole('heading', { name: 'Testing home' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^Events/ })).toBeInTheDocument();
    expect(screen.queryByText('Event detail')).not.toBeInTheDocument();
  });

  it('links each page in an opened group', async () => {
    const user = userEvent.setup();
    renderWithRouter(<TestingChecklistPage />);
    await openGroup(user, /^Events/);

    expect(screen.getByRole('link', { name: /Events \/events/s })).toHaveAttribute('href', '/events');
  });

  it('says which pages this account cannot open', async () => {
    const user = userEvent.setup();
    renderWithRouter(<TestingChecklistPage />);
    await openGroup(user, /^Events/);

    const adminHub = cardFor('Events administration hub');
    expect(within(adminHub).getByText(/should refuse with Access Denied/)).toBeInTheDocument();
    // Named twice on purpose: on the gate badge and in the sentence below it.
    expect(within(adminHub).getAllByText('events.manage')).toHaveLength(2);
  });

  it('separates a switched-off module from a missing permission', async () => {
    const user = userEvent.setup();
    modulesOff.push('minutes');
    renderWithRouter(<TestingChecklistPage />);
    await openGroup(user, /^Meetings & minutes/);

    expect(within(cardFor('Minutes')).getByText(/module is switched off/)).toBeInTheDocument();
  });

  it('records a pass and counts it', async () => {
    const user = userEvent.setup();
    renderWithRouter(<TestingChecklistPage />);
    await openGroup(user, /^Core/);

    const dashboard = cardFor('Dashboard');
    await user.click(within(dashboard).getByRole('button', { name: 'Pass' }));

    expect(within(cardFor('Dashboard')).getByRole('button', { name: 'Pass' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('1 passed')).toBeInTheDocument();
    await waitFor(() =>
      expect(mockSaveEntry).toHaveBeenCalledWith(expect.objectContaining({ routePath: '/dashboard', status: 'pass' }))
    );
  });

  it('withholds the link until a route parameter has a value', async () => {
    const user = userEvent.setup();
    renderWithRouter(<TestingChecklistPage />);
    await openGroup(user, /^Events/);

    const detail = cardFor('Event detail');
    expect(within(detail).queryByRole('link')).not.toBeInTheDocument();

    await user.type(within(detail).getByLabelText('Sample id for Event detail'), 'evt-7');

    expect(within(cardFor('Event detail')).getByRole('link')).toHaveAttribute('href', '/events/evt-7');
  });

  it('searches by path, opening whatever still matches', async () => {
    const user = userEvent.setup();
    renderWithRouter(<TestingChecklistPage />);

    await user.type(screen.getByLabelText('Search pages'), '/minutes');

    expect(screen.getByText('Minutes detail')).toBeInTheDocument();
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
  });

  it('filters to the pages this account can open', async () => {
    const user = userEvent.setup();
    renderWithRouter(<TestingChecklistPage />);
    await user.type(screen.getByLabelText('Search pages'), 'events');

    expect(screen.getByText('Events administration hub')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Only pages I can open/ }));

    expect(screen.queryByText('Events administration hub')).not.toBeInTheDocument();
    expect(screen.getByText('Event detail')).toBeInTheDocument();
  });

  it('asks before clearing the run, and clears only your own marks', async () => {
    const user = userEvent.setup();
    renderWithRouter(<TestingChecklistPage />);
    await user.type(screen.getByLabelText('Search pages'), '/dashboard');
    await user.click(within(cardFor('Dashboard')).getByRole('button', { name: 'Pass' }));

    await user.click(screen.getByRole('button', { name: /Clear my marks/ }));
    await user.click(screen.getByRole('button', { name: 'Keep them' }));
    expect(mockClearRun).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /Clear my marks/ }));
    await user.click(screen.getByRole('button', { name: 'Delete my marks' }));
    await waitFor(() => expect(mockClearRun).toHaveBeenCalledWith('mine'));
  });

  it('does not offer to clear the department to a member', () => {
    renderWithRouter(<TestingChecklistPage />);

    expect(screen.queryByRole('button', { name: /Clear everyone/ })).not.toBeInTheDocument();
  });

  it('says the module is switched off rather than blaming the server', async () => {
    moduleDisabled = true;
    renderWithRouter(<TestingChecklistPage />);

    expect(await screen.findByText(/module is switched off for this department/)).toBeInTheDocument();
    expect(screen.queryByText(/Check the connection/)).not.toBeInTheDocument();
  });

  it('shows the permissions the account actually holds', async () => {
    const user = userEvent.setup();
    renderWithRouter(<TestingChecklistPage />);

    await user.click(screen.getByRole('button', { name: /Show permissions/ }));

    expect(screen.getByText('events.view')).toBeInTheDocument();
  });

  describe('as the IT manager', () => {
    beforeEach(() => {
      // The system owner holds the global wildcard; the screen asks for the
      // shared run on `settings.manage`, which the wildcard matches.
      currentPermissions = ['*', 'settings.manage'];
      savedEntries.push({
        id: 'theirs',
        routePath: '/events',
        status: 'blocked',
        note: 'refused as expected',
        params: null,
        checkedAt: '2026-08-27T12:00:00Z',
        userId: 'u2',
        userName: 'Firefighter Jones',
        testedAs: ['firefighter'],
        isMine: false,
      });
    });

    it('shows what every other tester found, and from which seat', async () => {
      const user = userEvent.setup();
      renderWithRouter(<TestingChecklistPage />);
      await user.type(screen.getByLabelText('Search pages'), '/events');

      const card = cardFor('Events');
      expect(within(card).getByText('Other testers')).toBeInTheDocument();
      expect(within(card).getByText(/Firefighter Jones/)).toBeInTheDocument();
      expect(within(card).getByText('(firefighter)')).toBeInTheDocument();
      expect(within(card).getByText('blocked')).toBeInTheDocument();
    });

    it('counts department-wide coverage separately from its own', async () => {
      renderWithRouter(<TestingChecklistPage />);

      expect(await screen.findByText(/Across 1 tester, 1 of \d+ pages have been checked/)).toBeInTheDocument();
      expect(screen.getByText(/0 of \d+ pages checked by you/)).toBeInTheDocument();
    });

    it('can clear the whole department, behind its own confirmation', async () => {
      const user = userEvent.setup();
      renderWithRouter(<TestingChecklistPage />);

      await user.click(screen.getByRole('button', { name: /Clear everyone/ }));
      await user.click(screen.getByRole('button', { name: 'Delete every mark' }));

      await waitFor(() => expect(mockClearRun).toHaveBeenCalledWith('all'));
    });
  });
});
