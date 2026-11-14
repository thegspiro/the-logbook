import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

const mockGetOrder = vi.fn();

vi.mock('../services/api', () => ({
  storefrontService: {
    getOrder: (...args: unknown[]) => mockGetOrder(...args) as unknown,
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

const renderModal = () => render(<OrderDetailModal orderId="o1" onClose={vi.fn()} onChanged={vi.fn()} />);

describe('OrderDetailModal delivery details', () => {
  beforeEach(() => {
    mockGetOrder.mockReset();
    mockGetOrder.mockResolvedValue(structuredClone(shippedOrder));
  });

  it('shows where a shipped order goes and what the member asked for', async () => {
    renderModal();
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Ship to the member');

    expect(within(dialog).getByText(/12 Elm St/)).toHaveTextContent('12 Elm St Springfield');
    expect(within(dialog).getByText("Member's notes")).toBeInTheDocument();
    expect(within(dialog).getByText('Leave it with the neighbour')).toBeInTheDocument();
  });

  it('breaks the total into subtotal, tax and shipping', async () => {
    renderModal();
    const dialog = await screen.findByRole('dialog');
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
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Pick up');

    expect(within(dialog).queryByText(/12 Elm St/)).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Ship to')).not.toBeInTheDocument();
  });
});
