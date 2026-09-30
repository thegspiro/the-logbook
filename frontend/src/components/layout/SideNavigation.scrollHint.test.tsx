/**
 * The floating "More" scroll hint belongs to the mobile drawer only. On a
 * desktop the sidebar's own scrollbar already says the list continues, and the
 * pill just covers the last rows.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
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

describe('side navigation "More" scroll hint', () => {
  beforeEach(() => {
    mockScrollOverflow.mockReset();
    mockScrollOverflow.mockReturnValue({ canScrollUp: false, canScrollDown: true });
  });

  it('is hidden from the md (desktop) breakpoint up', () => {
    renderWithRouter(<SideNavigation departmentName="Test FD" logoPreview={null} onLogout={vi.fn()} />);

    const hint = screen.getByTestId('side-nav-scroll-hint');
    expect(hint).toHaveTextContent('More');
    expect(hint).toHaveClass('md:hidden');
  });

  it('still shows on phones when the list overflows', () => {
    renderWithRouter(<SideNavigation departmentName="Test FD" logoPreview={null} onLogout={vi.fn()} />);

    expect(screen.getByTestId('side-nav-scroll-hint')).toHaveClass('opacity-100');
  });

  it('stays invisible when there is nothing further to scroll to', () => {
    mockScrollOverflow.mockReturnValue({ canScrollUp: false, canScrollDown: false });
    renderWithRouter(<SideNavigation departmentName="Test FD" logoPreview={null} onLogout={vi.fn()} />);

    expect(screen.getByTestId('side-nav-scroll-hint')).toHaveClass('opacity-0');
  });
});
