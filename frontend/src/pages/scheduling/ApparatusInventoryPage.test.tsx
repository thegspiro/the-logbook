import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';

const mockGetApparatusInventory = vi.fn();
const mockReportItemUsed = vi.fn();
const mockClearItemRestock = vi.fn();
const mockSwapItemLot = vi.fn();
const mockGetApparatusList = vi.fn();

vi.mock('../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getApparatusInventory: (...a: unknown[]) => mockGetApparatusInventory(...a) as unknown,
    reportItemUsed: (...a: unknown[]) => mockReportItemUsed(...a) as unknown,
    clearItemRestock: (...a: unknown[]) => mockClearItemRestock(...a) as unknown,
    swapItemLot: (...a: unknown[]) => mockSwapItemLot(...a) as unknown,
  },
}));

vi.mock('../../modules/apparatus/services/api', () => ({
  apparatusService: {
    getApparatusList: (...a: unknown[]) => mockGetApparatusList(...a) as unknown,
  },
}));

vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
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

import ApparatusInventoryPage from './ApparatusInventoryPage';

const makeItem = (overrides = {}) => ({
  templateItemId: 'ti-1',
  itemName: '4x4 Gauze',
  checkType: 'quantity',
  isExpired: false,
  restockNeeded: false,
  readyStock: 0,
  readyLots: [],
  ...overrides,
});

const inventory = (items: ReturnType<typeof makeItem>[]) => ({
  apparatusId: 'app-1',
  apparatusName: 'Engine 1',
  compartments: [{ compartmentId: 'c-1', compartmentName: 'Front Bumper', items }],
});

describe('ApparatusInventoryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetApparatusList.mockResolvedValue({
      items: [{ id: 'app-1', unitNumber: 'E-1', name: 'Engine 1' }],
      total: 1,
    });
    mockGetApparatusInventory.mockResolvedValue(inventory([makeItem()]));
    mockReportItemUsed.mockResolvedValue({ templateItemId: 'ti-1', restockNeeded: true });
    mockClearItemRestock.mockResolvedValue({ templateItemId: 'ti-1', restockNeeded: false });
    mockSwapItemLot.mockResolvedValue({ templateItemId: 'ti-1', remainingQuantity: 4, restockNeeded: false });
  });

  /** Choose the one apparatus in the fleet, which triggers the inventory load. */
  const selectApparatus = async (user: ReturnType<typeof userEvent.setup>) => {
    await screen.findByRole('option', { name: /E-1/ });
    await user.selectOptions(screen.getByLabelText('Apparatus'), 'app-1');
    await screen.findByText('4x4 Gauze');
  };

  it('asks for an apparatus before loading anything', async () => {
    renderWithRouter(<ApparatusInventoryPage />);
    await screen.findByRole('option', { name: /E-1/ });
    expect(mockGetApparatusInventory).not.toHaveBeenCalled();
  });

  it('loads the selected apparatus and groups items by compartment', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ApparatusInventoryPage />);
    await selectApparatus(user);

    expect(mockGetApparatusInventory).toHaveBeenCalledWith('app-1');
    expect(screen.getByText('Front Bumper')).toBeInTheDocument();
  });

  it('reports an item used with the note the member typed', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ApparatusInventoryPage />);
    await selectApparatus(user);

    await user.click(screen.getByRole('button', { name: /Used/ }));
    await user.type(await screen.findByLabelText(/Note/), 'used two on a call');
    await user.click(screen.getByRole('button', { name: 'Report used' }));

    await waitFor(() => {
      expect(mockReportItemUsed).toHaveBeenCalledWith('ti-1', 'used two on a call');
    });
    // Reloaded so the row shows the report that was just filed.
    expect(mockGetApparatusInventory).toHaveBeenCalledTimes(2);
  });

  it('shows who reported a standing restock and offers to withdraw it', async () => {
    mockGetApparatusInventory.mockResolvedValue(
      inventory([
        makeItem({
          restockNeeded: true,
          restockNote: 'used two',
          restockReportedByName: 'Dana Reed',
        }),
      ])
    );
    const user = userEvent.setup();
    renderWithRouter(<ApparatusInventoryPage />);
    await selectApparatus(user);

    expect(screen.getByText('Needs restock')).toBeInTheDocument();
    expect(screen.getByText(/Dana Reed/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Undo/ }));
    await waitFor(() => {
      expect(mockClearItemRestock).toHaveBeenCalledWith('ti-1');
    });
  });

  it('swaps a ready lot onto the truck', async () => {
    mockGetApparatusInventory.mockResolvedValue(
      inventory([
        makeItem({
          inventoryItemId: 'inv-1',
          readyStock: 6,
          readyLots: [{ id: 'lot-1', lotNumber: 'LOT-A', quantity: 6, expirationDate: '2027-03-01' }],
        }),
      ])
    );
    const user = userEvent.setup();
    renderWithRouter(<ApparatusInventoryPage />);
    await selectApparatus(user);

    await user.click(screen.getByRole('button', { name: /Swap/ }));
    await user.click(await screen.findByRole('button', { name: /Swap in/ }));

    await waitFor(() => {
      expect(mockSwapItemLot).toHaveBeenCalledWith('ti-1', 'lot-1');
    });
  });

  it('points a member at reporting it when no stock is on hand', async () => {
    mockGetApparatusInventory.mockResolvedValue(
      inventory([makeItem({ inventoryItemId: 'inv-1', readyStock: 0, readyLots: [] })])
    );
    const user = userEvent.setup();
    renderWithRouter(<ApparatusInventoryPage />);
    await selectApparatus(user);

    await user.click(screen.getByRole('button', { name: /Swap/ }));
    expect(await screen.findByText(/No in-date stock on hand/)).toBeInTheDocument();
    expect(mockSwapItemLot).not.toHaveBeenCalled();
  });

  it('offers no swap for an item that is not linked to inventory', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ApparatusInventoryPage />);
    await selectApparatus(user);

    expect(screen.queryByRole('button', { name: /Swap/ })).not.toBeInTheDocument();
  });
});
