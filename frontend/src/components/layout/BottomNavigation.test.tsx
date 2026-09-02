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
    isLoading: false,
  }),
}));

// The sheet has its own suite; here it stands in for "the tab opened
// something", so a bar assertion never depends on the registry's contents.
vi.mock('./QuickAddSheet', () => ({
  QuickAddSheet: ({ isOpen, onClose, onSelected }: { isOpen: boolean; onClose: () => void; onSelected: () => void }) =>
    isOpen ? (
      <div data-testid="quick-add-sheet">
        <button onClick={onClose}>dismiss sheet</button>
        <button onClick={onSelected}>choose row</button>
      </div>
    ) : null,
}));

/**
 * The real selector by default — the Add tab's presence should be wired to the
 * actual registry, not to a fixture. One test forces the empty case, which the
 * shipped registry cannot reach because it carries rows no gate can remove.
 */
let mockQuickAddEmpty = false;
vi.mock('./quickAddActions', async () => {
  const actual = await vi.importActual<typeof import('./quickAddActions')>('./quickAddActions');
  return {
    ...actual,
    availableQuickAddActions: (
      isModuleOn: (key: string) => boolean,
      checkPermission: (permission: string) => boolean
    ) => (mockQuickAddEmpty ? [] : actual.availableQuickAddActions(isModuleOn, checkPermission)),
  };
});

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
    mockQuickAddEmpty = false;
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('keeps Home, the two stable member slots and Quick Add when all modules are on', () => {
    renderBar();
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Home',
      'Events',
      'Add',
      'Schedule',
      'More',
    ]);
  });

  it('uses the same-slot fallback without reordering unrelated destinations', () => {
    mockEnabled = new Set(['training', 'members', 'events']);
    renderBar();
    const labels = screen.getAllByRole('button').map((button) => button.textContent);
    expect(screen.queryByText('Schedule')).not.toBeInTheDocument();
    expect(labels).toEqual(['Home', 'Events', 'Add', 'Training', 'More']);
  });

  it('persists customization and safely falls back when its module is disabled', () => {
    localStorage.setItem(BOTTOM_NAV_STORAGE_KEY, JSON.stringify(['/members', '/training/my-training', '/store']));
    mockEnabled = new Set(['training']);
    const { unmount } = renderBar();
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Home',
      'Members',
      'Add',
      'Training',
      'More',
    ]);
    unmount();
    // A three-entry preference written before Quick Add shipped keeps its
    // first two and is left intact on disk — the third is not discarded, it is
    // simply not rendered while the centre of the bar is the action.
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
      'Add',
      'Schedule',
      'More',
    ]);
  });

  it('never renders more than five slots', () => {
    mockEnabled = null;
    renderBar();
    expect(screen.getAllByRole('button')).toHaveLength(5);
  });

  it('puts Quick Add in the centre, under the thumb', () => {
    renderBar();
    const labels = screen.getAllByRole('button').map((button) => button.textContent);
    expect(labels.indexOf('Add')).toBe(2);
  });

  it('opens the sheet on tap rather than navigating', async () => {
    const user = userEvent.setup();
    renderBar();
    expect(screen.queryByTestId('quick-add-sheet')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(screen.getByTestId('quick-add-sheet')).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  // The bar is hidden while any overlay is open, and the sheet is what makes
  // that true of itself. Rendered inside the nav it would unmount the moment
  // it opened; the assertion is that the sheet survives the bar going away.
  it('keeps the sheet mounted once the bar hides behind it', async () => {
    const user = userEvent.setup();
    const { rerender } = renderBar();
    await user.click(screen.getByRole('button', { name: 'Add' }));

    rerender(
      <MemoryRouter initialEntries={['/dashboard']}>
        <BottomNavigation hidden />
      </MemoryRouter>
    );

    expect(screen.queryByText('Home')).not.toBeInTheDocument();
    expect(screen.getByTestId('quick-add-sheet')).toBeInTheDocument();
  });

  // The sheet's arrival removes the button that opened it, so the focus trap
  // restores focus to a detached node — a silent no-op that drops the member
  // on <body>. Measured on a real phone viewport before this was added.
  it('returns focus to the Add tab after a dismissal', async () => {
    const user = userEvent.setup();
    renderBar();
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('button', { name: 'dismiss sheet' }));

    expect(screen.queryByTestId('quick-add-sheet')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toHaveFocus();
  });

  // Choosing a row hands the member a new page; dragging focus back onto the
  // bar behind it would announce "Add button" instead of where they landed.
  it('leaves focus alone when a row was chosen', async () => {
    const user = userEvent.setup();
    renderBar();
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('button', { name: 'choose row' }));

    expect(screen.queryByTestId('quick-add-sheet')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).not.toHaveFocus();
  });

  it('drops the Add tab rather than offering an empty sheet', () => {
    mockQuickAddEmpty = true;
    renderBar();
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Home',
      'Events',
      'Schedule',
      'More',
    ]);
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
