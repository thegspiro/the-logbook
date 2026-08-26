import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { BottomNavigation, BOTTOM_NAV_STORAGE_KEY, OPEN_MOBILE_NAV_EVENT } from './BottomNavigation';

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => mockNavigate };
});

let mockEnabled: Set<string> | null = null;
vi.mock('../../hooks/useEnabledModules', () => ({
  useEnabledModules: () => ({
    enabledModules: mockEnabled,
    isModuleOn: (k: string) => mockEnabled === null || mockEnabled.has(k),
  }),
}));

vi.mock('../../utils/routePrefetch', () => ({ prefetchRoute: vi.fn() }));
let mockPermissions = new Set<string>();
vi.mock('../../stores/authStore', () => ({
  useAuthStore: (selector: (state: { checkPermission: (permission: string) => boolean }) => unknown) =>
    selector({ checkPermission: (permission) => mockPermissions.has(permission) }),
}));

function renderBar(props: { hidden?: boolean } = {}, initialPath = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <BottomNavigation {...props} />
    </MemoryRouter>
  );
}

describe('BottomNavigation', () => {
  beforeEach(() => {
    mockEnabled = null;
    // The baseline every seeded member holds — the Store tab is gated on it.
    mockPermissions = new Set(['storefront.view']);
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('keeps Home and the three stable member slots when all modules are on', () => {
    renderBar();
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Events')).toBeInTheDocument();
    expect(screen.getByText('Store')).toBeInTheDocument();
    expect(screen.getByText('Schedule')).toBeInTheDocument();
    expect(screen.getByText('More')).toBeInTheDocument();
  });

  it('uses the same-slot fallback without reordering unrelated destinations', () => {
    mockEnabled = new Set(['training', 'members', 'events']);
    renderBar();
    const labels = screen.getAllByRole('button').map((button) => button.textContent);
    expect(screen.queryByText('Schedule')).not.toBeInTheDocument();
    expect(labels).toEqual(['Home', 'Events', 'Training', 'Documents', 'More']);
  });

  it('persists customization and safely falls back when its module is disabled', () => {
    localStorage.setItem(BOTTOM_NAV_STORAGE_KEY, JSON.stringify(['/members', '/training/my-training', '/store']));
    mockEnabled = new Set(['training']);
    const { unmount } = renderBar();
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Home',
      'Members',
      'Training',
      'Documents',
      'More',
    ]);
    unmount();
    expect(JSON.parse(localStorage.getItem(BOTTOM_NAV_STORAGE_KEY) ?? '[]')).toEqual([
      '/members',
      '/training/my-training',
      '/store',
    ]);
  });

  it('uses an administrator priority only while its permission is present', () => {
    mockPermissions.add('settings.manage');
    const { unmount } = renderBar();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    unmount();

    mockPermissions = new Set(['storefront.view']);
    renderBar();
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Schedule' })).toBeInTheDocument();
  });

  // /store requires storefront.view, and a department seeded before the
  // storefront module shipped carries a member position without it. The tab
  // used to render anyway and land the member on Access Denied.
  it('drops the Store tab when the member lacks storefront.view', () => {
    mockPermissions = new Set();
    renderBar();
    expect(screen.queryByRole('button', { name: 'Store' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Home',
      'Events',
      'Schedule',
      'Documents',
      'More',
    ]);
  });

  it('never renders more than five slots', () => {
    mockEnabled = null;
    renderBar();
    expect(screen.getAllByRole('button')).toHaveLength(5);
  });

  it('navigates on tap', async () => {
    const user = userEvent.setup();
    renderBar();
    await user.click(screen.getByText('Events'));
    expect(mockNavigate).toHaveBeenCalledWith('/events');
  });

  it('marks the active route with aria-current', () => {
    renderBar({}, '/events');
    expect(screen.getByRole('button', { name: 'Events' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Home' })).not.toHaveAttribute('aria-current');
  });

  it('treats nested routes as active', () => {
    renderBar({}, '/events/abc123');
    expect(screen.getByRole('button', { name: 'Events' })).toHaveAttribute('aria-current', 'page');
  });

  it('marks More active when the current route is not a visible tab', () => {
    renderBar({}, '/inventory');
    expect(screen.getByRole('button', { name: 'Open full navigation menu' })).toHaveAttribute('aria-current', 'page');
  });

  it('keeps every enabled destination reachable through a tab or More', async () => {
    const user = userEvent.setup();
    const listener = vi.fn();
    window.addEventListener(OPEN_MOBILE_NAV_EVENT, listener);
    mockEnabled = new Set(['storefront', 'training', 'scheduling']);
    renderBar({}, '/training/courses');

    expect(screen.getByRole('button', { name: 'Open full navigation menu' })).toHaveAttribute('aria-current', 'page');
    await user.click(screen.getByText('More'));
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(OPEN_MOBILE_NAV_EVENT, listener);
  });

  it('asks the drawer to open instead of navigating when More is tapped', async () => {
    const user = userEvent.setup();
    const listener = vi.fn();
    window.addEventListener(OPEN_MOBILE_NAV_EVENT, listener);
    renderBar();

    await user.click(screen.getByText('More'));

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: OPEN_MOBILE_NAV_EVENT }));
    expect(mockNavigate).not.toHaveBeenCalled();
    window.removeEventListener(OPEN_MOBILE_NAV_EVENT, listener);
  });

  it('renders nothing while the on-screen keyboard is up', () => {
    renderBar({ hidden: true });
    expect(screen.queryByText('Home')).not.toBeInTheDocument();
  });
});
