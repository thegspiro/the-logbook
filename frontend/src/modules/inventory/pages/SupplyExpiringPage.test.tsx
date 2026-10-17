/**
 * The supply worklist is readable on `inventory.check_view` — the hub card
 * offers it on that grant deliberately, because knowing what is about to
 * expire is the checklist officer's business, and
 * `GET /equipment-check/supply/expiring-items` accepts it.
 *
 * Adding replacement stock is not: `POST /inventory/items/{id}/lots` requires
 * `inventory.manage`. The page rendered "Add stock" unconditionally, so a
 * check_view holder — reached here from the hub card, or from the ungated
 * links on the fleet board and the apparatus detail page — got a 403 from a
 * button the page had just offered them.
 *
 * Disabled rather than hidden, matching the Swap control on
 * ApparatusInventoryPage, which is the same manage-gated stock write.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

const mockCheckPermission = vi.fn();

vi.mock('../../../stores/authStore', () => ({
  // The page reads the store through a selector, so the mock has to support
  // both shapes rather than only the destructured one.
  useAuthStore: (selector?: (s: unknown) => unknown) => {
    const state = { checkPermission: (...a: unknown[]) => mockCheckPermission(...a) as boolean };
    return selector ? selector(state) : state;
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const mockGetSupplyExpiringItems = vi.fn();
vi.mock('@/modules/inventory/services/equipmentCheckApi', () => ({
  equipmentCheckService: {
    getSupplyExpiringItems: (...a: unknown[]) => mockGetSupplyExpiringItems(...a) as unknown,
  },
}));

const mockAddItemLot = vi.fn();
vi.mock('../../../services/inventoryService', () => ({
  inventoryService: {
    addItemLot: (...a: unknown[]) => mockAddItemLot(...a) as unknown,
  },
}));

import SupplyExpiringPage from './SupplyExpiringPage';

const item = {
  templateItemId: 'ti-1',
  itemName: 'Epinephrine 1mg',
  apparatusName: 'Medic 1',
  inventoryItemId: 'inv-1',
  isExpired: false,
  readyStock: 0,
  readyLots: [],
};

const renderPage = async () => {
  renderWithRouter(<SupplyExpiringPage />);
  expect(await screen.findByText('Epinephrine 1mg')).toBeInTheDocument();
};

describe('SupplyExpiringPage — Add stock', () => {
  beforeEach(() => {
    mockGetSupplyExpiringItems.mockReset();
    mockGetSupplyExpiringItems.mockResolvedValue({ items: [item] });
    mockAddItemLot.mockReset();
    mockAddItemLot.mockResolvedValue({});
    mockCheckPermission.mockReset();
    mockCheckPermission.mockReturnValue(false);
  });

  describe('with inventory.check_view only', () => {
    beforeEach(() => {
      // The grant that opens the page, and nothing more.
      mockCheckPermission.mockImplementation((p: string) => p === 'inventory.check_view');
    });

    it('still shows the worklist', async () => {
      await renderPage();
      expect(screen.getByText('Medic 1')).toBeInTheDocument();
    });

    it('offers Add stock as disabled, naming who does it', async () => {
      await renderPage();
      const button = screen.getByRole('button', { name: /add stock/i });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('title', 'Replacement stock is added by the quartermaster');
    });

    it('never reaches the manage-gated write', async () => {
      await renderPage();
      const button = screen.getByRole('button', { name: /add stock/i });
      await userEvent.click(button);
      // The panel does not open, and nothing is sent — the tap cannot end in
      // a 403. Anchored on the panel's heading: this modal carries no
      // `role="dialog"`, so querying for that role would pass whether or not
      // the panel rendered.
      expect(screen.queryByRole('heading', { name: 'Add ready stock' })).not.toBeInTheDocument();
      expect(mockAddItemLot).not.toHaveBeenCalled();
    });
  });

  describe('with inventory.manage', () => {
    beforeEach(() => {
      mockCheckPermission.mockImplementation((p: string) => p === 'inventory.manage');
    });

    it('offers Add stock as an enabled control with no explanatory title', async () => {
      await renderPage();
      const button = screen.getByRole('button', { name: /add stock/i });
      expect(button).toBeEnabled();
      expect(button).not.toHaveAttribute('title');
    });

    it('opens the add-stock form on click', async () => {
      await renderPage();
      await userEvent.click(screen.getByRole('button', { name: /add stock/i }));
      // Anchored on the panel heading rather than its submit button, which
      // shares its label with the row control that opened it.
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Add ready stock' })).toBeInTheDocument();
      });
    });
  });
});

describe('SupplyExpiringPage — phone layout', () => {
  const lot = (id: string, lotNumber: string, quantity: number, isExpired = false) => ({
    id,
    lotNumber,
    quantity,
    expirationDate: '2027-04-01',
    isExpired,
  });
  const expiredItem = {
    ...item,
    templateItemId: 'a',
    itemName: 'Epinephrine 1mg',
    apparatusName: 'Medic 1',
    lotNumber: 'L-OLD',
    expirationDate: '2026-10-14',
    daysUntilExpiration: -3,
    isExpired: true,
    readyStock: 3,
    readyLots: [lot('l1', 'L-NEW', 3), lot('l2', 'L-GONE', 1, true)],
  };
  const worklist = [
    expiredItem,
    { ...item, templateItemId: 'b', itemName: 'Burn sheets', apparatusName: 'Engine 2', restockNeeded: true },
    { ...item, templateItemId: 'c', itemName: 'Road flares', apparatusName: 'Medic 1', daysUntilExpiration: 20 },
  ];

  beforeEach(() => {
    mockGetSupplyExpiringItems.mockReset();
    mockGetSupplyExpiringItems.mockResolvedValue({ items: worklist });
    mockCheckPermission.mockReset();
    mockCheckPermission.mockImplementation((p: string) => p === 'inventory.manage');
  });

  // The counts are the filters, so a chip's number and the list it opens are
  // one predicate and cannot disagree.
  it('counts each filter on its own chip and leaves out one with nothing behind it', async () => {
    await renderPage();
    const chips = within(screen.getByRole('group', { name: 'Filter items' }));
    expect(chips.getByRole('button', { name: 'All 3' })).toBeInTheDocument();
    expect(chips.getByRole('button', { name: 'Needs restock 2' })).toBeInTheDocument();
    expect(chips.getByRole('button', { name: 'Used or short 1' })).toBeInTheDocument();
    expect(chips.getByRole('button', { name: 'Expired 1' })).toBeInTheDocument();

    mockGetSupplyExpiringItems.mockResolvedValue({ items: [worklist[2]] });
    await userEvent.click(screen.getByRole('button', { name: '60d' }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^Expired/ })).not.toBeInTheDocument();
    });
  });

  it('narrows to a chip, and a second tap clears it', async () => {
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Used or short 1' }));
    expect(screen.getByText('Burn sheets')).toBeInTheDocument();
    expect(screen.queryByText('Road flares')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Used or short 1' }));
    expect(screen.getByText('Road flares')).toBeInTheDocument();
  });

  it('groups by apparatus under a heading per rig', async () => {
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'By apparatus' }));

    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Engine 2 · 1 item',
      'Medic 1 · 2 items',
    ]);
    const medic = screen.getByRole('region', { name: 'Medic 1' });
    expect(within(medic).getByText('Epinephrine 1mg')).toBeInTheDocument();
    expect(within(medic).getByText('Road flares')).toBeInTheDocument();
  });

  it('keeps the ready lots behind a toggle', async () => {
    await renderPage();
    expect(screen.queryByText(/L-NEW/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /2 lots/ }));
    expect(screen.getByText(/L-NEW · 3×/)).toBeInTheDocument();
    expect(screen.getByText(/L-GONE · 1×.*expired/)).toBeInTheDocument();
  });

  it('shows what is on the truck now when adding stock', async () => {
    mockGetSupplyExpiringItems.mockResolvedValue({ items: [expiredItem] });
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: /add stock/i }));

    const sheet = screen.getByRole('dialog', { name: 'Add ready stock' });
    expect(within(sheet).getByText(/Medic 1 · lot L-OLD · expired Oct 14, 2026/)).toBeInTheDocument();
    expect(within(sheet).getByLabelText('Quantity')).toHaveValue(1);
  });
});
