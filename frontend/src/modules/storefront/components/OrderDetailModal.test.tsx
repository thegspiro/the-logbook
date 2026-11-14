import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider } from '../../../contexts/ConfirmContext';

const mockGetOrder = vi.fn();
const mockCancelOrder = vi.fn();

vi.mock('../services/api', () => ({
  storefrontService: {
    getOrder: (...args: unknown[]) => mockGetOrder(...args) as unknown,
    cancelOrder: (...args: unknown[]) => mockCancelOrder(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import { OrderDetailModal } from './OrderDetailModal';

const shippedOrder = {
  id: 'o1',
  organizationId: 'org1',
  orderNumber: 'ORD-2026-0007',
  customerName: 'A. Member',
  customerEmail: 'member@example.org',
  windowName: 'Winter 2026',
  status: 'awaiting_payment',
  paymentStatus: 'unpaid',
  paymentMethod: 'cash',
  subtotal: '60.00',
  taxAmount: '3.15',
  shippingAmount: '5.00',
  discountAmount: '0.00',
  total: '68.15',
  amountPaid: '0.00',
  balanceDue: '68.15',
  fulfillmentMethod: 'ship',
  shippingAddress: '12 Elm St\nSpringfield',
  memberNotes: 'Leave it with the neighbour',
  submittedAt: '2026-11-13T19:44:00Z',
  items: [
    {
      id: 'i1',
      productName: 'Station Hoodie',
      variantLabel: 'M',
      unitPrice: '45.00',
      quantity: 1,
      lineTotal: '45.00',
      fulfilledQuantity: 0,
    },
  ],
  events: [],
};

/** The <dd> paired with the <dt> reading `label`, found by role rather than DOM walking. */
const valueFor = (scope: HTMLElement, label: string): HTMLElement | undefined => {
  const terms = within(scope).getAllByRole('term');
  const index = terms.findIndex((term) => term.textContent === label);
  expect(index).toBeGreaterThanOrEqual(0);
  return within(scope).getAllByRole('definition')[index];
};

// ConfirmProvider is part of the app shell; cancelling asks first.
const renderModal = () =>
  render(
    <ConfirmProvider>
      <OrderDetailModal orderId="o1" onClose={vi.fn()} onChanged={vi.fn()} />
    </ConfirmProvider>
  );

/** The order dialog itself, as distinct from the confirmation dialog it opens. */
const findOrderDialog = () => screen.findByRole('dialog', { name: /Order ORD-2026-0007/ });

describe('OrderDetailModal delivery details', () => {
  beforeEach(() => {
    mockGetOrder.mockReset();
    mockGetOrder.mockResolvedValue(structuredClone(shippedOrder));
  });

  it('shows where a shipped order goes and what the member asked for', async () => {
    renderModal();
    const dialog = await findOrderDialog();
    await within(dialog).findByText('Ship to the member');

    expect(within(dialog).getByText(/12 Elm St/)).toHaveTextContent('12 Elm St Springfield');
    expect(within(dialog).getByText("Member's notes")).toBeInTheDocument();
    expect(within(dialog).getByText('Leave it with the neighbour')).toBeInTheDocument();
  });

  it('breaks the total into subtotal, tax and shipping', async () => {
    renderModal();
    const dialog = await findOrderDialog();
    await within(dialog).findByText('Ship to the member');

    expect(valueFor(dialog, 'Subtotal')).toHaveTextContent('$60.00');
    expect(valueFor(dialog, 'Tax')).toHaveTextContent('$3.15');
    expect(valueFor(dialog, 'Shipping')).toHaveTextContent('$5.00');
  });

  it('does not show a stored address on a pickup order', async () => {
    mockGetOrder.mockResolvedValue({
      ...structuredClone(shippedOrder),
      fulfillmentMethod: 'pickup',
      shippingAmount: '0.00',
      total: '63.15',
      balanceDue: '63.15',
    });
    renderModal();
    const dialog = await findOrderDialog();
    await within(dialog).findByText('Pick up');

    expect(within(dialog).queryByText(/12 Elm St/)).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Ship to')).not.toBeInTheDocument();
  });
});

describe('OrderDetailModal cancelling an order', () => {
  beforeEach(() => {
    mockGetOrder.mockReset();
    mockGetOrder.mockResolvedValue(structuredClone(shippedOrder));
    mockCancelOrder.mockReset();
    mockCancelOrder.mockResolvedValue({ ...structuredClone(shippedOrder), status: 'cancelled' });
  });

  it('cancels with the reason given, once the officer confirms', async () => {
    const user = userEvent.setup();
    renderModal();
    const dialog = await findOrderDialog();
    await within(dialog).findByText('Ship to the member');

    await user.type(within(dialog).getByLabelText(/Reason for cancelling/), 'Vendor discontinued it');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel ORD-2026-0007' }));

    const confirmDialog = await screen.findByRole('dialog', { name: 'Cancel ORD-2026-0007?' });
    await user.click(within(confirmDialog).getByRole('button', { name: 'Cancel order' }));

    expect(mockCancelOrder).toHaveBeenCalledWith('o1', { reason: 'Vendor discontinued it', notifyMember: true });
  });

  it('does nothing when the officer keeps the order', async () => {
    const user = userEvent.setup();
    renderModal();
    const dialog = await findOrderDialog();
    await within(dialog).findByText('Ship to the member');

    await user.click(within(dialog).getByRole('button', { name: 'Cancel ORD-2026-0007' }));
    const confirmDialog = await screen.findByRole('dialog', { name: 'Cancel ORD-2026-0007?' });
    await user.click(within(confirmDialog).getByRole('button', { name: 'Keep order' }));

    expect(mockCancelOrder).not.toHaveBeenCalled();
  });

  it('warns that money already recorded is not refunded by cancelling', async () => {
    mockGetOrder.mockResolvedValue({
      ...structuredClone(shippedOrder),
      paymentStatus: 'partial',
      amountPaid: '20.00',
      balanceDue: '48.15',
    });
    const user = userEvent.setup();
    renderModal();
    const dialog = await findOrderDialog();
    await within(dialog).findByText('Ship to the member');

    await user.click(within(dialog).getByRole('button', { name: 'Cancel ORD-2026-0007' }));
    const confirmDialog = await screen.findByRole('dialog', { name: 'Cancel ORD-2026-0007?' });

    expect(confirmDialog).toHaveTextContent('$20.00 has been recorded on this order');
    expect(confirmDialog).toHaveTextContent('Cancelling does not refund it');
  });

  it('on a cancelled order, offers the refund but none of the actions the server refuses', async () => {
    mockGetOrder.mockResolvedValue({
      ...structuredClone(shippedOrder),
      status: 'cancelled',
      paymentStatus: 'partial',
      amountPaid: '20.00',
      balanceDue: '48.15',
      cancelledAt: '2026-11-14T10:00:00Z',
      cancellationReason: 'Vendor discontinued it',
    });
    renderModal();
    const dialog = await findOrderDialog();
    await within(dialog).findByText('Ship to the member');

    expect(within(dialog).getByText(/Vendor discontinued it/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /Refund/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Cancel ORD-2026-0007' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Mark paid in full/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Waive payment' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Update status' })).not.toBeInTheDocument();
    // Nobody owes a cancelled order's remaining balance.
    expect(within(dialog).queryByText('Balance due')).not.toBeInTheDocument();
  });
});
