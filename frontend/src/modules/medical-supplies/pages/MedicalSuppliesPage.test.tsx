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

const itemResponse = (name: string) => ({
  items: [{ id: `item-${name}`, name, quantity: 5 }],
  total: 1,
  skip: 0,
  limit: 200,
});

/**
 * The cancellation the page passes with every item read.
 *
 * Held as `unknown` rather than used inline: `expect.any()` is typed `any`,
 * and dropping that straight into an object literal is an unsafe assignment.
 */
const anyAbortSignal: unknown = expect.any(AbortSignal);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

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
    // mockReset, not just clearAllMocks: clearAllMocks wipes recorded calls
    // but leaves implementations and queued *Once values in place, so an
    // unconsumed rejection from a failure-path test would be handed to
    // whichever test called the mock next (CLAUDE.md pitfall #28).
    [mockCheckPermission, mockGetSummary, mockGetItems, mockGetCategories, mockGetExpiringLots].forEach((mock) =>
      mock.mockReset()
    );
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
      expect(mockGetItems).toHaveBeenCalledWith(
        {
          search: undefined,
          category_id: undefined,
          skip: 0,
          limit: 200,
        },
        { signal: anyAbortSignal }
      )
    );
  });

  it('settles rapid search edits into one item request without reloading overview data', async () => {
    vi.useFakeTimers();
    try {
      renderWithRouter(<MedicalSuppliesPage />);
      await act(async () => Promise.resolve());
      mockGetItems.mockClear();
      mockGetSummary.mockClear();
      mockGetCategories.mockClear();
      mockGetExpiringLots.mockClear();

      fireEvent.click(screen.getByRole('button', { name: /All supplies/i }));
      const input = screen.getByRole('searchbox', { name: /Search medical supplies/i });
      fireEvent.change(input, { target: { value: 'g' } });
      fireEvent.change(input, { target: { value: 'ga' } });
      fireEvent.change(input, { target: { value: 'gauze' } });

      await act(async () => vi.advanceTimersByTimeAsync(299));
      expect(mockGetItems).not.toHaveBeenCalled();
      await act(async () => vi.advanceTimersByTimeAsync(1));

      expect(mockGetItems).toHaveBeenCalledTimes(1);
      expect(mockGetItems).toHaveBeenCalledWith(
        { search: 'gauze', category_id: undefined, skip: 0, limit: 200 },
        { signal: anyAbortSignal }
      );
      expect(mockGetSummary).not.toHaveBeenCalled();
      expect(mockGetCategories).not.toHaveBeenCalled();
      expect(mockGetExpiringLots).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let an older item response replace newer search results', async () => {
    vi.useFakeTimers();
    const older = deferred<ReturnType<typeof itemResponse>>();
    const newer = deferred<ReturnType<typeof itemResponse>>();
    mockGetItems.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);

    try {
      renderWithRouter(<MedicalSuppliesPage />);
      fireEvent.click(screen.getByRole('button', { name: /All supplies/i }));
      fireEvent.change(screen.getByRole('searchbox', { name: /Search medical supplies/i }), {
        target: { value: 'new' },
      });
      await act(async () => vi.advanceTimersByTimeAsync(300));

      await act(async () => newer.resolve(itemResponse('New result')));
      expect(screen.getByText('New result')).toBeInTheDocument();

      await act(async () => older.resolve(itemResponse('Older result')));
      expect(screen.getByText('New result')).toBeInTheDocument();
      expect(screen.queryByText('Older result')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
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
    await waitFor(() => expect(mockGetExpiringLots).toHaveBeenCalledWith(30, undefined));

    expect(await screen.findByText(/Expiring within 30d/i)).toBeInTheDocument();
  });

  it('presents the organization-wide low-stock summary for an unfiltered catalog', async () => {
    mockGetSummary.mockResolvedValue({ ...summary, low_stock: 7 });
    mockGetItems.mockResolvedValue({ items: [item()], total: 1, skip: 0, limit: 200 });

    renderWithRouter(<MedicalSuppliesPage />);
    await userEvent.click(await screen.findByRole('button', { name: /All supplies/i }));

    await screen.findByText('4x4 Gauze');
    assertOrganizationLowStockCount(7);
    expect(mockGetSummary).toHaveBeenCalledWith(30, undefined);
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

    await waitFor(() =>
      expect(mockGetItems).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'gauze' }), {
        signal: anyAbortSignal,
      })
    );
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
      expect(mockGetItems).toHaveBeenLastCalledWith(expect.objectContaining({ category_id: 'cat-1' }), {
        signal: anyAbortSignal,
      })
    );
    assertOrganizationLowStockCount(7);
  });

  it('does not let Next run ahead of a search that has not been requested yet', async () => {
    // Typing while already on page 0 makes setPage(0) a no-op, so no request
    // starts until the debounce expires. Next stayed live in that window, and
    // one click there meant the search itself was requested at skip 200 --
    // past its own first page, for a range like "Showing 201-5 of 5".
    mockGetItems.mockResolvedValue({
      items: [{ id: 'item-1', name: 'Gauze', quantity: 1 }],
      total: 201,
      skip: 0,
      limit: 200,
    });

    renderWithRouter(<MedicalSuppliesPage />);
    await userEvent.click(await screen.findByRole('button', { name: /All supplies/i }));
    expect(await screen.findByRole('button', { name: 'Next' })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: /Search medical supplies/i }), {
      target: { value: 'gauze' },
    });

    // Still on screen -- hiding the pager mid-type would be its own problem --
    // but inert until the typed query has actually been asked.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled());
  });

  it('does not keep a page range on screen for a query that failed', async () => {
    // itemPage still holds the previous response after a failure, so the range
    // and total would sit above an empty table, under the error that explains
    // why there are no rows.
    mockGetItems.mockResolvedValue({
      items: [{ id: 'item-1', name: 'Gauze', quantity: 1 }],
      total: 201,
      skip: 0,
      limit: 200,
    });

    renderWithRouter(<MedicalSuppliesPage />);
    await userEvent.click(await screen.findByRole('button', { name: /All supplies/i }));
    expect(await screen.findByText(/Showing 1–1 of 201/)).toBeInTheDocument();

    mockGetItems.mockRejectedValue(new Error('Supplies unavailable'));
    fireEvent.change(screen.getByRole('searchbox', { name: /Search medical supplies/i }), {
      target: { value: 'gauze' },
    });

    await waitFor(() => expect(screen.queryByText(/Showing 1–1 of 201/)).not.toBeInTheDocument());
    // The pager itself stays: hiding it also removed the only way back to a
    // page that loads. Next is inert, because stepping forward on the previous
    // query's total would ask for page 2 of a query whose page 1 never came.
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('leaves Previous usable after a page request fails', async () => {
    // page and itemPage.skip disagree after a rejected Next -- page 1, skip 0
    // -- and keying Previous on skip disabled the one control that could get
    // back to a page that loads, stranding the officer on an empty table.
    mockGetItems.mockResolvedValue({
      items: [{ id: 'item-1', name: 'Gauze', quantity: 1 }],
      total: 201,
      skip: 0,
      limit: 200,
    });

    renderWithRouter(<MedicalSuppliesPage />);
    await userEvent.click(await screen.findByRole('button', { name: /All supplies/i }));
    expect(await screen.findByText(/Showing 1–1 of 201/)).toBeInTheDocument();

    mockGetItems.mockRejectedValueOnce(new Error('Supplies unavailable'));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled());
    expect(screen.getByText('Page 2')).toBeInTheDocument();

    // And it actually returns to a page that loads.
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(await screen.findByText(/Showing 1–1 of 201/)).toBeInTheDocument();
  });

  it('does not report an empty catalogue while the first item request is still in flight', async () => {
    // The empty state is keyed off items.length, which is [] both before the
    // first response and after an empty one. Reporting "No medical supplies
    // yet" for the first is a false answer about the department's inventory,
    // and on a slow connection it is the only answer on screen.
    const pending = deferred<{ items: unknown[]; total: number; skip: number; limit: number }>();
    mockGetItems.mockReturnValue(pending.promise);

    renderWithRouter(<MedicalSuppliesPage />);
    await screen.findByRole('heading', { name: /Medical Supplies/i });
    await userEvent.click(screen.getByRole('button', { name: 'All supplies' }));

    expect(screen.queryByText('No medical supplies yet')).not.toBeInTheDocument();

    await act(async () => {
      pending.resolve({ items: [], total: 0, skip: 0, limit: 200 });
    });

    // And once the server has actually said the catalogue is empty, it says so.
    expect(await screen.findByText('No medical supplies yet')).toBeInTheDocument();
  });

  it('reports a failed category load on the stock tab, where it costs the category names', async () => {
    // The stock tab still renders rows when the category list fails -- with a
    // dash for every category and a filter offering nothing -- so a tab that
    // reported nothing looked like a catalogue with no categories assigned
    // rather than a page half-loaded. The tab-level sentence this once
    // asserted is now the category section's own alert, with its own retry.
    mockGetCategories.mockRejectedValue(new Error('Categories unavailable'));
    mockGetItems.mockResolvedValue(itemResponse('4x4 Gauze'));

    renderWithRouter(<MedicalSuppliesPage />);
    await screen.findByRole('heading', { name: /Medical Supplies/i });
    await userEvent.click(screen.getByRole('button', { name: 'All supplies' }));

    expect(await screen.findByText('4x4 Gauze')).toBeInTheDocument();
    expect(screen.getByText('Could not load the category list.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry category list' })).toBeInTheDocument();
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
    expect(mockGetItems).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 200, limit: 200 }), {
      signal: anyAbortSignal,
    });
  });

  it('resets to the first page when a search filter changes', async () => {
    mockGetItems.mockImplementation(({ skip = 0 }: { skip?: number }) =>
      Promise.resolve({ items: [{ id: 'item-1', name: 'Gauze', quantity: 1 }], total: 201, skip, limit: 200 })
    );

    renderWithRouter(<MedicalSuppliesPage />);
    await userEvent.click(await screen.findByRole('button', { name: /All supplies/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(mockGetItems).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 200 }), { signal: anyAbortSignal })
    );

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search medical supplies' }), 'gauze');

    await waitFor(() =>
      expect(mockGetItems).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'gauze', skip: 0 }), {
        signal: anyAbortSignal,
      })
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
  describe('a section stands on its own', () => {
    it('shows a section that has settled while another is still hanging', async () => {
      // Promise.allSettled waits for the slowest before any section updates, so
      // one endpoint hanging to the API timeout held every other section on its
      // skeleton -- exactly the coupling the per-section split removes.
      mockGetCategories.mockImplementation(() => new Promise(() => {}));

      renderWithRouter(<MedicalSuppliesPage />);

      expect(await screen.findByText('4x4 Gauze')).toBeInTheDocument();
    });

    it('shows the overview as pending rather than simply absent', async () => {
      // The sections settle independently now, so a summary still in flight
      // after expiring stock arrives would leave the stat grid missing with
      // nothing to say it is coming: a half-loaded page that looks complete,
      // and tiles that appear later without warning.
      mockGetSummary.mockImplementation(() => new Promise(() => {}));

      renderWithRouter(<MedicalSuppliesPage />);

      // Expiring stock has landed while the summary has not.
      expect(await screen.findByText('4x4 Gauze')).toBeInTheDocument();
      expect(screen.queryByText('Below reorder point')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Loading the overview')).toBeInTheDocument();
    });

    it('ignores a superseded request for the same section', async () => {
      // Two retries of one section -- or a retry overlapping the refresh --
      // otherwise both commit, and whichever lands last wins regardless of
      // which was asked for last.
      let failOlder: ((reason: Error) => void) | undefined;
      mockGetExpiringLots
        .mockRejectedValueOnce(new Error('Lots unavailable'))
        .mockImplementationOnce(() => new Promise((_resolve, reject) => (failOlder = reject)))
        .mockResolvedValue([expiringLot({ id: 'lot-2', item_name: 'Trauma Shears' })]);

      const user = userEvent.setup();
      renderWithRouter(<MedicalSuppliesPage />);
      await screen.findByRole('alert');

      // First retry hangs; second supersedes it and succeeds.
      await user.click(screen.getByRole('button', { name: 'Retry expiring stock' }));
      await waitFor(() => expect(failOlder).toBeDefined());
      await user.click(screen.getByRole('button', { name: 'Retry expiring stock' }));
      expect(await screen.findByText('Trauma Shears')).toBeInTheDocument();

      // The older request now fails. It must not put its error back over the
      // newer success.
      await act(async () => {
        failOlder?.(new Error('Stale failure'));
        await Promise.resolve();
      });

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByText('Trauma Shears')).toBeInTheDocument();
    });

    it('stops showing the previous query\u2019s rows once the filter changes', async () => {
      // The table kept the old rows under the newly selected filter, with no
      // loading or stale indication, until the request finished -- so the rows
      // on screen and the filter above them disagreed, silently.
      mockGetItems
        .mockResolvedValueOnce({
          items: [{ id: 'item-1', name: 'Trauma Shears', quantity: 6 }],
          total: 1,
          skip: 0,
          limit: 200,
        })
        .mockImplementation(() => new Promise(() => {}));

      const user = userEvent.setup();
      renderWithRouter(<MedicalSuppliesPage />);
      await user.click(await screen.findByRole('button', { name: /All supplies/i }));
      expect(await screen.findByText('Trauma Shears')).toBeInTheDocument();

      fireEvent.change(screen.getByRole('searchbox', { name: /Search medical supplies/i }), {
        target: { value: 'gauze' },
      });

      await waitFor(() => expect(screen.queryByText('Trauma Shears')).not.toBeInTheDocument());
    });

    it('marks a section that loaded empty as stale when a later load fails', async () => {
      // A row count cannot tell "loaded, and there is nothing" from "never
      // loaded", so an empty-but-loaded section lost its stale marker.
      mockGetExpiringLots.mockResolvedValueOnce([]).mockRejectedValue(new Error('Lots unavailable'));

      const user = userEvent.setup();
      renderWithRouter(<MedicalSuppliesPage />);
      expect(await screen.findByText('Nothing expiring')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Refresh medical supplies' }));

      expect(await screen.findByText('Showing previously loaded data')).toBeInTheDocument();
    });

    it('does not claim a section is empty before it has ever loaded', async () => {
      // "Nothing expiring" is an assertion about the department's stock. A
      // section whose only request failed knows nothing and must not make it.
      mockGetExpiringLots.mockRejectedValue(new Error('Lots unavailable'));

      renderWithRouter(<MedicalSuppliesPage />);
      await screen.findByRole('alert');

      expect(screen.queryByText('Nothing expiring')).not.toBeInTheDocument();
    });

    it('keeps retained rows on screen while a retry of the same query runs', async () => {
      // The banner promises "showing previously loaded data" -- a skeleton over
      // those rows while a slow retry runs breaks that promise at exactly the
      // moment the data is being relied on. A retry asks the same question the
      // rows already answer, unlike a filter change, which does not.
      mockGetExpiringLots
        .mockResolvedValueOnce([expiringLot()])
        .mockRejectedValueOnce(new Error('Lots unavailable'))
        .mockImplementation(() => new Promise(() => {}));

      const user = userEvent.setup();
      renderWithRouter(<MedicalSuppliesPage />);
      expect(await screen.findByText('4x4 Gauze')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Refresh medical supplies' }));
      await screen.findByText('Showing previously loaded data');

      // The retry hangs. The rows it is retrying stay put.
      await user.click(screen.getByRole('button', { name: 'Retry expiring stock' }));
      await waitFor(() => expect(mockGetExpiringLots).toHaveBeenCalledTimes(3));
      expect(screen.getByText('4x4 Gauze')).toBeInTheDocument();
    });

    it('does not fall back to the previous filter\u2019s rows when the new filter fails', async () => {
      // The guard that hid mismatched rows only held while the request was in
      // flight. On rejection the loading flag drops and the old rows reappeared
      // under controls that disagree with them -- the filter says "gauze", the
      // table lists what was there before it.
      mockGetItems
        .mockResolvedValueOnce({
          items: [{ id: 'item-1', name: 'Trauma Shears', quantity: 6 }],
          total: 1,
          skip: 0,
          limit: 200,
        })
        .mockRejectedValue(new Error('Supplies unavailable'));

      const user = userEvent.setup();
      renderWithRouter(<MedicalSuppliesPage />);
      await user.click(await screen.findByRole('button', { name: /All supplies/i }));
      expect(await screen.findByText('Trauma Shears')).toBeInTheDocument();

      fireEvent.change(screen.getByRole('searchbox', { name: /Search medical supplies/i }), {
        target: { value: 'gauze' },
      });

      await screen.findByText('Could not load the supply table.');
      expect(screen.queryByText('Trauma Shears')).not.toBeInTheDocument();
      // And the banner does not claim to be showing data it is not showing.
      expect(screen.queryByText('Showing previously loaded data')).not.toBeInTheDocument();
    });

    it('keeps the search box mounted while the item list reloads', async () => {
      // Skeletoning the whole section unmounted the focused input on the first
      // keystroke, so every character after it was typed into nothing until the
      // request settled -- a search box that cannot be typed into.
      mockGetItems
        .mockResolvedValueOnce({ items: [], total: 0, skip: 0, limit: 200 })
        .mockImplementation(() => new Promise(() => {}));

      const user = userEvent.setup();
      renderWithRouter(<MedicalSuppliesPage />);
      await user.click(await screen.findByRole('button', { name: /All supplies/i }));

      const box = screen.getByRole('searchbox', { name: /Search medical supplies/i });
      fireEvent.change(box, { target: { value: 'g' } });

      // The reload is in flight; the control the user is typing into survives it.
      await waitFor(() => expect(mockGetItems).toHaveBeenCalledTimes(2));
      expect(screen.getByRole('searchbox', { name: /Search medical supplies/i })).toBeInTheDocument();
    });

    it('reloads only the item list when a filter changes', async () => {
      // loadSections closes over the filters, so one effect keyed on it
      // reloaded all four sections per keystroke -- and because the newest
      // request per section wins, those superseded an explicit refresh's
      // requests, letting cached data land while the refresh was discarded.
      const user = userEvent.setup();
      renderWithRouter(<MedicalSuppliesPage />);
      await user.click(await screen.findByRole('button', { name: /All supplies/i }));
      await waitFor(() => expect(mockGetSummary).toHaveBeenCalledTimes(1));
      const summaryCalls = mockGetSummary.mock.calls.length;
      const categoryCalls = mockGetCategories.mock.calls.length;
      const expiringCalls = mockGetExpiringLots.mock.calls.length;
      const itemCalls = mockGetItems.mock.calls.length;

      fireEvent.change(screen.getByRole('searchbox', { name: /Search medical supplies/i }), {
        target: { value: 'gauze' },
      });

      await waitFor(() => expect(mockGetItems.mock.calls.length).toBeGreaterThan(itemCalls));
      expect(mockGetSummary.mock.calls.length).toBe(summaryCalls);
      expect(mockGetCategories.mock.calls.length).toBe(categoryCalls);
      expect(mockGetExpiringLots.mock.calls.length).toBe(expiringCalls);
    });

    it('does not call a supply uncategorized while the category list is loading', async () => {
      // A dash is an answer -- "this supply has no category" -- and the page is
      // not entitled to give it before the list that would name one arrives.
      mockGetCategories.mockImplementation(() => new Promise(() => {}));
      mockGetItems.mockResolvedValue({
        items: [{ id: 'item-1', name: 'Trauma Shears', quantity: 6, category_id: 'cat-1' }],
        total: 1,
        skip: 0,
        limit: 200,
      });

      const user = userEvent.setup();
      renderWithRouter(<MedicalSuppliesPage />);
      await user.click(await screen.findByRole('button', { name: /All supplies/i }));
      await screen.findByText('Trauma Shears');

      // The category reads as pending rather than as "no category", and the
      // filter says so too instead of offering a complete-looking set of one.
      expect(screen.getByText('…')).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: 'Filter by category' })).toBeDisabled();
      expect(screen.getByRole('option', { name: 'Loading categories…' })).toBeInTheDocument();
    });

    it('does not call a supply uncategorized while a refresh is still fetching categories', async () => {
      // Same rule on a refresh as on the first load. Another session can add a
      // category and an item in it between loads, so a lookup that misses
      // while the list is in flight is a pending answer, not "uncategorized" --
      // even though this section has loaded successfully once already.
      mockGetItems.mockResolvedValue({
        items: [{ id: 'item-1', name: 'Trauma Shears', quantity: 6, category_id: 'cat-1' }],
        total: 1,
        skip: 0,
        limit: 200,
      });
      mockGetCategories.mockResolvedValue([{ id: 'cat-1', name: 'Airway' }]);

      const user = userEvent.setup();
      renderWithRouter(<MedicalSuppliesPage />);
      await user.click(await screen.findByRole('button', { name: /All supplies/i }));
      await screen.findByText('Trauma Shears');
      // Named, not pending: the category list is in hand for this one.
      expect(screen.queryByText('…')).not.toBeInTheDocument();

      // The refresh returns an item in a category the stale list cannot name,
      // and hangs on the categories that would name it.
      mockGetItems.mockResolvedValue({
        items: [{ id: 'item-2', name: 'Nasal Airway', quantity: 4, category_id: 'cat-2' }],
        total: 1,
        skip: 0,
        limit: 200,
      });
      mockGetCategories.mockImplementation(() => new Promise(() => {}));

      await user.click(screen.getByRole('button', { name: 'Refresh medical supplies' }));

      expect(await screen.findByText('Nasal Airway')).toBeInTheDocument();
      expect(screen.getByText('…')).toBeInTheDocument();
    });

    it('tells the add-supply flow the category list failed rather than that none exist', async () => {
      // The category alert lives on the stock tab, but Add supply is visible
      // from either. Opening it after a failed load showed "no categories
      // exist yet" -- advice that sends an officer to duplicate a category the
      // department already has, and that names no remedy for the real problem.
      mockCheckPermission.mockReturnValue(true);
      mockGetCategories.mockRejectedValue(new Error('Categories unavailable'));

      const user = userEvent.setup();
      renderWithRouter(<MedicalSuppliesPage />);
      await user.click(await screen.findByRole('button', { name: 'Add supply' }));

      expect(await screen.findByText(/The category list could not be loaded/i)).toBeInTheDocument();
      expect(screen.queryByText(/No medical supply categories exist yet/i)).not.toBeInTheDocument();
    });

    it('warns the add-supply flow that retained categories are out of date', async () => {
      // Options surviving a failed refresh is not the same as them being
      // current: one added since is missing, and one removed since is still
      // offered -- selectable right up to the save that rejects it.
      mockCheckPermission.mockReturnValue(true);
      mockGetCategories.mockResolvedValueOnce([{ id: 'cat-1', name: 'Airway' }]);

      const user = userEvent.setup();
      renderWithRouter(<MedicalSuppliesPage />);
      await user.click(await screen.findByRole('button', { name: /All supplies/i }));
      await screen.findByRole('option', { name: 'Airway' });

      mockGetCategories.mockRejectedValue(new Error('Categories unavailable'));
      await user.click(screen.getByRole('button', { name: 'Refresh medical supplies' }));
      await screen.findByText('Could not load the category list.');

      await user.click(screen.getByRole('button', { name: 'Add supply' }));

      expect(await screen.findByText(/Showing previously loaded categories/i)).toBeInTheDocument();
    });

    it('still tells the add-supply flow to create a category when none exist', async () => {
      mockCheckPermission.mockReturnValue(true);
      mockGetCategories.mockResolvedValue([]);

      const user = userEvent.setup();
      renderWithRouter(<MedicalSuppliesPage />);
      await user.click(await screen.findByRole('button', { name: 'Add supply' }));

      expect(await screen.findByText(/No medical supply categories exist yet/i)).toBeInTheDocument();
      expect(screen.queryByText(/could not be loaded/i)).not.toBeInTheDocument();
    });

    it('retires an item failure once the filter it belonged to is no longer on screen', async () => {
      // A failure answers one query. Left standing under a different filter's
      // controls it reads as that filter having failed, and its Retry re-runs
      // the query the user has already moved on from.
      mockGetItems.mockRejectedValueOnce(new Error('Supplies unavailable'));

      const user = userEvent.setup();
      renderWithRouter(<MedicalSuppliesPage />);
      await user.click(await screen.findByRole('button', { name: /All supplies/i }));
      expect(await screen.findByText('Could not load the supply table.')).toBeInTheDocument();

      // The new query is left hanging on purpose. If it were allowed to
      // succeed it would clear `errors.items` on its own, and this test would
      // pass whether or not the alert is keyed to the query it belongs to --
      // which is exactly what it is here to prove.
      mockGetItems.mockImplementation(() => new Promise(() => {}));
      fireEvent.change(screen.getByRole('searchbox', { name: /Search medical supplies/i }), {
        target: { value: 'airway' },
      });

      await waitFor(() => expect(screen.queryByText('Could not load the supply table.')).not.toBeInTheDocument());
    });

    it('sends a user-initiated refresh past the response cache', async () => {
      // The shared client answers a GET from cache for 30s and serves a stale
      // one for 90s while swallowing the revalidation's failure -- so without a
      // bypass an explicit refresh reports success against old quantities.
      const user = userEvent.setup();
      renderWithRouter(<MedicalSuppliesPage />);
      await screen.findByText('4x4 Gauze');

      expect(mockGetSummary).toHaveBeenLastCalledWith(30, undefined);

      await user.click(screen.getByRole('button', { name: 'Refresh medical supplies' }));

      await waitFor(() => expect(mockGetSummary).toHaveBeenLastCalledWith(30, { bypassCache: true }));
    });
  });
});
