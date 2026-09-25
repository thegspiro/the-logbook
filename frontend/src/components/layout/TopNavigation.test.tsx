import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { screen, act, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import { TopNavigation } from './TopNavigation';
import { OPEN_MOBILE_NAV_EVENT } from './BottomNavigation';

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));

vi.mock('../../stores/authStore', () => ({
  useAuthStore: () => ({ checkPermission: () => false }),
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
});

describe('TopNavigation overflow into More', () => {
  // jsdom has no layout, so the widths the bar measures are set here. Every
  // trigger is 100px wide and the region beside the logo 350px: More (100) and
  // two groups (+4 +100 each) fit, a third would not.
  let offsetWidth: MockInstance<() => number>;
  let clientWidth: MockInstance<() => number>;

  beforeEach(() => {
    offsetWidth = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100);
    clientWidth = vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(350);
  });

  afterEach(() => {
    offsetWidth.mockRestore();
    clientWidth.mockRestore();
  });

  const mainNav = () => screen.getByRole('navigation', { name: 'Main navigation' });

  it('keeps the leading groups in the bar and moves the rest behind More', () => {
    renderNav();
    const nav = within(mainNav());

    expect(nav.getByRole('link', { name: 'Members' })).toBeInTheDocument();
    expect(nav.getByRole('link', { name: 'Events' })).toBeInTheDocument();
    expect(nav.queryByRole('link', { name: 'Documents' })).not.toBeInTheDocument();
    expect(nav.getByRole('button', { name: 'More' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens More onto the groups that did not fit, in order, each under its own name', async () => {
    const user = userEvent.setup();
    renderNav();
    const nav = within(mainNav());

    await user.click(nav.getByRole('button', { name: 'More' }));

    expect(nav.getByRole('button', { name: 'More' })).toHaveAttribute('aria-expanded', 'true');
    expect(nav.getByRole('link', { name: 'Documents' })).toHaveAttribute('href', '/documents');
    // A group keeps its pages together under its name, not flattened into a
    // list where they could be mistaken for somebody else's.
    const training = nav.getByRole('group', { name: 'Training' });
    expect(within(training).getByRole('link', { name: 'My Training' })).toHaveAttribute(
      'href',
      '/training/my-training'
    );
  });

  it('divides every group from its neighbours, including a link that follows one', async () => {
    const user = userEvent.setup();
    renderNav();
    const nav = within(mainNav());

    await user.click(nav.getByRole('button', { name: 'More' }));

    // More holds Documents, Learning Center, [Training], Admin Hours, Shift
    // Scheduling, [Operations], [Governance]. The boundaries are before
    // Training, after it (before Admin Hours, which is not a Training page),
    // before Operations and before Governance: four. Without the one after a
    // group, Admin Hours sat directly under My Training and read as its page.
    expect(nav.getAllByRole('separator')).toHaveLength(4);
    expect(
      within(nav.getByRole('group', { name: 'Training' })).queryByRole('link', { name: 'Admin Hours' })
    ).toBeNull();
  });

  it('shows no More when every group fits', () => {
    clientWidth.mockReturnValue(2000);
    renderNav();

    expect(within(mainNav()).queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
    expect(within(mainNav()).getByRole('link', { name: 'Documents' })).toBeInTheDocument();
  });

  it('never offers the measuring copy to assistive technology or the keyboard', () => {
    renderNav();

    // The bar shows two groups; a stray focusable copy would be a third
    // "Members" reachable by Tab.
    expect(within(mainNav()).getAllByRole('link', { name: 'Members' })).toHaveLength(1);
  });
});
