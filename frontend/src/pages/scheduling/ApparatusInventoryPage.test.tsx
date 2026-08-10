import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';

const mockGetApparatusInventory = vi.fn();
const mockReportItemUsed = vi.fn();
const mockClearItemRestock = vi.fn();
const mockSwapItemLot = vi.fn();
const mockSetItemQuantity = vi.fn();
const mockGetItemDeployedLots = vi.fn();
const mockUpdateDeployedLot = vi.fn();
const mockGetApparatusList = vi.fn();

vi.mock('../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getApparatusInventory: (...a: unknown[]) => mockGetApparatusInventory(...a) as unknown,
    reportItemUsed: (...a: unknown[]) => mockReportItemUsed(...a) as unknown,
    clearItemRestock: (...a: unknown[]) => mockClearItemRestock(...a) as unknown,
    swapItemLot: (...a: unknown[]) => mockSwapItemLot(...a) as unknown,
    setItemQuantity: (...a: unknown[]) => mockSetItemQuantity(...a) as unknown,
    getItemDeployedLots: (...a: unknown[]) => mockGetItemDeployedLots(...a) as unknown,
    updateDeployedLot: (...a: unknown[]) => mockUpdateDeployedLot(...a) as unknown,
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
  isShort: false,
  readyStock: 0,
  readyLots: [],
  deployedLots: [],
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
    mockSetItemQuantity.mockResolvedValue({ templateItemId: 'ti-1', restockNeeded: false, isShort: false });
    mockGetItemDeployedLots.mockResolvedValue({
      templateItemId: 'ti-1',
      itemName: 'Epinephrine',
      targetQuantity: 2,
      quantityOnTruck: 2,
      isShort: false,
      unitOfMeasure: 'Each',
      lots: [
        { id: 'dl-1', lotNumber: 'LOT-A', expirationDate: '2026-11-30', quantity: 1, isExpired: false },
        { id: 'dl-2', lotNumber: 'LOT-B', expirationDate: '2027-06-30', quantity: 1, isExpired: false },
      ],
    });
    mockUpdateDeployedLot.mockResolvedValue({
      templateItemId: 'ti-1',
      itemName: 'Epinephrine',
      targetQuantity: 2,
      quantityOnTruck: 1,
      isShort: true,
      lots: [{ id: 'dl-2', lotNumber: 'LOT-B', expirationDate: '2027-06-30', quantity: 1, isExpired: false }],
    });
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
      // An uncounted bracket takes one unit — the default that covers
      // everything that is not a multi-unit position.
      expect(mockSwapItemLot).toHaveBeenCalledWith('ti-1', 'lot-1', 1);
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

  it('records one used when a counted item is decremented', async () => {
    mockGetApparatusInventory.mockResolvedValue(inventory([makeItem({ targetQuantity: 4, quantityOnTruck: 4 })]));
    const user = userEvent.setup();
    renderWithRouter(<ApparatusInventoryPage />);
    await selectApparatus(user);

    expect(screen.getByText('4 of 4 aboard')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Record one 4x4 Gauze used/ }));

    // Down is consumption, so it files the report as well as moving the count.
    await waitFor(() => {
      expect(mockReportItemUsed).toHaveBeenCalledWith('ti-1', undefined, 1);
    });
    expect(mockSetItemQuantity).not.toHaveBeenCalled();
  });

  it('records a hand restock when a counted item is incremented', async () => {
    mockGetApparatusInventory.mockResolvedValue(
      inventory([makeItem({ targetQuantity: 4, quantityOnTruck: 2, isShort: true })])
    );
    const user = userEvent.setup();
    renderWithRouter(<ApparatusInventoryPage />);
    await selectApparatus(user);

    await user.click(screen.getByRole('button', { name: /Add one 4x4 Gauze to the truck/ }));

    // Up is a recount, not a consumption — it must not file a report.
    await waitFor(() => {
      expect(mockSetItemQuantity).toHaveBeenCalledWith('ti-1', 3);
    });
    expect(mockReportItemUsed).not.toHaveBeenCalled();
  });

  it('will not decrement a position already at zero', async () => {
    mockGetApparatusInventory.mockResolvedValue(
      inventory([makeItem({ targetQuantity: 4, quantityOnTruck: 0, isShort: true })])
    );
    const user = userEvent.setup();
    renderWithRouter(<ApparatusInventoryPage />);
    await selectApparatus(user);

    expect(screen.getByRole('button', { name: /Record one 4x4 Gauze used/ })).toBeDisabled();
  });

  it('shows a shortfall even with no report behind it', async () => {
    mockGetApparatusInventory.mockResolvedValue(
      inventory([makeItem({ targetQuantity: 4, quantityOnTruck: 2, isShort: true, restockNeeded: false })])
    );
    const user = userEvent.setup();
    renderWithRouter(<ApparatusInventoryPage />);
    await selectApparatus(user);

    expect(screen.getByText('Short')).toBeInTheDocument();
    expect(screen.getByText('2 of 4 aboard')).toBeInTheDocument();
  });

  it('defaults a restock to the size of the shortfall', async () => {
    mockGetApparatusInventory.mockResolvedValue(
      inventory([
        makeItem({
          inventoryItemId: 'inv-1',
          targetQuantity: 4,
          quantityOnTruck: 1,
          isShort: true,
          readyStock: 12,
          readyLots: [{ id: 'lot-1', lotNumber: 'LOT-A', quantity: 12 }],
        }),
      ])
    );
    const user = userEvent.setup();
    renderWithRouter(<ApparatusInventoryPage />);
    await selectApparatus(user);

    await user.click(screen.getByRole('button', { name: /Swap/ }));
    // Filling the gap is what the member came for; it should need no arithmetic.
    expect(await screen.findByLabelText(/How many to put on the truck/)).toHaveValue(3);

    await user.click(screen.getByRole('button', { name: /Swap in/ }));
    await waitFor(() => {
      expect(mockSwapItemLot).toHaveBeenCalledWith('ti-1', 'lot-1', 3);
    });
  });

  it('will not draw more than a lot holds', async () => {
    mockGetApparatusInventory.mockResolvedValue(
      inventory([
        makeItem({
          inventoryItemId: 'inv-1',
          targetQuantity: 10,
          quantityOnTruck: 0,
          isShort: true,
          readyStock: 2,
          readyLots: [{ id: 'lot-1', lotNumber: 'LOT-A', quantity: 2 }],
        }),
      ])
    );
    const user = userEvent.setup();
    renderWithRouter(<ApparatusInventoryPage />);
    await selectApparatus(user);

    await user.click(screen.getByRole('button', { name: /Swap/ }));
    // Defaulted to the shortfall of 10, but the lot only has 2.
    expect(await screen.findByRole('button', { name: /Swap in/ })).toBeDisabled();
  });

  it('opens the lots aboard instead of a bare stepper', async () => {
    mockGetApparatusInventory.mockResolvedValue(
      inventory([
        makeItem({
          itemName: 'Epinephrine',
          targetQuantity: 2,
          quantityOnTruck: 2,
          deployedLots: [
            { id: 'dl-1', lotNumber: 'LOT-A', expirationDate: '2026-11-30', quantity: 1, isExpired: false },
            { id: 'dl-2', lotNumber: 'LOT-B', expirationDate: '2027-06-30', quantity: 1, isExpired: false },
          ],
        }),
      ])
    );
    const user = userEvent.setup();
    renderWithRouter(<ApparatusInventoryPage />);
    await screen.findByRole('option', { name: /E-1/ });
    await user.selectOptions(screen.getByLabelText('Apparatus'), 'app-1');
    await screen.findByText('Epinephrine');

    // Two units with two dates cannot be moved by one +/-, so the position
    // shows its lots rather than a stepper.
    expect(screen.queryByRole('button', { name: /Record one/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /2 lots/ }));
    expect(await screen.findByText('LOT-A')).toBeInTheDocument();
    expect(screen.getByText('LOT-B')).toBeInTheDocument();
    expect(mockGetItemDeployedLots).toHaveBeenCalledWith('ti-1');
  });

  it('takes a lot off the truck entirely', async () => {
    mockGetApparatusInventory.mockResolvedValue(
      inventory([
        makeItem({
          targetQuantity: 2,
          deployedLots: [
            { id: 'dl-1', lotNumber: 'LOT-A', expirationDate: '2026-11-30', quantity: 1, isExpired: true },
          ],
        }),
      ])
    );
    // The sheet loads its own payload, so it must match the single expired lot.
    mockGetItemDeployedLots.mockResolvedValue({
      templateItemId: 'ti-1',
      itemName: '4x4 Gauze',
      targetQuantity: 2,
      quantityOnTruck: 1,
      isShort: true,
      lots: [{ id: 'dl-1', lotNumber: 'LOT-A', expirationDate: '2026-11-30', quantity: 1, isExpired: true }],
    });
    const user = userEvent.setup();
    renderWithRouter(<ApparatusInventoryPage />);
    await selectApparatus(user);

    await user.click(screen.getByRole('button', { name: /1 lot/ }));
    await user.click(await screen.findByRole('button', { name: 'Remove' }));

    // Zero is removal: a lot counted to nothing must stop contributing its
    // date to the position's soonest-expiry reading.
    await waitFor(() => {
      expect(mockUpdateDeployedLot).toHaveBeenCalledWith('ti-1', 'dl-1', { quantity: 0 });
    });
  });

  it('corrects one lot\u2019s date so the record matches the box', async () => {
    mockGetApparatusInventory.mockResolvedValue(
      inventory([
        makeItem({
          targetQuantity: 2,
          deployedLots: [
            { id: 'dl-1', lotNumber: 'LOT-A', expirationDate: '2026-11-30', quantity: 1, isExpired: false },
          ],
        }),
      ])
    );
    mockGetItemDeployedLots.mockResolvedValue({
      templateItemId: 'ti-1',
      itemName: '4x4 Gauze',
      targetQuantity: 2,
      quantityOnTruck: 1,
      isShort: true,
      lots: [{ id: 'dl-1', lotNumber: 'LOT-A', expirationDate: '2026-11-30', quantity: 1, isExpired: false }],
    });
    const user = userEvent.setup();
    renderWithRouter(<ApparatusInventoryPage />);
    await selectApparatus(user);

    await user.click(screen.getByRole('button', { name: /1 lot/ }));
    await user.click(await screen.findByRole('button', { name: /Correct/ }));

    const dateField = screen.getByLabelText('Expiration');
    await user.clear(dateField);
    await user.type(dateField, '2028-03-31');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // Count, number and date travel together: a changed-out box has a new
    // date, and sending the count alone would leave the old one asserted.
    await waitFor(() => {
      expect(mockUpdateDeployedLot).toHaveBeenCalledWith('ti-1', 'dl-1', {
        quantity: 1,
        lotNumber: 'LOT-A',
        expirationDate: '2028-03-31',
      });
    });
  });

  it('offers no swap for an item that is not linked to inventory', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ApparatusInventoryPage />);
    await selectApparatus(user);

    expect(screen.queryByRole('button', { name: /Swap/ })).not.toBeInTheDocument();
  });
});
