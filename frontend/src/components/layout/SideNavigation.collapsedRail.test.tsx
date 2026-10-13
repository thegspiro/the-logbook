/**
 * Keyboard reach of the collapsed (icon-only) rail. Groups have no path of
 * their own, so in the rail a press used to do nothing at all, and the
 * collapse/expand toggles swapped themselves out from under focus.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';

const mockScrollOverflow = vi.fn();

vi.mock('../../hooks/useScrollOverflow', () => ({
  useScrollOverflow: () => mockScrollOverflow() as { canScrollUp: boolean; canScrollDown: boolean },
}));

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));

vi.mock('../../stores/authStore', () => ({
  useAuthStore: (selector?: (s: { checkPermission: (p: string) => boolean }) => unknown) => {
    const state = { checkPermission: () => true };
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

import { SideNavigation } from './SideNavigation';

const renderNav = () =>
  renderWithRouter(<SideNavigation departmentName="Test FD" logoPreview={null} onLogout={vi.fn()} />);

describe('side navigation in the collapsed rail', () => {
  beforeEach(() => {
    mockScrollOverflow.mockReset();
    mockScrollOverflow.mockReturnValue({ canScrollUp: false, canScrollDown: false });
  });

  it('hands focus to the expand button when the rail collapses, and back', async () => {
    const user = userEvent.setup();
    renderNav();

    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    const expand = screen.getByRole('button', { name: 'Expand navigation' });
    expect(expand).toHaveFocus();
    expect(expand).toHaveAttribute('aria-expanded', 'false');

    await user.click(expand);
    expect(screen.getByRole('button', { name: 'Collapse navigation' })).toHaveFocus();
  });

  it('opens the rail and the group when a group is pressed while collapsed', async () => {
    const user = userEvent.setup();
    renderNav();
    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));

    const training = screen.getAllByRole('button', { name: /Training/ })[0];
    expect(training).toHaveAttribute('aria-expanded', 'false');
    await user.click(training as HTMLElement);

    expect(screen.getByRole('button', { name: 'Collapse navigation' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Training/ })[0]).toHaveAttribute('aria-expanded', 'true');
  });
});
