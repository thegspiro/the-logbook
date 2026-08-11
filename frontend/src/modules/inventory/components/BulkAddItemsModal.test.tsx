/**
 * Stocking a catalog from a pasted list.
 *
 * The parsing has to survive the data supply catalogs actually contain —
 * names full of commas — and the write has to be honest about what it skipped.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

const mockCreateItemsBulk = vi.fn();
const mockToast = vi.fn();

vi.mock('@/services/inventoryService', () => ({
  inventoryService: {
    createItemsBulk: (...a: unknown[]) => mockCreateItemsBulk(...a) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: Object.assign((...a: unknown[]) => mockToast(...a) as unknown, {
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

import BulkAddItemsModal from './BulkAddItemsModal';
import { parseBulkLines } from '../utils/bulkItemLines';

describe('parseBulkLines', () => {
  it('reads one item per line', () => {
    expect(parseBulkLines('Gauze\nGloves')).toEqual([{ name: 'Gauze' }, { name: 'Gloves' }]);
  });

  it('keeps a comma inside the name', () => {
    // The reason the separator is a pipe: supply names are full of commas and
    // a comma-delimited format would cut this one in half.
    expect(parseBulkLines('Gauze Pads, 4x4 Sterile')).toEqual([{ name: 'Gauze Pads, 4x4 Sterile' }]);
  });

  it('reads the optional quantity and unit', () => {
    expect(parseBulkLines('Airway Set | 2 | Set')).toEqual([{ name: 'Airway Set', quantity: 2, unitOfMeasure: 'Set' }]);
  });

  it('ignores a quantity that is not a number', () => {
    expect(parseBulkLines('Gauze | lots')).toEqual([{ name: 'Gauze' }]);
  });

  it('accepts a quantity of zero', () => {
    // Zero on hand is a real answer for something not yet received.
    expect(parseBulkLines('Gauze | 0')).toEqual([{ name: 'Gauze', quantity: 0 }]);
  });

  it('drops blank lines and trims each one', () => {
    expect(parseBulkLines('  Gauze  \n\n   \nGloves')).toEqual([{ name: 'Gauze' }, { name: 'Gloves' }]);
  });

  it('drops a line whose name is empty', () => {
    expect(parseBulkLines('| 4 | Box')).toEqual([]);
  });
});

describe('BulkAddItemsModal', () => {
  const onClose = vi.fn();
  const onCreated = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateItemsBulk.mockResolvedValue({ created: 2, skipped: [], item_ids: ['a', 'b'] });
  });

  const open = () =>
    renderWithRouter(
      <BulkAddItemsModal
        isOpen
        onClose={onClose}
        onCreated={onCreated}
        categories={[{ id: 'cat-1', name: 'Medical' } as never]}
      />
    );

  it('counts what would be added before anything is written', async () => {
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText(/One item per line/), 'Gauze\nGloves');

    expect(screen.getByText('2 items to add')).toBeInTheDocument();
  });

  it('sends each line as a counted item', async () => {
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText(/One item per line/), 'Gauze | 24 | Box');
    await user.click(screen.getByRole('button', { name: /Add 1 item/ }));

    await waitFor(() => {
      expect(mockCreateItemsBulk).toHaveBeenCalledWith([
        { name: 'Gauze', tracking_type: 'pool', quantity: 24, unit_of_measure: 'Box' },
      ]);
    });
  });

  it('defaults a counted item with no stated quantity to none on hand', async () => {
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText(/One item per line/), 'Gauze');
    await user.click(screen.getByRole('button', { name: /Add 1 item/ }));

    // Nothing has been received yet, so zero — not one.
    await waitFor(() => {
      expect(mockCreateItemsBulk).toHaveBeenCalledWith([{ name: 'Gauze', tracking_type: 'pool', quantity: 0 }]);
    });
  });

  it('omits the category rather than sending an empty one', async () => {
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText(/One item per line/), 'Gauze');
    await user.click(screen.getByRole('button', { name: /Add 1 item/ }));

    await waitFor(() => {
      const entries = mockCreateItemsBulk.mock.calls[0]?.[0] as Record<string, unknown>[];
      expect(entries[0]).not.toHaveProperty('category_id');
    });
  });

  it('sends the chosen category with every line', async () => {
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText(/One item per line/), 'Gauze');
    await user.selectOptions(screen.getByLabelText('Category'), 'cat-1');
    await user.click(screen.getByRole('button', { name: /Add 1 item/ }));

    await waitFor(() => {
      expect(mockCreateItemsBulk).toHaveBeenCalledWith([expect.objectContaining({ category_id: 'cat-1' })]);
    });
  });

  it('reports the names it left alone', async () => {
    const user = userEvent.setup();
    mockCreateItemsBulk.mockResolvedValue({ created: 1, skipped: ['Gauze'], item_ids: ['a'] });
    open();

    await user.type(screen.getByLabelText(/One item per line/), 'Gauze\nGloves');
    await user.click(screen.getByRole('button', { name: /Add 2 items/ }));

    // Re-pasting a list that grew is the normal way this is used; the officer
    // needs to see which lines were already on file.
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('Gauze'), expect.anything());
    });
  });

  it('will not submit an empty list', () => {
    open();

    expect(screen.getByRole('button', { name: /Add item/ })).toBeDisabled();
  });

  it('keeps the modal open when the write fails', async () => {
    const user = userEvent.setup();
    mockCreateItemsBulk.mockRejectedValue(new Error('nope'));
    open();

    await user.type(screen.getByLabelText(/One item per line/), 'Gauze');
    await user.click(screen.getByRole('button', { name: /Add 1 item/ }));

    // The typed list is the officer's work; closing would discard it.
    await waitFor(() => {
      expect(onClose).not.toHaveBeenCalled();
    });
    expect(screen.getByLabelText(/One item per line/)).toHaveValue('Gauze');
  });
});
