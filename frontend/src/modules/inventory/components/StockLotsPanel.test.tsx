import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithRouter } from '../../../test/utils';
import type { InventoryLot } from '@/services/eventServices';

const mockGetItemLots = vi.fn();
const mockGetItemDeployments = vi.fn();
const mockDeleteItemLot = vi.fn();
const mockToastError = vi.fn();

vi.mock('@/services/inventoryService', () => ({
  inventoryService: {
    getItemLots: (...a: unknown[]) => mockGetItemLots(...a) as unknown,
    addItemLot: vi.fn(),
    updateLot: vi.fn(),
    deleteLot: vi.fn(),
    deleteItemLot: (...a: unknown[]) => mockDeleteItemLot(...a) as unknown,
  },
}));
vi.mock('../services/equipmentCheckApi', () => ({
  equipmentCheckService: {
    getItemDeployments: (...a: unknown[]) => mockGetItemDeployments(...a) as unknown,
  },
}));
vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: (...a: unknown[]): void => {
      mockToastError(...a);
    },
  },
}));

import StockLotsPanel from './StockLotsPanel';

const lot = (over: Partial<InventoryLot>): InventoryLot =>
  ({
    id: 'lot',
    inventory_item_id: 'item-1',
    organization_id: 'org-1',
    lot_number: 'L',
    expiration_date: null,
    quantity: 1,
    ...over,
  }) as InventoryLot;

describe('StockLotsPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-29T12:00:00Z'));
    mockGetItemLots.mockReset();
    mockGetItemLots.mockResolvedValue([
      lot({ id: 'b', lot_number: 'TQ-B', expiration_date: '2026-09-01', quantity: 2 }),
      lot({ id: 'a', lot_number: 'TQ-A', expiration_date: '2026-10-10', quantity: 3 }),
    ]);
    mockGetItemDeployments.mockReset();
    mockGetItemDeployments.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // An expired lot is not stock anyone can use: the server skips it when it
  // issues or swaps, and Medical Supplies reports 3 on hand for these lots.
  // The panel called all five "ready".
  it('does not count an expired lot as ready stock', async () => {
    renderWithRouter(<StockLotsPanel itemId="item-1" canManage={false} />);
    const summary = await screen.findByText(/ready unit/);
    expect(summary).toHaveTextContent('3 ready units across 2 lots · 2 expired');
  });

  // Every lot's controls read "Decrease quantity", "Increase quantity" and
  // "Delete lot", with nothing saying which lot they act on.
  it('names each lot on its own controls', async () => {
    renderWithRouter(<StockLotsPanel itemId="item-1" canManage />);
    expect(await screen.findByRole('button', { name: 'Delete lot TQ-B' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decrease lot TQ-A' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Increase lot TQ-A' })).toBeInTheDocument();
  });
});

describe('StockLotsPanel deleting a lot received against a reorder', () => {
  const refusal =
    'This lot was received against reorder "Gloves" (PO PO-77), so it cannot be deleted. Adjust its quantity to 0 instead.';

  beforeEach(() => {
    mockGetItemLots.mockReset();
    mockGetItemLots.mockResolvedValue([lot({ id: 'r', lot_number: 'RX-1', quantity: 10 })]);
    mockGetItemDeployments.mockReset();
    mockGetItemDeployments.mockResolvedValue([]);
    mockDeleteItemLot.mockReset();
    mockDeleteItemLot.mockRejectedValue({ response: { status: 409, data: { detail: refusal } } });
    mockToastError.mockReset();
  });

  it("shows the server's reason and keeps the lot", async () => {
    renderWithRouter(<StockLotsPanel itemId="item-1" canManage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Delete lot RX-1' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith(refusal));
    expect(mockDeleteItemLot).toHaveBeenCalledWith('r');
    expect(screen.getByRole('button', { name: 'Delete lot RX-1' })).toBeInTheDocument();
  });
});
