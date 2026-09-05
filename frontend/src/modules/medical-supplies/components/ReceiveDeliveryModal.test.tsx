import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

const mockReceiveDelivery = vi.fn();
const mockGetItems = vi.fn();
const mockToastError = vi.fn();
const mockToastSuccess = vi.fn();

vi.mock('../../../services/medicalSuppliesService', () => ({
  medicalSuppliesService: {
    receiveDelivery: (...args: unknown[]) => mockReceiveDelivery(...args) as unknown,
    getItems: (...args: unknown[]) => mockGetItems(...args) as unknown,
  },
}));

vi.mock('../../../stores/authStore', () => {
  const state = { user: { timezone: 'America/New_York' } };
  return {
    useAuthStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state),
  };
});

vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => mockToastSuccess(...args) as unknown,
    error: (...args: unknown[]) => mockToastError(...args) as unknown,
  },
}));

import { ReceiveDeliveryModal } from './ReceiveDeliveryModal';

const renderModal = () => renderWithRouter(<ReceiveDeliveryModal onClose={vi.fn()} onSaved={vi.fn()} />);

const chooseItem = async (input: HTMLElement, name: string, id: string) => {
  mockGetItems.mockImplementation(({ search }: { search?: string }) =>
    Promise.resolve({ items: search === name ? [{ id, name }] : [], total: 1, skip: 0, limit: 20 })
  );
  await userEvent.type(input, name);
  await userEvent.click(await screen.findByRole('option', { name }));
};

describe('ReceiveDeliveryModal', () => {
  beforeEach(() => {
    // mockReset, not just clearAllMocks: clearAllMocks wipes recorded calls but
    // leaves implementations AND any unconsumed mockRejectedValueOnce still
    // queued, so a failure-path test that returns before consuming its one-shot
    // hands it to whichever test calls that mock next -- and the picker's own
    // search tests arm exactly those. (CLAUDE.md pitfall #28.)
    [mockReceiveDelivery, mockGetItems, mockToastError, mockToastSuccess].forEach((mock) => mock.mockReset());
    vi.clearAllMocks();
    mockReceiveDelivery.mockResolvedValue([]);
    mockGetItems.mockResolvedValue({ items: [], total: 0, skip: 0, limit: 20 });
  });

  it('records a complete line', async () => {
    renderModal();

    await chooseItem(screen.getByLabelText(/^Item/), '4x4 Gauze', 'item-1');
    await userEvent.type(screen.getByLabelText('Qty'), '12');
    await userEvent.click(screen.getByRole('button', { name: 'Record delivery' }));

    await waitFor(() => expect(mockReceiveDelivery.mock.calls).toHaveLength(1));
    const entries = mockReceiveDelivery.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ inventory_item_id: 'item-1', quantity: 12 });
  });

  it('refuses a shipment where one line has an item but no quantity', async () => {
    // This used to be dropped by the same filter that selected the good lines:
    // the shipment went in short and still reported success, and the officer
    // only found out by recounting.
    renderModal();

    await chooseItem(screen.getByLabelText(/^Item/), '4x4 Gauze', 'item-1');
    await userEvent.type(screen.getByLabelText('Qty'), '12');

    await userEvent.click(screen.getByRole('button', { name: 'Add line' }));
    await chooseItem(screen.getByRole('combobox'), 'Epi 1:1000', 'item-2');

    await userEvent.click(screen.getByRole('button', { name: 'Record delivery' }));

    expect(mockReceiveDelivery).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining('missing its item or quantity'));
  });

  it('refuses a line with a quantity but no item', async () => {
    renderModal();

    await userEvent.type(screen.getByLabelText('Qty'), '5');
    await userEvent.click(screen.getByRole('button', { name: 'Record delivery' }));

    expect(mockReceiveDelivery).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining('missing its item or quantity'));
  });

  it('ignores a spare blank row alongside a complete one', async () => {
    // A blank row is just an unused slot, not a mistake — only rows the user
    // actually touched are held to the completeness rule.
    renderModal();

    await chooseItem(screen.getByLabelText(/^Item/), '4x4 Gauze', 'item-1');
    await userEvent.type(screen.getByLabelText('Qty'), '12');
    await userEvent.click(screen.getByRole('button', { name: 'Add line' }));

    await userEvent.click(screen.getByRole('button', { name: 'Record delivery' }));

    await waitFor(() => expect(mockReceiveDelivery.mock.calls).toHaveLength(1));
    const entries = mockReceiveDelivery.mock.calls[0]?.[0] as unknown[];
    expect(entries).toHaveLength(1);
  });

  it('asks for a line when nothing has been entered at all', async () => {
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: 'Record delivery' }));

    expect(mockReceiveDelivery).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining('at least one line'));
  });

  it('selects a delivery item through the server even when it is not on the table page', async () => {
    renderModal();

    await chooseItem(screen.getByLabelText(/^Item/), 'Record 250 supply', 'item-250');
    await userEvent.type(screen.getByLabelText('Qty'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Record delivery' }));

    await waitFor(() => expect(mockReceiveDelivery).toHaveBeenCalled());
    expect(mockGetItems).toHaveBeenCalledWith({
      search: 'Record 250 supply',
      active_only: true,
      skip: 0,
      limit: 20,
    });
    expect(mockReceiveDelivery).toHaveBeenCalledWith([
      expect.objectContaining({ inventory_item_id: 'item-250', quantity: 3 }),
    ]);
  });

  describe('the catalog picker', () => {
    it('says a search failed rather than reporting an empty catalog', async () => {
      // "No matching items." is a claim about the department's catalog. A
      // network, auth or server failure is not that, and the toast saying
      // otherwise is gone seconds later -- leaving an officer to conclude the
      // supply does not exist and abandon the delivery.
      mockGetItems.mockRejectedValue(new Error('offline'));

      renderModal();
      await userEvent.type(screen.getByLabelText(/^Item/), 'gauze');

      expect(await screen.findByText('Could not search the catalog.')).toBeInTheDocument();
      expect(screen.queryByText('No matching items.')).not.toBeInTheDocument();
    });

    it('selects the highlighted result with the keyboard', async () => {
      // It announces itself as a combobox; the native <select> it replaced
      // supported arrow keys and Enter. Without them Enter reaches the delivery
      // form and trips its missing-item validation instead of choosing a row.
      mockGetItems.mockResolvedValue({
        items: [
          { id: 'item-1', name: '4x4 Gauze' },
          { id: 'item-2', name: 'Trauma Shears' },
        ],
        total: 2,
        skip: 0,
        limit: 20,
      });

      renderModal();
      const input = screen.getByLabelText(/^Item/);
      await userEvent.type(input, 'a');
      await screen.findByRole('option', { name: 'Trauma Shears' });

      await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');

      expect(await screen.findByText('Trauma Shears')).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'Trauma Shears' })).not.toBeInTheDocument();
    });

    it('reaches matches beyond the first page', async () => {
      // Item names are not unique, so a department can legitimately have more
      // matches than one page -- and every one of them has to be selectable.
      //
      // Paged by `skip` rather than by a growing `limit`: the endpoint caps
      // limit at 500, so growing it returned 422 once a search had been paged
      // far enough, and the failure cleared every result already on screen.
      mockGetItems.mockImplementation(({ skip = 0, limit = 20 }: { skip?: number; limit?: number }) =>
        Promise.resolve({
          items: Array.from({ length: Math.max(0, Math.min(limit, 21 - skip)) }, (_unused, index) => ({
            id: `item-${skip + index}`,
            name: `Gauze ${skip + index}`,
          })),
          total: 21,
          skip,
          limit,
        })
      );

      renderModal();
      await userEvent.type(screen.getByLabelText(/^Item/), 'gauze');
      expect(await screen.findByRole('button', { name: /Show more \(20 of 21\)/ })).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: /Show more/ }));

      expect(await screen.findByRole('option', { name: 'Gauze 20' })).toBeInTheDocument();
    });
  });
});
