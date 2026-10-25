import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderWithRouter } from '../../../test/utils';

const mockCheckPermission = vi.fn();
const mockGetSummary = vi.fn();
const mockGetEquipmentRequests = vi.fn();
const mockGetAdminHubSummary = vi.fn();
const mockIsModuleOn = vi.fn();

vi.mock('../../../services/api', () => ({
  inventoryService: {
    getSummary: (...args: unknown[]) => mockGetSummary(...args) as unknown,
    getLowStockItems: () => Promise.resolve([]),
    getReturnRequests: () => Promise.resolve([]),
    getEquipmentRequests: (...args: unknown[]) => mockGetEquipmentRequests(...args) as unknown,
    getSetupStatus: () => Promise.resolve({ rooms: 1, storage_areas: 1, categories: 1, items: 1, is_complete: true }),
    getOverdueCheckouts: () => Promise.resolve({ checkouts: [], total: 0 }),
    getMaintenanceDueItems: () => Promise.resolve([]),
    getWriteOffRequests: () => Promise.resolve([]),
    getReorderRequests: () => Promise.resolve([]),
    getDepartureClearances: () => Promise.resolve({ clearances: [], total: 0 }),
    getMembersSummary: () => Promise.resolve({ members: [], total: 0 }),
  },
}));

vi.mock('../../../services/medicalSuppliesService', () => ({
  medicalSuppliesService: {
    getSummary: () =>
      Promise.resolve({ total_items: 0, expiring_soon: 0, expired: 0, low_stock: 0, expiring_within_days: 30 }),
  },
}));

vi.mock('../../../services/adminHubService', () => ({
  adminHubService: {
    getSummary: (...args: unknown[]) => mockGetAdminHubSummary(...args) as unknown,
  },
}));

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: (...args: unknown[]) => mockCheckPermission(...args) as boolean }),
}));

vi.mock('../../../hooks/useEnabledModules', () => ({
  useEnabledModules: () => ({
    enabledModules: null,
    isLoading: false,
    isModuleOn: (...args: unknown[]) => mockIsModuleOn(...args) as boolean,
  }),
}));

import { InventoryAdminLayout } from './InventoryAdminLayout';
import { useInventoryAdminShell } from './inventoryAdminShell';

const SubPage = () => {
  const shell = useInventoryAdminShell();
  return <p>{shell ? 'inside the admin header' : 'on its own'}</p>;
};

const renderAt = (url: string) => {
  window.history.pushState({}, '', url);
  return renderWithRouter(
    <InventoryAdminLayout>
      <SubPage />
    </InventoryAdminLayout>
  );
};

describe('InventoryAdminLayout', () => {
  beforeEach(() => {
    mockCheckPermission.mockReset();
    mockCheckPermission.mockReturnValue(true);
    mockIsModuleOn.mockReset();
    mockIsModuleOn.mockReturnValue(true);
    mockGetSummary.mockReset();
    mockGetSummary.mockResolvedValue({
      total_items: 10,
      items_by_type: {},
      non_medical_items: 10,
      items_by_status: {},
      active_checkouts: 0,
      overdue_checkouts: 0,
      maintenance_due_count: 0,
    });
    mockGetEquipmentRequests.mockReset();
    mockGetEquipmentRequests.mockResolvedValue({ requests: [], total: 4 });
    mockGetAdminHubSummary.mockReset();
    mockGetAdminHubSummary.mockResolvedValue({
      moduleKey: 'inventory',
      generatedAt: '2026-10-24T12:00:00Z',
      timezone: 'UTC',
      metrics: [],
      attention: [],
    });
  });

  it('draws the hub header around a sub-page and marks where it is', async () => {
    renderAt('/inventory/admin/requests');

    expect(screen.getByRole('heading', { level: 1, name: 'Inventory Administration' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Requests & Approvals' })).toHaveAttribute('aria-selected', 'true');
    const strip = screen.getByRole('navigation', { name: 'Requests & Approvals pages' });
    expect(within(strip).getByRole('link', { name: /^Gear Requests/ })).toHaveAttribute('aria-current', 'page');
    expect(within(strip).getByRole('link', { name: /^Return Requests/ })).not.toHaveAttribute('aria-current');
    expect(screen.getByText('inside the admin header')).toBeInTheDocument();
  });

  it('labels the page body as the selected area’s panel', () => {
    renderAt('/inventory/admin/requests');

    const tab = screen.getByRole('tab', { name: 'Requests & Approvals' });
    const panel = screen.getByRole('tabpanel');
    expect(tab).toHaveAttribute('aria-controls', panel.id);
    expect(within(panel).getByText('inside the admin header')).toBeInTheDocument();
  });

  it('badges a page with the work waiting on it', async () => {
    renderAt('/inventory/admin/requests');

    const gear = screen.getByRole('link', { name: /^Gear Requests/ });
    expect(await within(gear).findByText('4')).toBeInTheDocument();
    expect(gear).toHaveTextContent('need attention');
    expect(screen.getByRole('link', { name: /^Return Requests/ })).not.toHaveTextContent('need attention');
  });

  it('offers the counts refresh on the Overview only, where the counts are shown', async () => {
    renderAt('/inventory/admin/requests');
    await waitFor(() => expect(mockGetSummary).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Refresh inventory counts' })).not.toBeInTheDocument();
  });

  it('gives a viewer the hub refuses the page and a trail, without the header', () => {
    // A checklist reader opening Check Reports passes that route's gate but not
    // the hub's: the header's Overview would refuse them.
    mockCheckPermission.mockImplementation((permission: string) => permission === 'inventory.check_view');
    renderAt('/inventory/admin/checklists/reports');

    expect(screen.queryByRole('heading', { name: 'Inventory Administration' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: /breadcrumb/i })).toBeInTheDocument();
    expect(screen.getByText('inside the admin header')).toBeInTheDocument();
  });

  it('asks for no inventory figures on behalf of that viewer', () => {
    mockCheckPermission.mockImplementation((permission: string) => permission === 'inventory.check_view');
    renderAt('/inventory/admin/checklists/reports');

    expect(mockGetSummary).not.toHaveBeenCalled();
    expect(mockGetAdminHubSummary).not.toHaveBeenCalled();
  });
});
