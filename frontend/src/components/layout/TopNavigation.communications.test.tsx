/**
 * Workflow review W55: on the top-navigation layout a member had no way to
 * reach their Messages inbox or the suggestion box, and an officer none to
 * reach Department Messages or the rest of the Forms & Comms screens.
 * SideNavigation has always listed them.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import { TopNavigation } from './TopNavigation';
import { OPEN_MOBILE_NAV_EVENT } from './BottomNavigation';

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));

let granted = new Set<string>();
vi.mock('../../stores/authStore', () => ({
  useAuthStore: () => ({ checkPermission: (p: string) => granted.has(p) }),
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

const openMenu = () => {
  renderWithRouter(<TopNavigation departmentName="Test FD" logoPreview={null} onLogout={vi.fn()} />);
  act(() => {
    window.dispatchEvent(new CustomEvent(OPEN_MOBILE_NAV_EVENT));
  });
  return screen.getByRole('navigation', { name: 'Mobile navigation' });
};

describe('TopNavigation communications entries (W55)', () => {
  beforeEach(() => {
    granted = new Set();
  });

  it('gives every member a way to their inbox and the suggestion box', () => {
    const menu = openMenu();

    expect(within(menu).getByRole('link', { name: 'Messages' })).toHaveAttribute('href', '/messages');
    expect(within(menu).getByRole('link', { name: 'Suggestions' })).toHaveAttribute('href', '/suggestions');
  });

  it('lists Department Messages under Admin for whoever may post them', async () => {
    granted = new Set(['notifications.manage']);
    const user = userEvent.setup();
    const menu = openMenu();

    await user.click(within(menu).getByRole('button', { name: 'Admin' }));

    expect(within(menu).getByRole('link', { name: 'Department Messages' })).toHaveAttribute(
      'href',
      '/communications/messages'
    );
    // Same gates as SideNavigation: notifications.manage reaches these two,
    // and not the screens that need settings.manage or suggestions.manage.
    expect(within(menu).getByRole('link', { name: 'Member Emails & Texts' })).toBeInTheDocument();
    expect(within(menu).queryByRole('link', { name: 'Email Templates' })).not.toBeInTheDocument();
    expect(within(menu).queryByRole('link', { name: 'Suggestion Boxes' })).not.toBeInTheDocument();
  });

  it('offers no Department Messages to a member without the permission', () => {
    const menu = openMenu();

    expect(within(menu).queryByRole('button', { name: 'Admin' })).not.toBeInTheDocument();
    expect(within(menu).queryByRole('link', { name: 'Department Messages' })).not.toBeInTheDocument();
  });
});
