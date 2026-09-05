/**
 * Members (roster) — permission-shaped surface.
 *
 * The roster is open to every member (`/members` carries no ProtectedRoute),
 * so the same page renders for a firefighter looking someone up and for the
 * membership coordinator working the list. These tests pin which half of the
 * page each of them gets, and that the row-click route into a member's
 * profile survives the removal of the Actions column that used to carry it.
 *
 * Both layouts are in the DOM at once: the phone cards and the desktop table
 * are separated by Tailwind's `md:hidden` / `hidden md:block`, which is CSS
 * and so does not remove either tree under jsdom. Every query below is scoped
 * to one layout or the other for that reason — an unscoped `getByText` finds
 * the member twice.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import type { User } from '../types/user';
import { UserStatus } from '../constants/enums';

const mockGetUsers = vi.fn();
const mockCheckContactInfoEnabled = vi.fn();

vi.mock('../services/api', () => ({
  userService: {
    getUsers: (...args: unknown[]) => mockGetUsers(...args) as unknown,
    checkContactInfoEnabled: (...args: unknown[]) => mockCheckContactInfoEnabled(...args) as unknown,
    deleteUserWithMode: vi.fn(),
  },
}));

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockCheckPermission = vi.fn();
const mockAuthState: Record<string, unknown> = {
  user: { id: 'me' },
  checkPermission: (...args: unknown[]) => mockCheckPermission(...args) as unknown,
};
vi.mock('../stores/authStore', () => ({
  useAuthStore: vi.fn((selector?: (state: Record<string, unknown>) => unknown) =>
    selector ? selector(mockAuthState) : mockAuthState
  ),
}));

vi.mock('../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

// Import AFTER mocks
import Members from './Members';

function makeMember(overrides: Partial<User> = {}): User {
  return {
    id: 'u1',
    organization_id: 'org-1',
    username: 'ladams',
    email: 'ladams@example.org',
    first_name: 'Laura',
    last_name: 'Adams',
    membership_number: '030',
    status: UserStatus.ACTIVE,
    hire_date: '2020-12-06',
    ...overrides,
  };
}

const ROSTER: User[] = [
  makeMember(),
  makeMember({
    id: 'u2',
    username: 'banderson',
    // Deliberately not "banderson@..." — the email is searchable for everyone,
    // so a username-shaped address would let the username-search assertions
    // below pass on the email match instead.
    email: 'brian.a@example.org',
    first_name: 'Brian',
    last_name: 'Anderson',
    membership_number: '011',
    hire_date: '2015-01-05',
  }),
];

/** The desktop table — the surface every column assertion targets. */
function table(): HTMLElement {
  return screen.getByRole('table');
}

/** The phone card list, which mirrors the table under `md:hidden`. */
function cards(): HTMLElement {
  return screen.getByRole('list', { name: 'Members' });
}

function columnLabels(): (string | undefined)[] {
  return within(table())
    .getAllByRole('columnheader')
    .map((h) => h.textContent?.trim());
}

async function renderRoster(): Promise<void> {
  renderWithRouter(<Members />);
  await screen.findByRole('table');
  expect(within(table()).getByText('Laura Adams')).toBeInTheDocument();
}

function installDefaults(canManage: boolean): void {
  // Reset rather than clear: an implementation left by a neighbouring block
  // survives vi.clearAllMocks(), and what checkPermission returns is this
  // file's entire subject (CLAUDE.md pitfall #28).
  mockGetUsers.mockReset();
  mockCheckContactInfoEnabled.mockReset();
  mockCheckPermission.mockReset();
  mockNavigate.mockReset();
  mockGetUsers.mockResolvedValue(ROSTER);
  mockCheckContactInfoEnabled.mockResolvedValue({
    enabled: true,
    show_email: true,
    show_phone: false,
    show_mobile: false,
  });
  mockCheckPermission.mockReturnValue(canManage);
}

describe('Members roster — regular member (no members.manage)', () => {
  beforeEach(() => installDefaults(false));

  it('hides the username under each member name, in both layouts', async () => {
    await renderRoster();

    expect(within(table()).getByText('Laura Adams')).toBeInTheDocument();
    expect(screen.queryByText('@ladams')).not.toBeInTheDocument();
    expect(screen.queryByText('@banderson')).not.toBeInTheDocument();
  });

  it('hides the Hire Date and Actions columns', async () => {
    await renderRoster();

    expect(columnLabels()).toEqual(expect.arrayContaining(['Member', 'Member #', 'Contact', 'Status']));
    expect(columnLabels()).not.toContain('Hire Date');
    expect(columnLabels()).not.toContain('Actions');
    expect(screen.queryByText('12/6/2020')).not.toBeInTheDocument();
  });

  it('hides bulk selection and the CSV export', async () => {
    await renderRoster();

    expect(screen.queryByLabelText('Select all members')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Select Laura Adams')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /export/i })).not.toBeInTheDocument();
  });

  it('hides the row action buttons on the phone layout too', async () => {
    await renderRoster();

    expect(within(cards()).queryByRole('button')).not.toBeInTheDocument();
    expect(within(cards()).getByRole('link', { name: 'Laura Adams' })).toBeInTheDocument();
  });

  it('titles the page as a directory rather than a management screen', async () => {
    await renderRoster();

    expect(screen.getByRole('heading', { name: 'Member Directory' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Membership Management' })).not.toBeInTheDocument();
  });

  it('opens the member profile when the row is clicked', async () => {
    const user = userEvent.setup();
    await renderRoster();

    await user.click(within(table()).getByText('030'));

    expect(mockNavigate).toHaveBeenCalledWith('/members/u1');
  });

  it('opens the member profile when the phone card is tapped', async () => {
    const user = userEvent.setup();
    await renderRoster();

    await user.click(within(cards()).getByText('#030'));

    expect(mockNavigate).toHaveBeenCalledWith('/members/u1');
  });

  it('keeps the member name a real link, so it works from the keyboard', async () => {
    await renderRoster();

    expect(within(table()).getByRole('link', { name: 'Laura Adams' })).toHaveAttribute('href', '/members/u1');
  });

  it('does not match a search against the hidden username', async () => {
    const user = userEvent.setup();
    await renderRoster();

    await user.type(screen.getByLabelText(/search by name/i), 'banderson');

    expect(await screen.findByText('No Members Found')).toBeInTheDocument();
    expect(screen.queryByText('Brian Anderson')).not.toBeInTheDocument();
  });

  it('still matches a search against name, member number and email', async () => {
    const user = userEvent.setup();
    await renderRoster();

    const search = screen.getByLabelText(/search by name/i);

    await user.type(search, 'Anderson');
    expect(await within(table()).findByText('Brian Anderson')).toBeInTheDocument();
    expect(within(table()).queryByText('Laura Adams')).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, '030');
    expect(await within(table()).findByText('Laura Adams')).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'brian.a@example.org');
    expect(await within(table()).findByText('Brian Anderson')).toBeInTheDocument();
  });

  it('leaves the roster blank when it is empty and nothing is filtered', async () => {
    mockGetUsers.mockResolvedValue([]);
    renderWithRouter(<Members />);

    // The card exists to offer Add Member / Import CSV, so a member with an
    // unfiltered empty roster gets nothing rather than a prompt they cannot act on.
    await waitFor(() => expect(mockGetUsers).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('No Members Found')).not.toBeInTheDocument());
    expect(screen.queryByText(/Get started by adding your first member/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add Member/i })).not.toBeInTheDocument();
  });

  it('still reports an empty filter result', async () => {
    const user = userEvent.setup();
    await renderRoster();

    await user.selectOptions(screen.getByRole('combobox', { name: /filter by status/i }), 'retired');

    // Feedback on the filter they chose, without the create prompt.
    expect(await screen.findByText('No Members Found')).toBeInTheDocument();
    expect(screen.getByText('Try adjusting your search or filters')).toBeInTheDocument();
    expect(screen.queryByText(/Get started by adding your first member/i)).not.toBeInTheDocument();
  });
});

describe('Members roster — membership coordinator (members.manage)', () => {
  beforeEach(() => installDefaults(true));

  it('offers the add and import prompt on an empty roster', async () => {
    mockGetUsers.mockResolvedValue([]);
    renderWithRouter(<Members />);

    expect(await screen.findByText('No Members Found')).toBeInTheDocument();
    expect(screen.getByText('Get started by adding your first member or importing from CSV')).toBeInTheDocument();
    // Two: the toolbar's, which a manager always has, plus the card's own action.
    expect(screen.getAllByRole('button', { name: /Add Member/i })).toHaveLength(2);
  });

  it('keeps the username, Hire Date and Actions columns', async () => {
    await renderRoster();

    expect(within(table()).getByText('@ladams')).toBeInTheDocument();
    expect(columnLabels()).toContain('Hire Date');
    expect(columnLabels()).toContain('Actions');
    // hire_date is a bare DATE ("2020-12-06"). It is a calendar date, so it
    // reads as the 6th here and in every other timezone -- this assertion said
    // 12/5/2020 until formatDate stopped shifting calendar dates.
    expect(within(table()).getByText('12/6/2020')).toBeInTheDocument();
  });

  it('keeps bulk selection, the CSV export and the management title', async () => {
    await renderRoster();

    expect(screen.getByLabelText('Select all members')).toBeInTheDocument();
    expect(screen.getByLabelText('Select Laura Adams')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Membership Management' })).toBeInTheDocument();
  });

  it('matches a search against the username it displays', async () => {
    const user = userEvent.setup();
    await renderRoster();

    await user.type(screen.getByLabelText(/search by name/i), 'banderson');

    expect(await within(table()).findByText('Brian Anderson')).toBeInTheDocument();
    expect(within(table()).queryByText('Laura Adams')).not.toBeInTheDocument();
  });

  it('opens the profile from a row click without tripping the selection checkbox', async () => {
    const user = userEvent.setup();
    await renderRoster();

    await user.click(screen.getByLabelText('Select Laura Adams'));
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Select Laura Adams')).toBeChecked();

    await user.click(within(table()).getByText('030'));
    expect(mockNavigate).toHaveBeenCalledWith('/members/u1');
  });

  it('does not offer to delete the signed-in member', async () => {
    mockGetUsers.mockResolvedValue([makeMember({ id: 'me', first_name: 'Me', last_name: 'Myself' })]);
    renderWithRouter(<Members />);
    await screen.findByRole('table');
    expect(within(table()).getByText('Me Myself')).toBeInTheDocument();

    expect(within(table()).getByLabelText('View or edit Me Myself')).toBeInTheDocument();
    expect(screen.queryByLabelText('Delete Me Myself')).not.toBeInTheDocument();
  });
});
