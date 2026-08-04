import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes } from 'react-router';

vi.mock('./pages/StorefrontPage', () => ({
  default: () => <div data-testid="storefront-page">Storefront</div>,
}));
vi.mock('./pages/MyOrdersPage', () => ({
  default: () => <div data-testid="my-orders-page">MyOrders</div>,
}));
vi.mock('./pages/StoreAdminPage', () => ({
  default: () => <div data-testid="store-admin-page">StoreAdmin</div>,
}));

const capturedPermissions: (string | undefined)[] = [];
vi.mock('../../components/ProtectedRoute', () => ({
  ProtectedRoute: ({ children, requiredPermission }: { children: React.ReactNode; requiredPermission?: string }) => {
    capturedPermissions.push(requiredPermission);
    return <>{children}</>;
  },
}));

import { getStorefrontRoutes } from './routes';

function renderRoute(path: string) {
  capturedPermissions.length = 0;
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>{getStorefrontRoutes()}</Routes>
    </MemoryRouter>
  );
}

describe('getStorefrontRoutes', () => {
  it('renders the storefront at /store', async () => {
    renderRoute('/store');
    expect(await screen.findByTestId('storefront-page')).toBeInTheDocument();
  });

  it('renders my orders at /store/orders', async () => {
    renderRoute('/store/orders');
    expect(await screen.findByTestId('my-orders-page')).toBeInTheDocument();
  });

  it('renders the admin console at /store/admin', async () => {
    renderRoute('/store/admin');
    expect(await screen.findByTestId('store-admin-page')).toBeInTheDocument();
  });

  it('gates the member store on storefront.view', async () => {
    renderRoute('/store');
    await screen.findByTestId('storefront-page');
    expect(capturedPermissions).toContain('storefront.view');
  });

  it('gates the admin console on storefront.manage', async () => {
    renderRoute('/store/admin');
    await screen.findByTestId('store-admin-page');
    expect(capturedPermissions).toContain('storefront.manage');
  });
});
