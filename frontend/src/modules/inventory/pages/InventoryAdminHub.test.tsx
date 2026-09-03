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
const mockGetOverdueCheckouts = vi.fn();
const mockGetMaintenanceDueItems = vi.fn();
const mockGetWriteOffRequests = vi.fn();
const mockGetReorderRequests = vi.fn();
const mockGetDepartureClearances = vi.fn();
const mockCheckPermission = vi.fn();

vi.mock('../../../services/api', () => ({
  inventoryService: {
    getSummary: (...args: unknown[]) => mockGetSummary(...args) as unknown,
    getLowStockItems: (...args: unknown[]) => mockGetLowStockItems(...args) as unknown,
    getReturnRequests: (...args: unknown[]) => mockGetReturnRequests(...args) as unknown,
    getEquipmentRequests: (...args: unknown[]) => mockGetEquipmentRequests(...args) as unknown,
    getMembersSummary: (...args: unknown[]) => mockGetMembersSummary(...args) as unknown,
    getSetupStatus: (...args: unknown[]) => mockGetSetupStatus(...args) as unknown,
    getOverdueCheckouts: (...args: unknown[]) => mockGetOverdueCheckouts(...args) as unknown,
    getMaintenanceDueItems: (...args: unknown[]) => mockGetMaintenanceDueItems(...args) as unknown,
    getWriteOffRequests: (...args: unknown[]) => mockGetWriteOffRequests(...args) as unknown,
    getReorderRequests: (...args: unknown[]) => mockGetReorderRequests(...args) as unknown,
    getDepartureClearances: (...args: unknown[]) => mockGetDepartureClearances(...args) as unknown,
  },
}));

const mockGetMedicalSummary = vi.fn();
vi.mock('../../../services/medicalSuppliesService', () => ({
  medicalSuppliesService: {
    getSummary: (...args: unknown[]) => mockGetMedicalSummary(...args) as unknown,
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
  items_by_type: { ppe: 62, uniform: 45, tool: 20 },
  non_medical_items: 127,
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
    mockGetOverdueCheckouts.mockResolvedValue({ checkouts: [], total: 0 });
    mockGetMaintenanceDueItems.mockResolvedValue([]);
    mockGetWriteOffRequests.mockResolvedValue([]);
    mockGetReorderRequests.mockResolvedValue([]);
    mockGetDepartureClearances.mockResolvedValue({ clearances: [], total: 0 });
    mockCheckPermission.mockReturnValue(true);
    mockIsModuleOn.mockReturnValue(true);
    mockGetMedicalSummary.mockResolvedValue({
      total_items: 88,
      expiring_soon: 7,
      expired: 1,
      low_stock: 2,
      expiring_within_days: 30,
    });
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
    expect(screen.getByText('Inventory Administration')).toBeInTheDocument();
    expect(
      screen.getByText('Gear, uniforms and EMS supplies — stock, issuance, and what needs a decision today')
    ).toBeInTheDocument();
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

  it('carries low stock as actionable record-level queue rows', async () => {
    renderWithRouter(<InventoryAdminHub />);
    expect(await screen.findAllByText('Low-stock item')).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: 'Open item' }).map((link) => link.getAttribute('href'))).toContain(
      '/inventory/admin/reorder?category=cat-1'
    );
    expect(screen.queryByText(/Low Stock Alerts/)).not.toBeInTheDocument();
  });

  it('still badges the reorder card with the number of low categories', async () => {
    renderWithRouter(<InventoryAdminHub />);
    await waitFor(() => {
      expect(screen.getByText('Reorder Requests')).toBeInTheDocument();
    });
    expect(within(screen.getByRole('link', { name: /Reorder Requests/ })).getByText('2')).toBeInTheDocument();
  });

  it('renders all navigation cards', async () => {
    renderWithRouter(<InventoryAdminHub />);
    await waitFor(() => {
      expect(screen.getByText('All Items')).toBeInTheDocument();
    });
    const navTitles = [
      'All Items',
      'Pool Items',
      'Categories',
      'Members',
      'Maintenance',
      'Temporary Loans',
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
      expect(screen.getByText('All Items')).toBeInTheDocument();
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
      expect(screen.getByText('All Items')).toBeInTheDocument();
    });
    expect(screen.queryByText('available')).not.toBeInTheDocument();
  });

  it('opens the member picker when "Assign to Member" is clicked', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryAdminHub />);
    await waitFor(() => {
      expect(screen.getByText('All Items')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Assign to Member/ }));
    await waitFor(() => {
      expect(mockGetMembersSummary).toHaveBeenCalledWith();
    });
    expect(screen.getByLabelText('Search members')).toBeInTheDocument();
  });

  it('hides "Assign to Member" and every card without any grant', async () => {
    // Each card now resolves its own gate, so a caller holding nothing sees
    // an empty body rather than a wall of links that all refuse them.
    mockCheckPermission.mockReturnValue(false);
    renderWithRouter(<InventoryAdminHub />);
    await screen.findByRole('heading', { name: 'Inventory Administration' });

    expect(screen.queryByRole('button', { name: /Assign to Member/ })).not.toBeInTheDocument();
    expect(screen.queryByText('All Items')).not.toBeInTheDocument();
    expect(screen.queryByText('Catalog')).not.toBeInTheDocument();
  });

  // The store is its own module with its own grant, and this card used to
  // ignore both — it was the one unguarded door into a console a department
  // had never enabled, which is how a store got configured that no member
  // could see in their navigation.
  it('hides the Department Store card when the module is off', async () => {
    mockIsModuleOn.mockImplementation((key: unknown) => key !== 'storefront');
    renderWithRouter(<InventoryAdminHub />);
    await waitFor(() => {
      expect(screen.getByText('All Items')).toBeInTheDocument();
    });
    expect(screen.queryByText('Department Store')).not.toBeInTheDocument();
    expect(screen.queryByText('Store Overview')).not.toBeInTheDocument();
  });

  it('hides the Department Store card without storefront.manage', async () => {
    mockCheckPermission.mockImplementation((p: unknown) => p !== 'storefront.manage');
    renderWithRouter(<InventoryAdminHub />);
    await waitFor(() => {
      expect(screen.getByText('All Items')).toBeInTheDocument();
    });
    expect(screen.queryByText('Department Store')).not.toBeInTheDocument();
  });

  it('shows the store section with the module on and the grant held', async () => {
    renderWithRouter(<InventoryAdminHub />);
    await waitFor(() => {
      expect(screen.getByText('All Items')).toBeInTheDocument();
    });
    expect(screen.getAllByText('Department Store')).toHaveLength(2);
    expect(screen.getByRole('link', { name: /Department Store/ })).toHaveAttribute('href', '/inventory/admin/store');
  });

  it('shows only the store entry to a storefront-only administrator without inventory requests', async () => {
    mockCheckPermission.mockImplementation((permission: unknown) => permission === 'storefront.manage');
    renderWithRouter(<InventoryAdminHub />);

    const storeLink = await screen.findByRole('link', { name: /Department Store/ });
    expect(storeLink).toHaveAttribute('href', '/inventory/admin/store');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.queryByText('All Items')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Needs attention' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Headline metrics' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Assign to Member/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Refresh inventory counts/ })).not.toBeInTheDocument();
    expect(mockGetSummary).not.toHaveBeenCalled();
    expect(mockGetLowStockItems).not.toHaveBeenCalled();
    expect(mockGetAdminHubSummary).not.toHaveBeenCalled();
  });

  it('shows badges on nav cards with counts', async () => {
    renderWithRouter(<InventoryAdminHub />);
    await waitFor(() => {
      expect(screen.getByText('All Items')).toBeInTheDocument();
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
      expect(screen.getByText('All Items')).toBeInTheDocument();
    });
    expect(screen.queryByText('Finish inventory setup')).not.toBeInTheDocument();
  });

  it('still renders when the setup status call fails', async () => {
    mockGetSetupStatus.mockRejectedValue(new Error('boom'));
    renderWithRouter(<InventoryAdminHub />);

    await waitFor(() => {
      expect(screen.getByText('All Items')).toBeInTheDocument();
    });
    expect(screen.queryByText('Finish inventory setup')).not.toBeInTheDocument();
  });

  it('orders safety and overdue work first and provides direct actions', async () => {
    mockGetMaintenanceDueItems.mockResolvedValue([
      { id: 'maint-1', name: 'SCBA 12', next_inspection_due: '2020-01-01' },
    ]);
    mockGetOverdueCheckouts.mockResolvedValue({
      checkouts: [
        {
          checkout_id: 'loan-1',
          item_id: 'i1',
          item_name: 'Radio',
          user_name: 'Alex',
          checked_out_at: '2020-01-01',
          expected_return_at: '2020-01-02',
          is_overdue: true,
        },
      ],
      total: 1,
    });
    mockGetEquipmentRequests.mockResolvedValue({
      requests: [
        { id: 'req-1', requester_name: 'Sam', item_name: 'Gloves', priority: 'normal', created_at: '2026-08-20' },
      ],
      total: 1,
    });
    renderWithRouter(<InventoryAdminHub />);
    const queue = await screen.findByRole('region', { name: 'Needs attention' });
    const rows = within(queue).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Maintenance due or overdue');
    expect(rows[1]).toHaveTextContent('Overdue temporary loan');
    expect(within(queue).getByRole('link', { name: 'Check in' })).toHaveAttribute(
      'href',
      '/inventory/checkouts?checkout=loan-1'
    );
    expect(within(queue).getByRole('link', { name: 'Review' })).toHaveAttribute(
      'href',
      '/inventory/admin/requests?request=req-1'
    );
  });

  it('warns and retries when one attention endpoint fails instead of showing zero', async () => {
    mockGetWriteOffRequests.mockRejectedValueOnce(new Error('offline')).mockResolvedValue([]);
    const user = userEvent.setup();
    renderWithRouter(<InventoryAdminHub />);
    expect(await screen.findByRole('alert')).toHaveTextContent('write-offs');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(mockGetWriteOffRequests).toHaveBeenCalledTimes(2));
  });

  it('shows an explicit empty state when every attention source succeeds', async () => {
    mockGetLowStockItems.mockResolvedValue([]);
    renderWithRouter(<InventoryAdminHub />);
    expect(await screen.findByText('Nothing needs attention. All inventory work is up to date.')).toBeInTheDocument();
  });
});

/**
 * The supply lines, the per-area gates, and the queue's repaired links.
 *
 * Its own block with its own `beforeEach`: `vi.clearAllMocks()` resets calls
 * but not implementations, so a block that configures nothing runs on whatever
 * its neighbour left behind and passes for the wrong reason (CLAUDE.md #28).
 * Every mock this block depends on is reset and given a default here.
 */
describe('InventoryAdminHub — supply lines and per-area gates', () => {
  const grantAll = () => mockCheckPermission.mockReturnValue(true);

  beforeEach(() => {
    mockGetSummary.mockReset();
    mockGetSummary.mockResolvedValue(mockSummary);
    mockGetLowStockItems.mockReset();
    mockGetLowStockItems.mockResolvedValue([]);
    mockGetReturnRequests.mockReset();
    mockGetReturnRequests.mockResolvedValue([]);
    mockGetEquipmentRequests.mockReset();
    mockGetEquipmentRequests.mockResolvedValue({ requests: [], total: 0 });
    mockGetSetupStatus.mockReset();
    mockGetSetupStatus.mockResolvedValue({ rooms: 3, storage_areas: 8, categories: 6, items: 150, is_complete: true });
    mockGetOverdueCheckouts.mockReset();
    mockGetOverdueCheckouts.mockResolvedValue({ checkouts: [], total: 0 });
    mockGetMaintenanceDueItems.mockReset();
    mockGetMaintenanceDueItems.mockResolvedValue([]);
    mockGetWriteOffRequests.mockReset();
    mockGetWriteOffRequests.mockResolvedValue([]);
    mockGetReorderRequests.mockReset();
    mockGetReorderRequests.mockResolvedValue([]);
    mockGetDepartureClearances.mockReset();
    mockGetDepartureClearances.mockResolvedValue({ clearances: [], total: 0 });
    mockGetMembersSummary.mockReset();
    mockGetMembersSummary.mockResolvedValue({ members: [], total: 0 });
    mockGetAdminHubSummary.mockReset();
    mockGetAdminHubSummary.mockResolvedValue({
      moduleKey: 'inventory',
      generatedAt: '2026-08-23T12:00:00Z',
      timezone: 'UTC',
      metrics: [],
      attention: [],
    });
    mockGetMedicalSummary.mockReset();
    mockGetMedicalSummary.mockResolvedValue({
      total_items: 88,
      expiring_soon: 7,
      expired: 1,
      low_stock: 2,
      expiring_within_days: 30,
    });
    mockCheckPermission.mockReset();
    grantAll();
    mockIsModuleOn.mockReset();
    mockIsModuleOn.mockReturnValue(true);
  });

  it('opens each supply line on the catalogue filtered to it', async () => {
    renderWithRouter(<InventoryAdminHub />);
    await screen.findByText('PPE & Turnout Gear');

    expect(screen.getByRole('link', { name: /PPE & Turnout Gear/ })).toHaveAttribute(
      'href',
      '/inventory/admin/items?item_type=ppe'
    );
    expect(screen.getByRole('link', { name: /Uniforms/ })).toHaveAttribute(
      'href',
      '/inventory/admin/items?item_type=uniform'
    );
    expect(screen.getByRole('link', { name: /EMS Supplies/ })).toHaveAttribute('href', '/medical-supplies');
  });

  it('counts each supply line from the summary breakdown', async () => {
    renderWithRouter(<InventoryAdminHub />);
    const ppe = await screen.findByRole('link', { name: /PPE & Turnout Gear/ });

    expect(within(ppe).getByText('62')).toBeInTheDocument();
    expect(within(screen.getByRole('link', { name: /Uniforms/ })).getByText('45')).toBeInTheDocument();
  });

  it('counts All Items as the non-medical rows its listing shows', async () => {
    // total_items is 150 and sums quantities across every type, medical
    // included; /inventory/admin/items excludes medical and reports rows. A
    // card that shows 150 over a list of 127 reads as a bug in the list.
    renderWithRouter(<InventoryAdminHub />);
    const items = await screen.findByRole('link', { name: /All Items/ });

    expect(within(items).getByText('127')).toBeInTheDocument();
    expect(within(items).queryByText('150')).not.toBeInTheDocument();
  });

  it('reports what is expiring on the EMS card, not what is on the shelf', async () => {
    // 7 expiring soon, out of 88 items — the number an EMS officer opens the
    // page for is the one with a deadline on it.
    renderWithRouter(<InventoryAdminHub />);
    const medical = await screen.findByRole('link', { name: /EMS Supplies/ });

    expect(within(medical).getByText('7')).toBeInTheDocument();
    expect(within(medical).queryByText('88')).not.toBeInTheDocument();
  });

  it('names the EMS request in the failure banner rather than swallowing it', async () => {
    // A silently-dropped stat is indistinguishable from a department with
    // nothing expiring, and leaves no Retry for the one request that failed.
    mockGetMedicalSummary.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    renderWithRouter(<InventoryAdminHub />);

    expect(await screen.findByRole('alert')).toHaveTextContent('EMS supplies');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(mockGetMedicalSummary).toHaveBeenCalledTimes(2));
  });

  it('leaves the EMS card without a stat when its request fails', async () => {
    mockGetMedicalSummary.mockRejectedValue(new Error('offline'));
    renderWithRouter(<InventoryAdminHub />);
    const medical = await screen.findByRole('link', { name: /EMS Supplies/ });

    expect(within(medical).queryByText('7')).not.toBeInTheDocument();
  });

  it('hides the EMS card, and asks nothing of its API, without the medical grant', async () => {
    mockCheckPermission.mockImplementation((permission: unknown) => permission !== 'inventory.view_medical');
    renderWithRouter(<InventoryAdminHub />);
    await screen.findByText('PPE & Turnout Gear');

    expect(screen.queryByText('EMS Supplies')).not.toBeInTheDocument();
    // The fetch is gated on the same condition as the card: a department with
    // no EMS supply line should not spend a 403 on every page load.
    expect(mockGetMedicalSummary).not.toHaveBeenCalled();
  });

  it('hides the EMS card when the medical module is off', async () => {
    mockIsModuleOn.mockImplementation((key: unknown) => key !== 'medical_supplies');
    renderWithRouter(<InventoryAdminHub />);
    await screen.findByText('PPE & Turnout Gear');

    expect(screen.queryByText('EMS Supplies')).not.toBeInTheDocument();
  });

  // The bug this whole change set exists to close: the seeded Quartermaster
  // holds `inventory.manage` and neither check grant, and `checkPermission` is
  // exact match plus module wildcard — so these two cards were a link to
  // Access Denied for the officer the hub is built for.
  it('hides the checklist cards from a quartermaster with no check grants', async () => {
    mockCheckPermission.mockImplementation(
      (permission: unknown) => permission !== 'inventory.check_manage' && permission !== 'inventory.check_view'
    );
    renderWithRouter(<InventoryAdminHub />);
    await screen.findByText('All Items');

    expect(screen.queryByText('Equipment Checklists')).not.toBeInTheDocument();
    expect(screen.queryByText('Check Reports')).not.toBeInTheDocument();
    // Still shown: its route accepts `inventory.manage` too.
    expect(screen.getByText('Expiring on Apparatus')).toBeInTheDocument();
  });

  it('shows the checklist cards once the check grants are held', async () => {
    renderWithRouter(<InventoryAdminHub />);
    await screen.findByText('All Items');

    expect(screen.getByRole('link', { name: /Equipment Checklists/ })).toHaveAttribute(
      'href',
      '/inventory/admin/checklists'
    );
    expect(screen.getByRole('link', { name: /Check Reports/ })).toHaveAttribute(
      'href',
      '/inventory/admin/checklists/reports'
    );
  });

  it('drops a section heading when every card under it is hidden', async () => {
    // A heading over an empty grid tells the reader something is missing
    // without saying what.
    mockIsModuleOn.mockImplementation((key: unknown) => key !== 'storefront');
    renderWithRouter(<InventoryAdminHub />);
    await screen.findByText('All Items');

    expect(screen.getByText('Catalog')).toBeInTheDocument();
    expect(screen.queryByText('Department Store')).not.toBeInTheDocument();
  });

  it('sends the maintenance row to the item, not to the dashboard', async () => {
    // `/inventory/admin/items/:id` matches no route, so this row spent its
    // life falling through App.tsx's catch-all.
    mockGetMaintenanceDueItems.mockResolvedValue([
      { id: 'maint-1', name: 'SCBA 12', next_inspection_due: '2020-01-01' },
    ]);
    renderWithRouter(<InventoryAdminHub />);
    const queue = await screen.findByRole('region', { name: 'Needs attention' });

    expect(within(queue).getByRole('link', { name: 'Open item' })).toHaveAttribute(
      'href',
      '/inventory/items/maint-1?tab=inspections'
    );
  });

  it('sends the overdue delivery to its request, not to a path with no route', async () => {
    mockGetReorderRequests.mockResolvedValue([
      { id: 'ro-1', item_name: 'Gloves', expected_delivery_date: '2020-01-01' },
    ]);
    renderWithRouter(<InventoryAdminHub />);
    const queue = await screen.findByRole('region', { name: 'Needs attention' });

    expect(within(queue).getByRole('link', { name: 'Receive' })).toHaveAttribute(
      'href',
      '/inventory/admin/reorder?request=ro-1'
    );
  });
});
