import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes } from 'react-router';
import type { CurrentUser } from '../../types/auth';
import { useAuthStore } from '../../stores/authStore';

const enabledModules = vi.hoisted(() => ({ value: new Set<string>(['inventory', 'storefront']) }));

vi.mock('../../hooks/useEnabledModules', () => ({
  useEnabledModules: () => ({
    enabledModules: enabledModules.value,
    isModuleOn: (module: string) => enabledModules.value.has(module),
    isLoading: false,
  }),
}));

vi.mock('./pages/InventoryAdminHub', () => ({
  InventoryAdminHub: () => <h1>Inventory administration hub</h1>,
}));

import { getInventoryRoutes } from './routes';

const authenticatedUser = (permissions: string[]): CurrentUser => ({
  id: 'user-1',
  username: 'officer',
  email: 'officer@example.test',
  organization_id: 'organization-1',
  timezone: 'UTC',
  roles: [],
  positions: [],
  rank: null,
  membership_type: 'active',
  permissions,
  is_active: true,
  email_verified: true,
  mfa_enabled: false,
  password_expired: false,
  must_change_password: false,
});

const renderAdminRoute = (permissions: string[]) => {
  useAuthStore.setState({
    user: authenticatedUser(permissions),
    isAuthenticated: true,
    isLoading: false,
  });

  return render(
    <MemoryRouter initialEntries={['/inventory/admin']}>
      <Routes>{getInventoryRoutes()}</Routes>
    </MemoryRouter>
  );
};

describe('/inventory/admin authorization', () => {
  beforeEach(() => {
    localStorage.removeItem('has_session');
    enabledModules.value = new Set(['inventory', 'storefront']);
  });

  afterEach(() => {
    useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false });
  });

  it.each([
    ['inventory manager', ['inventory.manage']],
    ['checklist manager', ['inventory.check_manage']],
    ['store manager', ['storefront.manage']],
    ['multi-role administrator', ['members.manage', 'inventory.check_view', 'storefront.manage']],
    ['system administrator', ['*']],
  ])('renders the hub for an authenticated %s', async (_label, permissions) => {
    renderAdminRoute(permissions);

    expect(await screen.findByRole('heading', { name: 'Inventory administration hub' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Access Denied' })).not.toBeInTheDocument();
  });

  it('uses the established access-denied view for an unauthorized user', () => {
    renderAdminRoute(['inventory.view']);

    expect(screen.queryByRole('heading', { name: 'Inventory administration hub' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Access Denied' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Return to Dashboard' })).toHaveAttribute('href', '/dashboard');
  });

  it.each([
    ['inventory manager', ['inventory.manage']],
    ['checklist manager', ['inventory.check_manage']],
    ['store manager', ['storefront.manage']],
  ])('refuses an authenticated %s when the inventory module is disabled', (_label, permissions) => {
    enabledModules.value = new Set(['storefront']);
    renderAdminRoute(permissions);

    expect(screen.queryByRole('heading', { name: 'Inventory administration hub' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Inventory is not enabled' })).toBeInTheDocument();
  });

  it('still renders for a store manager when storefront is disabled but the inventory hub is enabled', async () => {
    enabledModules.value = new Set(['inventory']);
    renderAdminRoute(['storefront.manage']);

    expect(await screen.findByRole('heading', { name: 'Inventory administration hub' })).toBeInTheDocument();
  });
});
