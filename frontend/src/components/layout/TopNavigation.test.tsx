import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import { TopNavigation } from './TopNavigation';
import { OPEN_MOBILE_NAV_EVENT } from './BottomNavigation';

const { mockCheckPermission } = vi.hoisted(() => ({ mockCheckPermission: vi.fn() }));

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));

vi.mock('../../stores/authStore', () => ({
  useAuthStore: () => ({ checkPermission: mockCheckPermission }),
}));

vi.mock('../../hooks/useEnabledModules', () => ({
  useEnabledModules: () => ({ isModuleOn: () => true }),
}));

vi.mock('../../hooks/useNotificationCount', () => ({
  useNotificationCountStore: (selector: (s: { unreadCount: number }) => unknown) => selector({ unreadCount: 0 }),
}));

vi.mock('../../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

vi.mock('../../stores/pendingSyncStore', () => ({
  usePendingSyncStore: (selector: (s: { count: number; status: string }) => unknown) =>
    selector({ count: 0, status: 'idle' }),
}));

vi.mock('../../hooks/useOfflineSyncEngine', () => ({
  triggerOfflineDrain: vi.fn(),
}));

const fireMoreEvent = () => {
  act(() => {
    window.dispatchEvent(new CustomEvent(OPEN_MOBILE_NAV_EVENT));
  });
};

const renderNav = () =>
  renderWithRouter(<TopNavigation departmentName="Test FD" logoPreview={null} onLogout={vi.fn()} />);

const mobileMenu = () => screen.queryByRole('navigation', { name: 'Mobile navigation' });

describe('TopNavigation mobile menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckPermission.mockReturnValue(false);
  });

  it('stays closed until the bottom bar asks for it', () => {
    renderNav();
    expect(mobileMenu()).not.toBeInTheDocument();
  });

  // The bar's "More" button stays visible above the backdrop, so a second tap
  // must close the menu — with open-only semantics the menu could previously
  // only be dismissed by navigating somewhere.
  it('toggles open and closed on the bottom bar "More" event', () => {
    renderNav();

    fireMoreEvent();
    expect(mobileMenu()).toBeInTheDocument();

    fireMoreEvent();
    expect(mobileMenu()).not.toBeInTheDocument();
  });

  it('closes when the backdrop is clicked', () => {
    renderNav();
    fireMoreEvent();
    expect(mobileMenu()).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('mobile-menu-backdrop'));

    expect(mobileMenu()).not.toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    renderNav();
    fireMoreEvent();
    expect(mobileMenu()).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(mobileMenu()).not.toBeInTheDocument();
  });

  it('renders no backdrop while closed', () => {
    renderNav();
    expect(screen.queryByTestId('mobile-menu-backdrop')).not.toBeInTheDocument();
  });

  it('offers one shared Inventory Admin entry to a storefront-only administrator', async () => {
    const user = userEvent.setup();
    mockCheckPermission.mockImplementation((permission: string) => permission === 'storefront.manage');
    renderNav();
    fireMoreEvent();
    await user.click(screen.getAllByRole('button', { name: 'Admin' }).at(-1));

    expect(screen.getByRole('link', { name: 'Inventory Admin' })).toHaveAttribute('href', '/inventory/admin');
    expect(screen.queryByRole('link', { name: 'Store Admin' })).not.toBeInTheDocument();
  });
});
