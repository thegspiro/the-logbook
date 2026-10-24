/**
 * The Administration section, rendered, for each administrator it admits.
 *
 * Separate from the source-parsing checks in `navGateIntegrity.test.ts`, and
 * deliberately so: those read one entry's gate out of the file, which cannot
 * see that the entry is never constructed because its parent section turned
 * the viewer away first. That is exactly what happened when `/inventory/admin`
 * was widened to admit the checklist officer -- the row's own gate accepted
 * them, `ADMIN_NAVIGATION_PERMISSIONS` did not, and the parsing test passed
 * while the navigation showed nothing. A gate is only reachable if every gate
 * above it also opens.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';

const mockCheckPermission = vi.fn();

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));

vi.mock('../../stores/authStore', () => ({
  useAuthStore: (selector?: (s: { checkPermission: (p: string) => boolean }) => unknown) => {
    const state = { checkPermission: (...args: unknown[]) => mockCheckPermission(...args) as boolean };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

vi.mock('../../hooks/useEnabledModules', () => ({
  useEnabledModules: () => ({ isModuleOn: () => true, isLoading: false }),
}));

vi.mock('../../hooks/useNotificationCount', () => ({
  useNotificationCountStore: (selector: (s: { unreadCount: number }) => unknown) => selector({ unreadCount: 0 }),
}));

vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));

vi.mock('../../stores/pendingSyncStore', () => ({
  usePendingSyncStore: (selector: (s: { count: number; status: string }) => unknown) =>
    selector({ count: 0, status: 'idle' }),
}));

vi.mock('../../hooks/useOfflineSyncEngine', () => ({ triggerOfflineDrain: vi.fn() }));

// Integration types the department has connected. Cleared before every test,
// so only a block that connects one sees the rows it puts in the menu.
const connectedIntegrations = new Set<string>();

vi.mock('../../hooks/useConnectedIntegrations', () => ({
  useConnectedIntegrations: () => ({
    connected: connectedIntegrations,
    loading: false,
    isConnected: (type: string) => connectedIntegrations.has(type),
  }),
}));

beforeEach(() => {
  connectedIntegrations.clear();
});

import { SideNavigation } from './SideNavigation';
import { TopNavigation } from './TopNavigation';
import { OPEN_MOBILE_NAV_EVENT } from './BottomNavigation';
import { NFC_ID_CARDS_INTEGRATION } from '../../modules/membership/constants/idCards';

describe('the checklist officer can find the console they administer', () => {
  beforeEach(() => {
    mockCheckPermission.mockReset();
    // The seeded officer's whole administrative grant. `checkPermission` is
    // exact match plus module wildcard, so this implies neither
    // `inventory.manage` nor `inventory.check_view`.
    mockCheckPermission.mockImplementation((permission: string) => permission === 'inventory.check_manage');
  });

  it('offers Inventory Admin in the side navigation', () => {
    renderWithRouter(<SideNavigation departmentName="Test FD" logoPreview={null} onLogout={vi.fn()} />);

    // Both are needed: the section is what the parent gate withholds, and the
    // row is what the child gate withholds. Asserting only the row would pass
    // on a build where the section renders for everybody.
    expect(screen.getByText('Administration')).toBeInTheDocument();
    // A nav row is a button here, not an anchor -- it navigates through the
    // router rather than through an href.
    expect(screen.getByRole('button', { name: /Inventory Admin/ })).toBeInTheDocument();
  });

  it('offers Inventory Admin in the top navigation', async () => {
    const user = userEvent.setup();
    renderWithRouter(<TopNavigation departmentName="Test FD" logoPreview={null} onLogout={vi.fn()} />);
    act(() => {
      window.dispatchEvent(new CustomEvent(OPEN_MOBILE_NAV_EVENT));
    });

    // The entry lives inside the Admin dropdown, which renders its contents
    // only once opened. That the trigger exists at all is the parent gate.
    const trigger = screen.getAllByRole('button', { name: 'Admin' })[0];
    expect(trigger, 'no Admin group for the checklist officer').toBeDefined();
    await user.click(trigger as HTMLElement);

    expect(screen.getByRole('link', { name: /Inventory Admin/ })).toHaveAttribute('href', '/inventory/admin');
  });

  it('still shows nothing to a member holding no administrative grant', () => {
    // The other half: a section that renders for everyone would satisfy the
    // assertions above without admitting anybody in particular.
    mockCheckPermission.mockReturnValue(false);
    renderWithRouter(<SideNavigation departmentName="Test FD" logoPreview={null} onLogout={vi.fn()} />);

    expect(screen.queryByText('Administration')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Inventory Admin/ })).not.toBeInTheDocument();
  });
});

describe('the scheduling officer can find the schedule they administer', () => {
  beforeEach(() => {
    mockCheckPermission.mockReset();
    // A scheduling officer holding nothing else administrative. Before
    // Scheduling Administration existed, `scheduling.manage` was absent from
    // ADMIN_NAVIGATION_PERMISSIONS, so this viewer never saw the section open
    // at all — the same shape of failure the checklist officer hit above.
    mockCheckPermission.mockImplementation((permission: string) => permission === 'scheduling.manage');
  });

  it('offers Scheduling Admin in the side navigation', () => {
    renderWithRouter(<SideNavigation departmentName="Test FD" logoPreview={null} onLogout={vi.fn()} />);

    expect(screen.getByText('Administration')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Scheduling Admin/ })).toBeInTheDocument();
  });

  it('offers Scheduling Admin in the top navigation', async () => {
    const user = userEvent.setup();
    renderWithRouter(<TopNavigation departmentName="Test FD" logoPreview={null} onLogout={vi.fn()} />);
    act(() => {
      window.dispatchEvent(new CustomEvent(OPEN_MOBILE_NAV_EVENT));
    });

    const trigger = screen.getAllByRole('button', { name: 'Admin' })[0];
    expect(trigger, 'no Admin group for the scheduling officer').toBeDefined();
    await user.click(trigger as HTMLElement);

    expect(screen.getByRole('link', { name: /Scheduling Admin/ })).toHaveAttribute('href', '/scheduling/admin');
  });
});

describe('a training officer is not an administrator of the schedule', () => {
  beforeEach(() => {
    mockCheckPermission.mockReset();
    // `training.view_all` reads training records. It briefly appeared in
    // ADMIN_NAVIGATION_PERMISSIONS, for a position roster that accepted it —
    // and opened the Administration section for a viewer no row inside it
    // admitted, which is an empty section rather than an extra page. Scheduling
    // administration is `scheduling.manage`, and this grant is not it.
    mockCheckPermission.mockImplementation((permission: string) => permission === 'training.view_all');
  });

  it('does not open the Administration section', () => {
    renderWithRouter(<SideNavigation departmentName="Test FD" logoPreview={null} onLogout={vi.fn()} />);

    expect(screen.queryByText('Administration')).not.toBeInTheDocument();
  });

  it('is not offered the Scheduling Admin row', () => {
    renderWithRouter(<SideNavigation departmentName="Test FD" logoPreview={null} onLogout={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /Scheduling Admin/ })).not.toBeInTheDocument();
  });
});

describe('a check-in station operator can find the station', () => {
  beforeEach(() => {
    mockCheckPermission.mockReset();
    // The station's own grant and nothing else: no users.view, no
    // members.manage, nothing in ADMIN_NAVIGATION_PERMISSIONS.
    mockCheckPermission.mockImplementation((permission: string) => permission === 'members.check_in');
    connectedIntegrations.add(NFC_ID_CARDS_INTEGRATION);
  });

  it('offers Check-In Station in the side navigation, and nothing else in the Members group', async () => {
    const user = userEvent.setup();
    renderWithRouter(<SideNavigation departmentName="Test FD" logoPreview={null} onLogout={vi.fn()} />);

    // The section, the group and the row each have their own gate; all three
    // must open for the row to be reachable.
    expect(screen.getByText('Administration')).toBeInTheDocument();
    const membersGroups = screen.getAllByRole('button', { name: /^Members/ });
    // The member-facing Members directory is a button too; the group is the
    // one that expands.
    const group = membersGroups.find((b) => b.hasAttribute('aria-expanded'));
    expect(group, 'no Members group in the Administration section').toBeDefined();
    await user.click(group as HTMLElement);

    expect(screen.getByRole('button', { name: /Check-In Station/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Member Management/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Scan Member ID/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Waivers/ })).not.toBeInTheDocument();
  });

  it('offers Check-In Station in the top navigation, and nothing else in Admin', async () => {
    const user = userEvent.setup();
    renderWithRouter(<TopNavigation departmentName="Test FD" logoPreview={null} onLogout={vi.fn()} />);
    act(() => {
      window.dispatchEvent(new CustomEvent(OPEN_MOBILE_NAV_EVENT));
    });

    const trigger = screen.getAllByRole('button', { name: 'Admin' })[0];
    expect(trigger, 'no Admin group for the check-in operator').toBeDefined();
    await user.click(trigger as HTMLElement);

    expect(screen.getByRole('link', { name: /Check-In Station/ })).toHaveAttribute('href', '/members/check-in-station');
    expect(screen.queryByRole('link', { name: /Member Management/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Scan Member ID/ })).not.toBeInTheDocument();
  });

  it('does not open the Administration section where the department issues no cards', () => {
    // Without the integration the row is never built, so opening the section
    // would show an empty heading.
    connectedIntegrations.clear();
    renderWithRouter(<SideNavigation departmentName="Test FD" logoPreview={null} onLogout={vi.fn()} />);

    expect(screen.queryByText('Administration')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Check-In Station/ })).not.toBeInTheDocument();
  });
});
