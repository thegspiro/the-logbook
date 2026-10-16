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

  it('shows the load failure instead of an empty list', async () => {
    mockGetItemLots.mockRejectedValue(new Error('Server unavailable'));
    renderModal();

    expect(await screen.findByRole('alert')).toHaveTextContent('Server unavailable');
    expect(screen.queryByText(/No stock lots yet/)).not.toBeInTheDocument();
  });
});
