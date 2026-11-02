/**
 * The side and top navigation reach the same destinations.
 *
 * The two layouts are separate components that each build their own menus, so
 * an entry added to one is easily missed in the other. W55-1 found the inbox,
 * the suggestion box and the whole Forms & Comms admin group present only in
 * the side layout; a later pass found Medical Screening and My ID Card the same
 * way. A department using the top layout simply could not reach them.
 *
 * Both are rendered with every permission granted and every module on, every
 * group opened, and their destinations compared: the side bar's by the path
 * each row navigates to, the top bar's by each link's href.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, act, fireEvent, within } from '@testing-library/react';
import { renderWithRouter } from '../../test/utils';

const navigated: string[] = [];

vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useNavigate: () => (path: string) => {
    navigated.push(path);
  },
}));
vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));
vi.mock('../../stores/authStore', () => ({
  useAuthStore: (selector?: (s: unknown) => unknown) => {
    const state = {
      checkPermission: () => true,
      user: { id: 'member-1', organization_id: 'org-1', membership_type: 'active' },
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));
vi.mock('../../hooks/useEnabledModules', () => ({
  useEnabledModules: () => ({ enabledModules: null, isModuleOn: () => true, isLoading: false }),
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
vi.mock('../../hooks/useConnectedIntegrations', () => ({
  useConnectedIntegrations: () => ({ connected: new Set<string>(), loading: false, isConnected: () => false }),
}));
vi.mock('../../stores/practicalSkillsStore', () => ({
  usePracticalSkillsMethod: () => null,
  offersSkillsTesting: () => true,
}));
vi.mock('../../modules/finance/hooks/useOwnsBudgets', () => ({
  useOwnsBudgets: () => true,
  usePlansNextYear: () => true,
}));

import { SideNavigation } from './SideNavigation';
import { TopNavigation } from './TopNavigation';
import { OPEN_MOBILE_NAV_EVENT } from './BottomNavigation';

/** Open every collapsed group, including groups nested in groups. */
const openEveryGroup = () => {
  for (let pass = 0; pass < 6; pass++) {
    const closed = screen.queryAllByRole('button', { expanded: false });
    if (closed.length === 0) return;
    for (const button of closed) fireEvent.click(button);
  }
};

const sideDestinations = (): Set<string> => {
  navigated.length = 0;
  const { unmount } = renderWithRouter(
    <SideNavigation departmentName="Test FD" logoPreview={null} onLogout={vi.fn()} />
  );
  openEveryGroup();
  // Group headers carry aria-expanded and navigate nowhere; every other row
  // in a navigation landmark is a destination.
  for (const landmark of screen.getAllByRole('navigation')) {
    for (const row of within(landmark).queryAllByRole('button')) {
      if (!row.hasAttribute('aria-expanded')) fireEvent.click(row);
    }
  }
  const found = new Set(navigated.filter((path) => path.startsWith('/')));
  unmount();
  return found;
};

const topDestinations = (): Set<string> => {
  const { unmount } = renderWithRouter(
    <TopNavigation departmentName="Test FD" logoPreview={null} onLogout={vi.fn()} />
  );
  act(() => {
    window.dispatchEvent(new CustomEvent(OPEN_MOBILE_NAV_EVENT));
  });
  openEveryGroup();
  const found = new Set(
    screen
      .queryAllByRole('link')
      .map((link) => link.getAttribute('href') ?? '')
      .filter((href) => href.startsWith('/'))
  );
  unmount();
  return found;
};

describe('side and top navigation parity', () => {
  beforeEach(() => {
    navigated.length = 0;
  });

  it('offers every destination in both layouts', () => {
    const side = sideDestinations();
    const top = topDestinations();

    // A walk that found nothing would compare two empty sets and pass.
    expect(side.size).toBeGreaterThan(50);
    expect({
      onlyInSide: [...side].filter((path) => !top.has(path)).sort(),
      onlyInTop: [...top].filter((path) => !side.has(path)).sort(),
    }).toEqual({ onlyInSide: [], onlyInTop: [] });
  });
});
