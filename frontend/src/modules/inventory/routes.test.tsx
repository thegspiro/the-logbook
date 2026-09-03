import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes } from 'react-router';

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
vi.mock('./pages/ReorderRequestsPage', () => ({
  default: () => <div data-testid="reorder-page">Reorder</div>,
}));
vi.mock('./pages/EquipmentKitsPage', () => ({
  default: () => <div data-testid="kits-page">Kits</div>,
}));
vi.mock('./pages/VariantGroupsPage', () => ({
  default: () => <div data-testid="variant-groups-page">VariantGroups</div>,
}));
vi.mock('./pages/AllowancesPage', () => ({
  default: () => <div data-testid="allowances-page">Allowances</div>,
}));
vi.mock('./pages/EquipmentCheckTemplateBuilder', () => ({
  default: () => <div data-testid="check-template-builder">TemplateBuilder</div>,
}));
vi.mock('./pages/EquipmentCheckReportsPage', () => ({
  default: () => <div data-testid="check-reports-page">CheckReports</div>,
}));
vi.mock('./pages/SupplyExpiringPage', () => ({
  default: () => <div data-testid="supply-expiring-page">SupplyExpiring</div>,
}));
vi.mock('./pages/FleetBoardPage', () => ({
  default: () => <div data-testid="fleet-board-page">FleetBoard</div>,
}));
vi.mock('./pages/CheckLogPage', () => ({
  default: () => <div data-testid="check-log-page">CheckLog</div>,
}));
vi.mock('./pages/ApparatusDetailPage', () => ({
  default: () => <div data-testid="apparatus-detail-page">ApparatusDetail</div>,
}));
vi.mock('./pages/ApparatusInventoryPage', () => ({
  default: () => <div data-testid="apparatus-inventory-page">ApparatusInventory</div>,
}));
vi.mock('./pages/MyChecklistsPage', () => ({
  default: () => <div data-testid="my-checklists-page">MyChecklists</div>,
}));
vi.mock('./pages/ChecklistsAdminPage', () => ({
  default: () => <div data-testid="checklists-admin-page">ChecklistsAdmin</div>,
}));
vi.mock('./pages/ChecklistSettingsPage', () => ({
  default: () => <div data-testid="checklist-settings-page">ChecklistSettings</div>,
}));
const capturedAnyPermissions: (string[] | undefined)[] = [];
vi.mock('../../components/ProtectedRoute', () => ({
  ProtectedRoute: ({
    children,
    requiredAnyPermission,
  }: {
    children: React.ReactNode;
    requiredAnyPermission?: string[];
  }) => {
    capturedAnyPermissions.push(requiredAnyPermission);
    return <>{children}</>;
  },
}));

import { getInventoryRoutes } from './routes';

function renderRoute(path: string) {
  capturedAnyPermissions.length = 0;
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>{getInventoryRoutes()}</Routes>
    </MemoryRouter>
  );
}

describe('getInventoryRoutes', () => {
  it('renders InventoryItemsPage at /inventory', async () => {
    renderRoute('/inventory');
    expect(await screen.findByTestId('inventory-items-page')).toBeInTheDocument();
  });

  it('renders MyEquipmentPage at /inventory/my-equipment', async () => {
    renderRoute('/inventory/my-equipment');
    expect(await screen.findByTestId('my-equipment-page')).toBeInTheDocument();
  });

  it('renders AdminHub at /inventory/admin', async () => {
    renderRoute('/inventory/admin');
    expect(await screen.findByTestId('admin-hub')).toBeInTheDocument();
  });

  it('allows any inventory, checklist, or storefront administrator into the admin hub', async () => {
    renderRoute('/inventory/admin');
    await screen.findByTestId('admin-hub');
    expect(capturedAnyPermissions).toContainEqual(['inventory.manage', 'inventory.check_manage', 'storefront.manage']);
  });

  it('renders PoolItemsPage at /inventory/admin/pool', async () => {
    renderRoute('/inventory/admin/pool');
    expect(await screen.findByTestId('pool-items-page')).toBeInTheDocument();
  });

  it('renders CategoriesPage at /inventory/admin/categories', async () => {
    renderRoute('/inventory/admin/categories');
    expect(await screen.findByTestId('categories-page')).toBeInTheDocument();
  });

  it('renders MaintenancePage at /inventory/admin/maintenance', async () => {
    renderRoute('/inventory/admin/maintenance');
    expect(await screen.findByTestId('maintenance-page')).toBeInTheDocument();
  });

  it('renders MembersPage at /inventory/admin/members', async () => {
    renderRoute('/inventory/admin/members');
    expect(await screen.findByTestId('members-page')).toBeInTheDocument();
  });

  it('renders ChargesPage at /inventory/admin/charges', async () => {
    renderRoute('/inventory/admin/charges');
    expect(await screen.findByTestId('charges-page')).toBeInTheDocument();
  });

  it('renders ReturnRequestsPage at /inventory/admin/returns', async () => {
    renderRoute('/inventory/admin/returns');
    expect(await screen.findByTestId('returns-page')).toBeInTheDocument();
  });

  it('renders EquipmentRequestsPage at /inventory/admin/requests', async () => {
    renderRoute('/inventory/admin/requests');
    expect(await screen.findByTestId('requests-page')).toBeInTheDocument();
  });

  it('renders WriteOffsPage at /inventory/admin/write-offs', async () => {
    renderRoute('/inventory/admin/write-offs');
    expect(await screen.findByTestId('write-offs-page')).toBeInTheDocument();
  });

  it('renders StorageAreasPage at /inventory/storage-areas', async () => {
    renderRoute('/inventory/storage-areas');
    expect(await screen.findByTestId('storage-page')).toBeInTheDocument();
  });

  it('renders ItemDetailPage at /inventory/items/:id', async () => {
    renderRoute('/inventory/items/test-id-123');
    expect(await screen.findByTestId('item-detail-page')).toBeInTheDocument();
  });

  it('renders barcode page at /inventory/print-labels', async () => {
    renderRoute('/inventory/print-labels');
    expect(await screen.findByTestId('barcode-page')).toBeInTheDocument();
  });

  it('renders AllowancesPage at /inventory/admin/allowances', async () => {
    renderRoute('/inventory/admin/allowances');
    expect(await screen.findByTestId('allowances-page')).toBeInTheDocument();
  });

  // Equipment checklists — moved here from Scheduling. Authoring and oversight
  // are Inventory's; performing a check stays on the shift screen.
  it('renders the template builder at /inventory/admin/checklists/templates/new', async () => {
    renderRoute('/inventory/admin/checklists/templates/new');
    expect(await screen.findByTestId('check-template-builder')).toBeInTheDocument();
  });

  it('renders the template builder for an existing template', async () => {
    renderRoute('/inventory/admin/checklists/templates/tpl-1');
    expect(await screen.findByTestId('check-template-builder')).toBeInTheDocument();
  });

  it('renders check reports at /inventory/admin/checklists/reports', async () => {
    renderRoute('/inventory/admin/checklists/reports');
    expect(await screen.findByTestId('check-reports-page')).toBeInTheDocument();
  });

  it('renders expiring supply at /inventory/admin/checklists/supply', async () => {
    renderRoute('/inventory/admin/checklists/supply');
    expect(await screen.findByTestId('supply-expiring-page')).toBeInTheDocument();
  });

  // The settings that decide when crews are prompted moved here from
  // Scheduling > Settings > Shift Reports > Checklist Timing.
  it('renders checklist settings at /inventory/admin/checklists/settings', async () => {
    renderRoute('/inventory/admin/checklists/settings');
    expect(await screen.findByTestId('checklist-settings-page')).toBeInTheDocument();
  });

  it('renders the fleet board at /inventory/checklists', async () => {
    renderRoute('/inventory/checklists');
    expect(await screen.findByTestId('fleet-board-page')).toBeInTheDocument();
  });

  it('renders the check log at /inventory/checklists/log', async () => {
    renderRoute('/inventory/checklists/log');
    expect(await screen.findByTestId('check-log-page')).toBeInTheDocument();
  });

  it('renders apparatus inventory at /inventory/checklists/apparatus-inventory', async () => {
    renderRoute('/inventory/checklists/apparatus-inventory');
    expect(await screen.findByTestId('apparatus-inventory-page')).toBeInTheDocument();
  });

  it('renders apparatus detail at /inventory/checklists/apparatus/:apparatusId', async () => {
    renderRoute('/inventory/checklists/apparatus/eng-1');
    expect(await screen.findByTestId('apparatus-detail-page')).toBeInTheDocument();
  });

  // The literal segments are declared before the dynamic apparatus route.
  // Declared the other way round, /log and /apparatus-inventory would both be
  // swallowed as apparatus ids and render the detail page instead.
  it('does not let the dynamic apparatus route swallow the literal segments', async () => {
    renderRoute('/inventory/checklists/log');
    expect(await screen.findByTestId('check-log-page')).toBeInTheDocument();
    expect(screen.queryByTestId('apparatus-detail-page')).not.toBeInTheDocument();
  });

  it("renders a member's own checklists at /inventory/checklists/my", async () => {
    // Every member's route to the checks they owe. It carries no permission
    // gate, and it is the only way there now that the Scheduling tab is gone.
    renderRoute('/inventory/checklists/my');
    expect(await screen.findByTestId('my-checklists-page')).toBeInTheDocument();
  });

  it('renders the checklists admin index at /inventory/admin/checklists', async () => {
    renderRoute('/inventory/admin/checklists');
    expect(await screen.findByTestId('checklists-admin-page')).toBeInTheDocument();
  });

  it('does not let /checklists/my be swallowed by the apparatus route', async () => {
    renderRoute('/inventory/checklists/my');
    expect(await screen.findByTestId('my-checklists-page')).toBeInTheDocument();
    expect(screen.queryByTestId('apparatus-detail-page')).not.toBeInTheDocument();
  });
});
