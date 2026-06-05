import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { InventoryItem } from '../types';

const mockGetItem = vi.fn();
const mockGetCategories = vi.fn();
const mockGetStorageAreas = vi.fn();
const mockGetItemHistory = vi.fn();
const mockGetItemMaintenanceHistory = vi.fn();
const mockGetNFPACompliance = vi.fn();
const mockGetExposureRecords = vi.fn();
const mockGetLocations = vi.fn();
const mockCheckPermission = vi.fn();

vi.mock('../../../services/api', () => ({
  inventoryService: {
    getItem: (...a: unknown[]) => mockGetItem(...a) as unknown,
    getCategories: (...a: unknown[]) => mockGetCategories(...a) as unknown,
    getStorageAreas: (...a: unknown[]) => mockGetStorageAreas(...a) as unknown,
    getItemHistory: (...a: unknown[]) => mockGetItemHistory(...a) as unknown,
    getItemMaintenanceHistory: (...a: unknown[]) => mockGetItemMaintenanceHistory(...a) as unknown,
    getNFPACompliance: (...a: unknown[]) => mockGetNFPACompliance(...a) as unknown,
    getExposureRecords: (...a: unknown[]) => mockGetExposureRecords(...a) as unknown,
    assignItem: vi.fn(),
    unassignItem: vi.fn(),
  },
}));

vi.mock('../../../services/facilitiesServices', () => ({
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
vi.mock('../components/ItemFormModal', () => ({
  ItemFormModal: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div>item-form-modal</div> : null),
}));
vi.mock('../../../components/MemberPickerModal', () => ({ MemberPickerModal: () => null }));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import ItemDetailPage from './ItemDetailPage';

const makeItem = (overrides: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'it-1',
  organization_id: 'org-1',
  name: 'Thermal Camera',
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

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/inventory/items/it-1']}>
      <Routes>
        <Route path="/inventory/items/:id" element={<ItemDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );

describe('ItemDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetItem.mockResolvedValue(makeItem());
    mockGetCategories.mockResolvedValue([]);
    mockGetStorageAreas.mockResolvedValue([]);
    mockGetLocations.mockResolvedValue([]);
    mockGetItemHistory.mockResolvedValue({ events: [] });
    mockGetItemMaintenanceHistory.mockResolvedValue([]);
    mockGetNFPACompliance.mockResolvedValue(null);
    mockGetExposureRecords.mockResolvedValue([]);
    mockCheckPermission.mockReturnValue(true);
  });

  it('loads and renders the item', async () => {
    renderPage();
    expect((await screen.findAllByText('Thermal Camera')).length).toBeGreaterThan(0);
    expect(mockGetItem).toHaveBeenCalledWith('it-1');
  });

  it('shows an error state when the item fails to load', async () => {
    mockGetItem.mockRejectedValue(new Error('boom'));
    renderPage();
    // Error state surfaces the message and a recovery link back to the list.
    expect(await screen.findByRole('link', { name: /Back to Items/ })).toBeInTheDocument();
    expect(screen.getByText('boom')).toBeInTheDocument();
  });

  it('loads history events on the default tab', async () => {
    mockGetItemHistory.mockResolvedValue({
      events: [
        { type: 'checkout', id: 'h-1', date: '2026-02-01T00:00:00Z', summary: 'Checked out to Engine 1', details: {} },
      ],
    });
    renderPage();
    await waitFor(() => expect(mockGetItemHistory).toHaveBeenCalledWith('it-1'));
    expect(await screen.findByText('Checked out to Engine 1')).toBeInTheDocument();
  });

  it('opens the edit modal', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findAllByText('Thermal Camera');

    await user.click(screen.getByRole('button', { name: /Edit/ }));
    expect(await screen.findByText('item-form-modal')).toBeInTheDocument();
  });

  it('hides the edit action without the manage permission', async () => {
    mockCheckPermission.mockReturnValue(false);
    renderPage();
    await screen.findAllByText('Thermal Camera');

    expect(screen.queryByRole('button', { name: /Edit/ })).not.toBeInTheDocument();
  });
});
