import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';

const mockAuthState: Record<string, unknown> = {
  user: {
    username: 'ffjones',
    full_name: 'Firefighter Jones',
    positions: ['firefighter'],
    permissions: ['events.view'],
  },
  checkPermission: (permission: string) => permission === 'events.view',
  hasRole: () => false,
};

vi.mock('../../stores/authStore', () => ({
  useAuthStore: vi.fn((selector?: (state: Record<string, unknown>) => unknown) =>
    selector ? selector(mockAuthState) : mockAuthState
  ),
}));

const modulesOff: string[] = [];
vi.mock('../../hooks/useEnabledModules', () => ({
  useEnabledModules: () => ({
    enabledModules: new Set<string>(),
    isModuleOn: (key: string) => !modulesOff.includes(key),
    isLoading: false,
  }),
}));

vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));

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
    localStorage.clear();
    modulesOff.length = 0;
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

  it('asks before clearing the run', async () => {
    const user = userEvent.setup();
    renderWithRouter(<TestingChecklistPage />);
    await user.type(screen.getByLabelText('Search pages'), '/dashboard');
    await user.click(within(cardFor('Dashboard')).getByRole('button', { name: 'Pass' }));

    await user.click(screen.getByRole('button', { name: /Clear run/ }));
    await user.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(within(cardFor('Dashboard')).getByRole('button', { name: 'Pass' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: /Clear run/ }));
    await user.click(screen.getByRole('button', { name: 'Clear the run' }));
    expect(within(cardFor('Dashboard')).getByRole('button', { name: 'Pass' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows the permissions the account actually holds', async () => {
    const user = userEvent.setup();
    renderWithRouter(<TestingChecklistPage />);

    await user.click(screen.getByRole('button', { name: /Show permissions/ }));

    expect(screen.getByText('events.view')).toBeInTheDocument();
  });
});
