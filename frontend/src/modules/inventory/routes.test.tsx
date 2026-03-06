import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter, Routes } from 'react-router-dom';

// Mock all lazy-loaded pages to avoid importing real modules
vi.mock('./pages/InventoryItemsPage', () => ({
  default: () => <div data-testid="inventory-items-page">Items</div>,
}));
vi.mock('./pages/MyEquipmentPage', () => ({
  default: () => <div data-testid="my-equipment-page">MyEquipment</div>,
}));
vi.mock('./pages/InventoryAdminHub', () => ({
  InventoryAdminHub: () => <div data-testid="admin-hub">AdminHub</div>,
}));
vi.mock('../../pages/InventoryCheckoutsPage', () => ({
  default: () => <div data-testid="checkouts-page">Checkouts</div>,
}));
vi.mock('./pages/StorageAreasPage', () => ({
  default: () => <div data-testid="storage-page">Storage</div>,
}));
vi.mock('../../pages/ImportInventory', () => ({
  default: () => <div data-testid="import-page">Import</div>,
}));
vi.mock('./pages/InventoryBarcodePrintPage', () => ({
  default: () => <div data-testid="barcode-page">Barcodes</div>,
}));
vi.mock('./pages/ItemDetailPage', () => ({
  default: () => <div data-testid="item-detail-page">ItemDetail</div>,
}));
vi.mock('./pages/PoolItemsPage', () => ({
  default: () => <div data-testid="pool-items-page">PoolItems</div>,
}));
vi.mock('./pages/InventoryCategoriesPage', () => ({
  default: () => <div data-testid="categories-page">Categories</div>,
}));
vi.mock('./pages/InventoryMaintenancePage', () => ({
  default: () => <div data-testid="maintenance-page">Maintenance</div>,
}));
vi.mock('./pages/InventoryMembersPage', () => ({
  default: () => <div data-testid="members-page">Members</div>,
}));
vi.mock('./pages/ChargesPage', () => ({
  default: () => <div data-testid="charges-page">Charges</div>,
}));
vi.mock('./pages/ReturnRequestsPage', () => ({
  default: () => <div data-testid="returns-page">Returns</div>,
}));
vi.mock('./pages/EquipmentRequestsPage', () => ({
  default: () => <div data-testid="requests-page">Requests</div>,
}));
vi.mock('./pages/WriteOffsPage', () => ({
  default: () => <div data-testid="write-offs-page">WriteOffs</div>,
}));
vi.mock('../../components/ProtectedRoute', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { getInventoryRoutes } from './routes';

function renderRoute(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>{getInventoryRoutes()}</Routes>
    </MemoryRouter>,
  );
}

describe('getInventoryRoutes', () => {
  it('renders InventoryItemsPage at /inventory', async () => {
    const { findByTestId } = renderRoute('/inventory');
    expect(await findByTestId('inventory-items-page')).toBeInTheDocument();
  });

  it('renders MyEquipmentPage at /inventory/my-equipment', async () => {
    const { findByTestId } = renderRoute('/inventory/my-equipment');
    expect(await findByTestId('my-equipment-page')).toBeInTheDocument();
  });

  it('renders AdminHub at /inventory/admin', async () => {
    const { findByTestId } = renderRoute('/inventory/admin');
    expect(await findByTestId('admin-hub')).toBeInTheDocument();
  });

  it('renders PoolItemsPage at /inventory/admin/pool', async () => {
    const { findByTestId } = renderRoute('/inventory/admin/pool');
    expect(await findByTestId('pool-items-page')).toBeInTheDocument();
  });

  it('renders CategoriesPage at /inventory/admin/categories', async () => {
    const { findByTestId } = renderRoute('/inventory/admin/categories');
    expect(await findByTestId('categories-page')).toBeInTheDocument();
  });

  it('renders MaintenancePage at /inventory/admin/maintenance', async () => {
    const { findByTestId } = renderRoute('/inventory/admin/maintenance');
    expect(await findByTestId('maintenance-page')).toBeInTheDocument();
  });

  it('renders MembersPage at /inventory/admin/members', async () => {
    const { findByTestId } = renderRoute('/inventory/admin/members');
    expect(await findByTestId('members-page')).toBeInTheDocument();
  });

  it('renders ChargesPage at /inventory/admin/charges', async () => {
    const { findByTestId } = renderRoute('/inventory/admin/charges');
    expect(await findByTestId('charges-page')).toBeInTheDocument();
  });

  it('renders ReturnRequestsPage at /inventory/admin/returns', async () => {
    const { findByTestId } = renderRoute('/inventory/admin/returns');
    expect(await findByTestId('returns-page')).toBeInTheDocument();
  });

  it('renders EquipmentRequestsPage at /inventory/admin/requests', async () => {
    const { findByTestId } = renderRoute('/inventory/admin/requests');
    expect(await findByTestId('requests-page')).toBeInTheDocument();
  });

  it('renders WriteOffsPage at /inventory/admin/write-offs', async () => {
    const { findByTestId } = renderRoute('/inventory/admin/write-offs');
    expect(await findByTestId('write-offs-page')).toBeInTheDocument();
  });

  it('renders StorageAreasPage at /inventory/storage-areas', async () => {
    const { findByTestId } = renderRoute('/inventory/storage-areas');
    expect(await findByTestId('storage-page')).toBeInTheDocument();
  });

  it('renders ItemDetailPage at /inventory/items/:id', async () => {
    const { findByTestId } = renderRoute('/inventory/items/test-id-123');
    expect(await findByTestId('item-detail-page')).toBeInTheDocument();
  });

  it('renders barcode page at /inventory/print-labels', async () => {
    const { findByTestId } = renderRoute('/inventory/print-labels');
    expect(await findByTestId('barcode-page')).toBeInTheDocument();
  });
});
