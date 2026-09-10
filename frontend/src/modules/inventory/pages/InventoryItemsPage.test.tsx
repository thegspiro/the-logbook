import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { InventoryItem } from '../types';

const mockGetItems = vi.fn();
const mockGetSummary = vi.fn();
const mockGetSummaryByLocation = vi.fn();
const mockGetCategories = vi.fn();
const mockGetStorageAreas = vi.fn();
const mockGetLocations = vi.fn();
const mockCheckPermission = vi.fn();
const mockRetireItem = vi.fn();
const mockUpdateItem = vi.fn();
const mockGetItemColors = vi.fn();
const mockPinItem = vi.fn();
const mockUnpinItem = vi.fn();
const mockReorderItemPins = vi.fn();
const mockExportItemsCsv = vi.fn();

vi.mock('../../../services/api', () => ({
  inventoryService: {
    getItems: (...a: unknown[]) => mockGetItems(...a) as unknown,
    getSummary: (...a: unknown[]) => mockGetSummary(...a) as unknown,
    getSummaryByLocation: (...a: unknown[]) => mockGetSummaryByLocation(...a) as unknown,
    getCategories: (...a: unknown[]) => mockGetCategories(...a) as unknown,
    getStorageAreas: (...a: unknown[]) => mockGetStorageAreas(...a) as unknown,
    getItemColors: (...a: unknown[]) => mockGetItemColors(...a) as unknown,
    retireItem: (...a: unknown[]) => mockRetireItem(...a) as unknown,
    updateItem: (...a: unknown[]) => mockUpdateItem(...a) as unknown,
    pinItem: (...a: unknown[]) => mockPinItem(...a) as unknown,
    unpinItem: (...a: unknown[]) => mockUnpinItem(...a) as unknown,
    reorderItemPins: (...a: unknown[]) => mockReorderItemPins(...a) as unknown,
    exportItemsCsv: (...a: unknown[]) => mockExportItemsCsv(...a) as unknown,
  },
  locationsService: {
    getLocations: (...a: unknown[]) => mockGetLocations(...a) as unknown,
  },
}));

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector?: (s: { checkPermission: (p: string) => boolean }) => unknown) => {
    const state = { checkPermission: (p: string) => mockCheckPermission(p) as boolean };
    return selector ? selector(state) : state;
  },
}));

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../../../hooks/useInventoryWebSocket', () => ({ useInventoryWebSocket: () => undefined }));

// Stub heavy / out-of-scope child components.
vi.mock('../components/ItemFormModal', () => ({
  ItemFormModal: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div>item-form-modal</div> : null),
}));
vi.mock('../components/ReceiveStockModal', () => ({
  default: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div>receive-stock-modal</div> : null),
}));
vi.mock('../../../components/MemberPickerModal', () => ({ MemberPickerModal: () => null }));
vi.mock('../../../components/InventoryScanModal', () => ({ InventoryScanModal: () => null }));
vi.mock('../../../components/ux/FloatingActionButton', () => ({ FloatingActionButton: () => null }));

const mockToastError = vi.fn();
const mockToastSuccess = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...a: unknown[]): void => {
      mockToastSuccess(...a);
    },
    error: (...a: unknown[]): void => {
      mockToastError(...a);
    },
  },
}));

import InventoryItemsPage from './InventoryItemsPage';

const makeItem = (overrides: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'it-1',
  organization_id: 'org-1',
  name: 'Cordless Drill',
  condition: 'good',
  status: 'available',
  tracking_type: 'individual',
  quantity: 1,
  quantity_issued: 0,
  active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('InventoryItemsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetItems.mockResolvedValue({ items: [], total: 0 });
    mockGetSummary.mockResolvedValue({
      total_items: 42,
      non_medical_items: 6,
      overdue_checkouts: 1,
      maintenance_due_count: 2,
      total_value: 0,
    });
    mockGetSummaryByLocation.mockResolvedValue([]);
    mockGetCategories.mockResolvedValue([]);
    mockGetStorageAreas.mockResolvedValue([]);
    mockGetItemColors.mockResolvedValue([]);
    mockGetLocations.mockResolvedValue([]);
    mockRetireItem.mockResolvedValue({});
    mockUpdateItem.mockResolvedValue({});
    mockCheckPermission.mockReturnValue(true);
  });

  it('shows the empty state when there are no items', async () => {
    renderWithRouter(<InventoryItemsPage />);
    expect(await screen.findByText('No items found')).toBeInTheDocument();
  });

  it('offers the org colours in the filter, from the endpoint', async () => {
    // Previously derived from the loaded page of items, which bounded it to the
    // first page AND narrowed it by the colour filter itself — so choosing a
    // colour left that colour as the only option.
    mockGetItemColors.mockResolvedValue(['Navy', 'White']);
    renderWithRouter(<InventoryItemsPage />);

    const filter = await screen.findByLabelText('Filter by color');
    await waitFor(() => expect(within(filter).getByRole('option', { name: 'Navy' })).toBeInTheDocument());
    expect(within(filter).getByRole('option', { name: 'White' })).toBeInTheDocument();
  });

  it('keeps the page usable when the colours endpoint fails', async () => {
    // An older backend does not serve this route. The filter may lose its
    // options; the page may not lose its rows.
    mockGetItemColors.mockRejectedValue(new Error('404'));
    mockGetItems.mockResolvedValue({ items: [makeItem()], total: 1 });
    renderWithRouter(<InventoryItemsPage />);

    expect(await screen.findByText('Cordless Drill')).toBeInTheDocument();
  });

  it('shows an error toast when items fail to load', async () => {
    mockGetItems.mockRejectedValue(new Error('boom'));
    renderWithRouter(<InventoryItemsPage />);
    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
  });

  it('renders items and summary stats', async () => {
    mockGetItems.mockResolvedValue({ items: [makeItem()], total: 1 });
    renderWithRouter(<InventoryItemsPage />);
    // Desktop table + mobile card both render the name.
    expect((await screen.findAllByText('Cordless Drill')).length).toBeGreaterThan(0);
    // non_medical_items, not total_items: the header counts the population the
    // list below it shows.
    expect(screen.getByText(/6 items/)).toBeInTheDocument();
    expect(screen.queryByText(/42 items/)).not.toBeInTheDocument();
  });

  it('shows lot stock as the quantity for a lot-stocked item', async () => {
    // quantity says 50, but lot bookkeeping never writes that column — the
    // in-date lots are the count that matters.
    mockGetItems.mockResolvedValue({
      items: [
        makeItem({ name: '4x4 Gauze', tracking_type: 'pool', quantity: 50, lot_stock: 12, is_lot_stocked: true }),
      ],
      total: 1,
    });
    renderWithRouter(<InventoryItemsPage />);
    await screen.findAllByText('4x4 Gauze');

    expect(screen.getAllByText('12').length).toBeGreaterThan(0);
    expect(screen.getAllByText('in-date lots').length).toBeGreaterThan(0);
    expect(screen.queryByText('50 / 50')).not.toBeInTheDocument();
  });

  it('shows zero rather than a stale quantity when every lot has expired', async () => {
    mockGetItems.mockResolvedValue({
      items: [
        makeItem({ name: 'Epi 1:1000', tracking_type: 'pool', quantity: 30, lot_stock: 0, is_lot_stocked: true }),
      ],
      total: 1,
    });
    renderWithRouter(<InventoryItemsPage />);
    await screen.findAllByText('Epi 1:1000');

    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
  });

  it('leaves a non-lot item on its own quantity ledger', async () => {
    mockGetItems.mockResolvedValue({
      items: [makeItem({ name: 'Spare Gloves', tracking_type: 'pool', quantity: 8, quantity_issued: 3 })],
      total: 1,
    });
    renderWithRouter(<InventoryItemsPage />);
    await screen.findAllByText('Spare Gloves');

    // `quantity` is already net of what is out on issue, so 8 on hand with 3
    // issued is 11 owned — not 5 on hand, which subtracted the issued units a
    // second time.
    expect(screen.getAllByText('8 / 11').length).toBeGreaterThan(0);
    expect(screen.queryByText('in-date lots')).not.toBeInTheDocument();
  });

  it('never reports a negative on-hand for a fully-issued pool item', async () => {
    mockGetItems.mockResolvedValue({
      items: [makeItem({ name: 'Nitrile Gloves', tracking_type: 'pool', quantity: 0, quantity_issued: 1 })],
      total: 1,
    });
    renderWithRouter(<InventoryItemsPage />);
    await screen.findAllByText('Nitrile Gloves');

    expect(screen.getAllByText('0 / 1').length).toBeGreaterThan(0);
    expect(screen.queryByText('-1 / 0')).not.toBeInTheDocument();
  });

  it('opens the receive-stock modal', async () => {
    mockGetItems.mockResolvedValue({ items: [makeItem()], total: 1 });
    const user = userEvent.setup();
    renderWithRouter(<InventoryItemsPage />);
    await screen.findAllByText('Cordless Drill');

    await user.click(screen.getByRole('button', { name: /Receive Stock/ }));
    expect(await screen.findByText('receive-stock-modal')).toBeInTheDocument();
  });

  it('opens the add-item modal', async () => {
    mockGetItems.mockResolvedValue({ items: [makeItem()], total: 1 });
    const user = userEvent.setup();
    renderWithRouter(<InventoryItemsPage />);
    await screen.findAllByText('Cordless Drill');

    await user.click(screen.getByRole('button', { name: /Add Item/ }));
    expect(await screen.findByText('item-form-modal')).toBeInTheDocument();
  });

  it('passes the search term to the items query (debounced)', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryItemsPage />);
    await screen.findByText('No items found');

    await user.type(screen.getByPlaceholderText('Search items...'), 'drill');
    await waitFor(() => expect(mockGetItems).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'drill' })));
  });

  it('refetches when the status filter changes', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryItemsPage />);
    await screen.findByText('No items found');

    const statusSelect = screen.getByLabelText('Filter by status');
    await user.selectOptions(statusSelect, 'assigned');
    await waitFor(() => expect(mockGetItems).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'assigned' })));
  });

  it('hides the add-item action without the manage permission', async () => {
    mockCheckPermission.mockReturnValue(false);
    mockGetItems.mockResolvedValue({ items: [makeItem()], total: 1 });
    renderWithRouter(<InventoryItemsPage />);
    await screen.findAllByText('Cordless Drill');

    expect(screen.queryByRole('button', { name: /Add Item/ })).not.toBeInTheDocument();
  });

  it('opens the edit modal from a row action', async () => {
    mockGetItems.mockResolvedValue({ items: [makeItem()], total: 1 });
    const user = userEvent.setup();
    renderWithRouter(<InventoryItemsPage />);
    await screen.findAllByText('Cordless Drill');

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(await screen.findByText('item-form-modal')).toBeInTheDocument();
  });

  it('retires an item from a row action', async () => {
    mockGetItems.mockResolvedValue({ items: [makeItem()], total: 1 });
    const user = userEvent.setup();
    renderWithRouter(<InventoryItemsPage />);
    await screen.findAllByText('Cordless Drill');

    await user.click(screen.getByRole('button', { name: 'Retire' }));
    await waitFor(() => expect(mockRetireItem).toHaveBeenCalledWith('it-1'));
  });
});

describe('InventoryItemsPage — the item_type URL filter', () => {
  // The inventory hub's supply-line cards link straight at one domain, so the
  // list has to read the type out of the URL rather than only out of its own
  // dropdown. Each test states the mocks it depends on: `vi.clearAllMocks()`
  // resets calls but not implementations, so a block that configures nothing
  // runs on whatever its neighbour left behind (CLAUDE.md #28).
  beforeEach(() => {
    mockGetItems.mockReset();
    mockGetItems.mockResolvedValue({ items: [], total: 0 });
    mockGetSummary.mockReset();
    mockGetSummary.mockResolvedValue({
      total_items: 0,
      non_medical_items: 0,
      overdue_checkouts: 0,
      maintenance_due_count: 0,
      total_value: 0,
    });
    mockGetSummaryByLocation.mockReset();
    mockGetSummaryByLocation.mockResolvedValue([]);
    mockGetCategories.mockReset();
    mockGetCategories.mockResolvedValue([]);
    mockGetStorageAreas.mockReset();
    mockGetStorageAreas.mockResolvedValue([]);
    mockGetItemColors.mockReset();
    mockGetItemColors.mockResolvedValue([]);
    mockGetLocations.mockReset();
    mockGetLocations.mockResolvedValue([]);
    mockCheckPermission.mockReset();
    mockCheckPermission.mockReturnValue(true);
  });

  // renderWithRouter mounts a BrowserRouter, which reads window.location — so
  // the URL is the fixture here, and it has to be put back or it leaks into
  // every test that runs after this block.
  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  const renderAt = (url: string) => {
    window.history.pushState({}, '', url);
    return renderWithRouter(<InventoryItemsPage />);
  };

  it('filters the query by a type named in the URL', async () => {
    renderAt('/inventory/admin/items?item_type=uniform');
    await screen.findByText('No items found');

    expect(mockGetItems).toHaveBeenCalledWith(expect.objectContaining({ item_type: 'uniform' }));
  });

  it('shows that type as the selected option, so it can be cleared', async () => {
    renderAt('/inventory/admin/items?item_type=uniform');
    await screen.findByText('No items found');

    expect(screen.getByLabelText('Filter by type')).toHaveValue('uniform');
  });

  it('ignores a type outside the enum rather than sending it', async () => {
    // GET /items 400s on an unknown item_type, so a hand-edited URL has to
    // degrade to the unfiltered list, not to an error page.
    renderAt('/inventory/admin/items?item_type=not-a-type');
    await screen.findByText('No items found');

    expect(mockGetItems).toHaveBeenCalledWith(expect.objectContaining({ item_type: undefined }));
    expect(screen.getByLabelText('Filter by type')).toHaveValue('');
  });

  it('sends no type filter when the parameter is absent', async () => {
    renderAt('/inventory/admin/items');
    await screen.findByText('No items found');

    expect(mockGetItems).toHaveBeenCalledWith(expect.objectContaining({ item_type: undefined }));
  });

  it('writes the dropdown selection back to the URL', async () => {
    const user = userEvent.setup();
    renderAt('/inventory/admin/items');
    await screen.findByText('No items found');

    await user.selectOptions(screen.getByLabelText('Filter by type'), 'ppe');

    await waitFor(() => expect(window.location.search).toBe('?item_type=ppe'));
    await waitFor(() => expect(mockGetItems).toHaveBeenLastCalledWith(expect.objectContaining({ item_type: 'ppe' })));
  });

  it('drops the parameter when the filter is cleared', async () => {
    const user = userEvent.setup();
    renderAt('/inventory/admin/items?item_type=ppe');
    await screen.findByText('No items found');

    await user.selectOptions(screen.getByLabelText('Filter by type'), '');

    await waitFor(() => expect(window.location.search).toBe(''));
  });
});

describe('InventoryItemsPage — a bulk change that only half applies', () => {
  const two = [makeItem({ id: 'it-1', name: 'Drill' }), makeItem({ id: 'it-2', name: 'Saw' })];

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetItems.mockResolvedValue({ items: two, total: 2 });
    mockGetSummary.mockResolvedValue({
      total_items: 2,
      non_medical_items: 2,
      overdue_checkouts: 0,
      maintenance_due_count: 0,
      total_value: 0,
    });
    mockGetSummaryByLocation.mockResolvedValue([]);
    mockGetCategories.mockResolvedValue([]);
    mockGetStorageAreas.mockResolvedValue([]);
    mockGetLocations.mockResolvedValue([]);
    mockCheckPermission.mockReturnValue(true);
    mockUpdateItem.mockResolvedValue({});
  });

  const selectBoth = async (user: ReturnType<typeof userEvent.setup>) => {
    await screen.findByText('Drill');
    const selectAll = screen.getAllByRole('checkbox', { name: /^Select all/ })[0];
    await user.click(selectAll as HTMLElement);
  };

  it('reports what failed and still refreshes the list', async () => {
    // `Promise.all` rejects on the first failure, so the reload never ran and
    // the items that *did* change stayed on screen with their old status —
    // reachable now that setting status='available' is refused per item.
    mockUpdateItem
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce({ response: { data: { detail: 'Condition forbids AVAILABLE' } } });
    const user = userEvent.setup();
    renderWithRouter(<InventoryItemsPage />);
    await selectBoth(user);

    await user.click(screen.getByRole('button', { name: /Change Status/ }));
    await user.selectOptions(await screen.findByRole('combobox', { name: /new status/i }), 'in_maintenance');
    await user.click(screen.getByRole('button', { name: /Apply/ }));

    await waitFor(() => expect(mockUpdateItem).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
    expect(String(mockToastError.mock.calls[0]?.[0])).toContain('Condition forbids AVAILABLE');
    // The reload happens on both halves; the initial load is call 1.
    await waitFor(() => expect(mockGetItems.mock.calls.length).toBeGreaterThan(1));
  });

  it('counts the half that worked instead of calling the whole thing a failure', async () => {
    // A call count proves nothing here: `Promise.all` still *starts* every
    // request, it only rejects early. What it cannot do is report both
    // outcomes — the old code said just "Failed to update" while one item had
    // in fact changed.
    mockUpdateItem.mockRejectedValueOnce({ response: { data: { detail: 'nope' } } }).mockResolvedValueOnce({});
    const user = userEvent.setup();
    renderWithRouter(<InventoryItemsPage />);
    await selectBoth(user);

    await user.click(screen.getByRole('button', { name: /Change Status/ }));
    await user.selectOptions(await screen.findByRole('combobox', { name: /new status/i }), 'in_maintenance');
    await user.click(screen.getByRole('button', { name: /Apply/ }));

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalled());
    expect(String(mockToastSuccess.mock.calls[0]?.[0])).toContain('1 item(s)');
    expect(String(mockToastError.mock.calls[0]?.[0])).toContain('1 item(s)');
  });

  it('does not offer Retired in the bulk status picker — the backend rejects that pair through this path', async () => {
    // Retiring is the dedicated Retire action's job alone; update_item
    // rejects a status/condition pair of retired outright, so offering it
    // in this generic picker would deterministically 400 for every item.
    const user = userEvent.setup();
    renderWithRouter(<InventoryItemsPage />);
    await selectBoth(user);

    await user.click(screen.getByRole('button', { name: /Change Status/ }));
    const picker = await screen.findByRole('combobox', { name: /new status/i });

    expect(within(picker).queryByRole('option', { name: 'Retired' })).not.toBeInTheDocument();
  });
});

describe('InventoryItemsPage — the location panel', () => {
  // The cards above the list are links into it. A card that counts rows the
  // list excludes, or that cannot filter to the rows it counts, is a number
  // the department cannot reconcile with anything on screen.
  const panel = [
    {
      location_id: 'loc-1',
      location_name: "Quartermaster's Storage",
      item_count: 6,
      total_quantity: 30,
      total_value: 100,
    },
    { location_id: null, location_name: 'Unassigned', item_count: 2, total_quantity: 8, total_value: 0 },
  ];

  beforeEach(() => {
    mockGetItems.mockReset();
    mockGetItems.mockResolvedValue({ items: [makeItem()], total: 1 });
    mockGetSummary.mockReset();
    mockGetSummary.mockResolvedValue({
      total_items: 38,
      non_medical_items: 8,
      overdue_checkouts: 0,
      maintenance_due_count: 0,
      total_value: 100,
    });
    mockGetSummaryByLocation.mockReset();
    mockGetSummaryByLocation.mockResolvedValue(panel);
    mockGetCategories.mockReset();
    mockGetCategories.mockResolvedValue([]);
    mockGetStorageAreas.mockReset();
    mockGetStorageAreas.mockResolvedValue([]);
    mockGetLocations.mockReset();
    mockGetLocations.mockResolvedValue([]);
    mockCheckPermission.mockReset();
    mockCheckPermission.mockReturnValue(true);
  });

  const lastItemsCall = (): Record<string, unknown> =>
    (mockGetItems.mock.calls[mockGetItems.mock.calls.length - 1]?.[0] ?? {}) as Record<string, unknown>;

  it('starts with no location card selected', async () => {
    renderWithRouter(<InventoryItemsPage />);
    const card = await screen.findByRole('button', { name: /Unassigned/ });

    // `location_id: null` used to collapse onto the "All Locations" empty
    // string, so the Unassigned card read as selected on an unfiltered page.
    expect(card).toHaveAttribute('aria-pressed', 'false');
  });

  it('filters the list to items with no location when Unassigned is clicked', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryItemsPage />);
    await user.click(await screen.findByRole('button', { name: /Unassigned/ }));

    await waitFor(() => expect(lastItemsCall().unassigned_location).toBe(true));
    expect(lastItemsCall().location_id).toBeUndefined();
    expect(screen.getByRole('button', { name: /Unassigned/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('sends a location id, and no unassigned flag, for a real location', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryItemsPage />);
    await user.click(await screen.findByRole('button', { name: /Quartermaster/ }));

    await waitFor(() => expect(lastItemsCall().location_id).toBe('loc-1'));
    expect(lastItemsCall().unassigned_location).toBeUndefined();
  });

  it('clears the filter when the selected card is clicked again', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryItemsPage />);
    const card = await screen.findByRole('button', { name: /Unassigned/ });
    await user.click(card);
    await waitFor(() => expect(lastItemsCall().unassigned_location).toBe(true));

    await user.click(screen.getByRole('button', { name: /Unassigned/ }));

    await waitFor(() => expect(lastItemsCall().unassigned_location).toBeUndefined());
    expect(lastItemsCall().location_id).toBeUndefined();
  });

  it('offers Unassigned in the location dropdown too', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryItemsPage />);
    await user.selectOptions(await screen.findByRole('combobox', { name: /filter by location/i }), 'unassigned');

    await waitFor(() => expect(lastItemsCall().unassigned_location).toBe(true));
  });

  it('re-fetches for every filter the request carries, not just the first four', async () => {
    // Location, size, colour, style and the vendor scope were absent from the
    // reload effect's dependencies, so picking one changed the request the
    // page *would* send and never sent it. The list stayed as it was until an
    // unrelated reload applied the filter nobody had touched since.
    const user = userEvent.setup();
    renderWithRouter(<InventoryItemsPage />);
    await screen.findByRole('combobox', { name: /filter by size/i });

    await user.selectOptions(screen.getByRole('combobox', { name: /filter by size/i }), 'l');
    await waitFor(() => expect(lastItemsCall().size).toBe('l'));

    await user.click(screen.getByRole('button', { name: /Quartermaster/ }));
    await waitFor(() => expect(lastItemsCall().location_id).toBe('loc-1'));
    // The size the user picked first is still on the request.
    expect(lastItemsCall().size).toBe('l');
  });
});

describe('InventoryItemsPage — pinned shortlist', () => {
  // Its own defaults rather than the neighbouring block's: vi.clearAllMocks()
  // resets recorded calls but NOT implementations, so a block that configures
  // nothing runs on whatever ran before it (CLAUDE.md pitfall #28).
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetItems.mockReset();
    mockPinItem.mockReset();
    mockUnpinItem.mockReset();
    mockReorderItemPins.mockReset();

    mockGetItems.mockResolvedValue({
      items: [
        makeItem({ id: 'it-boots', name: 'Duty Boots', pin_position: 1 }),
        makeItem({ id: 'it-polo', name: 'Class B Polo', pin_position: 0 }),
        makeItem({ id: 'it-ladder', name: 'Attic Ladder' }),
        makeItem({ id: 'it-saw', name: 'Rotary Saw', status: 'maintenance' }),
      ],
      total: 4,
    });
    mockGetSummary.mockResolvedValue({
      total_items: 4,
      non_medical_items: 4,
      overdue_checkouts: 0,
      maintenance_due_count: 0,
      total_value: 0,
    });
    mockGetSummaryByLocation.mockResolvedValue([]);
    mockGetCategories.mockResolvedValue([]);
    mockGetStorageAreas.mockResolvedValue([]);
    mockGetItemColors.mockResolvedValue([]);
    mockGetLocations.mockResolvedValue([]);
    mockPinItem.mockResolvedValue({ id: 'pin-1', item_id: 'it-ladder', position: 2 });
    mockUnpinItem.mockResolvedValue(undefined);
    mockReorderItemPins.mockResolvedValue([]);
    mockCheckPermission.mockReturnValue(true);
  });

  /** The data rows of one section's table, header row dropped. */
  const sectionRows = async (name: string) => {
    const table = await screen.findByRole('table', { name });
    return within(table).getAllByRole('row').slice(1);
  };

  it('renders a Pinned section ordered by pin_position, not by name', async () => {
    renderWithRouter(<InventoryItemsPage />);

    const rows = await sectionRows('Pinned');
    // Polo is pin_position 0 and Boots is 1. Alphabetically Boots comes first,
    // so the pin order is the only thing that can produce this.
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Class B Polo');
    expect(rows[1]).toHaveTextContent('Duty Boots');
  });

  it('does not repeat a pinned item in the sections below', async () => {
    // The same id in two tables would render two checkboxes for one row and
    // desynchronise the bulk-selection Set.
    renderWithRouter(<InventoryItemsPage />);
    await screen.findByRole('heading', { name: /^Pinned$/ });

    const available = await sectionRows('Available');
    expect(available).toHaveLength(1);
    expect(available[0]).toHaveTextContent('Attic Ladder');
    expect(screen.getAllByText('Class B Polo')).toHaveLength(1);
  });

  it('pins an unpinned item and reloads the list', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryItemsPage />);

    await user.click(await screen.findByRole('button', { name: /^Pin Attic Ladder$/ }));
    await waitFor(() => expect(mockPinItem).toHaveBeenCalledWith('it-ladder'));
  });

  it('unpins a pinned item', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryItemsPage />);

    await user.click(await screen.findByRole('button', { name: /^Unpin Class B Polo$/ }));
    await waitFor(() => expect(mockUnpinItem).toHaveBeenCalledWith('it-polo'));
  });

  it('sends every pinned id when a row is moved, not just the one that moved', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryItemsPage />);

    await user.click(await screen.findByRole('button', { name: /Move Duty Boots up/i }));
    // A partial list is indistinguishable from a stale tab dropping a pin, so
    // the backend rejects one — the page must send the whole order.
    await waitFor(() => expect(mockReorderItemPins).toHaveBeenCalledWith(['it-boots', 'it-polo']));
  });

  it('disables Move up on the first pinned row and Move down on the last', async () => {
    renderWithRouter(<InventoryItemsPage />);

    expect(await screen.findByRole('button', { name: /Move Class B Polo up/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Move Duty Boots down/i })).toBeDisabled();
  });

  it('warns and refetches the real order when the reorder is rejected', async () => {
    mockReorderItemPins.mockRejectedValue(new Error('stale'));
    const user = userEvent.setup();
    renderWithRouter(<InventoryItemsPage />);
    await screen.findByRole('table', { name: 'Pinned' });
    const callsBefore = mockGetItems.mock.calls.length;

    await user.click(screen.getByRole('button', { name: /Move Duty Boots up/i }));
    await waitFor(() => expect(mockToastError).toHaveBeenCalled());

    // Refetched rather than rolled back to the browser's own stale copy: the
    // rejection this path exists for is "your list no longer matches ours", so
    // restoring what the browser already had leaves every retry failing.
    await waitFor(() => expect(mockGetItems.mock.calls.length).toBeGreaterThan(callsBefore));
    const rows = await sectionRows('Pinned');
    expect(rows[0]).toHaveTextContent('Class B Polo');
  });

  it('marks the sorted column with aria-sort', async () => {
    renderWithRouter(<InventoryItemsPage />);
    const nameHeaders = await screen.findAllByRole('columnheader', { name: /Name/ });
    // Default sort is name ascending.
    expect(nameHeaders[0]).toHaveAttribute('aria-sort', 'ascending');
  });

  it('says the count is a running tally when more items match than are loaded', async () => {
    mockGetItems.mockResolvedValue({
      items: [makeItem({ id: 'it-ladder', name: 'Attic Ladder' })],
      total: 87,
    });
    renderWithRouter(<InventoryItemsPage />);

    // A bare "(1)" would read as "there is one available item" when 87 match.
    expect(await screen.findByText('(1 so far)')).toBeInTheDocument();
  });

  it('shows no Pinned section when the member has pinned nothing', async () => {
    mockGetItems.mockResolvedValue({
      items: [makeItem({ id: 'it-ladder', name: 'Attic Ladder' })],
      total: 1,
    });
    renderWithRouter(<InventoryItemsPage />);
    await screen.findByText('Attic Ladder');

    expect(screen.queryByRole('heading', { name: /^Pinned$/ })).not.toBeInTheDocument();
  });
});

describe('InventoryItemsPage — grouping', () => {
  // Own defaults rather than a neighbour's: vi.clearAllMocks() resets recorded
  // calls but not implementations (CLAUDE.md pitfall #28).
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetItems.mockReset();
    mockGetItems.mockResolvedValue({
      items: [
        makeItem({ id: 'a-coat', name: 'Dress Coat', category_id: 'cat-a', group_key: 'cat-a' }),
        makeItem({ id: 'b-polo', name: 'Class B Polo', category_id: 'cat-b', group_key: 'cat-b' }),
      ],
      total: 2,
      groups: [
        { key: 'cat-a', label: 'Class A Uniform', available_count: 12, unavailable_count: 1 },
        { key: 'cat-b', label: 'Class B Uniform', available_count: 30, unavailable_count: 0 },
      ],
    });
    mockGetSummary.mockResolvedValue({
      total_items: 2,
      non_medical_items: 2,
      overdue_checkouts: 0,
      maintenance_due_count: 0,
      total_value: 0,
    });
    mockGetSummaryByLocation.mockResolvedValue([]);
    mockGetCategories.mockResolvedValue([
      { id: 'cat-a', name: 'Class A Uniform', item_type: 'uniform', active: true },
      { id: 'cat-b', name: 'Class B Uniform', item_type: 'uniform', active: true },
    ]);
    mockGetStorageAreas.mockResolvedValue([]);
    mockGetItemColors.mockResolvedValue([]);
    mockGetLocations.mockResolvedValue([]);
    mockCheckPermission.mockReturnValue(true);
  });

  const lastItemsCall = (): Record<string, unknown> =>
    (mockGetItems.mock.calls[mockGetItems.mock.calls.length - 1]?.[0] ?? {}) as Record<string, unknown>;

  const chooseGrouping = async (value: string) => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryItemsPage />);
    await screen.findByLabelText('Group by:');
    await user.selectOptions(screen.getByLabelText('Group by:'), value);
    return user;
  };

  it('sends group_by on the request when a dimension is chosen', async () => {
    await chooseGrouping('category');
    await waitFor(() => expect(lastItemsCall().group_by).toBe('category'));
  });

  it('does not send group_by when grouping is off', async () => {
    renderWithRouter(<InventoryItemsPage />);
    await screen.findByLabelText('Group by:');
    expect(lastItemsCall().group_by).toBeUndefined();
  });

  it("labels each group with the backend's whole-set count, not the loaded rows", async () => {
    await chooseGrouping('category');

    // One Class A row is loaded but 12 match. A tally of what arrived is the
    // exact mislabel counting server-side exists to prevent.
    const header = await screen.findByRole('button', { name: /Class A Uniform/ });
    expect(header).toHaveTextContent('(12)');
  });

  it('collapses a group and keeps its count visible', async () => {
    const user = await chooseGrouping('category');
    const header = await screen.findByRole('button', { name: /Class A Uniform/ });
    expect(header).toHaveAttribute('aria-expanded', 'true');

    await user.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(header).toHaveTextContent('(12)');
    // The row is gone; the header that accounts for it is not.
    expect(screen.queryByText('Dress Coat')).not.toBeInTheDocument();
  });

  it('clears collapse state when the dimension changes', async () => {
    const user = await chooseGrouping('category');
    await user.click(await screen.findByRole('button', { name: /Class A Uniform/ }));
    expect(screen.queryByText('Dress Coat')).not.toBeInTheDocument();

    // Collapse state is keyed by group VALUE, and 'cat-a' means nothing under
    // Colour — carrying it over would collapse an unrelated bucket.
    await user.selectOptions(screen.getByLabelText('Group by:'), 'color');
    expect(await screen.findByText('Dress Coat')).toBeInTheDocument();
  });

  it('heads the no-value bucket "Unspecified" rather than dropping it', async () => {
    mockGetItems.mockResolvedValue({
      items: [makeItem({ id: 'x', name: 'Unsorted Helmet', group_key: null })],
      total: 1,
      groups: [{ key: null, label: null, available_count: 1, unavailable_count: 0 }],
    });
    await chooseGrouping('category');

    // An item with no category is a group, not an absence of one — it must
    // not vanish from a list it matches the filters for.
    expect(await screen.findByRole('button', { name: /Unspecified/ })).toBeInTheDocument();
    expect(screen.getByText('Unsorted Helmet')).toBeInTheDocument();
  });

  it("files a row under the server's key even when local data would disagree", async () => {
    // The regression this guards: the page used to re-derive the group key
    // from the row's own fields plus a locations lookup capped at 100 rows.
    // Colour keys lower-cased, location follows a COALESCE, item_type lives on
    // the category — every one a chance to disagree with the header's count,
    // and the failure is a silent missing total (CLAUDE.md pitfall #29).
    mockGetItems.mockResolvedValue({
      items: [
        // Nothing on this row spells 'far-loc'; only the server knows it.
        makeItem({ id: 'far', name: 'Distant Nozzle', group_key: 'far-loc' }),
      ],
      total: 1,
      groups: [{ key: 'far-loc', label: 'Shelf Z-9', available_count: 7, unavailable_count: 0 }],
    });
    await chooseGrouping('location');

    const header = await screen.findByRole('button', { name: /Shelf Z-9/ });
    expect(header).toHaveTextContent('(7)');
    expect(screen.getByText('Distant Nozzle')).toBeInTheDocument();
    // Not stranded under Unspecified with no count.
    expect(screen.queryByRole('button', { name: /Unspecified/ })).not.toBeInTheDocument();
  });

  it('leaves a department-authored name exactly as typed', async () => {
    // Underscore-opening is for enum values like `in_maintenance`. Category,
    // colour, location and vendor names are typed by the department, so an
    // unconditional replace rewrites their own data.
    mockGetItems.mockResolvedValue({
      items: [makeItem({ id: 's1', name: 'Nozzle', group_key: 'cat-s1' })],
      total: 1,
      groups: [{ key: 'cat-s1', label: 'Station_1', available_count: 1, unavailable_count: 0 }],
    });
    await chooseGrouping('category');

    expect(await screen.findByRole('button', { name: /Station_1/ })).toBeInTheDocument();
  });

  it('opens out underscores in an enum-backed value', async () => {
    mockGetItems.mockResolvedValue({
      items: [makeItem({ id: 'm1', name: 'Saw', group_key: 'in_maintenance' })],
      total: 1,
      groups: [{ key: 'in_maintenance', label: 'in_maintenance', available_count: 0, unavailable_count: 1 }],
    });
    await chooseGrouping('condition');

    expect(await screen.findByRole('button', { name: /in maintenance/i })).toBeInTheDocument();
  });

  it('gives each group its own row group', async () => {
    const user = await chooseGrouping('category');
    expect(user).toBeDefined();

    // Wait for the grouped fetch: grouping does not apply until rows fetched
    // for that dimension arrive.
    await screen.findByRole('button', { name: /Class A Uniform/ });
    const table = screen.getByRole('table', { name: 'Available' });
    // thead plus one tbody per group. A single tbody would bind every
    // scope="rowgroup" header to the rows of the whole table rather than its
    // own, handing a screen reader the wrong group-to-row map.
    expect(within(table).getAllByRole('rowgroup')).toHaveLength(3);
  });

  it('renders no group headers when grouping is off', async () => {
    renderWithRouter(<InventoryItemsPage />);
    await screen.findByText('Dress Coat');
    expect(screen.queryByRole('button', { name: /Class A Uniform \(/ })).not.toBeInTheDocument();
  });
});

describe('InventoryItemsPage — the grouped dimension leaves the row', () => {
  // One rule under test: whatever you group by is stated once by the group
  // header and never repeated on the rows beneath — whether it lives in a real
  // column or in a variant capsule.
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetItems.mockReset();
    mockGetItems.mockResolvedValue({
      items: [
        makeItem({
          id: 'a-coat',
          name: 'Dress Coat',
          category_id: 'cat-a',
          group_key: 'cat-a',
          size: 'l',
          standard_size: 'l',
          color: 'Navy',
          storage_location: 'Shelf B-3',
        }),
        makeItem({
          id: 'b-polo',
          name: 'Class B Polo',
          category_id: 'cat-b',
          group_key: 'cat-b',
          size: 'l',
          standard_size: 'l',
          color: 'Navy',
          storage_location: 'Shelf B-3',
        }),
      ],
      total: 2,
      groups: [
        { key: 'cat-a', label: 'Class A Uniform', available_count: 1, unavailable_count: 0 },
        { key: 'cat-b', label: 'Class B Uniform', available_count: 1, unavailable_count: 0 },
      ],
    });
    mockGetSummary.mockResolvedValue({
      total_items: 2,
      non_medical_items: 2,
      overdue_checkouts: 0,
      maintenance_due_count: 0,
      total_value: 0,
    });
    mockGetSummaryByLocation.mockResolvedValue([]);
    mockGetCategories.mockResolvedValue([
      { id: 'cat-a', name: 'Class A Uniform', item_type: 'uniform', active: true },
      { id: 'cat-b', name: 'Class B Uniform', item_type: 'uniform', active: true },
    ]);
    mockGetStorageAreas.mockResolvedValue([]);
    mockGetItemColors.mockResolvedValue([]);
    mockGetLocations.mockResolvedValue([]);
    mockCheckPermission.mockReturnValue(true);
  });

  const lastItemsCall = (): Record<string, unknown> =>
    (mockGetItems.mock.calls[mockGetItems.mock.calls.length - 1]?.[0] ?? {}) as Record<string, unknown>;

  const groupBy = async (value: string) => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryItemsPage />);
    await screen.findByLabelText('Group by:');
    await user.selectOptions(screen.getByLabelText('Group by:'), value);
    // Grouping deliberately does not apply until rows fetched FOR that
    // dimension arrive — otherwise the previous dimension's keys are rendered
    // under the new dimension's headings. So wait for the request to carry it
    // and for a group heading to appear, rather than asserting mid-flight.
    await waitFor(() => expect(lastItemsCall().group_by).toBe(value));
    await screen.findByRole('button', { name: /Class A Uniform/ });
    return user;
  };

  const header = (name: string) => screen.queryAllByRole('columnheader', { name });

  it('leaves every column in place when nothing is grouped', async () => {
    renderWithRouter(<InventoryItemsPage />);
    await screen.findByText('Dress Coat');

    // The promise this change makes: the default view is untouched.
    expect(header('Category').length).toBeGreaterThan(0);
    expect(header('Location').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('columnheader', { name: /Condition/ }).length).toBeGreaterThan(0);
    expect(header('Size')).toHaveLength(0);
  });

  it('drops the Category column when grouped by category', async () => {
    await groupBy('category');

    expect(header('Category')).toHaveLength(0);
    // Named once, by the header that accounts for the rows.
    expect(screen.getByRole('button', { name: /Class A Uniform/ })).toBeInTheDocument();
  });

  it('drops the Condition column when grouped by condition', async () => {
    await groupBy('condition');
    expect(screen.queryAllByRole('columnheader', { name: /Condition/ })).toHaveLength(0);
  });

  it('drops the Location column when grouped by location', async () => {
    await groupBy('location');
    expect(header('Location')).toHaveLength(0);
  });

  // Scoped to the table: the filter bar carries an "All Sizes" select whose
  // options include a literal "L", so an unscoped text query matches the
  // control rather than the rows.
  const sizesInRows = () => within(screen.getByRole('table', { name: 'Available' })).queryAllByText('L');

  it('adds a Size column when grouping, and shows size once not twice', async () => {
    renderWithRouter(<InventoryItemsPage />);
    await screen.findByText('Dress Coat');
    // Ungrouped: size appears once per row, as a capsule.
    expect(sizesInRows()).toHaveLength(2);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Group by:'), 'category');
    await waitFor(() => expect(header('Size').length).toBeGreaterThan(0));

    // Still once per row — now the column, not the capsule. Four would mean
    // the capsule stayed and the column duplicated it.
    expect(sizesInRows()).toHaveLength(2);
  });

  it('drops the colour capsule when grouped by colour', async () => {
    await groupBy('color');

    // Colour only ever renders as a capsule, so its absence is unambiguous.
    await waitFor(() => expect(screen.queryByText('Navy')).not.toBeInTheDocument());
    // And the columns it does not own are untouched.
    expect(header('Category').length).toBeGreaterThan(0);
    expect(header('Size').length).toBeGreaterThan(0);
  });

  it('adds no Size column when size IS the grouping', async () => {
    await groupBy('size');

    // The header already says it; a column would be the exact redundancy this
    // rule removes.
    expect(header('Size')).toHaveLength(0);
    expect(sizesInRows()).toHaveLength(0);
  });

  it('hides no column for a dimension that has none, but still adds Size', async () => {
    await groupBy('vendor');

    // Proves the two rules are independent: nothing to hide, Size still gained.
    expect(header('Category').length).toBeGreaterThan(0);
    expect(header('Location').length).toBeGreaterThan(0);
    expect(header('Size').length).toBeGreaterThan(0);
  });
});

describe('InventoryItemsPage — CSV export', () => {
  // This block states every mock implementation it depends on rather than
  // inheriting whatever ran before it, and resets each one before installing
  // the default (CLAUDE.md pitfall #28). `vi.clearAllMocks()` is not enough on
  // its own: it clears recorded calls but leaves implementations in place, and
  // an unconsumed `...Once` queued by an earlier block is still handed out
  // ahead of a `mockResolvedValue` set here. Resetting only the two mocks this
  // block asserts on left the other seven able to serve a leaked one-shot, so
  // these tests could pass or fail differently focused than in place.
  beforeEach(() => {
    vi.clearAllMocks();
    for (const mock of [
      mockGetItems,
      mockGetSummary,
      mockGetSummaryByLocation,
      mockGetCategories,
      mockGetStorageAreas,
      mockGetLocations,
      mockGetItemColors,
      mockCheckPermission,
      mockExportItemsCsv,
    ]) {
      mock.mockReset();
    }

    mockGetItems.mockResolvedValue({ items: [], total: 0 });
    mockGetSummary.mockResolvedValue({
      total_items: 0,
      non_medical_items: 0,
      overdue_checkouts: 0,
      maintenance_due_count: 0,
      total_value: 0,
    });
    mockGetSummaryByLocation.mockResolvedValue([]);
    mockGetCategories.mockResolvedValue([]);
    mockGetStorageAreas.mockResolvedValue([]);
    mockGetLocations.mockResolvedValue([{ id: 'loc-1', name: 'Station 1' }]);
    mockGetItemColors.mockResolvedValue(['Navy']);
    mockCheckPermission.mockReturnValue(true);
    mockExportItemsCsv.mockResolvedValue(new Blob(['Name\n'], { type: 'text/csv' }));

    // jsdom implements neither, and the handler calls both around the download.
    const url = URL as unknown as { createObjectURL?: unknown; revokeObjectURL?: unknown };
    url.createObjectURL = vi.fn(() => 'blob:export');
    url.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    const url = URL as unknown as { createObjectURL?: unknown; revokeObjectURL?: unknown };
    delete url.createObjectURL;
    delete url.revokeObjectURL;
  });

  it('exports the list on screen, not a hand-picked three of its filters', async () => {
    // The regression this suite exists for: the handler named category, status
    // and search out of eleven filters, so narrowing to one colour and
    // condition and hitting Export produced the whole department's uniforms —
    // under a filename saying otherwise, which is what makes it dangerous.
    //
    // Asserted against the parameters the LIST was fetched with rather than a
    // literal object, so a filter added to the page fails this test until it
    // reaches the export too.
    const user = userEvent.setup();
    renderWithRouter(<InventoryItemsPage />);
    await screen.findByText('No items found');

    await user.type(screen.getByLabelText('Search items...'), 'helmet');
    await user.selectOptions(screen.getByLabelText('Filter by status'), 'assigned');
    await user.selectOptions(screen.getByLabelText('Filter by condition'), 'fair');
    await user.selectOptions(screen.getByLabelText('Filter by type'), 'uniform');
    await user.selectOptions(await screen.findByLabelText('Filter by color'), 'Navy');
    await user.selectOptions(screen.getByLabelText('Filter by location'), 'loc-1');

    await waitFor(() =>
      expect(mockGetItems).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: 'helmet', color: 'Navy', location_id: 'loc-1' })
      )
    );

    await user.click(screen.getByRole('button', { name: /Export/ }));
    await waitFor(() => expect(mockExportItemsCsv).toHaveBeenCalledTimes(1));

    // `mock.calls` off an untyped `vi.fn()` is `any[][]`, so `.at()` on it is
    // an unsafe call the type-aware lint rejects. Narrowed once, here.
    const calls = mockGetItems.mock.calls as unknown as Record<string, unknown>[][];
    const listCall = calls[calls.length - 1]?.[0] ?? {};
    // Paging is the list's own concern; `group_by` orders rows on screen and a
    // spreadsheet regroups for itself. Everything else must match.
    const { skip: _skip, limit: _limit, group_by: _groupBy, ...expected } = listCall;
    expect(mockExportItemsCsv).toHaveBeenLastCalledWith(expected);
  });

  it('carries the sort the list is using', async () => {
    // The sort controls only render with rows beneath them.
    mockGetItems.mockResolvedValue({ items: [makeItem()], total: 1 });
    const user = userEvent.setup();
    renderWithRouter(<InventoryItemsPage />);
    await screen.findAllByText('Cordless Drill');

    await user.click(screen.getByRole('button', { name: /Sort descending/i }));
    await waitFor(() => expect(mockGetItems).toHaveBeenLastCalledWith(expect.objectContaining({ sort_order: 'desc' })));

    await user.click(screen.getByRole('button', { name: /Export/ }));
    await waitFor(() =>
      expect(mockExportItemsCsv).toHaveBeenLastCalledWith(expect.objectContaining({ sort_order: 'desc' }))
    );
  });

  it('reports a failed export instead of claiming one', async () => {
    mockExportItemsCsv.mockRejectedValue({ response: { data: { detail: 'Invalid status: bogus' } } });
    const user = userEvent.setup();
    renderWithRouter(<InventoryItemsPage />);
    await screen.findByText('No items found');

    await user.click(screen.getByRole('button', { name: /Export/ }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
    expect(String(mockToastError.mock.calls[0]?.[0])).toContain('Invalid status: bogus');
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  // Filter changes are debounced by FILTER_DEBOUNCE_MS (350ms), so between a
  // click on a filter and the response landing, the controls and the rows
  // disagree. Export has to follow the rows: a file named for today's
  // inventory that describes a filter set the reader never saw is the same
  // defect this whole suite exists for, one layer in.
  describe('while a filter change is still in flight', () => {
    it('exports the filters the visible rows were fetched with, not the pending ones', async () => {
      const user = userEvent.setup();
      renderWithRouter(<InventoryItemsPage />);
      await screen.findByText('No items found');
      await waitFor(() => expect(mockGetItems).toHaveBeenCalled());
      const loadsBefore = mockGetItems.mock.calls.length;

      await user.selectOptions(screen.getByLabelText('Filter by status'), 'assigned');
      // Deliberately no wait: this is the window the finding is about. The
      // select already reads "assigned"; the rows on screen do not.
      await user.click(screen.getByRole('button', { name: /Export/ }));

      await waitFor(() => expect(mockExportItemsCsv).toHaveBeenCalledTimes(1));
      expect(mockGetItems.mock.calls.length).toBe(loadsBefore);
      expect(mockExportItemsCsv).toHaveBeenLastCalledWith(expect.objectContaining({ status: undefined }));
    });

    it('picks up the new filters once their rows have actually arrived', async () => {
      const user = userEvent.setup();
      renderWithRouter(<InventoryItemsPage />);
      await screen.findByText('No items found');

      await user.selectOptions(screen.getByLabelText('Filter by status'), 'assigned');
      await waitFor(() =>
        expect(mockGetItems).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'assigned' }))
      );

      await user.click(screen.getByRole('button', { name: /Export/ }));
      await waitFor(() =>
        expect(mockExportItemsCsv).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'assigned' }))
      );
    });

    it('holds the last successful filters when the refresh fails', async () => {
      // The half that a "disable Export while a request is pending" fix would
      // miss: a rejected load leaves the old rows on screen with nothing
      // pending, so Export re-enables and would export filters those rows were
      // never fetched with -- indefinitely.
      const user = userEvent.setup();
      renderWithRouter(<InventoryItemsPage />);
      await screen.findByText('No items found');

      mockGetItems.mockRejectedValue(new Error('boom'));
      await user.selectOptions(screen.getByLabelText('Filter by status'), 'assigned');
      await waitFor(() => expect(mockToastError).toHaveBeenCalled());

      await user.click(screen.getByRole('button', { name: /Export/ }));
      await waitFor(() => expect(mockExportItemsCsv).toHaveBeenCalledTimes(1));
      expect(mockExportItemsCsv).toHaveBeenLastCalledWith(expect.objectContaining({ status: undefined }));
    });

    it('offers no Export until a list has actually loaded', async () => {
      // A never-resolving load, so the page sits in the state before any
      // response. Exporting here would send filters against no rows at all.
      mockGetItems.mockImplementation(() => new Promise(() => {}));
      renderWithRouter(<InventoryItemsPage />);

      await waitFor(() => expect(screen.getByRole('button', { name: /Export/ })).toBeDisabled());
    });
  });

  describe('collapsing groups and folding variants', () => {
    // Two independent folds share one `Set` each, and both are keyed per
    // SECTION -- Available and Unavailable are different populations that
    // happen to share a heading.
    const shirt = (id: string, size: string, over: Partial<InventoryItem> = {}) =>
      makeItem({
        id,
        name: `Duty Shirt \u2014 ${size}`,
        variant_group_id: 'vg-1',
        standard_size: size.toLowerCase(),
        tracking_type: 'pool',
        quantity: 4,
        group_key: 'Uniforms',
        ...over,
      });

    beforeEach(() => {
      // This block installs its own getItems per test; state the default it
      // returns to so a queued `...Once` cannot leak forward (pitfall #28).
      mockGetItems.mockReset();
      mockGetItems.mockResolvedValue({ items: [], total: 0 });
    });

    /** The table row carrying a folded product's control. */
    const productRow = (name: RegExp): HTMLElement => {
      const row = screen.getAllByRole('row').find((r) => within(r).queryByRole('button', { name }) !== null);
      if (!row) throw new Error(`no product row matching ${String(name)}`);
      return row;
    };

    const groupBy = async (dimension: string) => {
      const select = await screen.findByLabelText('Group by:');
      await userEvent.selectOptions(select, dimension);
    };

    it('folds adjacent variants of one product into a single row', async () => {
      mockGetItems.mockResolvedValue({
        items: [shirt('v-s', 'S'), shirt('v-m', 'M'), shirt('v-l', 'L')],
        total: 3,
      });
      renderWithRouter(<InventoryItemsPage />);

      // One product row, not three item rows.
      expect(await screen.findByRole('button', { name: /Duty Shirt/ })).toBeInTheDocument();
      expect(screen.getByText('3 loaded')).toBeInTheDocument();
      // The individual sizes are not on screen until it is opened.
      expect(screen.queryByRole('link', { name: 'S' })).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: /Duty Shirt/ }));
      expect(screen.getByRole('link', { name: 'S' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'M' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'L' })).toBeInTheDocument();
    });

    it('leaves non-adjacent variants as separate rows', async () => {
      // Adjacency is the contract: under a sort that scatters a product's
      // variants the fold must not fire, rather than reordering rows away
      // from the sort the member picked.
      mockGetItems.mockResolvedValue({
        items: [shirt('v-s', 'S'), makeItem({ id: 'other', name: 'Halligan Bar' }), shirt('v-m', 'M')],
        total: 3,
      });
      renderWithRouter(<InventoryItemsPage />);

      // Two rows named for the same product, each its own row: the fold did
      // not fire, which is the point. (Two, not one, so `findAll`.)
      expect((await screen.findAllByRole('link', { name: 'Duty Shirt' })).length).toBe(2);
      expect(screen.queryByText('2 loaded')).not.toBeInTheDocument();
    });

    it('sums on-hand across the folded variants', async () => {
      mockGetItems.mockResolvedValue({
        items: [shirt('v-s', 'S', { quantity: 4 }), shirt('v-m', 'M', { quantity: 6 })],
        total: 2,
      });
      renderWithRouter(<InventoryItemsPage />);

      await screen.findByRole('button', { name: /Duty Shirt/ });
      expect(within(productRow(/Duty Shirt/)).getByText('10')).toBeInTheDocument();
    });

    it("says Mixed rather than picking one variant's value", async () => {
      // Reporting the lead's location as the product's would send a
      // quartermaster to the wrong shelf.
      mockGetItems.mockResolvedValue({
        items: [shirt('v-s', 'S', { storage_location: 'Bay 1' }), shirt('v-m', 'M', { storage_location: 'Bay 2' })],
        total: 2,
      });
      renderWithRouter(<InventoryItemsPage />);

      await screen.findByRole('button', { name: /Duty Shirt/ });
      const row = productRow(/Duty Shirt/);
      expect(within(row).getAllByText('Mixed').length).toBeGreaterThan(0);
      expect(within(row).queryByText('Bay 1')).not.toBeInTheDocument();
    });

    it('collapsing a group under Available leaves Unavailable expanded', async () => {
      mockGetItems.mockResolvedValue({
        items: [
          makeItem({ id: 'a-1', name: 'Ready Helmet', status: 'available', group_key: 'PPE' }),
          makeItem({ id: 'u-1', name: 'Broken Helmet', status: 'damaged', group_key: 'PPE' }),
        ],
        total: 2,
        groups: [{ key: 'PPE', label: 'PPE', count: 2 }],
      });
      renderWithRouter(<InventoryItemsPage />);
      await groupBy('category');
      // The group HEADER, not a row name: the row is on screen ungrouped too,
      // so awaiting it proves nothing about the debounced regrouped reload.
      await screen.findAllByRole('button', { name: /PPE/ });

      const available = screen.getByRole('table', { name: 'Available' });
      await userEvent.click(within(available).getByRole('button', { name: /PPE/ }));

      expect(screen.queryByText('Ready Helmet')).not.toBeInTheDocument();
      // The other section's identically-named group is untouched.
      expect(screen.getByText('Broken Helmet')).toBeInTheDocument();
    });

    it('loads the next page when a collapse leaves nothing visible', async () => {
      // Paging is by item row, so a collapsed group's rows still consume the
      // page. A page that is entirely hidden must refill itself rather than
      // leaving headings over an empty table.
      // Keyed on `skip`, not queued with `...Once`: the page loads once
      // ungrouped and again when the grouping is chosen, so a queued value is
      // spent before the assertion ever gets to it.
      const groups = [
        { key: 'PPE', label: 'PPE', count: 1 },
        { key: 'Tools', label: 'Tools', count: 1 },
      ];
      mockGetItems.mockImplementation((params: unknown) =>
        Promise.resolve(
          ((params as { skip?: number } | undefined)?.skip ?? 0) === 0
            ? {
                items: [makeItem({ id: 'p1', name: 'Hidden Helmet', group_key: 'PPE' })],
                total: 2,
                groups,
              }
            : {
                items: [makeItem({ id: 'p2', name: 'Second Page Axe', group_key: 'Tools' })],
                total: 2,
                groups,
              }
        )
      );
      renderWithRouter(<InventoryItemsPage />);
      await groupBy('category');
      await screen.findAllByRole('button', { name: /PPE/ });

      const available = screen.getByRole('table', { name: 'Available' });
      await userEvent.click(within(available).getByRole('button', { name: /PPE/ }));

      // The top-up fetched the next page rather than leaving the table empty.
      expect(await screen.findByText('Second Page Axe')).toBeInTheDocument();
    });

    it('stops topping up once the whole set is loaded', async () => {
      // The guard that terminates the loop is `hasMore`. With every row
      // loaded and every one hidden, the page must settle rather than
      // fetching forever.
      mockGetItems.mockResolvedValue({
        items: [makeItem({ id: 'p1', name: 'Hidden Helmet', group_key: 'PPE' })],
        total: 1,
        groups: [{ key: 'PPE', label: 'PPE', count: 1 }],
      });
      renderWithRouter(<InventoryItemsPage />);
      await groupBy('category');
      await screen.findAllByRole('button', { name: /PPE/ });
      const before = mockGetItems.mock.calls.length;

      const available = screen.getByRole('table', { name: 'Available' });
      await userEvent.click(within(available).getByRole('button', { name: /PPE/ }));

      await waitFor(() => expect(screen.queryByText('Hidden Helmet')).not.toBeInTheDocument());
      expect(mockGetItems.mock.calls.length).toBe(before);
    });
  });

  describe('bounding the automatic top-up', () => {
    beforeEach(() => {
      mockGetItems.mockReset();
      mockGetItems.mockResolvedValue({ items: [], total: 0 });
    });

    const hiddenPage = (id: string) => ({
      items: [makeItem({ id, name: `Hidden ${id}`, group_key: 'PPE' })],
      total: 10_000,
      groups: [{ key: 'PPE', label: 'PPE', count: 10_000 }],
    });

    const collapsePPE = async () => {
      const select = await screen.findByLabelText('Group by:');
      await userEvent.selectOptions(select, 'category');
      await screen.findAllByRole('button', { name: /PPE/ });
      const available = screen.getByRole('table', { name: 'Available' });
      await userEvent.click(within(available).getByRole('button', { name: /PPE/ }));
    };

    it('never issues more than MAX_AUTO_TOP_UPS automatic pages', async () => {
      // A collapsed group can outrun a page: the backend orders by group key
      // and then applies offset/limit, so nothing keeps a group inside one.
      // The cap is what stops "keep going until something is visible" from
      // walking a 400-row category. Counted by offset, because the top-ups
      // flush inside the same act() as the collapse.
      let page = 0;
      const topUps: number[] = [];
      mockGetItems.mockImplementation((params: unknown) => {
        const skip = (params as { skip?: number } | undefined)?.skip ?? 0;
        if (skip > 0) topUps.push(skip);
        return Promise.resolve(hiddenPage(`p${(page += 1)}`));
      });

      renderWithRouter(<InventoryItemsPage />);
      await collapsePPE();

      await waitFor(() => expect(topUps.length).toBeGreaterThan(0));
      await new Promise((r) => setTimeout(r, 150));
      const settled = topUps.length;
      await new Promise((r) => setTimeout(r, 150));
      expect(topUps.length).toBe(settled);
      expect(settled).toBeLessThanOrEqual(3);
    });

    it('halts on a failed top-up instead of retrying forever', async () => {
      // The rejection path is the one that provably ran away: `loadingMore`
      // returns to false with nothing loaded, so the effect re-fired at once
      // and raised a toast every turn.
      mockGetItems.mockImplementation((params: unknown) =>
        ((params as { skip?: number } | undefined)?.skip ?? 0) === 0
          ? Promise.resolve(hiddenPage('p1'))
          : Promise.reject(new Error('network down'))
      );

      renderWithRouter(<InventoryItemsPage />);
      await collapsePPE();

      await waitFor(() => expect(mockToastError).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 150));
      const settled = mockGetItems.mock.calls.length;
      await new Promise((r) => setTimeout(r, 150));
      expect(mockGetItems.mock.calls.length).toBe(settled);
      // One failure, one toast -- not one per turn.
      expect(mockToastError).toHaveBeenCalledTimes(1);
    });

    it('does not consume the page offset when a load fails', async () => {
      // `skip` advanced before the request, so a failed page was skipped for
      // good and the rows in it were never fetched.
      const seen: number[] = [];
      mockGetItems.mockImplementation((params: unknown) => {
        const skip = (params as { skip?: number } | undefined)?.skip ?? 0;
        seen.push(skip);
        if (skip === 0) return Promise.resolve({ items: [makeItem({ id: 'a' })], total: 500 });
        return Promise.reject(new Error('network down'));
      });

      renderWithRouter(<InventoryItemsPage />);
      await screen.findByText('Cordless Drill');

      await userEvent.click(await screen.findByRole('button', { name: /Load More/ }));
      await waitFor(() => expect(mockToastError).toHaveBeenCalled());
      await userEvent.click(screen.getByRole('button', { name: /Load More/ }));
      await waitFor(() => expect(seen.filter((v) => v === 50).length).toBe(2));

      expect(seen).not.toContain(100);
    });

    it('renders no per-item detail cells on a product row', async () => {
      // Below 768px `.rwd-table tbody td` is display:flex and only cells with
      // NO data-label are hidden, so a `hidden` cell carrying one still shows
      // as a labelled row on a phone. Rendering these five empty put five
      // blank Manufacturer/Serial/Asset Tag/Barcode/Cost lines in every folded
      // card; they describe one physical item and a product row is not one.
      const shirt = (id: string, size: string) =>
        makeItem({
          id,
          name: `Duty Shirt \u2014 ${size}`,
          variant_group_id: 'vg-4',
          standard_size: size.toLowerCase(),
          tracking_type: 'pool',
          quantity: 3,
        });
      mockGetItems.mockResolvedValue({ items: [shirt('d-s', 'S'), shirt('d-m', 'M')], total: 2 });

      renderWithRouter(<InventoryItemsPage />);
      await screen.findByRole('button', { name: /Duty Shirt/ });
      const row = screen
        .getAllByRole('row')
        .find((r) => within(r).queryByRole('button', { name: /Duty Shirt/ }) !== null);
      expect(row).toBeDefined();
      const labels = within(row as HTMLElement)
        .getAllByRole('cell')
        .map((c) => c.getAttribute('data-label'));
      expect(labels).not.toContain('Serial #');
      expect(labels).not.toContain('Asset Tag');
      expect(labels).not.toContain('Barcode');
      expect(labels).not.toContain('Manufacturer');
      expect(labels).not.toContain('Cost');
    });

    it('does not call an entirely uncategorised product "Mixed"', async () => {
      // Every member agrees -- their shared category is *none*. `category_id`
      // arrives as an explicit null from the API, which a `T | null` result
      // could not tell apart from "they differ".
      const bare = (id: string, size: string) =>
        makeItem({
          id,
          name: `Spare Hood — ${size}`,
          variant_group_id: 'vg-9',
          standard_size: size.toLowerCase(),
          tracking_type: 'pool',
          quantity: 2,
          category_id: null as unknown as undefined,
        });
      mockGetItems.mockResolvedValue({ items: [bare('h-s', 'S'), bare('h-m', 'M')], total: 2 });

      renderWithRouter(<InventoryItemsPage />);
      await screen.findByRole('button', { name: /Spare Hood/ });
      const row = screen
        .getAllByRole('row')
        .find((r) => within(r).queryByRole('button', { name: /Spare Hood/ }) !== null);
      expect(row).toBeDefined();
      expect(within(row as HTMLElement).queryByText('Mixed')).not.toBeInTheDocument();
    });
  });
});
