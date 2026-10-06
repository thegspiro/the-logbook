/**
 * Grants & Fundraising had no navigation entry: its pages were reachable only
 * by typing the URL (grants-navigation). The entry follows the route's gate,
 * the module switch plus `fundraising.view`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, act } from '@testing-library/react';
import { renderWithRouter } from '../../test/utils';
import { TopNavigation } from './TopNavigation';
import { OPEN_MOBILE_NAV_EVENT } from './BottomNavigation';
import { GRANTS_NAV_ITEMS } from './grantsNavigation';

let granted = new Set<string>();
let grantsModuleOn = true;

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));

vi.mock('../../stores/authStore', () => ({
  useAuthStore: () => ({ checkPermission: (p: string) => granted.has(p) }),
}));

vi.mock('../../hooks/useEnabledModules', () => ({
  useEnabledModules: () => ({ isModuleOn: (id: string) => (id === 'grants' ? grantsModuleOn : true) }),
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

const openMobileMenu = () => {
  renderWithRouter(<TopNavigation departmentName="Test FD" logoPreview={null} onLogout={vi.fn()} />);
  act(() => {
    window.dispatchEvent(new CustomEvent(OPEN_MOBILE_NAV_EVENT));
  });
};

describe('Grants & Fundraising navigation', () => {
  beforeEach(() => {
    granted = new Set();
    grantsModuleOn = true;
  });

  it('is offered to a member who can view fundraising', () => {
    granted = new Set(['fundraising.view']);
    openMobileMenu();
    expect(screen.getAllByText('Grants & Fundraising').length).toBeGreaterThan(0);
  });

  it('is not offered without fundraising.view', () => {
    openMobileMenu();
    expect(screen.queryByText('Grants & Fundraising')).not.toBeInTheDocument();
  });

  it('is not offered when the module is off', () => {
    granted = new Set(['fundraising.view']);
    grantsModuleOn = false;
    openMobileMenu();
    expect(screen.queryByText('Grants & Fundraising')).not.toBeInTheDocument();
  });

  it('lists every routed grants page', () => {
    expect(GRANTS_NAV_ITEMS.map((item) => item.path)).toEqual([
      '/grants',
      '/grants/opportunities',
      '/grants/applications',
      '/grants/campaigns',
      '/grants/donors',
      '/grants/donations',
      '/grants/reports',
    ]);
  });
});
