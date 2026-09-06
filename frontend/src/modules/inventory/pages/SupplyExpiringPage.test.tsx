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
import { screen, waitFor } from '@testing-library/react';
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
