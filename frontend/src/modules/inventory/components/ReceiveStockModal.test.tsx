import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReceiveStockModal from './ReceiveStockModal';

const mockAddLotsBulk = vi.fn();
const mockGetItems = vi.fn();
const mockGetItem = vi.fn();

vi.mock('@/services/inventoryService', () => ({
  inventoryService: {
    addLotsBulk: (...args: unknown[]) => mockAddLotsBulk(...args) as unknown,
    getItems: (...args: unknown[]) => mockGetItems(...args) as unknown,
    getItem: (...args: unknown[]) => mockGetItem(...args) as unknown,
  },
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]): void => {
      mockToastSuccess(...args);
    },
    error: (...args: unknown[]): void => {
      mockToastError(...args);
    },
  },
}));

describe('ReceiveStockModal', () => {
  const onClose = vi.fn();
  const onReceived = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockAddLotsBulk.mockResolvedValue([{ id: 'lot-1' }]);
    mockGetItems.mockResolvedValue({ items: [{ id: 'i-1', name: '4x4 Gauze' }], total: 1 });
    mockGetItem.mockResolvedValue({ id: 'i-1', name: '4x4 Gauze' });
  });

  const open = () => render(<ReceiveStockModal isOpen onClose={onClose} onReceived={onReceived} />);

  /** Search the picker on the given line and choose the one result. */
  const pickItem = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByPlaceholderText('Search inventory…'), 'gauze');
    const result = await screen.findByText('4x4 Gauze');
    await user.click(result);
  };

  it('starts with a single empty line and nothing to submit', () => {
    open();
    expect(screen.getByText('Line 1')).toBeInTheDocument();
    expect(screen.queryByText('Line 2')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Receive 0 lots/ })).toBeDisabled();
  });

  it('adds a line on request', async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole('button', { name: /Add line/ }));
    expect(screen.getByText('Line 2')).toBeInTheDocument();
  });

  it('sends the picked item with its lot, expiration and quantity', async () => {
    const user = userEvent.setup();
    open();
    await pickItem(user);

    await user.type(screen.getByLabelText('Lot #'), 'LOT-A');
    await user.type(screen.getByLabelText('Expiration'), '2027-03-01');
    const qty = screen.getByLabelText('Quantity');
    await user.clear(qty);
    await user.type(qty, '24');

    await user.click(screen.getByRole('button', { name: /Receive 1 lot/ }));

    await waitFor(() => {
      expect(mockAddLotsBulk).toHaveBeenCalledWith([
        expect.objectContaining({
          inventory_item_id: 'i-1',
          quantity: 24,
          lot_number: 'LOT-A',
          expiration_date: '2027-03-01',
        }),
      ]);
    });
    expect(onReceived).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('omits a blank lot number rather than sending an empty string', async () => {
    const user = userEvent.setup();
    open();
    await pickItem(user);

    await user.click(screen.getByRole('button', { name: /Receive 1 lot/ }));

    await waitFor(() => {
      expect(mockAddLotsBulk).toHaveBeenCalledWith([expect.objectContaining({ inventory_item_id: 'i-1' })]);
    });
    const entries = mockAddLotsBulk.mock.calls[0]?.[0] as { lot_number?: string }[];
    expect(entries[0]?.lot_number).toBeUndefined();
  });

  it('refuses a line whose quantity is below one', async () => {
    const user = userEvent.setup();
    open();
    await pickItem(user);

    const qty = screen.getByLabelText('Quantity');
    await user.clear(qty);
    await user.type(qty, '0');

    await user.click(screen.getByRole('button', { name: /Receive 1 lot/ }));

    expect(mockAddLotsBulk).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining('quantity'));
  });

  it('keeps the modal open when the delivery is rejected', async () => {
    const user = userEvent.setup();
    mockAddLotsBulk.mockRejectedValue(new Error('nope'));
    open();
    await pickItem(user);

    await user.click(screen.getByRole('button', { name: /Receive 1 lot/ }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(expect.any(String));
    });
    // All or nothing: nothing landed, so the officer keeps what they typed.
    expect(onClose).not.toHaveBeenCalled();
    expect(onReceived).not.toHaveBeenCalled();
  });
});
