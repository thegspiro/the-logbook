import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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

vi.mock('../../../services/api', () => ({
  inventoryService: {
    getItems: (...a: unknown[]) => mockGetItems(...a) as unknown,
    getSummary: (...a: unknown[]) => mockGetSummary(...a) as unknown,
    getSummaryByLocation: (...a: unknown[]) => mockGetSummaryByLocation(...a) as unknown,
    getCategories: (...a: unknown[]) => mockGetCategories(...a) as unknown,
    getStorageAreas: (...a: unknown[]) => mockGetStorageAreas(...a) as unknown,
    retireItem: (...a: unknown[]) => mockRetireItem(...a) as unknown,
    updateItem: vi.fn(),
    exportItemsCsv: vi.fn(),
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
vi.mock('../../../components/MemberPickerModal', () => ({ MemberPickerModal: () => null }));
vi.mock('../../../components/InventoryScanModal', () => ({ InventoryScanModal: () => null }));
vi.mock('../../../components/ux/FloatingActionButton', () => ({ FloatingActionButton: () => null }));

const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: (...a: unknown[]): void => { mockToastError(...a); },
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
      total_items: 42, overdue_checkouts: 1, maintenance_due_count: 2, total_value: 0,
    });
    mockGetSummaryByLocation.mockResolvedValue([]);
    mockGetCategories.mockResolvedValue([]);
    mockGetStorageAreas.mockResolvedValue([]);
    mockGetLocations.mockResolvedValue([]);
    mockRetireItem.mockResolvedValue({});
    mockCheckPermission.mockReturnValue(true);
  });

  it('shows the empty state when there are no items', async () => {
    renderWithRouter(<InventoryItemsPage />);
    expect(await screen.findByText('No items found')).toBeInTheDocument();
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
    expect(screen.getByText(/42 items/)).toBeInTheDocument();
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
    await waitFor(() =>
      expect(mockGetItems).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: 'drill' }),
      ),
    );
  });

  it('refetches when the status filter changes', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InventoryItemsPage />);
    await screen.findByText('No items found');

    const statusSelect = screen.getByLabelText('Filter by status');
    await user.selectOptions(statusSelect, 'assigned');
    await waitFor(() =>
      expect(mockGetItems).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'assigned' }),
      ),
    );
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
