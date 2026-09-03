import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

const mockGetSummary = vi.fn();
const mockGetItems = vi.fn();
const mockGetCategories = vi.fn();
const mockGetExpiringLots = vi.fn();
const mockCheckPermission = vi.fn();

vi.mock('../../../services/medicalSuppliesService', () => ({
  medicalSuppliesService: {
    getSummary: (...args: unknown[]) => mockGetSummary(...args) as unknown,
    getItems: (...args: unknown[]) => mockGetItems(...args) as unknown,
    getCategories: (...args: unknown[]) => mockGetCategories(...args) as unknown,
    getExpiringLots: (...args: unknown[]) => mockGetExpiringLots(...args) as unknown,
  },
}));

// Both call forms, because both are used against this store: the page
// destructures (`useAuthStore()`), and useTimezone passes a selector
// (`useAuthStore((s) => s.user?.timezone)`). A mock that honours only the
// destructuring form hands the selector call the whole state object, which
// then reaches Intl as a timezone and throws.
vi.mock('../../../stores/authStore', () => {
  const state = {
    user: { timezone: 'America/New_York' },
    checkPermission: (...args: unknown[]) => mockCheckPermission(...args) as boolean,
  };
  return {
    useAuthStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state),
  };
});

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import MedicalSuppliesPage from './MedicalSuppliesPage';

const summary = {
  total_items: 12,
  expiring_soon: 3,
  expired: 1,
  low_stock: 2,
  expiring_within_days: 30,
};

const expiringLot = (overrides: Record<string, unknown> = {}) => ({
  id: 'lot-1',
  organization_id: 'org-1',
  inventory_item_id: 'item-1',
  item_name: '4x4 Gauze',
  lot_number: 'LOT-77',
  expiration_date: '2026-09-01',
  days_until_expiration: 16,
  quantity: 24,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
  ...overrides,
});

const item = (overrides: Record<string, unknown> = {}) => ({
  id: 'item-1',
  name: '4x4 Gauze',
  quantity: 1,
  reorder_point: 5,
  ...overrides,
});

function assertOrganizationLowStockCount(count: number): void {
  expect(screen.getByText('Below reorder point')).toBeInTheDocument();
  expect(screen.getByText(String(count))).toBeInTheDocument();
  expect(screen.queryByText(/item\(s\) at or below their reorder point/i)).not.toBeInTheDocument();
}

describe('MedicalSuppliesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckPermission.mockReturnValue(false);
    mockGetSummary.mockResolvedValue(summary);
    mockGetItems.mockResolvedValue({ items: [], total: 0, skip: 0, limit: 200 });
    mockGetCategories.mockResolvedValue([]);
    mockGetExpiringLots.mockResolvedValue([expiringLot()]);
  });

  it('names the page for the domain it holds', async () => {
    renderWithRouter(<MedicalSuppliesPage />);

    expect(await screen.findByRole('heading', { name: /Medical Supplies/i })).toBeInTheDocument();
  });

  it('points a gear manager at the gear page rather than implying it holds gear too', async () => {
    mockCheckPermission.mockImplementation((p: unknown) => p === 'inventory.manage');

    renderWithRouter(<MedicalSuppliesPage />);

    const gearLink = await screen.findByRole('link', { name: /Inventory/i });
    expect(gearLink).toHaveAttribute('href', '/inventory');
  });

  it('states the separation without linking it for someone who cannot open the catalogue', async () => {
    // The gear catalogue is manage-gated. An EMS supply officer holding only
    // the medical grants would have been sent to Access Denied by a sentence
    // that was never more than an aside — so the aside keeps its meaning and
    // drops its link.
    mockCheckPermission.mockImplementation((p: unknown) => p === 'inventory.manage_medical');

    renderWithRouter(<MedicalSuppliesPage />);
    await screen.findByRole('heading', { name: /Medical Supplies/i });

    expect(screen.getByText(/run on the same catalog as gear and uniforms/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Inventory/i })).not.toBeInTheDocument();
  });

  it('opens on expiring stock, which is what goes wrong quietly', async () => {
    renderWithRouter(<MedicalSuppliesPage />);

    expect(await screen.findByText('4x4 Gauze')).toBeInTheDocument();
    expect(screen.getByText('16d left')).toBeInTheDocument();
  });

  it('calls out an already-expired lot rather than showing a negative countdown', async () => {
    mockGetExpiringLots.mockResolvedValue([expiringLot({ days_until_expiration: -4 })]);

    renderWithRouter(<MedicalSuppliesPage />);

    expect(await screen.findByText('Expired 4d ago')).toBeInTheDocument();
  });

  it('hides the management actions from a member who can only view', async () => {
    renderWithRouter(<MedicalSuppliesPage />);
    await screen.findByRole('heading', { name: /Medical Supplies/i });

    expect(screen.queryByRole('button', { name: /Add supply/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Receive delivery/i })).not.toBeInTheDocument();
  });

  it('shows the management actions to a medical-only supply officer', async () => {
    // Holds inventory.manage_medical but not the broad inventory.manage.
    mockCheckPermission.mockImplementation((p: unknown) => p === 'inventory.manage_medical');

    renderWithRouter(<MedicalSuppliesPage />);

    expect(await screen.findByRole('button', { name: /Add supply/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Receive delivery/i })).toBeInTheDocument();
  });

  it('shows the management actions to a quartermaster holding only the broad grant', async () => {
    mockCheckPermission.mockImplementation((p: unknown) => p === 'inventory.manage');

    renderWithRouter(<MedicalSuppliesPage />);

    expect(await screen.findByRole('button', { name: /Add supply/i })).toBeInTheDocument();
  });

  it('never asks the API for an item type — the domain is the server’s to pin', async () => {
    renderWithRouter(<MedicalSuppliesPage />);

    // The exact filter object, so a future item_type sneaking into the payload
    // fails here rather than quietly letting the client choose its own domain.
    await waitFor(() =>
      expect(mockGetItems).toHaveBeenCalledWith({
        search: undefined,
        category_id: undefined,
        skip: 0,
        limit: 200,
      })
    );
  });

  it('names the category from the list it loaded, not the stripped response field', async () => {
    // `category_name` is not on InventoryItemResponse, so the API never sends
    // it and every categorized supply used to render a dash.
    mockGetCategories.mockResolvedValue([{ id: 'cat-1', name: 'Airway' }]);
    mockGetItems.mockResolvedValue({
      items: [{ id: 'item-1', name: '4x4 Gauze', category_id: 'cat-1', quantity: 5 }],
      total: 1,
      skip: 0,
      limit: 200,
    });

    renderWithRouter(<MedicalSuppliesPage />);
    await userEvent.click(await screen.findByRole('button', { name: /All supplies/i }));

    // The cell specifically — the category filter's <option> carries the same
    // text, and matching either one would pass without the table being right.
    expect(await screen.findByRole('cell', { name: 'Airway' })).toBeInTheDocument();
  });

  it('offers an edit action per supply to a manager', async () => {
    mockCheckPermission.mockImplementation((p: unknown) => p === 'inventory.manage_medical');
    mockGetItems.mockResolvedValue({
      items: [{ id: 'item-1', name: '4x4 Gauze', quantity: 5 }],
      total: 1,
      skip: 0,
      limit: 200,
    });

    renderWithRouter(<MedicalSuppliesPage />);
    await userEvent.click(await screen.findByRole('button', { name: /All supplies/i }));

    expect(await screen.findByRole('button', { name: 'Edit 4x4 Gauze' })).toBeInTheDocument();
  });

  it('offers no edit action to a member who can only view', async () => {
    mockGetItems.mockResolvedValue({
      items: [{ id: 'item-1', name: '4x4 Gauze', quantity: 5 }],
      total: 1,
      skip: 0,
      limit: 200,
    });

    renderWithRouter(<MedicalSuppliesPage />);
    await userEvent.click(await screen.findByRole('button', { name: /All supplies/i }));

    await screen.findByText('4x4 Gauze');
    expect(screen.queryByRole('button', { name: 'Edit 4x4 Gauze' })).not.toBeInTheDocument();
  });

  it('does not offer an editable On hand for a lot-stocked supply', async () => {
    // `quantity` and the lots are separate ledgers. Editing the box would
    // change a number this page never displays, behind a success toast.
    mockCheckPermission.mockImplementation((p: unknown) => p === 'inventory.manage_medical');
    mockGetCategories.mockResolvedValue([{ id: 'cat-1', name: 'Airway' }]);
    mockGetItems.mockResolvedValue({
      items: [
        {
          id: 'item-1',
          name: '4x4 Gauze',
          category_id: 'cat-1',
          quantity: 0,
          is_lot_stocked: true,
          lot_stock: 48,
        },
      ],
      total: 1,
      skip: 0,
      limit: 200,
    });

    renderWithRouter(<MedicalSuppliesPage />);
    await userEvent.click(await screen.findByRole('button', { name: /All supplies/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Edit 4x4 Gauze' }));

    await screen.findByRole('heading', { name: /Edit medical supply/i });
    expect(screen.queryByLabelText('On hand')).not.toBeInTheDocument();
    expect(screen.getByText(/from stock lots/i)).toBeInTheDocument();
  });

  it('offers an editable On hand for a plainly counted supply', async () => {
    mockCheckPermission.mockImplementation((p: unknown) => p === 'inventory.manage_medical');
    mockGetCategories.mockResolvedValue([{ id: 'cat-1', name: 'Airway' }]);
    mockGetItems.mockResolvedValue({
      items: [{ id: 'item-2', name: 'Trauma Shears', category_id: 'cat-1', quantity: 6 }],
      total: 1,
      skip: 0,
      limit: 200,
    });

    renderWithRouter(<MedicalSuppliesPage />);
    await userEvent.click(await screen.findByRole('button', { name: /All supplies/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Trauma Shears' }));

    await screen.findByRole('heading', { name: /Edit medical supply/i });
    expect(screen.getByLabelText('On hand')).toHaveValue(6);
  });

  it('reports the expiry window it actually queried', async () => {
    renderWithRouter(<MedicalSuppliesPage />);
    await waitFor(() => expect(mockGetExpiringLots).toHaveBeenCalledWith(30));

    expect(await screen.findByText(/Expiring within 30d/i)).toBeInTheDocument();
  });

  it('presents the organization-wide low-stock summary for an unfiltered catalog', async () => {
    mockGetSummary.mockResolvedValue({ ...summary, low_stock: 7 });
    mockGetItems.mockResolvedValue({ items: [item()], total: 1, skip: 0, limit: 200 });

    renderWithRouter(<MedicalSuppliesPage />);
    await userEvent.click(await screen.findByRole('button', { name: /All supplies/i }));

    await screen.findByText('4x4 Gauze');
    assertOrganizationLowStockCount(7);
    expect(mockGetSummary).toHaveBeenCalledWith(30);
  });

  it('does not replace the organization-wide count with low-stock search results', async () => {
    mockGetSummary.mockResolvedValue({ ...summary, low_stock: 7 });
    mockGetItems.mockImplementation((filters: { search?: string }) =>
      Promise.resolve({ items: filters.search ? [item()] : [], total: filters.search ? 1 : 0, skip: 0, limit: 200 })
    );

    renderWithRouter(<MedicalSuppliesPage />);
    await userEvent.click(await screen.findByRole('button', { name: /All supplies/i }));
    fireEvent.change(screen.getByRole('searchbox', { name: /Search medical supplies/i }), {
      target: { value: 'gauze' },
    });

    await waitFor(() => expect(mockGetItems).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'gauze' })));
    assertOrganizationLowStockCount(7);
  });

  it('does not replace the organization-wide count with a category-filtered count', async () => {
    mockGetSummary.mockResolvedValue({ ...summary, low_stock: 7 });
    mockGetCategories.mockResolvedValue([{ id: 'cat-1', name: 'Airway' }]);
    mockGetItems.mockResolvedValue({ items: [item({ category_id: 'cat-1' })], total: 1, skip: 0, limit: 200 });

    renderWithRouter(<MedicalSuppliesPage />);
    await userEvent.click(await screen.findByRole('button', { name: /All supplies/i }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /Filter by category/i }), 'cat-1');

    await waitFor(() =>
      expect(mockGetItems).toHaveBeenLastCalledWith(expect.objectContaining({ category_id: 'cat-1' }))
    );
    assertOrganizationLowStockCount(7);
  });

  it('does not derive the organization-wide count from one page of a multi-page catalog', async () => {
    mockGetSummary.mockResolvedValue({ ...summary, total_items: 450, low_stock: 23 });
    mockGetItems.mockResolvedValue({
      items: [item({ is_lot_stocked: true, lot_stock: 3, quantity: 99 })],
      total: 450,
      skip: 0,
      limit: 200,
    });

    renderWithRouter(<MedicalSuppliesPage />);
    await userEvent.click(await screen.findByRole('button', { name: /All supplies/i }));

    expect(await screen.findByRole('cell', { name: '3' })).toBeInTheDocument();
    assertOrganizationLowStockCount(23);
  });

  it('navigates beyond the first 200 supplies and reports the visible range', async () => {
    mockGetItems.mockImplementation(({ skip = 0 }: { skip?: number }) =>
      Promise.resolve({
        items: [{ id: `item-${skip}`, name: skip === 200 ? 'Supply 201' : 'Supply 1', quantity: 1 }],
        total: 201,
        skip,
        limit: 200,
      })
    );

    renderWithRouter(<MedicalSuppliesPage />);
    await userEvent.click(await screen.findByRole('button', { name: /All supplies/i }));
    expect(await screen.findByText('Showing 1–1 of 201')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('Supply 201')).toBeInTheDocument();
    expect(screen.getByText('Showing 201–201 of 201')).toBeInTheDocument();
    expect(mockGetItems).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 200, limit: 200 }));
  });

  it('resets to the first page when a search filter changes', async () => {
    mockGetItems.mockImplementation(({ skip = 0 }: { skip?: number }) =>
      Promise.resolve({ items: [{ id: 'item-1', name: 'Gauze', quantity: 1 }], total: 201, skip, limit: 200 })
    );

    renderWithRouter(<MedicalSuppliesPage />);
    await userEvent.click(await screen.findByRole('button', { name: /All supplies/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }));
    await waitFor(() => expect(mockGetItems).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 200 })));

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search medical supplies' }), 'gauze');

    await waitFor(() =>
      expect(mockGetItems).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'gauze', skip: 0 }))
    );
  });

  describe('paging the catalog', () => {
    it('does not step past the last page while a page request is in flight', async () => {
      // Next took its enabled state from the *previous* response, so a second
      // activation before this one landed asked for skip=400 on a 201-item
      // catalog: an empty table and a range reading "Showing 401-201 of 201".
      // The first attempt at this guard used `isLoading`, which starts true and
      // is only ever cleared -- so it said nothing about a later request, and
      // this test passed against the unfixed control.
      let releasePage2: ((value: unknown) => void) | undefined;
      mockGetItems
        .mockResolvedValueOnce({
          items: [{ id: 'item-0', name: 'Supply 1', quantity: 1 }],
          total: 201,
          skip: 0,
          limit: 200,
        })
        .mockImplementationOnce(() => new Promise((resolve) => (releasePage2 = resolve)));

      const user = userEvent.setup();
      renderWithRouter(<MedicalSuppliesPage />);
      await user.click(await screen.findByRole('button', { name: /All supplies/i }));
      await screen.findByText('Showing 1–1 of 201');

      await user.click(screen.getByRole('button', { name: 'Next' }));
      await waitFor(() => expect(releasePage2).toBeDefined());
      const callsAfterFirst = mockGetItems.mock.calls.length;

      // The page-2 request is still in flight. A second activation must not
      // start a third one.
      expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
      await user.click(screen.getByRole('button', { name: 'Next' }));

      expect(mockGetItems.mock.calls.length).toBe(callsAfterFirst);
      expect(mockGetItems).not.toHaveBeenCalledWith(expect.objectContaining({ skip: 400 }));
    });

    it('ignores a catalog response that a newer request has superseded', async () => {
      // Clicking Next and then editing the filter starts two loads. If the
      // older one lands last the table shows rows that do not match the visible
      // filter, with page at 0 and skip at 200 -- a state Previous cannot undo,
      // because decrementing page 0 is a no-op.
      let releaseOlder: ((value: unknown) => void) | undefined;
      mockGetItems
        .mockResolvedValueOnce({
          items: [{ id: 'item-1', name: 'Supply 1', quantity: 1 }],
          total: 201,
          skip: 0,
          limit: 200,
        })
        .mockImplementationOnce(() => new Promise((resolve) => (releaseOlder = resolve)))
        .mockResolvedValue({
          items: [{ id: 'item-9', name: 'Filtered Supply', quantity: 1 }],
          total: 1,
          skip: 0,
          limit: 200,
        });

      const user = userEvent.setup();
      renderWithRouter(<MedicalSuppliesPage />);
      await user.click(await screen.findByRole('button', { name: /All supplies/i }));
      await screen.findByText('Supply 1');

      // Page 2 is requested and hangs; the filter then changes and settles.
      await user.click(screen.getByRole('button', { name: 'Next' }));
      await waitFor(() => expect(releaseOlder).toBeDefined());
      fireEvent.change(screen.getByRole('searchbox', { name: /Search medical supplies/i }), {
        target: { value: 'filtered' },
      });
      expect(await screen.findByText('Filtered Supply')).toBeInTheDocument();

      // The superseded page-2 response lands last and must be discarded.
      await act(async () => {
        releaseOlder?.({
          items: [{ id: 'item-200', name: 'Supply 201', quantity: 1 }],
          total: 201,
          skip: 200,
          limit: 200,
        });
        await Promise.resolve();
      });

      expect(screen.getByText('Filtered Supply')).toBeInTheDocument();
      expect(screen.queryByText('Supply 201')).not.toBeInTheDocument();
    });
  });
});
