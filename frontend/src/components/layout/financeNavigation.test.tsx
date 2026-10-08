/**
 * Finance had no navigation entry: its pages were reachable only by typing the
 * URL, which mattered once every member could raise their own requests
 * (`finance.request`). The entry follows the routes' gates and the module
 * switch, and names the lists the way the pages do.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, act } from '@testing-library/react';
import { renderWithRouter } from '../../test/utils';
import { TopNavigation } from './TopNavigation';
import { OPEN_MOBILE_NAV_EVENT } from './BottomNavigation';
import { financeNavItems } from './financeNavigation';

let granted = new Set<string>();
let financeModuleOn = true;

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));

vi.mock('../../stores/authStore', () => ({
  useAuthStore: () => ({ checkPermission: (p: string) => granted.has(p) }),
}));

vi.mock('../../hooks/useEnabledModules', () => ({
  useEnabledModules: () => ({ isModuleOn: (id: string) => (id === 'finance' ? financeModuleOn : true) }),
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

const visible = (permissions: string[]) => {
  const has = (p: string) => permissions.includes(p);
  return financeNavItems(has)
    .filter((item) => item.anyPermission.some(has))
    .map((item) => item.label);
};

describe('Finance navigation', () => {
  beforeEach(() => {
    granted = new Set();
    financeModuleOn = true;
  });

  it('is offered to every member who can raise a request', () => {
    granted = new Set(['finance.request']);
    openMobileMenu();
    expect(screen.getAllByText('Finance').length).toBeGreaterThan(0);
  });

  it('is not offered without any finance grant', () => {
    openMobileMenu();
    expect(screen.queryByText('Finance')).not.toBeInTheDocument();
  });

  it('is not offered when the module is off', () => {
    granted = new Set(['finance.request']);
    financeModuleOn = false;
    openMobileMenu();
    expect(screen.queryByText('Finance')).not.toBeInTheDocument();
  });

  it('shows a member their own three lists and nothing that would refuse them', () => {
    expect(visible(['finance.request'])).toEqual(['My Purchase Requests', 'My Expense Reports', 'My Check Requests']);
  });

  it('shows the treasurer the department’s queues', () => {
    expect(visible(['finance.request', 'finance.view', 'finance.manage', 'finance.approve'])).toEqual([
      'Dashboard',
      'Purchase Requests',
      'Expense Reports',
      'Check Requests',
      'Approvals',
    ]);
  });
});
