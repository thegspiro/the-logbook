import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

const mockGetSummary = vi.fn();
const mockGetLowStockItems = vi.fn();
const mockGetReturnRequests = vi.fn();
const mockGetEquipmentRequests = vi.fn();

vi.mock('../../../services/api', () => ({
  inventoryService: {
    getSummary: (...args: unknown[]) => mockGetSummary(...args) as unknown,
    getLowStockItems: (...args: unknown[]) => mockGetLowStockItems(...args) as unknown,
    getReturnRequests: (...args: unknown[]) => mockGetReturnRequests(...args) as unknown,
    getEquipmentRequests: (...args: unknown[]) => mockGetEquipmentRequests(...args) as unknown,
  },
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
  });

  it('renders the page title and subtitle', async () => {
    renderWithRouter(<InventoryAdminHub />);
    expect(screen.getByText('Inventory Administration')).toBeInTheDocument();
    expect(screen.getByText('Manage equipment, assignments, and compliance')).toBeInTheDocument();
    await waitFor(() => {
      expect(mockGetSummary).toHaveBeenCalledTimes(1);
    });
  });

  it('displays summary statistics after loading', async () => {
    renderWithRouter(<InventoryAdminHub />);
    await waitFor(() => {
      expect(screen.getByText('Total Items')).toBeInTheDocument();
    });
    expect(screen.getByText('Available')).toBeInTheDocument();
    expect(screen.getByText('Checked Out')).toBeInTheDocument();
    expect(screen.getByText('Overdue')).toBeInTheDocument();
    // 150 appears in both summary stat and NavCard badge
    expect(screen.getAllByText('150').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('80')).toBeInTheDocument();
  });

  it('displays low stock alerts', async () => {
    renderWithRouter(<InventoryAdminHub />);
    await waitFor(() => {
      expect(screen.getByText(/Low Stock Alerts/)).toBeInTheDocument();
    });
    expect(screen.getByText('Turnout Gear')).toBeInTheDocument();
    expect(screen.getByText('Helmets')).toBeInTheDocument();
  });

  it('hides low stock section when there are no alerts', async () => {
    mockGetLowStockItems.mockResolvedValue([]);
    renderWithRouter(<InventoryAdminHub />);
    await waitFor(() => {
      expect(screen.getByText('Total Items')).toBeInTheDocument();
    });
    expect(screen.queryByText(/Low Stock Alerts/)).not.toBeInTheDocument();
  });

  it('shows "...and X more" when more than 5 alerts', async () => {
    const manyAlerts = Array.from({ length: 8 }, (_, i) => ({
      category_id: `cat-${i}`,
      category_name: `Category ${i}`,
      current_stock: i,
      threshold: 10,
    }));
    mockGetLowStockItems.mockResolvedValue(manyAlerts);
    renderWithRouter(<InventoryAdminHub />);
    await waitFor(() => {
      expect(screen.getByText(/and 3 more/)).toBeInTheDocument();
    });
  });

  it('renders all navigation cards', async () => {
    renderWithRouter(<InventoryAdminHub />);
    await waitFor(() => {
      expect(screen.getByText('Total Items')).toBeInTheDocument();
    });
    const navTitles = [
      'Items', 'Pool Items', 'Categories', 'Members',
      'Maintenance', 'Checkouts', 'Charges', 'Return Requests',
      'Storage Areas', 'Import / Export', 'Equipment Requests', 'Write-Offs',
      'Reorder Requests', 'Equipment Kits', 'Variant Groups',
    ];
    for (const title of navTitles) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  it('renders correct links for navigation cards', async () => {
    renderWithRouter(<InventoryAdminHub />);
    await waitFor(() => {
      expect(screen.getByText('Total Items')).toBeInTheDocument();
    });
    const itemsLink = screen.getByText('Items').closest('a');
    expect(itemsLink).toHaveAttribute('href', '/inventory/admin/items');
    const poolLink = screen.getByText('Pool Items').closest('a');
    expect(poolLink).toHaveAttribute('href', '/inventory/admin/pool');
  });

  it('refreshes summary when refresh button is clicked', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryAdminHub />);
    await waitFor(() => {
      expect(mockGetSummary).toHaveBeenCalledTimes(1);
    });
    const refreshButton = screen.getByText('Refresh').closest('button') ?? screen.getByText('Refresh');
    await user.click(refreshButton);
    await waitFor(() => {
      expect(mockGetSummary).toHaveBeenCalledTimes(2);
    });
  });

  it('handles API errors gracefully', async () => {
    mockGetSummary.mockRejectedValue(new Error('Network error'));
    renderWithRouter(<InventoryAdminHub />);
    // Page should still render navigation cards even if summary fails
    await waitFor(() => {
      expect(screen.getByText('Items')).toBeInTheDocument();
    });
    // Summary stats should not appear
    expect(screen.queryByText('Total Items')).not.toBeInTheDocument();
  });

  it('shows badges on nav cards with counts', async () => {
    renderWithRouter(<InventoryAdminHub />);
    await waitFor(() => {
      expect(screen.getByText('Total Items')).toBeInTheDocument();
    });
    // Maintenance badge should show 7
    expect(screen.getByText('7')).toBeInTheDocument();
  });
});
