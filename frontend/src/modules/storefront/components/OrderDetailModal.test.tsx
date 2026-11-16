import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider } from '../../../contexts/ConfirmContext';

const mockGetOrder = vi.fn();
const mockCancelOrder = vi.fn();
const mockRefundOrder = vi.fn();
const mockRecordPayment = vi.fn();
const mockAddOrderMessage = vi.fn();
const mockUpdateOrderStatus = vi.fn();
const mockSetOrderNotes = vi.fn();

vi.mock('../services/api', () => ({
  storefrontService: {
    getOrder: (...args: unknown[]) => mockGetOrder(...args) as unknown,
    cancelOrder: (...args: unknown[]) => mockCancelOrder(...args) as unknown,
    refundOrder: (...args: unknown[]) => mockRefundOrder(...args) as unknown,
    recordPayment: (...args: unknown[]) => mockRecordPayment(...args) as unknown,
    addOrderMessage: (...args: unknown[]) => mockAddOrderMessage(...args) as unknown,
    updateOrderStatus: (...args: unknown[]) => mockUpdateOrderStatus(...args) as unknown,
    setOrderNotes: (...args: unknown[]) => mockSetOrderNotes(...args) as unknown,
    markOrderPaid: vi.fn(),
    waiveOrderPayment: vi.fn(),
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

// ConfirmProvider is part of the app shell; cancelling, and closing with
// anything typed, ask first.
const renderModal = (onClose: () => void = vi.fn()) =>
  render(
    <ConfirmProvider>
      <OrderDetailModal orderId="o1" onClose={onClose} onChanged={vi.fn()} />
    </ConfirmProvider>
  );

const unprocessable = (loc: string[], msg: string) => ({
  response: { status: 422, data: { detail: [{ loc, msg }] } },
});

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
    expect(within(dialog).getByRole('button', { name: 'Record refund' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Cancel ORD-2026-0007' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Mark paid in full/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Waive payment' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Update status' })).not.toBeInTheDocument();
    // Nobody owes a cancelled order's remaining balance.
    expect(within(dialog).queryByText('Balance due')).not.toBeInTheDocument();
  });

  it('keeps a refused cancellation in the cancel section, with the reason still typed', async () => {
    mockCancelOrder.mockRejectedValue({
      response: { status: 409, data: { detail: 'A fulfilled order cannot be cancelled' } },
    });
    const user = userEvent.setup();
    renderModal();
    const dialog = await findOrderDialog();
    await within(dialog).findByText('Ship to the member');

    await user.type(within(dialog).getByLabelText(/Reason for cancelling/), 'Vendor discontinued it');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel ORD-2026-0007' }));
    const confirmDialog = await screen.findByRole('dialog', { name: 'Cancel ORD-2026-0007?' });
    await user.click(within(confirmDialog).getByRole('button', { name: 'Cancel order' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('A fulfilled order cannot be cancelled');
    expect(within(dialog).getByLabelText(/Reason for cancelling/)).toHaveValue('Vendor discontinued it');
    // A refusal does not reload the order, which would clear what was typed.
    expect(mockGetOrder).toHaveBeenCalledTimes(1);
  });

  it('puts a refused reason on its field', async () => {
    mockCancelOrder.mockRejectedValue(unprocessable(['body', 'reason'], 'Reason is too long'));
    const user = userEvent.setup();
    renderModal();
    const dialog = await findOrderDialog();
    await within(dialog).findByText('Ship to the member');

    await user.type(within(dialog).getByLabelText(/Reason for cancelling/), 'Vendor discontinued it');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel ORD-2026-0007' }));
    const confirmDialog = await screen.findByRole('dialog', { name: 'Cancel ORD-2026-0007?' });
    await user.click(within(confirmDialog).getByRole('button', { name: 'Cancel order' }));

    await waitFor(() => {
      expect(within(dialog).getByLabelText(/Reason for cancelling/)).toHaveAccessibleDescription(
        /Reason is too long\./
      );
    });
  });

  it('asks before Close throws away a typed cancellation reason', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderModal(onClose);
    const dialog = await findOrderDialog();
    await within(dialog).findByText('Ship to the member');

    await user.type(within(dialog).getByLabelText(/Reason for cancelling/), 'Vendor discontinued it');
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Discard changes' })).toBeInTheDocument();
  });
});

// The payment, status, update and notes sections, each its own form (forms
// review batch 20).
const formOrder = {
  id: 'o1',
  orderNumber: 'ORD-2026-0001',
  customerName: 'A. Member',
  customerEmail: 'member@example.test',
  status: 'awaiting_payment',
  paymentStatus: 'unpaid',
  paymentMethod: 'venmo',
  paymentReference: null,
  adminNotes: null,
  total: '45.00',
  amountPaid: '0.00',
  balanceDue: '45.00',
  submittedAt: '2026-08-01T12:00:00Z',
  items: [],
  events: [],
};

describe('OrderDetailModal forms', () => {
  beforeEach(() => {
    mockGetOrder.mockReset();
    mockGetOrder.mockResolvedValue(structuredClone(formOrder));
    mockRecordPayment.mockReset();
    mockAddOrderMessage.mockReset();
    mockUpdateOrderStatus.mockReset();
    mockSetOrderNotes.mockReset();
  });

  it('names a zero amount on its field and records nothing', async () => {
    const user = userEvent.setup();
    renderModal();
    const amount = await screen.findByLabelText('Amount');

    await user.clear(amount);
    await user.type(amount, '0');
    await user.click(screen.getByRole('button', { name: 'Record payment' }));

    expect(amount).toHaveAccessibleDescription('Enter an amount greater than zero.');
    expect(amount).toHaveFocus();
    expect(mockRecordPayment).not.toHaveBeenCalled();
  });

  it('puts a refused reference on its field and keeps what was typed', async () => {
    const user = userEvent.setup();
    mockRecordPayment.mockRejectedValue(unprocessable(['body', 'reference'], 'Reference is too long'));
    renderModal();
    const amount = await screen.findByLabelText('Amount');

    await user.clear(amount);
    await user.type(amount, '20');
    await user.type(screen.getByLabelText(/Reference/), 'VENMO-123');
    await user.click(screen.getByRole('button', { name: 'Record payment' }));

    await waitFor(() => {
      expect(screen.getByLabelText(/Reference/)).toHaveAccessibleDescription(/Reference is too long\./);
    });
    // A refusal used to reload the order, which reseeded both boxes.
    expect(screen.getByLabelText('Amount')).toHaveValue(20);
    expect(screen.getByLabelText(/Reference/)).toHaveValue('VENMO-123');
    expect(mockGetOrder).toHaveBeenCalledTimes(1);
  });

  it('keeps a refusal no field answers for in the section that sent it', async () => {
    const user = userEvent.setup();
    mockUpdateOrderStatus.mockRejectedValue({
      response: { status: 409, data: { detail: 'A cancelled order cannot be reopened' } },
    });
    renderModal();
    await screen.findByLabelText('Status');

    await user.click(screen.getByRole('button', { name: 'Update status' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('A cancelled order cannot be reopened');
  });

  it('names a missing update and a missing channel instead of greying out Send update', async () => {
    const user = userEvent.setup();
    renderModal();
    await screen.findByLabelText('Message to the member');

    const send = screen.getByRole('button', { name: 'Send update' });
    expect(send).toBeEnabled();
    await user.click(screen.getByRole('checkbox', { name: 'In-app notification' }));
    await user.click(screen.getByRole('checkbox', { name: 'Email' }));
    await user.click(send);

    expect(screen.getByLabelText('Message to the member')).toHaveAccessibleDescription('Write the update to send.');
    expect(screen.getByText('Choose in-app, email or both, so the member hears about it.')).toBeInTheDocument();
    expect(mockAddOrderMessage).not.toHaveBeenCalled();
  });

  it('asks before Close throws away a typed note', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal(onClose);
    await user.type(await screen.findByLabelText('Internal notes'), 'Called the member');

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes at once when nothing was typed', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal(onClose);
    await screen.findByLabelText('Internal notes');

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('OrderDetailModal overpaid orders', () => {
  const overpaidOrder = {
    ...structuredClone(shippedOrder),
    paymentStatus: 'paid',
    amountPaid: '73.15',
    balanceDue: '0.00',
    overpaidAmount: '5.00',
  };

  beforeEach(() => {
    mockGetOrder.mockReset();
    mockGetOrder.mockResolvedValue(structuredClone(overpaidOrder));
    mockRefundOrder.mockReset();
    mockRefundOrder.mockResolvedValue(structuredClone(shippedOrder));
  });

  it('says what is owed back and refunds exactly the excess', async () => {
    const user = userEvent.setup();
    renderModal();
    const dialog = await findOrderDialog();
    await within(dialog).findByText('Ship to the member');

    expect(dialog).toHaveTextContent('$5.00 more than the order total has been recorded');
    await user.click(within(dialog).getByRole('button', { name: 'Refund the $5.00 excess' }));
    const confirmDialog = await screen.findByRole('dialog', { name: 'Refund $5.00 to A. Member?' });
    await user.click(within(confirmDialog).getByRole('button', { name: 'Refund $5.00' }));

    await waitFor(() => expect(mockRefundOrder).toHaveBeenCalled());
    expect(mockRefundOrder).toHaveBeenCalledWith('o1', {
      amount: 5,
      reason: 'Refund of an overpayment',
      notifyMember: true,
    });
  });

  it('offers nothing extra when nothing was overpaid', async () => {
    mockGetOrder.mockResolvedValue({ ...structuredClone(overpaidOrder), overpaidAmount: '0.00', amountPaid: '68.15' });
    renderModal();
    const dialog = await findOrderDialog();
    await within(dialog).findByText('Ship to the member');

    expect(within(dialog).queryByRole('button', { name: /excess/ })).not.toBeInTheDocument();
  });
});

describe('OrderDetailModal refunds', () => {
  // W67b-8: Refund was one tap, asked nothing, and always refunded everything.
  const paidOrder = {
    ...structuredClone(shippedOrder),
    status: 'paid',
    paymentStatus: 'paid',
    amountPaid: '68.15',
    balanceDue: '0.00',
  };

  beforeEach(() => {
    mockGetOrder.mockReset();
    mockGetOrder.mockResolvedValue(structuredClone(paidOrder));
    mockRefundOrder.mockReset();
    mockRefundOrder.mockResolvedValue(structuredClone(paidOrder));
  });

  it('offers the whole amount paid, and refunds the amount and reason given once confirmed', async () => {
    const user = userEvent.setup();
    renderModal();
    const dialog = await findOrderDialog();
    await within(dialog).findByText('Ship to the member');

    const amount = within(dialog).getByLabelText('Amount to refund');
    expect(amount).toHaveValue(68.15);
    await user.clear(amount);
    await user.type(amount, '20');
    await user.type(within(dialog).getByLabelText(/Refund reason/), 'Hoodie returned');
    await user.click(within(dialog).getByRole('button', { name: 'Record refund' }));

    const confirmDialog = await screen.findByRole('dialog', { name: 'Refund $20.00 to A. Member?' });
    await user.click(within(confirmDialog).getByRole('button', { name: 'Refund $20.00' }));

    await waitFor(() => expect(mockRefundOrder).toHaveBeenCalled());
    expect(mockRefundOrder).toHaveBeenCalledWith('o1', {
      amount: 20,
      reason: 'Hoodie returned',
      notifyMember: true,
    });
  });

  it('records nothing when the officer backs out', async () => {
    const user = userEvent.setup();
    renderModal();
    const dialog = await findOrderDialog();
    await within(dialog).findByText('Ship to the member');

    await user.click(within(dialog).getByRole('button', { name: 'Record refund' }));
    const confirmDialog = await screen.findByRole('dialog', { name: 'Refund $68.15 to A. Member?' });
    await user.click(within(confirmDialog).getByRole('button', { name: 'Not now' }));

    expect(mockRefundOrder).not.toHaveBeenCalled();
  });

  it('names an amount above what was paid on its field, and asks nothing', async () => {
    const user = userEvent.setup();
    renderModal();
    const dialog = await findOrderDialog();
    await within(dialog).findByText('Ship to the member');

    const amount = within(dialog).getByLabelText('Amount to refund');
    await user.clear(amount);
    await user.type(amount, '100');
    await user.click(within(dialog).getByRole('button', { name: 'Record refund' }));

    expect(await within(dialog).findByText('Enter no more than the $68.15 paid.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /^Refund \$/ })).not.toBeInTheDocument();
    expect(mockRefundOrder).not.toHaveBeenCalled();
  });
});
