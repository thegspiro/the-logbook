import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

const mockGetSummary = vi.fn();
const mockGetLowStockItems = vi.fn();
const mockGetReturnRequests = vi.fn();
const mockGetEquipmentRequests = vi.fn();
const mockGetMembersSummary = vi.fn();
const mockGetSetupStatus = vi.fn();
const mockCheckPermission = vi.fn();

vi.mock('../../../services/api', () => ({
  inventoryService: {
    getSummary: (...args: unknown[]) => mockGetSummary(...args) as unknown,
    getLowStockItems: (...args: unknown[]) => mockGetLowStockItems(...args) as unknown,
    getReturnRequests: (...args: unknown[]) => mockGetReturnRequests(...args) as unknown,
    getEquipmentRequests: (...args: unknown[]) => mockGetEquipmentRequests(...args) as unknown,
    getMembersSummary: (...args: unknown[]) => mockGetMembersSummary(...args) as unknown,
    getSetupStatus: (...args: unknown[]) => mockGetSetupStatus(...args) as unknown,
  },
}));

const mockGetAdminHubSummary = vi.fn();
vi.mock('../../../services/adminHubService', () => ({
  adminHubService: {
    getSummary: (...args: unknown[]) => mockGetAdminHubSummary(...args) as unknown,
  },
}));

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: (...args: unknown[]) => mockCheckPermission(...args) as boolean }),
}));

// The hook reads organizationService from the same module mocked above, so it
// is stubbed here rather than left to resolve against a partial mock.
const mockIsModuleOn = vi.fn();
vi.mock('../../../hooks/useEnabledModules', () => ({
  useEnabledModules: () => ({
    enabledModules: null,
    isModuleOn: (...args: unknown[]) => mockIsModuleOn(...args) as boolean,
  }),
}));

import { InventoryAdminHub } from './InventoryAdminHub';

const mockSummary = {
  total_items: 150,
  items_by_status: { available: 80, assigned: 40, checked_out: 20, in_maintenance: 5, retired: 5 },
  active_checkouts: 20,
  overdue_checkouts: 3,
  maintenance_due_count: 7,
};

const mockLowStockAlerts = [
  { category_id: 'cat-1', category_name: 'Turnout Gear', current_stock: 2, threshold: 5 },
  { category_id: 'cat-2', category_name: 'Helmets', current_stock: 1, threshold: 3 },
];

describe('InventoryAdminHub', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSummary.mockResolvedValue(mockSummary);
    mockGetLowStockItems.mockResolvedValue(mockLowStockAlerts);
    mockGetReturnRequests.mockResolvedValue([]);
    mockGetEquipmentRequests.mockResolvedValue({ requests: [], total: 0 });
    mockGetMembersSummary.mockResolvedValue({ members: [], total: 0 });
    mockGetSetupStatus.mockResolvedValue({
      rooms: 3,
      storage_areas: 8,
      categories: 6,
      items: 150,
      is_complete: true,
    });
    mockCheckPermission.mockReturnValue(true);
    mockIsModuleOn.mockReturnValue(true);
    mockGetAdminHubSummary.mockResolvedValue({
      moduleKey: 'inventory',
      generatedAt: '2026-08-23T12:00:00Z',
      timezone: 'UTC',
      metrics: [
        { key: 'items_tracked', label: 'Items tracked', value: '150', context: 'in service', fixed: false },
        {
          key: 'issued_to_members',
          label: 'Issued to members',
          value: '40',
          context: 'held by 12 members',
          fixed: false,
        },
        { key: 'out_for_repair', label: 'Out for repair', value: '5', context: 'in maintenance', fixed: false },
        { key: 'needs_attention', label: 'Needs attention', value: '1', context: 'nothing waiting', fixed: true },
      ],
      attention: [
        {
          key: 'below_par',
          title: '2 items below par level',
          detail: 'reorder before the next issue',
          actionLabel: 'Build order',
          href: '/inventory/admin/reorder',
          severity: 'warning',
          count: 2,
          oldestAgeDays: null,
        },
      ],
    });
  });

  it('renders the page title and subtitle', async () => {
    renderWithRouter(<InventoryAdminHub />);
    expect(screen.getByText('Gear & Uniforms Administration')).toBeInTheDocument();
    expect(screen.getByText('Manage equipment, assignments, and compliance')).toBeInTheDocument();
    await waitFor(() => {
      expect(mockGetSummary).toHaveBeenCalledTimes(1);
    });
  });

  // The page's own stat strip and low-stock banner are gone: the frame's four
  // headline metrics and its "Needs attention" queue say the same things once
  // each. Two panels restating one number is the duplication the admin pattern
  // exists to remove.
  it('reports the department totals through the frame\u2019s metrics row', async () => {
    renderWithRouter(<InventoryAdminHub />);
    await screen.findByText('Items tracked');
    // Scoped to the row: the Items nav card carries the same total, which is
    // the point — one number, stated where each reader is looking.
    const metrics = screen.getByRole('region', { name: 'Headline metrics' });
    expect(within(metrics).getByText('150')).toBeInTheDocument();
    expect(within(metrics).getByText('Out for repair')).toBeInTheDocument();
    expect(screen.queryByText('checked out')).not.toBeInTheDocument();
  });

  it('carries low stock as one queue row with an action that ends it', async () => {
    renderWithRouter(<InventoryAdminHub />);
    await screen.findByText('2 items below par level');
    expect(screen.getByRole('link', { name: 'Build order' })).toHaveAttribute('href', '/inventory/admin/reorder');
    expect(screen.queryByText(/Low Stock Alerts/)).not.toBeInTheDocument();
  });

  it('still badges the reorder card with the number of low categories', async () => {
    renderWithRouter(<InventoryAdminHub />);
    await waitFor(() => {
      expect(screen.getByText('Reorder Requests')).toBeInTheDocument();
    });
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders all navigation cards', async () => {
    renderWithRouter(<InventoryAdminHub />);
    await waitFor(() => {
      expect(screen.getByText('Items')).toBeInTheDocument();
    });
    const navTitles = [
      'Items',
      'Pool Items',
      'Categories',
      'Members',
      'Maintenance',
      'Checkouts',
      'Charges',
      'Return Requests',
      'Storage Areas',
      'Import / Export',
      'Gear Requests',
      'Write-Offs',
      'Reorder Requests',
      'Gear Kits',
      'Variant Groups',
    ];
    for (const title of navTitles) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  it('renders correct links for navigation cards', async () => {
    renderWithRouter(<InventoryAdminHub />);
    await waitFor(() => {
      expect(screen.getByText('Items')).toBeInTheDocument();
    });
    const allLinks = screen.getAllByRole('link');
    const itemsLink = allLinks.find((l) => l.getAttribute('href') === '/inventory/admin/items');
    expect(itemsLink).toBeDefined();
    const poolLink = allLinks.find((l) => l.getAttribute('href') === '/inventory/admin/pool');
    expect(poolLink).toBeDefined();
  });

  it('refreshes summary when refresh button is clicked', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryAdminHub />);
    await waitFor(() => {
      expect(mockGetSummary).toHaveBeenCalledTimes(1);
    });
    const refreshButton = screen.getByRole('button', { name: /Refresh/ });
    await user.click(refreshButton);
    await waitFor(() => {
      expect(mockGetSummary).toHaveBeenCalledTimes(2);
    });
  });

  it('handles API errors gracefully', async () => {
    mockGetSummary.mockRejectedValue(new Error('Network error'));
    renderWithRouter(<InventoryAdminHub />);
    await waitFor(() => {
      expect(screen.getByText('Items')).toBeInTheDocument();
    });
    expect(screen.queryByText('available')).not.toBeInTheDocument();
  });

  it('opens the member picker when "Assign to Member" is clicked', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryAdminHub />);
    await waitFor(() => {
      expect(screen.getByText('Items')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Assign to Member/ }));
    await waitFor(() => {
      expect(mockGetMembersSummary).toHaveBeenCalledWith();
    });
    expect(screen.getByLabelText('Search members')).toBeInTheDocument();
  });

  it('hides "Assign to Member" without inventory.manage permission', async () => {
    mockCheckPermission.mockReturnValue(false);
    renderWithRouter(<InventoryAdminHub />);
    await waitFor(() => {
      expect(screen.getByText('Items')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /Assign to Member/ })).not.toBeInTheDocument();
  });

  // The store is its own module with its own grant, and this card used to
  // ignore both — it was the one unguarded door into a console a department
  // had never enabled, which is how a store got configured that no member
  // could see in their navigation.
  it('hides the Department Store card when the module is off', async () => {
    mockIsModuleOn.mockImplementation((key: unknown) => key !== 'storefront');
    renderWithRouter(<InventoryAdminHub />);
    await waitFor(() => {
      expect(screen.getByText('Items')).toBeInTheDocument();
    });
    expect(screen.queryByText('Department Store')).not.toBeInTheDocument();
  });

  it('hides the Department Store card without storefront.manage', async () => {
    mockCheckPermission.mockImplementation((p: unknown) => p !== 'storefront.manage');
    renderWithRouter(<InventoryAdminHub />);
    await waitFor(() => {
      expect(screen.getByText('Items')).toBeInTheDocument();
    });
    expect(screen.queryByText('Department Store')).not.toBeInTheDocument();
  });

  it('shows the Department Store card with the module on and the grant held', async () => {
    renderWithRouter(<InventoryAdminHub />);
    await waitFor(() => {
      expect(screen.getByText('Items')).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: /Department Store/ })).toHaveAttribute('href', '/store/admin');
  });

  it('shows badges on nav cards with counts', async () => {
    renderWithRouter(<InventoryAdminHub />);
    await waitFor(() => {
      expect(screen.getByText('Items')).toBeInTheDocument();
    });
    expect(screen.getAllByText('7').length).toBeGreaterThanOrEqual(1);
  });

  it('prompts to finish setup and names what is still missing', async () => {
    mockGetSetupStatus.mockResolvedValue({
      rooms: 2,
      storage_areas: 0,
      categories: 0,
      items: 0,
      is_complete: false,
    });
    renderWithRouter(<InventoryAdminHub />);

    await waitFor(() => {
      expect(screen.getByText('Finish inventory setup')).toBeInTheDocument();
    });
    expect(screen.getByText(/Still to set up: storage areas, categories, items/)).toBeInTheDocument();
  });

  it('hides the setup prompt once every step has records', async () => {
    renderWithRouter(<InventoryAdminHub />);
    await waitFor(() => {
      expect(screen.getByText('Items')).toBeInTheDocument();
    });
    expect(screen.queryByText('Finish inventory setup')).not.toBeInTheDocument();
  });

  it('still renders when the setup status call fails', async () => {
    mockGetSetupStatus.mockRejectedValue(new Error('boom'));
    renderWithRouter(<InventoryAdminHub />);

    await waitFor(() => {
      expect(screen.getByText('Items')).toBeInTheDocument();
    });
    expect(screen.queryByText('Finish inventory setup')).not.toBeInTheDocument();
  });
});
