/**
 * Evaluations is one navigation entry for every member, and its parts are the
 * strip at the top of the evaluation pages. The side and top navigation used
 * to carry My Evaluations, Evaluations and Member Evaluations as three rows,
 * and Reports lit up beside Member Evaluations because its URL is a prefix of
 * every evaluation page's.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, act, fireEvent } from '@testing-library/react';
import { renderWithRouter } from '../../test/utils';

vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useNavigate: () => vi.fn(),
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
import { evaluationsNavItems } from './evaluationsNavigation';

const OLD_LABELS = ['My Evaluations', 'Member Evaluations'];

const grants =
  (...permissions: string[]) =>
  (permission: string) =>
    permissions.includes(permission);

describe('evaluationsNavItems', () => {
  it('gives a member with no evaluation grant only their own evaluations', () => {
    expect(evaluationsNavItems(grants()).map((item) => item.label)).toEqual([
      'My evaluations',
      'Evaluations I conduct',
      'Templates & periods',
    ]);
    // The gates, not the list, decide what is drawn: the two admin rows carry
    // the same grants as their routes.
    const [, conduct, setup] = evaluationsNavItems(grants());
    expect(conduct?.anyPermission).toEqual(['evaluations.conduct', 'evaluations.view_all', 'evaluations.manage']);
    expect(setup?.anyPermission).toEqual(['evaluations.configure', 'evaluations.manage']);
  });

  it.each(['evaluations.view_all', 'evaluations.manage'])('names the list for everyone when %s is held', (grant) => {
    expect(evaluationsNavItems(grants(grant))[1]?.label).toBe('All evaluations');
  });
});

describe('the Evaluations navigation entry', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/reports/evaluations/conduct');
  });

  it('is one side-navigation row, current on every evaluation page, with Reports not current', () => {
    renderWithRouter(<SideNavigation departmentName="Test FD" logoPreview={null} onLogout={vi.fn()} />);

    const rows = screen.getAllByRole('button', { name: 'Evaluations' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute('aria-current', 'page');
    for (const label of OLD_LABELS) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Reports' })).not.toHaveAttribute('aria-current');
  });

  it('leaves Reports current on its own pages', () => {
    window.history.pushState({}, '', '/reports/saved');
    renderWithRouter(<SideNavigation departmentName="Test FD" logoPreview={null} onLogout={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Reports' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Evaluations' })).not.toHaveAttribute('aria-current');
  });

  it('is one top-navigation link to My evaluations, current on every evaluation page', () => {
    renderWithRouter(<TopNavigation departmentName="Test FD" logoPreview={null} onLogout={vi.fn()} />);
    act(() => {
      window.dispatchEvent(new CustomEvent(OPEN_MOBILE_NAV_EVENT));
    });
    for (const button of screen.queryAllByRole('button', { expanded: false })) fireEvent.click(button);

    const links = screen.getAllByRole('link', { name: 'Evaluations' });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/reports/evaluations/mine');
    expect(links[0]).toHaveAttribute('aria-current', 'page');
    for (const label of OLD_LABELS) {
      expect(screen.queryByRole('link', { name: label })).not.toBeInTheDocument();
    }
    for (const reports of screen.getAllByRole('link', { name: 'Reports' })) {
      expect(reports).not.toHaveAttribute('aria-current');
    }
  });
});
