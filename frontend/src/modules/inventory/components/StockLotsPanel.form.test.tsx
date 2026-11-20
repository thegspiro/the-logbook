/**
 * The add-lot form (forms review batch 22): a missing answer is named on its
 * field, a refusal lands on the field it names, and Cancel asks before
 * throwing a typed lot away.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

const mockGetItemLots = vi.fn();
const mockAddItemLot = vi.fn();

vi.mock('@/services/inventoryService', () => ({
  inventoryService: {
    getItemLots: (...a: unknown[]) => mockGetItemLots(...a) as unknown,
    addItemLot: (...a: unknown[]) => mockAddItemLot(...a) as unknown,
    updateItemLot: vi.fn(),
    deleteItemLot: vi.fn(),
  },
}));
vi.mock('../services/equipmentCheckApi', () => ({
  equipmentCheckService: { getItemDeployments: vi.fn().mockResolvedValue([]) },
}));
vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import StockLotsPanel from './StockLotsPanel';

const openForm = async (user: ReturnType<typeof userEvent.setup>) => {
  renderWithRouter(<StockLotsPanel itemId="item-1" canManage />);
  await user.click(await screen.findByRole('button', { name: /Add Lot/ }));
};

describe('StockLotsPanel — the add-lot form', () => {
  beforeEach(() => {
    mockGetItemLots.mockReset();
    mockGetItemLots.mockResolvedValue([]);
    mockAddItemLot.mockReset();
  });

  // Forms review F-3: a cleared quantity was read as 0 and saved as an empty
  // lot; a negative one was a toast that named no field.
  it('names a missing quantity on its field and adds nothing', async () => {
    const user = userEvent.setup();
    await openForm(user);
    const quantity = screen.getByRole('spinbutton', { name: /Quantity/ });
    await user.clear(quantity);

    await user.click(screen.getByRole('button', { name: /Save Lot/ }));

    expect(quantity).toHaveAccessibleDescription('Enter how many units, a whole number 0 or more.');
    expect(quantity).toHaveFocus();
    expect(mockAddItemLot).not.toHaveBeenCalled();
  });

  // Forms review F-2: a refusal was a toast, and the form gave no clue which
  // box to fix.
  it('puts a refused lot number on its field and keeps what was typed', async () => {
    mockAddItemLot.mockRejectedValueOnce({
      response: { status: 422, data: { detail: [{ field: 'lot_number', message: 'Lot number is too long.' }] } },
    });
    const user = userEvent.setup();
    await openForm(user);
    await user.type(screen.getByRole('textbox', { name: /Lot Number/ }), 'LOT-77');

    await user.click(screen.getByRole('button', { name: /Save Lot/ }));

    const lotNumber = await screen.findByRole('textbox', {
      name: /Lot Number/,
      description: 'Lot number is too long.',
    });
    expect(lotNumber).toHaveValue('LOT-77');
    expect(lotNumber).toHaveFocus();
  });

  it('says a refusal no field answers for in the form, not a toast', async () => {
    mockAddItemLot.mockRejectedValueOnce({ response: { status: 409, data: { detail: 'This item is retired.' } } });
    const user = userEvent.setup();
    await openForm(user);

    await user.click(screen.getByRole('button', { name: /Save Lot/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This item is retired.');
  });

  // Forms review F-6: Cancel threw a typed lot away without a word.
  it('asks before Cancel throws a typed lot away', async () => {
    const user = userEvent.setup();
    await openForm(user);
    await user.type(screen.getByRole('textbox', { name: /Lot Number/ }), 'LOT-77');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }));

    await waitFor(() => expect(screen.getByRole('textbox', { name: /Lot Number/ })).toHaveValue('LOT-77'));
  });
});
