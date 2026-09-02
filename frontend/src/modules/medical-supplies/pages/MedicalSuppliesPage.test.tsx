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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
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

    const gearLink = await screen.findByRole('link', { name: /Gear & Uniforms/i });
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

    expect(screen.getByText(/Gear and uniforms are tracked separately/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Gear & Uniforms/i })).not.toBeInTheDocument();
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
        expect.any(AbortSignal)
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
        { search: 'gauze', category_id: undefined, limit: 200 },
        expect.any(AbortSignal)
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
    await waitFor(() => expect(mockGetExpiringLots).toHaveBeenCalledWith(30));

    expect(await screen.findByText(/Expiring within 30d/i)).toBeInTheDocument();
  });
});
