import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
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
  ItemFormModal: ({ isOpen, onSaved }: { isOpen: boolean; onSaved: () => void }) =>
    isOpen ? (
      <div>
        item-form-modal
        <button type="button" onClick={onSaved}>
          mock-save
        </button>
      </div>
    ) : null,
}));
vi.mock('../../../components/MemberPickerModal', () => ({ MemberPickerModal: () => null }));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import ItemDetailPage from './ItemDetailPage';
import { formatDate } from '../../../utils/dateFormatting';

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
    </MemoryRouter>
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

  it('says whether a label has been printed for the item', async () => {
    renderPage();
    expect(await screen.findByText('Needs a label')).toBeInTheDocument();
  });

  it('names who confirmed the label when the API says', async () => {
    mockGetItem.mockResolvedValue(
      makeItem({ label_printed_at: '2026-09-20T15:00:00Z', label_printed_by_name: 'Quarter Master' })
    );
    renderPage();

    expect(
      await screen.findByText(`${formatDate('2026-09-20T15:00:00Z', 'UTC')} by Quarter Master`)
    ).toBeInTheDocument();
  });

  it('lists every confirmed label print in the history', async () => {
    mockGetItemHistory.mockResolvedValue({
      events: [
        {
          type: 'label_printed',
          id: 'lp-2',
          date: '2026-09-20T15:00:00Z',
          summary: 'Label printed by Quarter Master',
          details: { user_name: 'Quarter Master', label_value: 'INV-0501' },
        },
        {
          type: 'label_printed',
          id: 'lp-1',
          date: '2026-09-01T10:00:00Z',
          summary: 'Label printed by Quarter Master',
          details: { user_name: 'Quarter Master', label_value: 'INV-0500' },
        },
      ],
    });
    renderPage();

    expect(await screen.findAllByText('Label printed by Quarter Master')).toHaveLength(2);
    expect(screen.getByText(/INV-0500/)).toBeInTheDocument();
  });

  it('shows the date the label was confirmed printed', async () => {
    mockGetItem.mockResolvedValue(makeItem({ label_printed_at: '2026-09-20T15:00:00Z' }));
    renderPage();
    await screen.findAllByText('Thermal Camera');
    expect(screen.queryByText('Needs a label')).not.toBeInTheDocument();
    expect(screen.getByText(formatDate('2026-09-20T15:00:00Z', 'UTC'))).toBeInTheDocument();
  });

  describe('after an edit changes what the label shows', () => {
    const labelled = makeItem({ barcode: 'INV-1', serial_number: 'SN-1', label_printed_at: '2026-09-20T15:00:00Z' });

    const editAndSave = async (after: InventoryItem) => {
      const user = userEvent.setup();
      mockGetItem.mockReset();
      mockGetItem.mockResolvedValueOnce(labelled).mockResolvedValue(after);
      renderPage();
      await user.click(await screen.findByRole('button', { name: /Edit/ }));
      await user.click(screen.getByRole('button', { name: 'mock-save' }));
      return user;
    };

    it('says the old label no longer scans when the backend cleared the mark', async () => {
      await editAndSave({ ...labelled, barcode: 'INV-2', label_printed_at: undefined });

      expect(await screen.findByText(/no longer scans to it/)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Print label' })).toHaveAttribute(
        'href',
        '/inventory/print-labels?ids=it-1'
      );
    });

    it('names the printed text that changed when the code did not', async () => {
      await editAndSave({ ...labelled, name: 'Thermal Imager', serial_number: 'SN-2' });

      expect(await screen.findByText(/still shows its old name and serial number/)).toBeInTheDocument();
    });

    it('stays quiet for an edit that touches nothing printed', async () => {
      await editAndSave({ ...labelled, notes: 'Charger in the bag' });

      await waitFor(() => expect(mockGetItem).toHaveBeenCalledTimes(2));
      expect(screen.queryByRole('link', { name: 'Print label' })).not.toBeInTheDocument();
    });

    it('stays quiet for an item that never had a label', async () => {
      const user = userEvent.setup();
      mockGetItem.mockReset();
      mockGetItem.mockResolvedValueOnce(makeItem()).mockResolvedValue(makeItem({ name: 'Renamed' }));
      renderPage();
      await user.click(await screen.findByRole('button', { name: /Edit/ }));
      await user.click(screen.getByRole('button', { name: 'mock-save' }));

      await waitFor(() => expect(mockGetItem).toHaveBeenCalledTimes(2));
      expect(screen.queryByRole('link', { name: 'Print label' })).not.toBeInTheDocument();
    });

    it('can be dismissed', async () => {
      const user = await editAndSave({ ...labelled, serial_number: 'SN-2' });

      await user.click(await screen.findByRole('button', { name: 'Dismiss' }));
      expect(screen.queryByText(/still shows its old/)).not.toBeInTheDocument();
    });
  });

  it('shows the lot ledger total, not the stale quantity column, for a lot-stocked uniform pool item', async () => {
    // Lots and `quantity` are separate ledgers -- receiving a lot never
    // touches the column, so a lot-stocked item's `quantity` is stale/zero.
    // The backend attaches `lot_stock`/`is_lot_stocked` on the detail
    // response for exactly this reason; this card must read them.
    mockGetItem.mockResolvedValue(
      makeItem({
        category_id: 'cat-uniform',
        tracking_type: 'pool',
        quantity: 0,
        is_lot_stocked: true,
        lot_stock: 12,
      })
    );
    mockGetCategories.mockResolvedValue([
      {
        id: 'cat-uniform',
        organization_id: 'org-1',
        name: 'Uniforms',
        item_type: 'uniform',
        requires_assignment: false,
        requires_serial_number: false,
        requires_maintenance: false,
        nfpa_tracking_enabled: false,
        active: true,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ]);

    renderPage();

    expect(await screen.findByText('Qty On Hand')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('falls back to the quantity column for an item with no lots', async () => {
    mockGetItem.mockResolvedValue(
      makeItem({
        category_id: 'cat-uniform',
        tracking_type: 'pool',
        quantity: 7,
        is_lot_stocked: false,
      })
    );
    mockGetCategories.mockResolvedValue([
      {
        id: 'cat-uniform',
        organization_id: 'org-1',
        name: 'Uniforms',
        item_type: 'uniform',
        requires_assignment: false,
        requires_serial_number: false,
        requires_maintenance: false,
        nfpa_tracking_enabled: false,
        active: true,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ]);

    renderPage();

    expect(await screen.findByText('Qty On Hand')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
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
    expect(await screen.findByText('Temporary loaned to Engine 1')).toBeInTheDocument();
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
