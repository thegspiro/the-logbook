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
  const ALL_SERVICE_MOCKS = [mockGetSummary, mockGetItems, mockGetCategories, mockGetExpiringLots, mockCheckPermission];

  beforeEach(() => {
    // mockReset, not just clearAllMocks: clearAllMocks wipes recorded calls but
    // leaves implementations AND any unconsumed mockRejectedValueOnce still
    // queued. The stale-data tests below arm four one-shot rejections at once,
    // so a test that returns before every section request fires hands the
    // leftover to whichever test calls that mock next. (CLAUDE.md pitfall #28.)
    ALL_SERVICE_MOCKS.forEach((mock) => mock.mockReset());
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
      expect(mockGetItems).toHaveBeenCalledWith(
        {
          search: undefined,
          category_id: undefined,
          limit: 200,
        },
        undefined
      )
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
      expect(mockGetItems).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'gauze' }), undefined)
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
      expect(mockGetItems).toHaveBeenLastCalledWith(expect.objectContaining({ category_id: 'cat-1' }), undefined)
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

  it('keeps expiring stock usable when the overview fails', async () => {
    mockGetSummary.mockRejectedValue(new Error('Overview unavailable'));

    renderWithRouter(<MedicalSuppliesPage />);

    expect(await screen.findByText('4x4 Gauze')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the overview');
    expect(screen.getByRole('button', { name: 'Retry overview' })).toBeInTheDocument();
  });

  it('keeps the overview and expiring stock usable when the supply table fails', async () => {
    mockGetItems.mockRejectedValue(new Error('Supplies unavailable'));

    renderWithRouter(<MedicalSuppliesPage />);

    expect(await screen.findByText('Supply items')).toBeInTheDocument();
    expect(screen.getByText('4x4 Gauze')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /All supplies/i }));
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the supply table');
  });

  it('keeps the supply table usable when the category list fails', async () => {
    mockGetCategories.mockRejectedValue(new Error('Categories unavailable'));
    mockGetItems.mockResolvedValue({
      items: [{ id: 'item-2', name: 'Trauma Shears', quantity: 6 }],
      total: 1,
      skip: 0,
      limit: 200,
    });

    renderWithRouter(<MedicalSuppliesPage />);
    await userEvent.click(await screen.findByRole('button', { name: /All supplies/i }));

    expect(await screen.findByText('Trauma Shears')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the category list');
    expect(screen.getByRole('combobox', { name: 'Filter by category' })).toBeEnabled();
  });

  it('keeps the overview and supply table usable when expiring stock fails', async () => {
    mockGetExpiringLots.mockRejectedValue(new Error('Lots unavailable'));
    mockGetItems.mockResolvedValue({
      items: [{ id: 'item-2', name: 'Trauma Shears', quantity: 6 }],
      total: 1,
      skip: 0,
      limit: 200,
    });

    renderWithRouter(<MedicalSuppliesPage />);

    expect(await screen.findByText('Supply items')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the expiring stock');
    await userEvent.click(screen.getByRole('button', { name: /All supplies/i }));
    expect(await screen.findByText('Trauma Shears')).toBeInTheDocument();
  });

  it('marks retained data as stale and explicit refresh retries every section', async () => {
    mockGetItems.mockResolvedValue({
      items: [{ id: 'item-2', name: 'Trauma Shears', category_id: 'cat-1', quantity: 6 }],
      total: 1,
      skip: 0,
      limit: 200,
    });
    mockGetCategories.mockResolvedValue([{ id: 'cat-1', name: 'Airway' }]);
    renderWithRouter(<MedicalSuppliesPage />);
    expect(await screen.findByText('4x4 Gauze')).toBeInTheDocument();

    mockGetSummary.mockRejectedValueOnce(new Error('Overview unavailable'));
    mockGetItems.mockRejectedValueOnce(new Error('Supplies unavailable'));
    mockGetCategories.mockRejectedValueOnce(new Error('Categories unavailable'));
    mockGetExpiringLots.mockRejectedValueOnce(new Error('Lots unavailable'));
    await userEvent.click(screen.getByRole('button', { name: 'Refresh medical supplies' }));

    expect(await screen.findAllByText('Showing previously loaded data')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: /All supplies/i }));
    expect(await screen.findAllByText('Showing previously loaded data')).toHaveLength(3);
    expect(mockGetSummary).toHaveBeenCalledTimes(2);
    expect(mockGetItems).toHaveBeenCalledTimes(2);
    expect(mockGetCategories).toHaveBeenCalledTimes(2);
    expect(mockGetExpiringLots).toHaveBeenCalledTimes(2);
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
