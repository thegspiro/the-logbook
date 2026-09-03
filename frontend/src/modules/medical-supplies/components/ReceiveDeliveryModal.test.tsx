import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

const mockReceiveDelivery = vi.fn();
const mockToastError = vi.fn();
const mockToastSuccess = vi.fn();

vi.mock('../../../services/medicalSuppliesService', () => ({
  medicalSuppliesService: {
    receiveDelivery: (...args: unknown[]) => mockReceiveDelivery(...args) as unknown,
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

const items = [
  { id: 'item-1', name: '4x4 Gauze' },
  { id: 'item-2', name: 'Epi 1:1000' },
] as never;

const renderModal = (overrides: { items?: never[]; loadError?: string | null } = {}) =>
  renderWithRouter(
    <ReceiveDeliveryModal
      items={overrides.items ?? items}
      loadError={overrides.loadError ?? null}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />
  );

describe('ReceiveDeliveryModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReceiveDelivery.mockResolvedValue([]);
  });

  it('records a complete line', async () => {
    renderModal();

    await userEvent.selectOptions(screen.getByLabelText(/^Item/), 'item-1');
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

    await userEvent.selectOptions(screen.getByLabelText(/^Item/), 'item-1');
    await userEvent.type(screen.getByLabelText('Qty'), '12');

    await userEvent.click(screen.getByRole('button', { name: 'Add line' }));
    const itemSelects = screen.getAllByLabelText(/^Item/);
    await userEvent.selectOptions(itemSelects[1] as HTMLElement, 'item-2');

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

    await userEvent.selectOptions(screen.getByLabelText(/^Item/), 'item-1');
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

  it('does not tell an officer to add a supply when the catalogue simply failed to load', async () => {
    // An empty `items` has two causes and only one of them is the officer's to
    // act on. Telling them to add a supply after a failed load sends them to
    // create a duplicate of stock the department already has.
    renderModal({ items: [], loadError: 'Network Error.' });

    expect(await screen.findByText(/The supply catalogue could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/Add a medical supply first/i)).not.toBeInTheDocument();
  });

  it('still advises adding a supply when the catalogue loaded and is genuinely empty', async () => {
    renderModal({ items: [], loadError: null });

    expect(await screen.findByText(/Add a medical supply first/i)).toBeInTheDocument();
    expect(screen.queryByText(/could not be loaded/i)).not.toBeInTheDocument();
  });
});
