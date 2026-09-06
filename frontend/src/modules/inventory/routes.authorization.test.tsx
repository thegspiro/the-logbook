/**
 * Who the inventory administration routes actually let in.
 *
 * `routes.test.tsx` stubs `ProtectedRoute` to a passthrough, which is right
 * for what it asserts — that each path resolves to its page — and means it
 * cannot see a gate at all. So the gates went unexercised: `/inventory/admin`
 * was widened from `inventory.manage` to an any-of set with no test that a
 * checklist officer or a store manager gets in, and none that the stricter
 * pages behind the hub still refuse them.
 *
 * These render the *real* `ProtectedRoute` over the real route table, driving
 * it through a grant set, so the assertions are about access rather than
 * routing. The two halves of the hub's gate are both covered on purpose: the
 * door widened, and what is behind the door did not.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes } from 'react-router';

const mockCheckPermission = vi.fn();
vi.mock('../../stores/authStore', () => ({
  useAuthStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = {
      isAuthenticated: true,
      isLoading: false,
      user: { id: 'u1' },
      loadUser: vi.fn(),
      checkPermission: (...args: unknown[]) => mockCheckPermission(...args) as boolean,
      hasRole: () => true,
    };
    return selector ? selector(state) : state;
  },
}));

const mockUseEnabledModules = vi.fn();
vi.mock('../../hooks/useEnabledModules', () => ({
  useEnabledModules: () => mockUseEnabledModules() as unknown,
}));

vi.mock('./pages/InventoryAdminHub', () => ({
  InventoryAdminHub: () => <div data-testid="admin-hub">AdminHub</div>,
}));
vi.mock('./pages/InventorySetupPage', () => ({
  default: () => <div data-testid="setup-page">Setup</div>,
}));

import { getInventoryRoutes } from './routes';

/** Drive the gate from a grant set, the way a real position resolves. */
const grant = (...held: string[]) => {
  mockCheckPermission.mockImplementation((p: unknown) => held.includes(p as string));
};

const renderRoute = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>{getInventoryRoutes()}</Routes>
    </MemoryRouter>
  );

const DENIED = /Access Denied/i;

describe('inventory admin route authorization', () => {
  // Stated here rather than inherited: `vi.clearAllMocks()` clears calls but
  // not implementations, and an unconsumed `…Once` survives it, so a block
  // that configures nothing runs on whatever a neighbour left behind
  // (CLAUDE.md pitfall #28).
  beforeEach(() => {
    mockCheckPermission.mockReset();
    mockCheckPermission.mockReturnValue(false);
    mockUseEnabledModules.mockReset();
    mockUseEnabledModules.mockReturnValue({
      enabledModules: new Set(['inventory']),
      isModuleOn: (k: string) => k === 'inventory',
      isLoading: false,
    });
    localStorage.setItem('has_session', '1');
  });

  describe('the hub at /inventory/admin admits any of three grants', () => {
    // The hub carries checklist and store cards whose own routes accept grants
    // it did not, so before the widening a checklist officer was refused the
    // only page linking to the console they administer.
    it.each([['inventory.manage'], ['inventory.check_manage'], ['storefront.manage']])(
      'admits a member holding only %s',
      async (permission) => {
        grant(permission);
        renderRoute('/inventory/admin');
        expect(await screen.findByTestId('admin-hub')).toBeInTheDocument();
      }
    );

    it('refuses a member holding none of them', async () => {
      grant();
      renderRoute('/inventory/admin');
      expect(await screen.findByText(DENIED)).toBeInTheDocument();
      expect(screen.queryByTestId('admin-hub')).not.toBeInTheDocument();
    });

    // An any-of gate that admitted an unrelated grant would be permissive by
    // default rather than an allowlist — the failure this asserts against is
    // silent, since the page renders and nothing errors.
    it('refuses a grant outside the set, however senior', async () => {
      grant('events.manage', 'training.manage', 'scheduling.manage');
      renderRoute('/inventory/admin');
      expect(await screen.findByText(DENIED)).toBeInTheDocument();
      expect(screen.queryByTestId('admin-hub')).not.toBeInTheDocument();
    });
  });

  describe('widening the door did not widen what is behind it', () => {
    // The guided setup flow writes an organization's inventory configuration
    // and is deliberately `inventory.manage` alone. If the hub's any-of set
    // ever leaks onto these routes, a store manager gains a console nobody
    // granted them — which is exactly what the hub's own comment promises
    // cannot happen.
    it.each([['inventory.check_manage'], ['storefront.manage']])(
      'refuses /inventory/admin/setup to a member holding only %s',
      async (permission) => {
        grant(permission);
        renderRoute('/inventory/admin/setup');
        expect(await screen.findByText(DENIED)).toBeInTheDocument();
        expect(screen.queryByTestId('setup-page')).not.toBeInTheDocument();
      }
    );

    it('admits /inventory/admin/setup to inventory.manage', async () => {
      grant('inventory.manage');
      renderRoute('/inventory/admin/setup');
      expect(await screen.findByTestId('setup-page')).toBeInTheDocument();
    });
  });

  describe('the module gate survives the widening', () => {
    // `requiredModule` is a usability gate, not access control, and it sits
    // *after* the permission check — so it has to be asserted with a grant in
    // hand, or a pass would prove only that the permission check refused.
    it('refuses the hub when the department has inventory switched off', async () => {
      grant('inventory.manage');
      mockUseEnabledModules.mockReturnValue({
        enabledModules: new Set(['storefront']),
        isModuleOn: () => false,
        isLoading: false,
      });
      renderRoute('/inventory/admin');
      expect(await screen.findByText(/is not enabled/i)).toBeInTheDocument();
      expect(screen.queryByTestId('admin-hub')).not.toBeInTheDocument();
    });
  });
});
