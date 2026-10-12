/**
 * Finance had no navigation entry: its pages were reachable only by typing the
 * URL, which mattered once every member could raise their own requests
 * (`finance.request`). The entry follows the routes' gates and the module
 * switch, and names the lists the way the pages do.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import { TopNavigation } from './TopNavigation';
import { OPEN_MOBILE_NAV_EVENT } from './BottomNavigation';
import { financeNavItems } from './financeNavigation';

let granted = new Set<string>();
let financeModuleOn = true;
let ownsBudgets = false;
let plansNextYear = false;

// Ownership is the backend's answer (GET /finance/my-budgets/summary); the
// hook's own fetching is covered in useOwnsBudgets.test.ts.
vi.mock('../../modules/finance/hooks/useOwnsBudgets', () => ({
  useOwnsBudgets: () => ownsBudgets,
  usePlansNextYear: () => plansNextYear,
}));

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

/** The mobile menu's Finance group — the last of the two Finance toggles (desktop first). */
const expandMobileFinance = async () => {
  const toggles = screen.getAllByRole('button', { name: /Finance/, expanded: false });
  await userEvent.setup().click(toggles[toggles.length - 1] ?? document.body);
};

const visible = (permissions: string[], owns = false, plans = false) => {
  const has = (p: string) => permissions.includes(p);
  return financeNavItems(has, { ownsBudgets: owns, plansNextYear: plans })
    .filter((item) => item.anyPermission.some(has))
    .map((item) => item.label);
};

describe('Finance navigation', () => {
  beforeEach(() => {
    granted = new Set();
    financeModuleOn = true;
    ownsBudgets = false;
    plansNextYear = false;
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

  it('offers My Budgets to a member who owns a budget line', () => {
    expect(visible(['finance.request'], true)).toEqual([
      'My Budgets',
      'My Purchase Requests',
      'My Expense Reports',
      'My Check Requests',
    ]);
  });

  it('offers My Budgets to a treasurer only when they own a line too', () => {
    const treasurer = ['finance.request', 'finance.view', 'finance.manage'];
    expect(visible(treasurer)).not.toContain('My Budgets');
    expect(visible(treasurer, true)).toContain('My Budgets');
  });

  it('links an owner to their budgets from the menu', async () => {
    granted = new Set(['finance.request']);
    ownsBudgets = true;
    openMobileMenu();
    await expandMobileFinance();
    expect(screen.getByRole('link', { name: 'My Budgets' })).toHaveAttribute('href', '/finance/my-budgets');
  });

  it('does not offer My Budgets to a member who owns nothing', async () => {
    granted = new Set(['finance.request']);
    openMobileMenu();
    await expandMobileFinance();
    expect(screen.getByRole('link', { name: 'My Purchase Requests' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'My Budgets' })).not.toBeInTheDocument();
  });

  it('shows the treasurer the department’s queues', () => {
    expect(visible(['finance.request', 'finance.view', 'finance.manage', 'finance.approve'])).toEqual([
      'Dashboard',
      'Budget requests',
      'Purchase Requests',
      'Expense Reports',
      'Check Requests',
      'Approvals',
    ]);
  });

  it("offers Next year's budget only to a member planning one", () => {
    expect(visible(['finance.request'], true, false)).not.toContain("Next year's budget");
    expect(visible(['finance.request'], true, true)).toEqual([
      'My Budgets',
      "Next year's budget",
      'My Purchase Requests',
      'My Expense Reports',
      'My Check Requests',
    ]);
  });

  it('offers the budget request review only to finance.manage', () => {
    expect(visible(['finance.request', 'finance.view'])).not.toContain('Budget requests');
    expect(visible(['finance.manage'])).toContain('Budget requests');
  });

  it("links a planning owner to next year's budget from the menu", async () => {
    granted = new Set(['finance.request']);
    plansNextYear = true;
    openMobileMenu();
    await expandMobileFinance();
    expect(screen.getByRole('link', { name: "Next year's budget" })).toHaveAttribute(
      'href',
      '/finance/budget-requests'
    );
  });

  it("does not offer Next year's budget to a member with nothing to plan", async () => {
    granted = new Set(['finance.request']);
    ownsBudgets = true;
    openMobileMenu();
    await expandMobileFinance();
    expect(screen.getByRole('link', { name: 'My Budgets' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: "Next year's budget" })).not.toBeInTheDocument();
  });
});
