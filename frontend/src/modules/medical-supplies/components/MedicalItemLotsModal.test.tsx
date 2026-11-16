import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { InventoryItem } from '../../../services/eventServices';

const mockGetItemLots = vi.fn();
const mockAddItemLot = vi.fn();
const mockUpdateLot = vi.fn();
const mockDeleteLot = vi.fn();
const mockToastError = vi.fn();
const mockGetItemPlacements = vi.fn();

vi.mock('../../../services/medicalSuppliesService', () => ({
  medicalSuppliesService: {
    getItemLots: (...a: unknown[]) => mockGetItemLots(...a) as unknown,
    addItemLot: (...a: unknown[]) => mockAddItemLot(...a) as unknown,
    updateLot: (...a: unknown[]) => mockUpdateLot(...a) as unknown,
    deleteLot: (...a: unknown[]) => mockDeleteLot(...a) as unknown,
    getItemPlacements: (...a: unknown[]) => mockGetItemPlacements(...a) as unknown,
  },
}));

vi.mock('../../../stores/authStore', () => {
  const state = { user: { timezone: 'UTC' } };
  return {
    useAuthStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state),
  };
});

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: (...a: unknown[]) => mockToastError(...a) as unknown },
}));

import { MedicalItemLotsModal } from './MedicalItemLotsModal';

const item = { id: 'item-1', name: 'Gauze Pads 4x4', size: null, quantity: 0 } as unknown as InventoryItem;

const lot = (overrides: Record<string, unknown> = {}) => ({
  id: 'lot-1',
  organization_id: 'org-1',
  inventory_item_id: 'item-1',
  lot_number: 'GZ-11',
  expiration_date: '2099-01-31',
  quantity: 6,
  received_date: '2026-09-01',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  ...overrides,
});

describe('MedicalItemLotsModal', () => {
  const onClose = vi.fn();
  const onChanged = vi.fn();

  beforeEach(() => {
    [
      mockGetItemLots,
      mockAddItemLot,
      mockUpdateLot,
      mockDeleteLot,
      mockToastError,
      mockGetItemPlacements,
      onClose,
      onChanged,
    ].forEach((m) => m.mockReset());
    mockGetItemLots.mockResolvedValue([
      lot(),
      lot({ id: 'lot-2', lot_number: 'GZ-09', expiration_date: '2000-01-01', quantity: 4 }),
    ]);
    mockAddItemLot.mockResolvedValue(lot({ id: 'lot-3' }));
    mockUpdateLot.mockResolvedValue(lot());
    mockDeleteLot.mockResolvedValue(undefined);
    mockGetItemPlacements.mockResolvedValue([]);
  });

  const renderModal = (canManage = true) =>
    renderWithRouter(
      <MedicalItemLotsModal item={item} canManage={canManage} onClose={onClose} onChanged={onChanged} />
    );

  it('shows no stock-lot controls for a supply kept on apparatus only', async () => {
    renderWithRouter(
      <MedicalItemLotsModal
        item={{ ...item, name: 'LUCAS device', apparatus_only: true }}
        canManage
        onClose={onClose}
        onChanged={onChanged}
      />
    );

    expect(await screen.findByText(/Kept on apparatus only, so there are no stock-room lots/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Where it is carried — LUCAS device' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add lot/ })).not.toBeInTheDocument();
    expect(mockGetItemLots).not.toHaveBeenCalled();
  });

  it('lists the lots and counts only the in-date ones as usable', async () => {
    renderModal();

    expect(await screen.findByText('GZ-11')).toBeInTheDocument();
    expect(screen.getByText(/Expired \d+d ago/)).toBeInTheDocument();
    expect(screen.getByText(/6 usable on hand across 2 lots/)).toBeInTheDocument();
  });

  it('adds a lot with the quantity typed and omits blank fields', async () => {
    const user = userEvent.setup();
    renderModal();
    await screen.findByText('GZ-11');

    await user.type(screen.getByLabelText(/^Quantity/), '12');
    await user.click(screen.getByRole('button', { name: 'Add lot' }));

    await waitFor(() => expect(mockAddItemLot).toHaveBeenCalled());
    const [itemId, payload] = mockAddItemLot.mock.calls[0] as [string, Record<string, unknown>];
    expect(itemId).toBe('item-1');
    expect(payload).toMatchObject({ quantity: 12 });
    expect(payload['lot_number']).toBeUndefined();
    expect(payload['expiration_date']).toBeUndefined();
  });

  it('sends a cleared expiration date as null so the clear persists', async () => {
    const user = userEvent.setup();
    renderModal();
    await screen.findByText('GZ-11');

    await user.click(screen.getByRole('button', { name: 'Edit lot GZ-11' }));
    await user.clear(screen.getByLabelText('Expiration date for lot GZ-11'));
    await user.clear(screen.getByLabelText('Quantity for lot GZ-11'));
    await user.type(screen.getByLabelText('Quantity for lot GZ-11'), '5');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(mockUpdateLot).toHaveBeenCalledWith('lot-1', { lot_number: 'GZ-11', expiration_date: null, quantity: 5 })
    );
  });

  it('deletes a lot only after confirmation, then refreshes the page on close', async () => {
    const user = userEvent.setup();
    renderModal();
    await screen.findByText('GZ-11');

    await user.click(screen.getByRole('button', { name: 'Delete lot GZ-11' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete lot' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete lot' }));

    await waitFor(() => expect(mockDeleteLot).toHaveBeenCalledWith('lot-1'));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the server's reason when a lot received against a reorder is refused", async () => {
    const refusal =
      'This lot was received against reorder "Gauze Pads 4x4", so it cannot be deleted. Adjust its quantity to 0 instead.';
    mockDeleteLot.mockRejectedValue({ response: { status: 409, data: { detail: refusal } } });
    const user = userEvent.setup();
    renderModal();
    await screen.findByText('GZ-11');

    await user.click(screen.getByRole('button', { name: 'Delete lot GZ-11' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete lot' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete lot' }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith(refusal));
    expect(screen.getByText('GZ-11')).toBeInTheDocument();
  });

  it('closes without a refresh when nothing changed', async () => {
    const user = userEvent.setup();
    renderModal();
    await screen.findByText('GZ-11');

    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(onChanged).not.toHaveBeenCalled();
  });

  it('is read-only for a member who can only view', async () => {
    renderModal(false);
    await screen.findByText('GZ-11');

    expect(screen.queryByRole('button', { name: /Edit lot/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add lot' })).not.toBeInTheDocument();
  });

  it('names a missing quantity on its field and adds nothing', async () => {
    const user = userEvent.setup();
    renderModal();
    await screen.findByText('GZ-11');

    await user.type(screen.getByLabelText(/^Lot #/), 'GZ-12');
    await user.click(screen.getByRole('button', { name: 'Add lot' }));

    const quantity = screen.getByLabelText(/^Quantity/);
    expect(quantity).toHaveAccessibleDescription('A new lot needs a whole number of 1 or more.');
    expect(quantity).toHaveFocus();
    expect(mockAddItemLot).not.toHaveBeenCalled();
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('puts a refused lot number on its field', async () => {
    mockAddItemLot.mockRejectedValue({
      response: { status: 422, data: { detail: [{ loc: ['body', 'lot_number'], msg: 'Lot number is too long' }] } },
    });
    const user = userEvent.setup();
    renderModal();
    await screen.findByText('GZ-11');

    await user.type(screen.getByLabelText(/^Lot #/), 'GZ-12');
    await user.type(screen.getByLabelText(/^Quantity/), '3');
    await user.click(screen.getByRole('button', { name: 'Add lot' }));

    await waitFor(() => {
      expect(screen.getByLabelText(/^Lot #/)).toHaveAccessibleDescription(/Lot number is too long\./);
    });
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('saves the rest of an edit and keeps a bad quantity flagged', async () => {
    const user = userEvent.setup();
    renderModal();
    await screen.findByText('GZ-11');

    await user.click(screen.getByRole('button', { name: 'Edit lot GZ-11' }));
    await user.clear(screen.getByLabelText('Lot number for lot GZ-11'));
    await user.type(screen.getByLabelText('Lot number for lot GZ-11'), 'GZ-11A');
    await user.clear(screen.getByLabelText('Quantity for lot GZ-11'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(mockUpdateLot).toHaveBeenCalledWith('lot-1', { lot_number: 'GZ-11A', expiration_date: '2099-01-31' })
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Lot saved, except quantity.');
    expect(screen.getByLabelText('Quantity for lot GZ-11')).toHaveAccessibleDescription(
      'Enter a whole number, 0 or more.'
    );
  });

  it('asks before Done throws away a typed lot', async () => {
    const user = userEvent.setup();
    renderModal();
    await screen.findByText('GZ-11');

    await user.type(screen.getByLabelText(/^Quantity/), '4');
    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(onClose).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: /Discard/ });
    await user.click(within(dialog).getByRole('button', { name: /Discard/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("asks before an edit row's Cancel throws a change away", async () => {
    const user = userEvent.setup();
    renderModal();
    await screen.findByText('GZ-11');

    await user.click(screen.getByRole('button', { name: 'Edit lot GZ-11' }));
    await user.type(screen.getByLabelText('Lot number for lot GZ-11'), 'X');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    const dialog = await screen.findByRole('dialog', { name: 'Discard changes?' });
    await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText('Lot number for lot GZ-11')).toHaveValue('GZ-11X');
  });

  it('shows the load failure instead of an empty list', async () => {
    mockGetItemLots.mockRejectedValue(new Error('Server unavailable'));
    renderModal();

    expect(await screen.findByRole('alert')).toHaveTextContent('Server unavailable');
    expect(screen.queryByText(/No stock lots yet/)).not.toBeInTheDocument();
  });
});
